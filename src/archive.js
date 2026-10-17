import { TEMPLATE, allFields, cleanData, validate, fullName } from './schema.js';
import { compactPdf } from './pdf.js';
export async function createArchive(data) {
  const clean=cleanData(data);
  if(Object.keys(validate(clean)).length)throw Error('Completa i campi richiesti prima di scaricare.');
  const content=await (await fetch('/src/content.json')).json();
  const payload={format:'scout-sanitaria',version:1,template:TEMPLATE,templateSha256:content.sourceSha256,exportedAt:new Date().toISOString(),data:clean};
  const zip=new window.JSZip();
  zip.file('scheda.json',JSON.stringify(payload,null,2));
  zip.file('scheda-compatta.pdf',await compactPdf(clean));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
}
export async function readArchive(file) {
  if(file.size>12*1024*1024)throw Error('ZIP troppo grande: massimo 12 MB.');
  let zip;try{zip=await window.JSZip.loadAsync(await file.arrayBuffer());}catch{throw Error('Il file non è un archivio ZIP leggibile.');}
  const entries=Object.values(zip.files);
  if(entries.length>10 || entries.some(e=>!e.dir&&e._data?.uncompressedSize>16*1024*1024))throw Error('L’archivio supera i limiti consentiti.');
  const json=zip.file('scheda.json');
  if(!json)throw Error('Nello ZIP manca scheda.json. Usa uno ZIP esportato da questa applicazione.');
  if(json._data?.uncompressedSize>256*1024)throw Error('Il JSON supera il limite di 256 KB.');
  let payload;try{payload=JSON.parse(await json.async('string'));}catch{throw Error('Il JSON della scheda non è valido.');}
  const content=await(await fetch('/src/content.json')).json();
  if(payload?.format!=='scout-sanitaria'||payload.version!==1||payload.template!==TEMPLATE||payload.templateSha256!==content.sourceSha256)throw Error('Versione o modello dello ZIP non compatibile con questa scheda.');
  const data=payload.data;
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Dati della scheda mancanti.');
  const known=new Set(allFields.map(f=>f.id));
  for(const key of Object.keys(data))if(!known.has(key))throw Error('Il JSON contiene un campo non riconosciuto: '+key);
  for(const f of allFields)if(Object.hasOwn(data,f.id)) {
    if(typeof data[f.id] !== (f.type==='checkbox'?'boolean':'string'))throw Error('Tipo di dato non valido: '+f.label);
    if(typeof data[f.id]==='string'&&(data[f.id].length>(f.max||6000)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data[f.id])))throw Error('Contenuto non valido o troppo lungo: '+f.label);
  }
  const clean=cleanData(data);
  const errors=validate(clean);
  if(Object.keys(errors).length)throw Error('Lo ZIP contiene dati incompleti o non validi: '+allFields.find(f=>errors[f.id])?.label+'.');
  return clean;
}
export function download(bytes,name,mime) {
  const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function filename(d) {return fullName(d).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'scout';}
