import {detectFormat} from './engine.js';
import {STUDIO_LIMITS,loadStudioImage,isHeic,renderMerge,signatureCanvas,canvasBlob,zipFiles,createCanvas} from './studio-engine.js';
const config=JSON.parse(document.getElementById('site-data').textContent),tool=config.tool,u=config.studio;
const $=id=>document.getElementById(id),isMerge=tool.mode==='studio-merge',isSign=tool.mode==='studio-signature';
const fileInput=$('studio-file'),canvas=$('studio-canvas'),form=$('studio-run');
const state={files:[],sources:[],results:[],errors:[],busy:false,epoch:0,id:0,direction:'horizontal',view:'result',signature:null,undo:null,erase:false,stroke:null,abort:null,debounce:null,autoSign:false};
const number=new Intl.NumberFormat(config.locale),size=n=>`${(n/1000).toLocaleString(config.locale,{maximumFractionDigits:1})} KB · ${number.format(n)} ${u.bytes}`;
function text(el,t){el.textContent=t;return el;}
function element(tag,cls,t){const el=document.createElement(tag);if(cls)el.className=cls;if(t!==undefined)el.textContent=t;return el;}
function friendly(e){const code=e.code||e.message;return u[code]||({fileTooLarge:u.tooLarge,pixelLimit:u.pixels,invalidDimensions:u.pixels,unsupportedFormat:u.invalid,emptyFile:u.invalid,corruptImage:config.strings.corruptImage}[code])||u.unknown;}
function status(message,kind='normal'){$('studio-status').textContent=message;$('studio-status').dataset.kind=kind;}
function releaseSources(){for(const s of state.sources){s.image.close?.();if(s.image instanceof HTMLCanvasElement)s.image.width=s.image.height=1;}state.sources=[];}
function releaseResults(){for(const r of state.results)URL.revokeObjectURL(r.url);state.results=[];state.errors=[];state.signature=null;state.undo=null;state.erase=false;$('studio-erase')?.setAttribute('aria-pressed','false');canvas.classList.remove('is-erasing');$('studio-eraser')?.setAttribute('hidden','');renderResults();}
function setBusy(b){state.busy=b;document.querySelectorAll('.studio button,.studio input,.studio select').forEach(el=>el.disabled=b);$('studio-cancel').hidden=!b;$('studio-cancel').disabled=false;form.disabled=b||!state.files.length;fileInput.disabled=b;$('studio-undo')?.toggleAttribute('disabled',b||!state.undo);if(!b){renderQueue();$('studio-progress').hidden=true;}}
function cancel(){state.epoch++;state.abort?.abort();state.abort=null;state.stroke=null;setBusy(false);status(u.cancelled);}
function clear(){clearTimeout(state.debounce);state.autoSign=false;cancel();releaseSources();releaseResults();for(const f of state.files)URL.revokeObjectURL(f.url);state.files=[];fileInput.value='';state.view='result';$('studio-preview-dimensions').textContent='';$('studio-view-controls').hidden=true;canvas.hidden=true;$('studio-empty').hidden=false;$('studio-drop').hidden=false;$('studio-clear').hidden=true;renderQueue();status(u.statusReady);}
function options(){return{width:Number($('studio-width')?.value||1600),spacing:Number($('studio-spacing')?.value||0),padding:Number($('studio-padding')?.value||0),direction:state.direction,background:$('studio-background')?.value||'#ffffff',quality:Number($('studio-quality')?.value||90)/100,format:$('studio-format')?.value||tool.output||'png',threshold:Number($('studio-sensitivity')?.value||220),softness:Number($('studio-softness')?.value||28),ink:$('studio-ink')?.value||'original',trim:$('studio-trim')?.checked??true};}
function drawPreview(source){canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);canvas.hidden=false;$('studio-empty').hidden=true;$('studio-preview-dimensions').textContent=`${number.format(canvas.width)} × ${number.format(canvas.height)} px`;}
function drawSource(source){const c=createCanvas(source.width,source.height);c.getContext('2d').drawImage(source.image,0,0);drawPreview(c);c.width=c.height=1;}
async function previewResult(result){state.view='result';updateViewButtons();const token=state.epoch;try{const bitmap=await createImageBitmap(result.blob);if(token===state.epoch)drawPreview(bitmap);bitmap.close();}catch{status(u.failed,'error');}}
function updateViewButtons(){document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===state.view)));}
function queueAction(label,symbol,fn,disabled=false){const b=element('button','',symbol);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.disabled=state.busy||disabled;b.addEventListener('click',fn);return b;}
function renderQueue(){
 const list=$('studio-queue');list.replaceChildren();list.hidden=!state.files.length;$('studio-drop').hidden=state.files.length>0;$('studio-clear').hidden=!state.files.length;
 state.files.forEach((f,i)=>{
  const li=element('li');li.dataset.fileId=f.id;
  if(tool.input==='heic')li.append(element('span','queue-token','HEIC'));
  else{const img=element('img','queue-thumb');img.src=f.url;img.alt='';img.width=44;img.height=44;li.append(img);}
  const info=element('div','queue-info');const name=element('strong','queue-name',`${i+1}. ${f.file.name}`);name.title=f.file.name;info.append(name,element('div','queue-meta',size(f.file.size)));li.append(info);
  const actions=element('div','queue-buttons');
  if(isMerge){actions.append(queueAction(u.earlier,'↑',()=>reorder(i,-1),i===0),queueAction(u.later,'↓',()=>reorder(i,1),i===state.files.length-1));}
  actions.append(queueAction(u.remove,'×',()=>removeFile(i)));li.append(actions);list.append(li);
 });
 form.disabled=state.busy||!state.files.length;
}
function reorder(i,d){if(state.busy)return;[state.files[i],state.files[i+d]]=[state.files[i+d],state.files[i]];if(state.sources.length)[state.sources[i],state.sources[i+d]]=[state.sources[i+d],state.sources[i]];releaseResults();renderQueue();refreshMergePreview();}
function removeFile(i){if(state.busy)return;URL.revokeObjectURL(state.files[i].url);state.files.splice(i,1);state.epoch++;releaseSources();releaseResults();renderQueue();if(!state.files.length){clear();return;}preparePreview();}
function renderResults(){
 const section=$('studio-results'),list=$('studio-result-list');list.replaceChildren();section.hidden=!state.results.length&&!state.errors.length;
 for(const r of state.results){const row=element('div','studio-result');const img=element('img');img.src=r.url;img.alt='';img.width=62;img.height=62;const info=element('div');info.append(element('strong','',r.name),element('small','',`${u.dimensions}: ${r.width} × ${r.height} px\n${u.resultSize}: ${size(r.blob.size)}\n${u.inputSize}: ${size(r.inputBytes)}`));const a=element('a','btn btn-outline',u.download);a.href=r.url;a.download=r.name;a.setAttribute('aria-label',`${u.download}: ${r.name}`);a.addEventListener('click',e=>{if(state.busy||state.stroke)e.preventDefault();});row.append(img,info,a);list.append(row);}
 for(const error of state.errors)list.append(element('p','studio-result-error',`${error.name}: ${error.message}`));
 $('studio-zip').hidden=state.results.length<2;
}
async function addFiles(input){
 if(state.busy)return;const files=[...input];if(!files.length)return;
 const combined=isSign?files.slice(0,1):[...state.files.map(f=>f.file),...files];
 if((isSign&&files.length!==1)||combined.length>(isMerge?8:10)){status(u.tooMany,'error');return;}
 if(combined.some(f=>f.size>STUDIO_LIMITS.file)||combined.reduce((n,f)=>n+f.size,0)>STUDIO_LIMITS.batch){status(u.tooLarge,'error');return;}
 setBusy(true);const token=++state.epoch;
 try{
  for(const f of files){if(!f.size)throw Error('invalid');if(tool.input==='heic'){if(!await isHeic(f))throw Error('invalid');}else{const format=await detectFormat(f);if(tool.input&&format!==tool.input)throw Error('invalid');}}
  if(token!==state.epoch)return;
  state.autoSign=false;releaseSources();releaseResults();if(isSign){for(const f of state.files)URL.revokeObjectURL(f.url);state.files=[];}
  for(const file of files)state.files.push({file,id:++state.id,url:URL.createObjectURL(file)});
  renderQueue();status(u.loaded);
 }catch(e){if(token===state.epoch)status(friendly(e),'error');}
 finally{if(token===state.epoch)setBusy(false);fileInput.value='';}
 if(token===state.epoch)await preparePreview();
}
async function preparePreview(){
 if(!state.files.length||state.busy)return;const token=state.epoch;state.view='original';updateViewButtons();
 if(tool.input==='heic'){canvas.hidden=true;$('studio-empty').hidden=false;$('studio-view-controls').hidden=true;return;}
 setBusy(true);
 try{
  releaseSources();const fs=isMerge?state.files:[state.files[0]];
  for(const f of fs){const source=await loadStudioImage(f.file,tool.input);if(token!==state.epoch){source.image.close?.();return;}state.sources.push(source);}
  if(isSign&&state.sources[0].width*state.sources[0].height>STUDIO_LIMITS.signaturePixels)throw Error('signaturePixels');
  if(isMerge&&state.sources.length>=2)await refreshMergePreview();else drawSource(state.sources[0]);
  $('studio-view-controls').hidden=!isSign;
 }catch(e){if(token===state.epoch)status(friendly(e),'error');releaseSources();canvas.hidden=true;$('studio-empty').hidden=false;}
 finally{if(token===state.epoch)setBusy(false);}
}
async function refreshMergePreview(){if(!isMerge||state.sources.length<2)return;const token=state.epoch;try{const c=await renderMerge(state.sources,options());if(token!==state.epoch){c.width=c.height=1;return;}drawPreview(c);c.width=c.height=1;status(u.loaded);}catch(e){status(friendly(e),'error');canvas.hidden=true;$('studio-empty').hidden=false;}}
function addResult(blob,width,height,name,inputBytes){
 if(state.results.reduce((n,r)=>n+r.blob.size,0)+blob.size>STUDIO_LIMITS.zip)throw Error('batchOutput');
 const r={blob,width,height,name,inputBytes,url:URL.createObjectURL(blob)};state.results.push(r);renderResults();return r;
}
const outputName=(f,ext)=>`${f.file.name.replace(/\.[^.]+$/,'').replace(/[\\/\x00-\x1f]/g,'_').slice(0,110)||'image'}-toolmova-${f.id}.${ext}`;
async function run(){
 if(state.busy||!state.files.length)return;
 const token=++state.epoch;const opts=options();releaseResults();setBusy(true);state.abort=new AbortController();status(u.processing+'…');$('studio-progress').hidden=false;$('studio-progress').value=0;
 try{
  if(isMerge){
   if(state.files.length<2)throw Error('needTwo');
   if(state.sources.length!==state.files.length){releaseSources();for(const f of state.files){const s=await loadStudioImage(f.file);if(token!==state.epoch){s.image.close?.();return;}state.sources.push(s);}}
   const c=await renderMerge(state.sources,opts);const blob=await canvasBlob(c,opts.format==='png'?'image/png':'image/jpeg',opts.quality);
   if(token!==state.epoch){c.width=c.height=1;return;}
   addResult(blob,c.width,c.height,`photos-toolmova.${opts.format==='png'?'png':'jpg'}`,state.files.reduce((n,f)=>n+f.file.size,0));drawPreview(c);c.width=c.height=1;
  }else if(isSign){
   if(!state.sources.length){const source=await loadStudioImage(state.files[0].file);if(token!==state.epoch){source.image.close?.();return;}state.sources.push(source);}
   const c=await signatureCanvas(state.sources[0],opts),blob=await canvasBlob(c);
   if(token!==state.epoch){c.width=c.height=1;return;}
   state.autoSign=true;state.signature=c;addResult(blob,c.width,c.height,outputName(state.files[0],'png'),state.files[0].file.size);state.view='result';updateViewButtons();drawPreview(c);$('studio-eraser').hidden=false;$('studio-view-controls').hidden=false;
  }else{
   for(let i=0;i<state.files.length;i++){
    if(token!==state.epoch)return;
    const f=state.files[i];status(`${u.processing} ${i+1} / ${state.files.length}…`);let source,c;
    try{
     source=await loadStudioImage(f.file,tool.input,{signal:state.abort.signal});if(token!==state.epoch)return;
     c=createCanvas(source.width,source.height);const ctx=c.getContext('2d');
     if(tool.output==='jpeg'){ctx.fillStyle=opts.background;ctx.fillRect(0,0,c.width,c.height);}ctx.drawImage(source.image,0,0);
     const blob=await canvasBlob(c,tool.output==='png'?'image/png':'image/jpeg',opts.quality);if(token!==state.epoch)return;
     const r=addResult(blob,c.width,c.height,outputName(f,tool.output==='png'?'png':'jpg'),f.file.size);await previewResult(r);
    }catch(e){if(e.name==='AbortError')return;if(token===state.epoch){state.errors.push({name:f.file.name,message:friendly(e)});renderResults();}}
    finally{source?.image.close?.();if(source?.image instanceof HTMLCanvasElement)source.image.width=source.image.height=1;if(c)c.width=c.height=1;}
    if(token===state.epoch)$('studio-progress').value=(i+1)/state.files.length*100;
   }
  }
  if(token===state.epoch)status(state.results.length?u.done:u.failed,state.results.length?'normal':'error');
 }catch(e){if(token===state.epoch)status(friendly(e),'error');}
 finally{if(token===state.epoch){state.abort=null;setBusy(false);}}
}
function optionChanged(){
 $('quality-value')&&(text($('quality-value'),`${$('studio-quality').value}%`));
 for(const k of ['sensitivity','softness'])if($(k+'-value'))$(k+'-value').textContent=$('studio-'+k).value;
 const hadSignature=!!state.signature||state.autoSign;
 releaseResults();state.view='original';updateViewButtons();clearTimeout(state.debounce);
 if(isMerge)state.debounce=setTimeout(refreshMergePreview,100);
 else if(isSign&&hadSignature)state.debounce=setTimeout(run,150);
 else if(isSign&&state.sources[0])drawSource(state.sources[0]);
 else if(!isSign&&tool.input!=='heic'&&state.sources[0])drawSource(state.sources[0]);
}
async function commitSignature(){
 if(!state.signature)return;
 setBusy(true);const token=state.epoch;
 try{const blob=await canvasBlob(state.signature);if(token!==state.epoch)return;for(const r of state.results)URL.revokeObjectURL(r.url);state.results=[];addResult(blob,state.signature.width,state.signature.height,outputName(state.files[0],'png'),state.files[0].file.size);status(u.done);}
 catch(e){status(friendly(e),'error');}finally{if(token===state.epoch)setBusy(false);}
}
function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
canvas.addEventListener('pointerdown',e=>{
 if(!isSign||!state.erase||!state.signature||state.busy||state.view!=='result')return;
 e.preventDefault();const c=state.signature,ctx=c.getContext('2d',{willReadFrequently:true});state.undo=ctx.getImageData(0,0,c.width,c.height);state.stroke=point(e);canvas.setPointerCapture(e.pointerId);eraseAt(state.stroke,state.stroke);$('studio-undo').disabled=false;document.querySelectorAll('.studio-result a').forEach(a=>a.setAttribute('aria-disabled','true'));
});
function eraseAt(a,b){const ctx=state.signature.getContext('2d');ctx.save();ctx.globalCompositeOperation='destination-out';ctx.lineWidth=Number($('studio-brush').value);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x+.001,b.y+.001);ctx.stroke();ctx.restore();drawPreview(state.signature);}
canvas.addEventListener('pointermove',e=>{if(!state.stroke||!state.signature)return;e.preventDefault();const p=point(e);eraseAt(state.stroke,p);state.stroke=p;});
async function endStroke(e){if(!state.stroke)return;state.stroke=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);await commitSignature();}
canvas.addEventListener('pointerup',endStroke);canvas.addEventListener('pointercancel',endStroke);
$('studio-undo')?.addEventListener('click',async()=>{if(!state.undo||!state.signature||state.busy)return;state.signature.getContext('2d').putImageData(state.undo,0,0);state.undo=null;drawPreview(state.signature);await commitSignature();});
$('studio-erase')?.addEventListener('click',()=>{if(!state.signature)return;state.erase=!state.erase;state.view='result';updateViewButtons();drawPreview(state.signature);canvas.classList.toggle('is-erasing',state.erase);$('studio-erase').setAttribute('aria-pressed',String(state.erase));});
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{state.view=b.dataset.view;updateViewButtons();if(state.view==='original'&&state.sources[0]){drawSource(state.sources[0]);canvas.classList.remove('is-erasing');}else if(state.signature){drawPreview(state.signature);canvas.classList.toggle('is-erasing',state.erase);}});
for(const b of document.querySelectorAll('[data-preview-bg]'))b.addEventListener('click',()=>{document.querySelectorAll('[data-preview-bg]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));const v=b.dataset.previewBg,wrap=$('studio-canvas-wrap');wrap.style.backgroundImage=v==='transparent'?'':'none';wrap.style.backgroundColor={white:'#fff',cream:'#efe3c8',dark:'#172c37',transparent:''}[v];});
for(const b of document.querySelectorAll('[data-layout]'))b.addEventListener('click',()=>{state.direction=b.dataset.layout;document.querySelectorAll('[data-layout]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));optionChanged();});
for(const input of document.querySelectorAll('[data-studio-option]'))input.addEventListener('input',optionChanged);
for(const id of ['studio-choose','studio-add'])$(id).addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',()=>addFiles(fileInput.files));
const drop=$('studio-drop');drop.addEventListener('dragover',e=>{e.preventDefault();if(!state.busy)drop.classList.add('is-dragging')});drop.addEventListener('dragleave',()=>drop.classList.remove('is-dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('is-dragging');addFiles(e.dataTransfer.files)});
$('studio-clear').addEventListener('click',clear);$('studio-cancel').addEventListener('click',cancel);form.addEventListener('click',run);
$('studio-sample').addEventListener('click',async()=>{
 if(state.busy)return;setBusy(true);const token=state.epoch;
 try{
  const names=isSign?['signature-example.png']:isMerge?['sample-poster-a.jpg','sample-poster-b.jpg']:[tool.input==='heic'?'sample-poster.heic':tool.input==='webp'?'sample-poster.webp':'sample-poster-a.jpg'];
  const files=[];
  for(const name of names){const response=await fetch(new URL('./examples/'+name,import.meta.url));if(!response.ok)throw Error('unknown');const blob=await response.blob();files.push(new File([blob],name,{type:blob.type}));}
  if(token===state.epoch){setBusy(false);await addFiles(files);}
 }catch(e){if(token===state.epoch){setBusy(false);status(friendly(e),'error');}}
});
$('studio-zip').addEventListener('click',async()=>{
 if(state.busy||!state.results.length)return;const token=state.epoch;setBusy(true);
 try{const blob=await zipFiles(state.results);if(token!==state.epoch)return;const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='toolmova-images.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);}
 catch{if(token===state.epoch)status(u.zipError,'error');}finally{if(token===state.epoch)setBusy(false);}
});
window.addEventListener('pagehide',event=>{if(event.persisted)return;state.abort?.abort();releaseSources();for(const f of state.files)URL.revokeObjectURL(f.url);for(const r of state.results)URL.revokeObjectURL(r.url);});
