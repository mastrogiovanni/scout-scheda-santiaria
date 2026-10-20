import {utf8,decodeUtf8,base64url,unbase64url,digest} from './crypto.js';
export const SEGMENT_BYTES=400,DEFAULT_FPS=3,MAX_TRANSFER=2*1024*1024,MAX_EXPANDED=8*1024*1024;
async function collect(stream,limit){const reader=stream.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Payload QRVideo troppo grande.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;}
export async function encodeTransfer(payload){
  const raw=utf8(JSON.stringify(payload));if(raw.length>MAX_EXPANDED)throw Error('Il gruppo supera 8 MB di JSON. Riduci le schede selezionate.');
  let bytes=raw,codec='j';if(globalThis.CompressionStream&&globalThis.DecompressionStream){const compressed=await collect(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),MAX_TRANSFER);if(compressed.length<raw.length){bytes=compressed;codec='g';}}
  if(!bytes.length||bytes.length>MAX_TRANSFER)throw Error('Il trasferimento supera 2 MB. Riduci le schede selezionate.');
  const id=await digest(bytes),frames=[];for(let offset=0,index=0;offset<bytes.length;offset+=SEGMENT_BYTES,index++){
    const part=bytes.slice(offset,offset+SEGMENT_BYTES);frames.push(['SQV1',id,codec,bytes.length,SEGMENT_BYTES,index,part.length,(await digest(part)).slice(0,16),base64url(part)].join('|'));
  }return {frames,id,bytes:bytes.length,rawBytes:raw.length};
}
export class QRVideoReceiver{
  constructor(){this.reset();}
  reset(){this.meta=null;this.parts=new Map();this.receivedBytes=0;this.complete=false;}
  get progress(){return {count:this.parts.size,total:this.meta?.count||0,bytes:this.receivedBytes,totalBytes:this.meta?.total||0,received:[...this.parts.keys()]};}
  async accept(text){
    if(this.complete)return {duplicate:true};
    if(typeof text!=='string'||!text.startsWith('SQV1|'))return {ignored:true};
    if(text.length>1100)throw Error('Frammento QRVideo troppo lungo.');
    const fields=text.split('|');if(fields.length!==9)throw Error('Frammento QRVideo non valido.');
    const [,id,codec,totalText,sizeText,indexText,lengthText,checksum,encoded]=fields;
    if(!/^[\w-]{43}$/.test(id)||!['j','g'].includes(codec)||!/^[\w-]{16}$/.test(checksum)||![totalText,sizeText,indexText,lengthText].every(v=>/^\d{1,7}$/.test(v)))throw Error('Intestazione QRVideo non valida.');
    const total=Number(totalText),size=Number(sizeText),index=Number(indexText),length=Number(lengthText),count=Math.ceil(total/size);
    if(total<1||total>MAX_TRANSFER||size!==SEGMENT_BYTES||index>=count||length!==Math.min(size,total-index*size))throw Error('Dimensioni del frammento QRVideo non valide.');
    const part=unbase64url(encoded,800);if(part.length!==length||(await digest(part)).slice(0,16)!==checksum)throw Error('Frammento danneggiato: attendi il prossimo passaggio.');
    if(this.meta&&(id!==this.meta.id||codec!==this.meta.codec||total!==this.meta.total))return {otherTransfer:true};
    if(!this.meta)this.meta={id,codec,total,count};
    if(this.parts.has(index))return {duplicate:true};
    this.parts.set(index,part);this.receivedBytes+=length;
    if(this.parts.size<count)return {progress:this.progress};
    const bytes=new Uint8Array(total);for(const [i,p] of this.parts)bytes.set(p,i*size);
    if(await digest(bytes)!==id){this.reset();throw Error('Integrità del payload non verificata. Ricomincia la scansione.');}
    let raw=bytes;if(codec==='g'){if(!globalThis.DecompressionStream)throw Error('Questo browser non supporta la decompressione gzip. Aggiorna il browser.');raw=await collect(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_EXPANDED);}
    this.complete=true;return {payload:JSON.parse(decodeUtf8(raw)),progress:this.progress};
  }
}
export function drawProgress(canvas,progress){canvas.width=1000;canvas.height=28;const ctx=canvas.getContext('2d');ctx.fillStyle='#dbe2e8';ctx.fillRect(0,0,1000,28);canvas.setAttribute('aria-valuenow',String(progress.count));canvas.setAttribute('aria-valuemax',String(progress.total));if(!progress.total)return;for(const index of progress.received){ctx.fillStyle=index%2?'#267463':'#16365a';ctx.fillRect(index/progress.total*1000,0,Math.max(1,1000/progress.total-1),28);}}
