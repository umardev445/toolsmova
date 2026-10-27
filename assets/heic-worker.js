// Local, pinned decoder. No file data is sent over the network.
import initialize from './vendor/libheif-bundle.mjs';
self.onmessage=async({data})=>{
 try{
  const lib=await initialize({print:()=>{},printErr:()=>{}});
  const images=new lib.HeifDecoder().decode(new Uint8Array(data.buffer));
  if(!images?.length)throw Error('heicError');
  const image=images[0],width=image.get_width(),height=image.get_height();
  if(!width||!height||width>10000||height>10000||width*height>24_000_000)throw Error('pixels');
  const display=await new Promise((resolve,reject)=>image.display({data:new Uint8ClampedArray(width*height*4),width,height},d=>d?resolve(d):reject(Error('heicError'))));
  self.postMessage({width,height,pixels:display.data.buffer},[display.data.buffer]);
 }catch(error){self.postMessage({error:error.message==='pixels'?'pixels':'heicError'});}
};
