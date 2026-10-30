import {PDF_LIMITS,validateBatch,parseRanges,pageLayout,safeStem} from './pdf-engine.js';
const app=document.querySelector('.pdf-app');
if(app){
 const $=id=>document.getElementById('pdf-'+id),mode=app.dataset.pdfMode,images=['jpgpdf','pngpdf'].includes(mode),pageMode=['pdfjpg','pdfsplit'].includes(mode);
 let files=[],sequence=0,loading=false,busy=false,loadVersion=0,runVersion=0,estimateVersion=0,splitMode='range',activeId=null,worker=null,renderTask=null,pdfModule=null,outputURLs=[],archive=null,estimateTimer;
 const selected=new Set(),refs=()=>files.flatMap(f=>Array.from({length:f.pages},(_,i)=>({file:f,page:i+1,key:f.id+'-'+(i+1)})));
 const bytes=n=>new Intl.NumberFormat('id-ID').format(n)+' byte',size=n=>n>=1e6?(n/1e6).toLocaleString('id-ID',{maximumFractionDigits:2})+' MB':(n/1000).toLocaleString('id-ID',{maximumFractionDigits:1})+' KB';
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 function error(message){$('error').textContent=message;$('error').hidden=false;$('error').focus();}
 function clearError(){$('error').hidden=true;$('error').textContent='';}
 function setState(state){app.dataset.state=state;for(const [id,show] of [['empty',state==='empty'],['editor',state==='files'],['action-bar',state==='files'],['processing',state==='processing'],['result',state==='result']])$(id).hidden=!show;}
 function progress(value,note){$('progress').value=value;$('progress-value').textContent=value+'%';$('progress-note').textContent=note||'Mengolah halaman di perangkat Anda…';}
 async function getPDF(){if(!pdfModule){pdfModule=import('./vendor/pdfjs/pdf.mjs').then(m=>{m.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;return m;});}return pdfModule;}
 async function readPDF(file){
  const lib=await getPDF(),data=new Uint8Array(await file.arrayBuffer());
  return lib.getDocument({data,cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href,isEvalSupported:false,stopAtErrors:true,enableXfa:false}).promise;
 }
 async function renderPage(f,n,scale,canvas){
  const page=await f.doc.getPage(n),viewport=page.getViewport({scale});
  if(viewport.width*viewport.height>PDF_LIMITS.renderPixels)throw new Error('Resolusi halaman terlalu besar. Pilih resolusi lebih rendah.');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const task=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'});renderTask=task;
  try{await task.promise;}finally{if(renderTask===task)renderTask=null;page.cleanup();}return canvas;
 }
 async function thumbnail(f,n){const page=await f.doc.getPage(n),v=page.getViewport({scale:1}),canvas=document.createElement('canvas');return renderPage(f,n,Math.min(150/v.width,190/v.height),canvas);}
 async function imageData(file){
  const signature=new Uint8Array(await file.slice(0,16).arrayBuffer()),png=signature[0]===137&&signature[1]===80&&signature[2]===78&&signature[3]===71,jpg=signature[0]===255&&signature[1]===216&&signature[2]===255,webp=String.fromCharCode(...signature.slice(0,4))==='RIFF'&&String.fromCharCode(...signature.slice(8,12))==='WEBP';
  if(mode==='pngpdf'?!png:!png&&!jpg&&!webp)throw new Error(mode==='pngpdf'?'Pilih gambar PNG yang valid.':'Format tidak didukung. Pilih JPG, PNG atau WebP.');
  const url=URL.createObjectURL(file),image=new Image();
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Gambar rusak atau tidak dapat dibaca. Coba simpan ulang gambar.'));image.src=url;});if(image.naturalWidth*image.naturalHeight>PDF_LIMITS.pixels)throw new Error('Gambar melebihi 24 juta piksel. Kecilkan dimensinya dahulu.');return {image,url,width:image.naturalWidth,height:image.naturalHeight,kind:png?'png':jpg?'jpg':'webp'};}catch(e){URL.revokeObjectURL(url);throw e;}
 }
 function friendly(e){if(e.name==='PasswordException'||/encrypt|password/i.test(e.message))return 'PDF dilindungi kata sandi. Gunakan salinan tanpa kata sandi yang dapat Anda akses.';if(e.name==='InvalidPDFException'||e.name==='MissingPDFException')return 'PDF rusak atau tidak valid. Coba buka dan simpan ulang dari aplikasi asal.';return e.message||'File tidak dapat dibaca. Coba file lain.';}
 async function dispose(f){if(f.url)URL.revokeObjectURL(f.url);if(f.thumbURL)URL.revokeObjectURL(f.thumbURL);if(f.doc)await f.doc.destroy().catch(()=>{});}
 async function addFiles(incoming){
  if(loading||busy)return;clearError();const list=Array.from(incoming);if(!list.length)return;
  try{validateBatch([...files.map(f=>f.file),...list],images);}catch(e){error(e.message);return;}
  const version=++loadVersion;loading=true;$('loading').hidden=false;$('choose').disabled=true;$('run').disabled=true;let failure='';
  for(let i=0;i<list.length;i++){
   if(version!==loadVersion)break;const file=list[i];let record;
   $('loading-text').textContent=`Membaca file ${i+1} dari ${list.length} di perangkat Anda…`;
   try{
    if(images){const image=await imageData(file);record={id:++sequence,file,name:file.name,pages:1,...image};}
    else{
     const head=new TextDecoder().decode(await file.slice(0,1024).arrayBuffer());if(!head.includes('%PDF-'))throw new Error('File bukan PDF yang valid. Pilih file berformat .pdf.');
     const doc=await readPDF(file);record={id:++sequence,file,name:file.name,pages:doc.numPages,doc};
     if(files.reduce((n,f)=>n+f.pages,0)+record.pages>PDF_LIMITS.pages)throw new Error('Total melebihi 200 halaman. Proses lebih sedikit halaman atau file.');
     const canvas=await thumbnail(record,1),blob=await new Promise(r=>canvas.toBlob(r,'image/png'));record.thumbURL=URL.createObjectURL(blob);
    }
    if(version!==loadVersion){await dispose(record);break;}
    files.push(record);for(let n=1;n<=record.pages;n++)selected.add(record.id+'-'+n);activeId??=record.id;
   }catch(e){if(record)await dispose(record);if(version!==loadVersion)break;failure=file.name+': '+friendly(e);}
  }
  loading=false;$('loading').hidden=true;$('choose').disabled=false;
  await renderFiles();if(failure)error(failure);$('file').value='';
 }
 function button(label,content,action,id,disabled=false){const b=el('button','pdf-icon-button',content);b.type='button';b.setAttribute('aria-label',label);b.dataset.action=action;b.dataset.id=id;b.disabled=disabled;return b;}
 function updateSummary(){
  const total=files.reduce((n,f)=>n+f.pages,0),count=refs().filter(r=>selected.has(r.key)).length;
  $('file-summary').textContent=files.length+' file · '+total+' halaman · '+size(files.reduce((n,f)=>n+f.file.size,0));
  $('action-summary').textContent=files.length+' file · '+total+' halaman';
  $('action-detail').textContent=pageMode?(mode==='pdfsplit'&&splitMode==='all'?'Setiap halaman menjadi satu PDF.':mode==='pdfsplit'&&splitMode==='range'?'Setiap rentang menjadi satu PDF.':count+' halaman dipilih.'):'Urutan kartu menjadi urutan halaman.';
  $('run').disabled=loading||busy||!files.length||(mode==='pdfmerge'&&files.length<2)||(pageMode&&(mode==='pdfjpg'||splitMode==='selected')&&!count);
  if(mode==='pdfmerge'&&files.length===1)$('action-detail').textContent='Tambahkan satu PDF lagi untuk menggabungkan.';
  const all=$('select-all');all.checked=count===total;all.indeterminate=count>0&&count<total;
 }
 async function renderFiles(){
  const grid=$('file-grid');grid.replaceChildren();
  for(const [index,f] of files.entries()){
   const card=el('article','pdf-file-card');card.dataset.id=f.id;if(activeId===f.id&&images)card.classList.add('is-active');
   const top=el('div','pdf-card-top'),handle=button('Seret untuk memindahkan '+f.name,'⠿','drag',f.id);handle.draggable=true;handle.classList.add('pdf-drag-handle');top.append(handle,el('span','pdf-card-order',String(index+1).padStart(2,'0')),button('Hapus '+f.name,'×','remove',f.id));
   const picture=el(images?'button':'div','pdf-card-picture');if(images){picture.type='button';picture.dataset.action='preview';picture.dataset.id=f.id;picture.setAttribute('aria-label','Pratinjau '+f.name);picture.setAttribute('aria-pressed',String(activeId===f.id));}
   const img=el('img');img.src=f.url||f.thumbURL;img.alt='';img.width=150;img.height=140;picture.append(img);
   const name=el('strong','pdf-card-name',f.name);name.title=f.name;
   const meta=el('p','pdf-card-meta',size(f.file.size)+' · '+f.pages+' halaman');
   const moves=el('div','pdf-reorder');moves.append(button('Pindahkan '+f.name+' ke atas','↑','up',f.id,index===0),button('Pindahkan '+f.name+' ke bawah','↓','down',f.id,index===files.length-1),el('span',null,'Urutan '+(index+1)));
   card.append(top,picture,name,meta,moves);grid.append(card);
  }
  const add=el('button','pdf-add-card');add.type='button';add.dataset.action='add';add.append(el('span',null,'+'),el('strong',null,'Tambah file'),el('small',null,images?'Gambar berikutnya':'PDF berikutnya'));grid.append(add);
  setState(files.length?'files':'empty');$('pages-section').hidden=!pageMode;updateSummary();
  if(files.length&&images)drawFit();
  if(pageMode)await renderPages();
 }
 let pageVersion=0;
 async function renderPages(){
  const version=++pageVersion,grid=$('page-grid');grid.replaceChildren();
  if(!files.length)return;
  const checks=mode==='pdfjpg'||splitMode==='selected';$('select-all').closest('label').hidden=!checks;
  $('pages-help').textContent=checks?'Centang halaman yang ingin diproses.':'Nomor besar adalah nomor global. Nomor asal ditampilkan di bawahnya.';
  for(const [globalIndex,ref] of refs().entries()){
   if(version!==pageVersion||busy)break;
   const card=el('label','pdf-page-card');if(!checks)card.classList.add('is-readonly');
   const check=el('input');check.type='checkbox';check.checked=selected.has(ref.key);check.dataset.pageKey=ref.key;check.setAttribute('aria-label','Pilih halaman '+(globalIndex+1)+' dari '+ref.file.name);check.hidden=!checks;check.disabled=!checks;
   const thumb=el('div','pdf-page-picture'),number=el('span','pdf-page-number',String(globalIndex+1)),caption=el('span','pdf-page-caption',ref.file.name+' · hal. '+ref.page);card.append(check,thumb,number,caption);grid.append(card);
   try{const canvas=await thumbnail(ref.file,ref.page);if(version!==pageVersion)break;canvas.setAttribute('aria-hidden','true');thumb.append(canvas);}catch(e){if(version===pageVersion){card.append(el('span','pdf-thumb-error','Pratinjau tidak tersedia'));}}
   if(globalIndex%4===0)await new Promise(r=>setTimeout(r,0));
  }
  scheduleEstimate();
 }
 function settings(){return {paper:$('paper')?.value||'a4',orientation:$('orientation')?.value||'portrait',margin:Number($('margin')?.value??24),background:$('background')?.value||'#ffffff'};}
 function drawFit(){
  const f=files.find(x=>x.id===activeId)||files[0];if(!f)return;
  const s=settings();$('orientation').disabled=s.paper==='original';const b=pageLayout(f.width,f.height,s),canvas=$('fit'),c=canvas.getContext('2d');
  canvas.width=300;canvas.height=300;const scale=Math.min(268/b.pageWidth,268/b.pageHeight),w=b.pageWidth*scale,h=b.pageHeight*scale,ox=(300-w)/2,oy=(300-h)/2;
  c.clearRect(0,0,300,300);c.fillStyle=s.background;c.fillRect(ox,oy,w,h);c.strokeStyle='#9caaa4';c.strokeRect(ox,oy,w,h);c.drawImage(f.image,ox+b.x*scale,oy+b.y*scale,b.width*scale,b.height*scale);
  $('fit-caption').textContent=f.name;$('fit').setAttribute('aria-label','Pratinjau '+f.name+': seluruh gambar dimuat tanpa potong');
 }
 function scheduleEstimate(){if(mode!=='pdfjpg')return;clearTimeout(estimateTimer);const version=++estimateVersion;estimateTimer=setTimeout(()=>estimate(version),450);}
 async function estimate(version){
  if(busy||loading||version!==estimateVersion)return;const chosen=refs().filter(r=>selected.has(r.key));if(!chosen.length){$('estimate').textContent='Pilih setidaknya satu halaman.';return;}
  $('estimate').textContent='Menghitung perkiraan dari halaman pertama yang dipilih…';
  try{const canvas=document.createElement('canvas');await renderPage(chosen[0].file,chosen[0].page,Number($('resolution').value),canvas);if(version!==estimateVersion||busy)return;const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',Number($('quality').value)/100));canvas.width=canvas.height=1;if(version!==estimateVersion||busy)return;$('estimate').textContent='Perkiraan total ≈ '+size(blob.size*chosen.length)+' · berdasarkan satu halaman sampel; hasil dapat berbeda.';}catch(e){if(version===estimateVersion&&!busy)$('estimate').textContent=friendly(e);}
 }
 function groups(){const all=refs();if(splitMode==='all')return all.map((_,i)=>[i]);if(splitMode==='selected'){const group=all.flatMap((r,i)=>selected.has(r.key)?[i]:[]);if(!group.length)throw new Error('Pilih setidaknya satu halaman.');return [group];}return parseRanges($('ranges').value,all.length);}
 async function workerBuild(job){return new Promise((resolve,reject)=>{worker=new Worker(new URL('./pdf-worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(data.error)reject(new Error(data.error));else if(data.outputs)resolve(data.outputs);else if(data.progress!==undefined)progress(data.progress,data.progress>=90?'Menyimpan struktur PDF…':'Menyusun halaman PDF…');};worker.onerror=()=>reject(new Error('Modul PDF tidak dapat dimuat. Muat ulang halaman atau coba browser terbaru.'));worker.postMessage(job,job.files.map(f=>f.bytes.buffer));});}
 async function run(){
  if(busy||loading||!files.length)return;clearError();if(mode==='pdfmerge'&&files.length<2){error('Tambahkan minimal dua PDF.');return;}
  let splitGroups;try{if(mode==='pdfsplit')splitGroups=groups();}catch(e){error(e.message);$('ranges').setAttribute('aria-invalid','true');return;}
  ++estimateVersion;++pageVersion;clearTimeout(estimateTimer);renderTask?.cancel();renderTask=null;busy=true;const version=++runVersion;setState('processing');progress(0,'Menyiapkan file di perangkat Anda…');$('progress-title').setAttribute('tabindex','-1');$('progress-title').focus({preventScroll:true});
  try{
   let outputs=[];
   if(mode==='pdfjpg'){
    const chosen=refs().filter(r=>selected.has(r.key));if(!chosen.length)throw new Error('Pilih setidaknya satu halaman.');let totalSize=0;
    for(const [i,ref] of chosen.entries()){
     if(version!==runVersion)return;const canvas=document.createElement('canvas');await renderPage(ref.file,ref.page,Number($('resolution').value),canvas);
     const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',Number($('quality').value)/100));canvas.width=canvas.height=1;if(!blob)throw new Error('Gambar tidak dapat dibuat. Coba resolusi lebih rendah.');
     totalSize+=blob.size;if(totalSize>PDF_LIMITS.output)throw new Error('Hasil melebihi 150 MB. Pilih lebih sedikit halaman atau resolusi lebih rendah.');
     outputs.push({blob,name:`${safeStem(ref.file.name)}-${i+1}-halaman-${ref.page}.jpg`,pages:1});progress(Math.round((i+1)/chosen.length*90));await new Promise(r=>setTimeout(r,0));
    }
   }else{
    const inputs=[];for(const f of files){let bytes,kind=f.kind;if(kind==='webp'){const c=document.createElement('canvas');c.width=f.width;c.height=f.height;c.getContext('2d').drawImage(f.image,0,0);const blob=await new Promise(r=>c.toBlob(r,'image/png'));bytes=new Uint8Array(await blob.arrayBuffer());kind='png';c.width=c.height=1;}else bytes=new Uint8Array(await f.file.arrayBuffer());inputs.push({bytes,kind});if(version!==runVersion)return;}
    const result=await workerBuild({mode,files:inputs,settings:settings(),groups:splitGroups});outputs=result.map(f=>({...f,blob:new Blob([f.bytes],{type:f.type})}));
   }
   if(version!==runVersion)return;progress(94,'Menyiapkan unduhan…');await showResult(outputs,version);
  }catch(e){if(version===runVersion){setState('files');error('Proses belum selesai. '+friendly(e));}}
  finally{if(version===runVersion){busy=false;worker?.terminate();worker=null;updateSummary();}}
 }
 function revokeOutputs(){for(const url of outputURLs)URL.revokeObjectURL(url);outputURLs=[];archive=null;}
 async function showResult(outputs,version){
  revokeOutputs();const total=outputs.reduce((n,o)=>n+o.blob.size,0),pages=outputs.reduce((n,o)=>n+o.pages,0),container=$('result-files');container.replaceChildren();
  for(const out of outputs){const url=URL.createObjectURL(out.blob);outputURLs.push(url);const row=el('div','pdf-output-row'),info=el('div');info.append(el('strong',null,out.name),el('span',null,size(out.blob.size)+' · '+out.pages+' halaman'));const a=el('a','pdf-quiet','Unduh '+(mode==='pdfjpg'?'JPG':'PDF'));a.href=url;a.download=out.name;a.setAttribute('aria-label','Unduh '+out.name);row.append(info,a);container.append(row);}
  const link=$('download');if(outputs.length===1){link.href=outputURLs[0];link.download=outputs[0].name;link.textContent=mode==='pdfjpg'?'Unduh JPG':'Unduh PDF';$('result-note').textContent='Ukuran akhir: '+bytes(total)+'. File sumber tidak berubah.';}
  else{const {zipFiles}=await import('./studio-engine.js');archive=await zipFiles(outputs);if(version!==runVersion)return;const url=URL.createObjectURL(archive);outputURLs.push(url);link.href=url;link.download='hasil-toolmova.zip';link.textContent='Unduh semua · ZIP';$('result-note').textContent='Total isi: '+bytes(total)+' · ZIP: '+bytes(archive.size)+'. ZIP mengemas file tanpa kompresi tambahan.';}
  if(version!==runVersion)return;$('result-summary').textContent=outputs.length+' file · '+pages+' halaman · '+size(total);if(outputs.length===1)container.hidden=true;else container.hidden=false;
  progress(100,'Selesai.');setState('result');$('result-title').setAttribute('tabindex','-1');$('result-title').focus({preventScroll:true});app.scrollIntoView({block:'start',behavior:'instant'});
 }
 async function reset(){++loadVersion;++runVersion;++estimateVersion;++pageVersion;worker?.terminate();worker=null;renderTask?.cancel();renderTask=null;busy=false;loading=false;$('loading').hidden=true;clearTimeout(estimateTimer);await Promise.all(files.map(dispose));files=[];selected.clear();activeId=null;revokeOutputs();clearError();$('file').value='';$('choose').disabled=false;await renderFiles();$('choose').focus();}
 $('choose').addEventListener('click',()=>$('file').click());$('file').addEventListener('change',()=>addFiles($('file').files));$('clear').addEventListener('click',reset);$('restart').addEventListener('click',reset);$('run').addEventListener('click',run);
 $('load-cancel').addEventListener('click',()=>{++loadVersion;$('loading-text').textContent='Membatalkan pembacaan…';});
 $('cancel').addEventListener('click',()=>{++runVersion;worker?.terminate();worker=null;renderTask?.cancel();renderTask=null;busy=false;setState(files.length?'files':'empty');updateSummary();$('run').focus();});
 for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('is-dragging');});
 for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('is-dragging');if(type==='drop')addFiles(e.dataTransfer.files);});
 $('file-grid').addEventListener('click',async e=>{const b=e.target.closest('button[data-action]');if(!b||busy||loading)return;const id=Number(b.dataset.id),index=files.findIndex(f=>f.id===id);if(b.dataset.action==='add'){$('file').click();return;}if(index<0)return;if(b.dataset.action==='preview'){activeId=id;drawFit();document.querySelectorAll('.pdf-file-card').forEach(c=>c.classList.toggle('is-active',Number(c.dataset.id)===id));document.querySelectorAll('[data-action=preview]').forEach(c=>c.setAttribute('aria-pressed',String(Number(c.dataset.id)===id)));return;}if(b.dataset.action==='drag')return;if(b.dataset.action==='remove'){const [f]=files.splice(index,1);for(let n=1;n<=f.pages;n++)selected.delete(f.id+'-'+n);await dispose(f);if(activeId===id)activeId=files[0]?.id||null;}else{const dest=index+(b.dataset.action==='up'?-1:1);if(dest<0||dest>=files.length)return;[files[index],files[dest]]=[files[dest],files[index]];}await renderFiles();const focus=Array.from($('file-grid').querySelectorAll('button')).find(x=>x.dataset.id===String(id)&&x.dataset.action===b.dataset.action&&!x.disabled)||$('file-grid').querySelector('[data-action=add]');focus?.focus();});
 let dragged=null;$('file-grid').addEventListener('dragstart',e=>{const h=e.target.closest('.pdf-drag-handle');if(!h||busy||loading){e.preventDefault();return;}dragged=Number(h.dataset.id);e.dataTransfer.setData('text/plain',String(dragged));e.dataTransfer.effectAllowed='move';});
 $('file-grid').addEventListener('dragover',e=>{if(dragged&&e.target.closest('.pdf-file-card')){e.preventDefault();e.dataTransfer.dropEffect='move';}});
 $('file-grid').addEventListener('drop',async e=>{e.preventDefault();const target=e.target.closest('.pdf-file-card');if(!target||!dragged)return;const from=files.findIndex(f=>f.id===dragged),to=files.findIndex(f=>f.id===Number(target.dataset.id));if(from>=0&&to>=0&&from!==to){const [f]=files.splice(from,1);files.splice(to,0,f);await renderFiles();}dragged=null;});$('file-grid').addEventListener('dragend',()=>dragged=null);
 $('page-grid').addEventListener('change',e=>{if(!e.target.dataset.pageKey)return;if(e.target.checked)selected.add(e.target.dataset.pageKey);else selected.delete(e.target.dataset.pageKey);updateSummary();scheduleEstimate();});
 $('select-all').addEventListener('change',e=>{for(const r of refs())if(e.target.checked)selected.add(r.key);else selected.delete(r.key);$('page-grid').querySelectorAll('input').forEach(c=>c.checked=e.target.checked);updateSummary();scheduleEstimate();});
 for(const b of document.querySelectorAll('[data-split-mode]'))b.addEventListener('click',()=>{splitMode=b.dataset.splitMode;document.querySelectorAll('[data-split-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('range-field').hidden=splitMode!=='range';$('mode-help').textContent=splitMode==='selected'?'Halaman yang dicentang disimpan dalam satu PDF.':splitMode==='all'?'Setiap halaman disimpan sebagai PDF terpisah.':'Nomor halaman berlanjut mengikuti urutan file.';updateSummary();renderPages();});
 $('ranges')?.addEventListener('input',()=>$('ranges').removeAttribute('aria-invalid'));
 for(const id of ['paper','orientation','margin','background'])$(id)?.addEventListener('input',drawFit);
 for(const id of ['resolution','quality'])$(id)?.addEventListener('input',()=>{$('quality-value').textContent=$('quality').value+'%';scheduleEstimate();});
 window.addEventListener('pagehide',()=>{worker?.terminate();revokeOutputs();files.forEach(dispose);});
 app.dataset.ready='true';
}
