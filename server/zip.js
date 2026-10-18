import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {TEMPLATE,allFields,cleanData,validate} from '../src/schema.js';
import content from '../src/content.json' with {type:'json'};

export const MAX_ZIP=12*1024*1024;
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
// Read central-directory sizes before inflating, and enforce the limit again in
// zlib. Only the two expected files are accepted; no filesystem extraction occurs.
export function inspectZip(input){
  const b=Buffer.from(input);if(b.length>MAX_ZIP||b.length<22)throw Error('Dimensione ZIP non valida.');
  let end=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
  if(end<0||b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+8)!==2||b.readUInt16LE(end+10)!==2)throw Error('Struttura ZIP non valida.');
  const start=b.readUInt32LE(end+16),centralSize=b.readUInt32LE(end+12);
  if(start+centralSize!==end)throw Error('Indice ZIP non valido.');
  const files=new Map();let cursor=start;
  for(let n=0;n<2;n++){
    if(cursor+46>end||b.readUInt32LE(cursor)!==0x02014b50)throw Error('Voce ZIP non valida.');
    const flags=b.readUInt16LE(cursor+8),method=b.readUInt16LE(cursor+10),crc=b.readUInt32LE(cursor+16),size=b.readUInt32LE(cursor+20),expanded=b.readUInt32LE(cursor+24);
    const nameLength=b.readUInt16LE(cursor+28),extra=b.readUInt16LE(cursor+30),comment=b.readUInt16LE(cursor+32),local=b.readUInt32LE(cursor+42);
    if(cursor+46+nameLength+extra+comment>end)throw Error('Indice ZIP troncato.');
    const name=b.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    if(!['scheda.json','scheda-compatta.pdf'].includes(name)||files.has(name)||(flags&1)||![0,8].includes(method)||b.readUInt16LE(cursor+34)||expanded>(name==='scheda.json'?256*1024:16*1024*1024))throw Error('Contenuto ZIP non valido.');
    if(local+30>start||b.readUInt32LE(local)!==0x04034b50||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method)throw Error('Intestazione ZIP non valida.');
    const localName=b.readUInt16LE(local+26),localExtra=b.readUInt16LE(local+28),offset=local+30+localName+localExtra;
    if(offset+size>start||b.subarray(local+30,local+30+localName).toString('utf8')!==name)throw Error('Contenuto ZIP troncato.');
    const raw=b.subarray(offset,offset+size),bytes=method===8?inflateRawSync(raw,{maxOutputLength:Math.max(1,expanded)}):raw;
    if(bytes.length!==expanded||crc32(bytes)!==crc)throw Error('Contenuto ZIP danneggiato.');
    files.set(name,bytes);cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==end||!files.get('scheda-compatta.pdf')?.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('PDF compatto non valido.');
  const payload=JSON.parse(files.get('scheda.json').toString('utf8'));
  if(payload?.format!=='scout-sanitaria'||payload.version!==1||payload.template!==TEMPLATE||payload.templateSha256!==content.sourceSha256)throw Error('Modello ZIP non compatibile.');
  const data=payload.data,known=new Map(allFields.map(f=>[f.id,f]));
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Dati mancanti.');
  for(const [key,value] of Object.entries(data)){
    const f=known.get(key);
    if(!f||typeof value!==(f.type==='checkbox'?'boolean':'string')||(typeof value==='string'&&(value.length>(f.max||6000)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))))throw Error('Dati non validi.');
  }
  const clean=cleanData(data);if(Object.keys(validate(clean)).length)throw Error('Scheda incompleta.');
  return {data:clean,size:b.length,sha256:createHash('sha256').update(b).digest('hex')};
}
