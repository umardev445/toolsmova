import {loadImage, validateDimensions, ToolError} from './engine.js';
export const STUDIO_LIMITS={file:25_000_000,batch:50_000_000,count:10,mergeCount:8,pixels:24_000_000,signaturePixels:12_000_000,zip:150_000_000};
const fail=(code)=>{throw new ToolError(code)};
export function mergeLayout(sizes,{width=1600,spacing=16,padding=24,direction='horizontal'}={}){
 if(sizes.length<2)fail('needTwo');
 if(sizes.length>STUDIO_LIMITS.mergeCount)fail('tooMany');
 if(!Number.isInteger(width)||width<100||width>6000)fail('badWidth');
 if(![spacing,padding].every(n=>Number.isInteger(n)&&n>=0&&n<=200))fail('badSpacing');
 for(const s of sizes)validateDimensions(s.width,s.height);
 if(sizes.reduce((n,s)=>n+s.width*s.height,0)>STUDIO_LIMITS.pixels)fail('pixels');
 const horizontal=direction==='horizontal';
 const usable=width-2*padding-(horizontal?spacing*(sizes.length-1):0);
 if(usable<sizes.length||width<=2*padding)fail('layoutTooSmall');
 let items=[],height;
 if(horizontal){
  const h=usable/sizes.reduce((n,s)=>n+s.width/s.height,0);let previous=0;
  for(let i=0;i<sizes.length;i++){
   const end=i===sizes.length-1?usable:Math.round(previous+sizes[i].width/sizes[i].height*h);
   items.push({x:padding+previous+i*spacing,y:padding,width:end-previous,height:Math.max(1,Math.round(h))});previous=end;
  }
  height=Math.max(1,Math.round(h))+2*padding;
 }else{
  let y=padding;
  for(const s of sizes){const h=Math.max(1,Math.round(usable*s.height/s.width));items.push({x:padding,y,width:usable,height:h});y+=h+spacing;}
  height=y-spacing+padding;
 }
 if(items.some(x=>x.width<1)||height>10000||width*height>STUDIO_LIMITS.pixels)fail('pixels');
 return {width,height,items};
}
export function createCanvas(width,height){validateDimensions(width,height);const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
export async function canvasBlob(canvas,type='image/png',quality=.9){
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new ToolError('encodingFailed')),type,quality));
 if(blob.type!==type)fail('encodingFailed');return blob;
}
export async function renderMerge(sources,options){
 const layout=mergeLayout(sources,options),canvas=createCanvas(layout.width,layout.height),ctx=canvas.getContext('2d');
 ctx.fillStyle=/^#[0-9a-f]{6}$/i.test(options.background)?options.background:'#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 sources.forEach((s,i)=>{const r=layout.items[i];ctx.drawImage(s.image,r.x,r.y,r.width,r.height)});
 return canvas;
}
export function cleanSignature(rgba,width,height,{threshold=220,softness=28,ink='original',trim=true}={}){
 if(width*height>STUDIO_LIMITS.signaturePixels)fail('signaturePixels');
 if(!Number.isFinite(threshold)||threshold<80||threshold>250||!Number.isFinite(softness)||softness<5||softness>70)fail('invalid');
 const data=new Uint8ClampedArray(rgba.length);let minX=width,minY=height,maxX=-1,maxY=-1;
 const colour=/^#[0-9a-f]{6}$/i.test(ink)?[1,3,5].map(i=>parseInt(ink.slice(i,i+2),16)):null;
 for(let i=0;i<rgba.length;i+=4){
  const light=.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2];
  const alpha=Math.round(Math.max(0,Math.min(1,(threshold-light)/softness))*rgba[i+3]);
  if(alpha){
   for(let k=0;k<3;k++)data[i+k]=colour?colour[k]:Math.max(0,Math.min(255,(rgba[i+k]-255*(1-alpha/255))/(alpha/255)));
   data[i+3]=alpha;
   if(alpha>12){const p=i/4,x=p%width,y=Math.floor(p/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  }
 }
 if(maxX<0)fail('noInk');
 const crop=trim?{x:Math.max(0,minX-12),y:Math.max(0,minY-12),width:Math.min(width-1,maxX+12)-Math.max(0,minX-12)+1,height:Math.min(height-1,maxY+12)-Math.max(0,minY-12)+1}:{x:0,y:0,width,height};
 return {data,crop};
}
export async function signatureCanvas(source,options){
 if(source.width*source.height>STUDIO_LIMITS.signaturePixels)fail('signaturePixels');
 const c=createCanvas(source.width,source.height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source.image,0,0);
 const {data,crop}=cleanSignature(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height,options);
 ctx.putImageData(new ImageData(data,c.width,c.height),0,0);
 if(!options.trim)return c;
 const output=createCanvas(crop.width,crop.height);output.getContext('2d').drawImage(c,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);c.width=c.height=1;return output;
}
export async function isHeic(file){const b=new Uint8Array(await file.slice(0,80).arrayBuffer());const text=String.fromCharCode(...b);return text.slice(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8));}
export async function loadStudioImage(file,expected=null,{signal}={}){
 if(!file?.size)fail('invalid');if(file.size>STUDIO_LIMITS.file)fail('tooLarge');
 if(expected!=='heic'){
  const source=await loadImage(file);if(expected&&source.format!==expected){source.image.close?.();fail('invalid');}return source;
 }
 if(!await isHeic(file))fail('invalid');if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const buffer=await file.arrayBuffer();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./heic-worker.js',import.meta.url),{type:'module'});let settled=false;
  const stop=()=>{worker.terminate();clearTimeout(timer);signal?.removeEventListener('abort',abort)};
  const error=code=>{if(settled)return;settled=true;stop();reject(new ToolError(code));};
  const abort=()=>{if(settled)return;settled=true;stop();reject(new DOMException('Aborted','AbortError'));};
  const timer=setTimeout(()=>error('heicError'),90_000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>error('heicError');
  worker.onmessage=({data})=>{if(settled)return;if(data.error){error(data.error);return;}settled=true;stop();
   try{validateDimensions(data.width,data.height);const c=createCanvas(data.width,data.height);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height),0,0);resolve({file,image:c,width:data.width,height:data.height,format:'heic'});}catch(e){reject(e);}
  };
  worker.postMessage({buffer},[buffer]);
 });
}
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=CRC_TABLE[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export async function zipFiles(files){
 if(files.reduce((n,f)=>n+f.blob.size,0)>STUDIO_LIMITS.zip)fail('zipError');
 const chunks=[],central=[];let offset=0,centralSize=0;const enc=new TextEncoder();
 const header=(size)=>{const b=new Uint8Array(size);return [b,new DataView(b.buffer)];};
 for(const file of files){
  const name=enc.encode(file.name.replace(/[\\/]/g,'_')),bytes=new Uint8Array(await file.blob.arrayBuffer()),crc=crc32(bytes);
  const [local,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);chunks.push(local,name,bytes);
  const [c,w]=header(46);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,bytes.length,true);w.setUint32(24,bytes.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);central.push(c,name);centralSize+=46+name.length;offset+=30+name.length+bytes.length;
 }
 const [end,v]=header(22);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
 return new Blob([...chunks,...central,end],{type:'application/zip'});
}
