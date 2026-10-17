import {readArchive} from '/src/archive.js';
export const MAX_PACKAGES=400;
const MAX_TOTAL=80*1024*1024;
const revision=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
export async function preparePackages(files){
  if(files.length>MAX_PACKAGES)throw Error(`Carica al massimo ${MAX_PACKAGES} pacchetti alla volta.`);
  if(files.reduce((sum,f)=>sum+f.size,0)>MAX_TOTAL)throw Error('Carica al massimo 80 MB alla volta.');
  const candidates=[],errors=[];let campName;let expanded=0;
  for(const file of files){
    try{
      if(file.size>MAX_TOTAL)throw Error('Archivio troppo grande.');
      const raw=await file.arrayBuffer();
      const zip=await window.JSZip.loadAsync(raw);
      const manifest=zip.file('campo.json');
      if(!manifest){candidates.push({file,raw});continue;}
      if(manifest._data?.uncompressedSize>4096)throw Error('Manifest del gruppo troppo grande.');
      const meta=JSON.parse(await manifest.async('string'));
      if(meta?.format!=='scout-campo'||meta.version!==1||typeof meta.campName!=='string'||meta.campName.length>100||!Number.isInteger(meta.count)||meta.count<1||meta.count>MAX_PACKAGES)throw Error('Backup del gruppo non compatibile.');
      const entries=Object.values(zip.files).filter(e=>!e.dir);
      const packs=entries.filter(e=>/^pacchetti\/[A-Za-z0-9-]+\.zip$/.test(e.name));
      if(packs.length!==meta.count||entries.length!==packs.length+1)throw Error('Contenuto del backup del gruppo non valido.');
      for(const entry of packs){
        const size=entry._data?.uncompressedSize;
        if(!Number.isFinite(size)||size>12*1024*1024)throw Error('Pacchetto nel backup troppo grande.');
        expanded+=size;if(expanded>MAX_TOTAL)throw Error('I pacchetti estratti superano 80 MB.');
      }
      // Check the complete backup structure and sizes before extracting its packages.
      const nested=[];
      for(const entry of packs){const bytes=await entry.async('uint8array');nested.push({file:new File([bytes],entry.name,{type:'application/zip'}),raw:bytes.slice().buffer});}
      candidates.push(...nested);campName??=meta.campName;
    }catch(error){errors.push({name:file.name,message:error.message||'ZIP non leggibile.'});}
  }
  if(candidates.length>MAX_PACKAGES)throw Error(`Massimo ${MAX_PACKAGES} schede per importazione.`);
  if(candidates.reduce((sum,c)=>sum+c.raw.byteLength,0)>MAX_TOTAL)throw Error('I pacchetti da importare superano 80 MB.');
  const records=[];
  for(const {file,raw} of candidates){
    try{
      const data=await readArchive(file);
      records.push({id:data.fiscalCode.toUpperCase(),data,archive:raw,filename:file.name.split('/').pop(),importedAt:new Date().toISOString(),revision:revision()});
    }catch(error){errors.push({name:file.name,message:error.message});}
  }
  return {records,errors,campName};
}
export function planImport(incoming,existing){
  const current=new Map(existing.map(r=>[r.id,r]));const unique=new Map();const errors=[...incoming.errors];let repeated=0;
  for(const record of incoming.records){
    const prior=unique.get(record.id);
    if(prior){if(JSON.stringify(prior.data)===JSON.stringify(record.data))repeated++;else errors.push({name:record.filename,message:'Due pacchetti diversi con lo stesso codice fiscale nel caricamento. È stato mantenuto il primo: importa gli aggiornamenti separatamente.'});continue;}
    unique.set(record.id,record);
  }
  const additions=[],conflicts=[];
  for(const record of unique.values()){
    const old=current.get(record.id);
    if(!old)additions.push({record,expectedRevision:null});
    else if(JSON.stringify(old.data)===JSON.stringify(record.data))repeated++;
    else conflicts.push({record,old,expectedRevision:old.revision});
  }
  return {additions,conflicts,repeated,errors,campName:incoming.campName};
}
export async function groupBackup(records,campName){
  if(!records.length)throw Error('Non ci sono schede da esportare.');
  const zip=new window.JSZip();zip.file('campo.json',JSON.stringify({format:'scout-campo',version:1,campName,count:records.length,exportedAt:new Date().toISOString()},null,2));
  records.forEach((record,i)=>zip.file(`pacchetti/scout-${String(i+1).padStart(3,'0')}.zip`,record.archive));
  return zip.generateAsync({type:'uint8array',compression:'STORE'});
}
