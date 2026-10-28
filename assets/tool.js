import{loadImage,processImage,toPixels,targetBytes,validateDimensions,fitCrop,resizeCrop,ToolError}from'./engine.js';

const page=JSON.parse(document.getElementById('site-data').textContent);
const S=page.strings,config=page.tool,$=id=>document.getElementById(id);
const cropMode=config.mode==='crop'||config.mode==='photo';
let source=null,sourceUrl=null,resultUrl=null,selection=null,ratio=config.ratio||null,revision=0,busy=false,resizeUnit='px';
const bytes=n=>new Intl.NumberFormat(page.locale).format(n)+' '+S.bytes;
const kb=n=>new Intl.NumberFormat(page.locale,{maximumFractionDigits:2}).format(n/1000)+' KB';
const fields=[...document.querySelectorAll('#tool-form input,#tool-form select,#tool-form button')];

function status(message='',kind='info'){$('tool-status').textContent=message;$('tool-status').dataset.kind=kind;$('tool-status').setAttribute('role',kind==='error'?'alert':'status');}
function errorText(error){const key=error instanceof ToolError?error.code:'processingFailed';return S[key]||S.processingFailed;}
function discardResult(){if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;$('result').hidden=true;$('preview-tabs').hidden=true;$('output-preview').hidden=true;showOriginal();}
function showOriginal(){if(!source)return;$('input-preview').hidden=cropMode;$('crop-stage').hidden=!cropMode;$('crop-controls').hidden=!cropMode;$('output-preview').hidden=true;$('preview-original').setAttribute('aria-pressed','true');$('preview-result').setAttribute('aria-pressed','false');}
function markDirty(){if(!busy){discardResult();status();}updateNotes();}
function setBusy(value){busy=value;fields.forEach(el=>el.disabled=value);if(!value&&config.fixedSize){$('width').readOnly=true;$('height').readOnly=true;$('unit').disabled=true;}if(!value&&config.mode==='photo')$('crop-ratio').disabled=true;$('process-btn').textContent=value?S.processing:S[config.action];$('tool-form').setAttribute('aria-busy',String(value));}
function currentLimit(){return config.mode==='compress'||$('use-limit')?.checked?targetBytes($('target-size').value,$('target-unit').value):null;}
function updateNotes(){try{$('target-note').textContent=bytes(targetBytes($('target-size').value,$('target-unit').value));}catch{$('target-note').textContent=S.validLimit;}
 for(const button of document.querySelectorAll('[data-preset]'))button.setAttribute('aria-pressed',String(Number(button.dataset.preset)===Number($('target-size').value)&&$('target-unit').value==='KB'));
 if($('quality-output'))$('quality-output').textContent=$('quality').value+'%';
 if($('limit-controls')&&config.mode!=='compress')$('limit-controls').hidden=!$('use-limit').checked;
 if($('pixel-note')&&source&&config.mode!=='compress'&&config.mode!=='crop'&&config.mode!=='convert'){
  try{const d=outputDimensions();$('pixel-note').textContent=d.width+' × '+d.height+' px';}catch{$('pixel-note').textContent=S.invalidDimensions;}
 }
}
function outputDimensions(){if(config.mode==='photo'){const dpi=Number($('dpi').value);return validateDimensions(toPixels(config.fixedSize[0],'cm',dpi),toPixels(config.fixedSize[1],'cm',dpi));}
 if(config.mode==='resize'){const u=$('unit').value,d=Number($('dpi').value);return validateDimensions(toPixels($('width').value,u,d),toPixels($('height').value,u,d));}
 if(cropMode)return validateDimensions(Math.round(selection.width),Math.round(selection.height));
 return{width:source.width,height:source.height};
}
function setSelection(next){if(!source)return;let w=Math.max(1,Math.min(source.width,next.width)),h=Math.max(1,Math.min(source.height,next.height));if(ratio){h=w/ratio;if(h>source.height){h=source.height;w=h*ratio;}}selection={x:Math.max(0,Math.min(source.width-w,next.x)),y:Math.max(0,Math.min(source.height-h,next.y)),width:w,height:h};
 const box=$('crop-box');box.style.left=selection.x/source.width*100+'%';box.style.top=selection.y/source.height*100+'%';box.style.width=selection.width/source.width*100+'%';box.style.height=selection.height/source.height*100+'%';
 for(const [id,key]of[['crop-x','x'],['crop-y','y'],['crop-w','width'],['crop-h','height']])$(id).value=Math.round(selection[key]);
 $('crop-caption').textContent=Math.round(selection.width)+' × '+Math.round(selection.height)+' px · '+S.cropInstruction;
}
async function acceptFile(file){if(busy)return;const id=++revision;discardResult();status(S.loading,'progress');let next;
 try{next=await loadImage(file);if(config.mode==='convert'&&next.format!=='png'){next.image.close?.();throw new ToolError('pngRequired');}if(id!==revision){next.image.close?.();return;}
  source?.image.close?.();if(sourceUrl)URL.revokeObjectURL(sourceUrl);source=next;sourceUrl=URL.createObjectURL(file);
  for(const id of['input-preview','crop-image']){$(id).src=sourceUrl;$(id).width=source.width;$(id).height=source.height;}$('file-name').textContent=file.name;$('file-meta').textContent=bytes(file.size)+' · '+source.width+' × '+source.height+' px';
  $('file-details').hidden=false;$('drop-zone').hidden=true;$('background-field').hidden=source.format==='jpeg';
  if(config.mode==='resize'){$('unit').value='px';resizeUnit='px';$('width').value=source.width;$('height').value=source.height;}
  if(cropMode){const initial=fitCrop(source.width,source.height,ratio);if(!ratio){initial.x=source.width*.05;initial.y=source.height*.05;initial.width=source.width*.9;initial.height=source.height*.9;}setSelection(initial);}
  showOriginal();status();updateNotes();
 }catch(error){if(id===revision)status(errorText(error),'error');}
}
$('choose-file').addEventListener('click',()=>$('file-input').click());$('replace-file').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',e=>{if(e.target.files?.[0])acceptFile(e.target.files[0]);e.target.value='';});
const drop=$('drop-zone');for(const type of['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();if(!busy)drop.classList.add('drag-over')});for(const type of['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('drag-over')});drop.addEventListener('drop',e=>{if(busy)return;if(e.dataTransfer.files.length!==1){status(S.oneFile,'error');return;}acceptFile(e.dataTransfer.files[0]);});
for(const button of document.querySelectorAll('[data-preset]'))button.addEventListener('click',()=>{$('target-size').value=button.dataset.preset;$('target-unit').value='KB';markDirty();});
for(const el of document.querySelectorAll('[data-option]'))el.addEventListener('input',markDirty);
$('use-limit')?.addEventListener('change',markDirty);
if(config.mode==='resize'){
 function unitValue(pixels,unit,dpi){return unit==='cm'?pixels*2.54/dpi:unit==='in'?pixels/dpi:pixels;}
 $('unit').addEventListener('change',()=>{if(!source)return;const dpi=Number($('dpi').value)||300;let w,h;try{w=toPixels($('width').value,resizeUnit,dpi);h=toPixels($('height').value,resizeUnit,dpi);}catch{w=source.width;h=source.height;}const unit=$('unit').value;$('width').value=unit==='px'?w:unitValue(w,unit,dpi).toFixed(3);$('height').value=unit==='px'?h:unitValue(h,unit,dpi).toFixed(3);resizeUnit=unit;markDirty();});
 for(const [id,other,multiplier]of[['width','height',()=>source.height/source.width],['height','width',()=>source.width/source.height]])$(id).addEventListener('input',()=>{if(source&&$('lock-aspect').checked){const value=Number($(id).value)*multiplier();if(Number.isFinite(value))$(other).value=$('unit').value==='px'?Math.max(1,Math.round(value)):value.toFixed(3);}markDirty();});
}
if(cropMode){
 $('crop-ratio').addEventListener('change',()=>{ratio=$('crop-ratio').value?Number($('crop-ratio').value):null;if(source)setSelection(fitCrop(source.width,source.height,ratio));markDirty();});
 const stage=$('crop-stage');let drag=null;
 stage.addEventListener('pointerdown',e=>{if(busy||!source||!$('crop-box').contains(e.target))return;e.preventDefault();drag={x:e.clientX,y:e.clientY,selection:{...selection},resize:e.target===$('crop-handle')};stage.setPointerCapture(e.pointerId);});
 stage.addEventListener('pointermove',e=>{if(!drag)return;const r=stage.getBoundingClientRect(),dx=(e.clientX-drag.x)*source.width/r.width,dy=(e.clientY-drag.y)*source.height/r.height,old=drag.selection;
  if(drag.resize)setSelection(resizeCrop(old,dx,dy,source.width,source.height,ratio));else setSelection({...old,x:old.x+dx,y:old.y+dy});
 });
 function endDrag(){if(drag){drag=null;markDirty();}}stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);
 $('crop-box').addEventListener('keydown',e=>{if(!source||busy||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const step=e.shiftKey?10:1,dx=e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,dy=e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0;if(e.target===$('crop-handle'))setSelection(resizeCrop(selection,dx,dy,source.width,source.height,ratio));else setSelection({...selection,x:selection.x+dx,y:selection.y+dy});markDirty();});
 for(const [id,key]of[['crop-x','x'],['crop-y','y'],['crop-w','width'],['crop-h','height']])$(id).addEventListener('change',()=>{if(!source)return;const v=Number($(id).value);if(!Number.isFinite(v))return;let next={...selection,[key]:v};if(ratio&&key==='height')next.width=v*ratio;setSelection(next);markDirty();});
}
$('preview-original').addEventListener('click',showOriginal);$('preview-result').addEventListener('click',()=>{if(!resultUrl)return;$('input-preview').hidden=true;$('crop-stage').hidden=true;$('crop-controls').hidden=true;$('output-preview').hidden=false;$('preview-original').setAttribute('aria-pressed','false');$('preview-result').setAttribute('aria-pressed','true');});
$('tool-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;if(!source){status(S.noImage,'error');$('choose-file').focus();return;}let options,id=revision;
 try{const dimensions=outputDimensions();options={mode:config.mode,limit:currentLimit(),...dimensions,crop:cropMode?{...selection}:undefined,quality:Number($('quality').value)/100,background:$('background').value,allowResize:config.mode==='compress'&&!$('keep-dimensions').checked,dpi:config.mode==='photo'||config.mode==='resize'?Number($('dpi').value):null,onProgress:()=>status(S.processing,'progress')};}
 catch(error){status(errorText(error),'error');return;}
 discardResult();setBusy(true);status(S.processing,'progress');
 try{const result=await processImage(source,options);if(id!==revision)return;if(options.limit&&result.blob.size>options.limit)throw new ToolError('cannotFit');
  resultUrl=URL.createObjectURL(result.blob);$('output-preview').src=resultUrl;$('output-preview').width=result.width;$('output-preview').height=result.height;$('result').hidden=false;$('preview-tabs').hidden=false;$('preview-result').click();
  $('result-bytes').textContent=bytes(result.blob.size);$('result-kb').textContent=kb(result.blob.size);$('stat-original').textContent=bytes(source.file.size);$('stat-dimensions').textContent=result.width+' × '+result.height+' px';
  const saving=(1-result.blob.size/source.file.size)*100;$('stat-saving').textContent=(saving>=0?'−':'+')+new Intl.NumberFormat(page.locale,{maximumFractionDigits:1}).format(Math.abs(saving))+'%';
  $('result-state-label').textContent=options.limit?S.withinLimit:S.ready;
  $('result-note').textContent=result.original?S.unchanged:result.resized?S.dimensionsChanged:options.dpi?S.densitySaved:S.reviewQuality;
  const name=source.file.name.replace(/\.[^.]*$/,'').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,80)||'photo';$('download-link').href=resultUrl;$('download-link').download=name+'-toolmova.jpg';$('download-link').removeAttribute('aria-disabled');
  status(result.original?S.unchanged:S.done);$('result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
 }catch(error){if(id===revision)status(errorText(error),'error');}finally{setBusy(false);}
});
$('start-again').addEventListener('click',()=>{if(busy)return;++revision;discardResult();source?.image.close?.();source=null;if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=null;$('tool-form').reset();$('file-details').hidden=true;$('drop-zone').hidden=false;$('crop-controls').hidden=true;$('background-field').hidden=config.mode!=='convert';status();updateNotes();$('choose-file').focus();});
window.addEventListener('pagehide',event=>{if(event.persisted)return;if(sourceUrl)URL.revokeObjectURL(sourceUrl);if(resultUrl)URL.revokeObjectURL(resultUrl);source?.image.close?.();});
updateNotes();
