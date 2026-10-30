import {buildPDFOutputs} from './pdf-engine.js';
self.onmessage=async({data})=>{
 try{const lib=await import('./vendor/pdf-lib.mjs');const outputs=await buildPDFOutputs(data,lib,value=>self.postMessage({progress:value}));self.postMessage({outputs},outputs.map(f=>f.bytes.buffer));}
 catch(e){self.postMessage({error:/encrypt|password/i.test(e.message)?'PDF dilindungi kata sandi. Simpan salinan tanpa kata sandi melalui aplikasi yang Anda gunakan, lalu coba lagi.':e.message||'PDF tidak dapat diproses. Coba file lain.'});}
};
