// Shared, deterministic PDF rules. No network requests or DOM dependencies.
export const PDF_LIMITS={pdf:50_000_000,image:25_000_000,batch:100_000_000,count:25,pages:200,pixels:24_000_000,renderPixels:12_000_000,output:150_000_000};
export function validateBatch(files,images=false){
 if(!files.length)throw new Error('Pilih setidaknya satu file.');
 if(files.length>PDF_LIMITS.count)throw new Error('Maksimal 25 file dalam satu proses.');
 if(files.some(f=>!f.size))throw new Error('File kosong tidak dapat diproses.');
 if(files.some(f=>f.size>(images?PDF_LIMITS.image:PDF_LIMITS.pdf)))throw new Error(images?'Ukuran gambar melebihi 25 MB.':'Ukuran PDF melebihi 50 MB.');
 if(files.reduce((n,f)=>n+f.size,0)>PDF_LIMITS.batch)throw new Error('Total ukuran file melebihi 100 MB. Tambahkan lebih sedikit file.');
}
export function parseRanges(value,total){
 if(!Number.isInteger(total)||total<1||total>PDF_LIMITS.pages)throw new Error('Jumlah halaman tidak valid.');
 if(!value.trim())throw new Error('Masukkan rentang halaman, misalnya 1-3, 5.');
 const seen=new Set();
 return value.split(',').map(part=>{
  const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if(!m)throw new Error('Gunakan angka dan rentang seperti 1-3, 5.');
  const start=Number(m[1]),end=Number(m[2]||m[1]);
  if(start<1||end<start||end>total)throw new Error(`Pilih halaman antara 1 dan ${total}, dengan rentang berurutan.`);
  const group=[];for(let i=start;i<=end;i++){if(seen.has(i))throw new Error('Halaman yang sama muncul di lebih dari satu rentang.');seen.add(i);group.push(i-1);}return group;
 });
}
export function pageLayout(width,height,{paper='a4',orientation='portrait',margin=24}={}){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Dimensi gambar tidak valid.');
 let pw=paper==='original'?width*.75:595.276,ph=paper==='original'?height*.75:841.89;
 if(paper!=='original'&&orientation==='landscape')[pw,ph]=[ph,pw];
 const m=Number(margin);if(![0,12,24,36].includes(m))throw new Error('Margin tidak valid.');
 if(paper==='original'){pw+=2*m;ph+=2*m;}
 if(pw>14400||ph>14400)throw new Error('Ukuran asli terlalu besar untuk PDF. Pilih A4.');
 const scale=Math.min((pw-2*m)/width,(ph-2*m)/height);
 return {pageWidth:pw,pageHeight:ph,width:width*scale,height:height*scale,x:(pw-width*scale)/2,y:(ph-height*scale)/2};
}
export function safeStem(name){return name.replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'dokumen';}
export async function buildPDFOutputs(job,lib,progress=()=>{}){
 const {PDFDocument,rgb}=lib,outputs=[];let outputSize=0;
 const add=async(doc,name)=>{const bytes=await doc.save();outputSize+=bytes.length;if(outputSize>PDF_LIMITS.output)throw new Error('Hasil terlalu besar. Proses lebih sedikit halaman.');outputs.push({bytes,name,type:'application/pdf',pages:doc.getPageCount()});};
 if(job.mode==='pngpdf'||job.mode==='jpgpdf'){
  const doc=await PDFDocument.create();
  for(let i=0;i<job.files.length;i++){
   const f=job.files[i],image=f.kind==='png'?await doc.embedPng(f.bytes):await doc.embedJpg(f.bytes);
   const box=pageLayout(image.width,image.height,job.settings),page=doc.addPage([box.pageWidth,box.pageHeight]);
   const colour=job.settings.background||'#ffffff';if(!/^#[0-9a-f]{6}$/i.test(colour))throw new Error('Warna latar tidak valid.');
   page.drawRectangle({x:0,y:0,width:box.pageWidth,height:box.pageHeight,color:rgb(parseInt(colour.slice(1,3),16)/255,parseInt(colour.slice(3,5),16)/255,parseInt(colour.slice(5,7),16)/255)});
   page.drawImage(image,{x:box.x,y:box.y,width:box.width,height:box.height});progress(Math.round((i+1)/job.files.length*90));
  }
  await add(doc,'foto-toolmova.pdf');return outputs;
 }
 const sources=[];for(const f of job.files)sources.push(await PDFDocument.load(f.bytes,{updateMetadata:false}));
 const refs=sources.flatMap((doc,source)=>Array.from({length:doc.getPageCount()},(_,page)=>({source,page})));
 if(!refs.length||refs.length>PDF_LIMITS.pages)throw new Error('Maksimal 200 halaman per proses.');
 if(job.mode==='pdfmerge'){
  const doc=await PDFDocument.create();let done=0;
  for(const source of sources){const pages=await doc.copyPages(source,source.getPageIndices());for(const p of pages)doc.addPage(p);done+=pages.length;progress(Math.round(done/refs.length*90));}
  await add(doc,'gabungan-toolmova.pdf');
 }else if(job.mode==='pdfsplit'){
  const groups=job.groups;
  if(!groups?.length)throw new Error('Pilih halaman yang ingin disimpan.');
  for(let i=0;i<groups.length;i++){
   const doc=await PDFDocument.create();
   for(const index of groups[i]){const ref=refs[index];if(!ref)throw new Error('Nomor halaman tidak valid.');const [p]=await doc.copyPages(sources[ref.source],[ref.page]);doc.addPage(p);}
   const label=groups[i].map(x=>x+1);await add(doc,`halaman-${label[0]}${label.length>1?'-'+label.at(-1):''}-${i+1}.pdf`);progress(Math.round((i+1)/groups.length*90));
  }
 }else throw new Error('Mode PDF tidak dikenal.');
 return outputs;
}
