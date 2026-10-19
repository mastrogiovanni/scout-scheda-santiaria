import {startScanner} from '/src/qr.js';
import {QRVideoReceiver,drawProgress} from '/src/qrvideo.js';
import {validatePayload} from '/src/archive.js';
// The incomplete transfer exists only in memory; IndexedDB is populated atomically on completion.
export function setupPreparation({begin,commit,ready,available,onError}){
  const $=s=>document.querySelector(s),receiver=new QRVideoReceiver();let stop=null,sessionId=null,active=false,starting=false,initializing=false,committing=false,epoch=0,cameraAbort=null;
  const message=text=>$('#preparation-status').textContent=text;
  const stopScan=()=>{epoch++;cameraAbort?.abort();cameraAbort=null;stop?.();stop=null;$('#restart-camp-camera').disabled=false;};
  function progress(){const p=receiver.progress;drawProgress($('#fragment-progress'),p);$('#fragment-count').textContent=p.total?`${p.count} / ${p.total} frammenti · ${Math.round(p.bytes/p.totalBytes*100)}%`:'In attesa del primo frammento…';}
  async function activate(){
    if(starting||committing||!active||!sessionId)return;starting=true;stopScan();const cameraEpoch=epoch;cameraAbort=new AbortController();$('#restart-camp-camera').disabled=true;
    try{const close=await startScanner($('#camp-video'),async text=>{
      if(cameraEpoch!==epoch)return true;
      try{const result=await receiver.accept(text);if(cameraEpoch!==epoch)return true;
        if(result.otherTransfer){message('È inquadrato un altro trasferimento. Torna al QRVideo iniziale o ricomincia la preparazione.');return false;}
        if(result.ignored)return false;
        progress();if(!result.payload){message('Ricezione in corso. I frammenti mancanti arriveranno nei prossimi giri.');return false;}
        const transferSession=sessionId;committing=true;stopScan();message('Payload ricevuto. Verifica delle schede e salvataggio sul dispositivo…');
        const payload=result.payload;if(payload?.format!=='scout-qrvideo'||payload.version!==1||typeof payload.campName!=='string'||payload.campName.length>100||!Array.isArray(payload.sheets)||payload.sheets.length<1||payload.sheets.length>400)throw Error('Payload del campo non valido.');
        const records=[],ids=new Set();for(const sheet of payload.sheets){const data=await validatePayload(sheet),id=data.fiscalCode.toUpperCase();if(ids.has(id))throw Error('Payload con più schede dello stesso scout. Il capo deve selezionare una sola versione.');ids.add(id);records.push({id,data,archive:null,filename:id+'.zip',revision:crypto.randomUUID(),importedAt:new Date().toISOString()});}
        await ready();await commit(records,payload.campName,transferSession);active=false;sessionId=null;receiver.reset();progress();message('Preparazione completata. Modalità uso: le schede sono disponibili offline.');return true;
      }catch(error){message(error.message);if(receiver.complete){receiver.reset();progress();}return false;}finally{committing=false;}
    },error=>{message(error.message);$('#restart-camp-camera').disabled=false;},cameraAbort.signal);
    if(cameraEpoch!==epoch){close();return;}stop=close;
    }catch(error){message(error.message);}finally{starting=false;$('#restart-camp-camera').disabled=false;}
  }
  $('#prepare-qrvideo').onclick=async()=>{
    if(starting||initializing||committing||!available())return;
    if(!confirm('Entrare in preparazione? Tutte le schede precedenti di questo dispositivo saranno eliminate prima di attivare la videocamera.'))return;
    initializing=true;try{stopScan();active=false;sessionId=null;receiver.reset();progress();sessionId=await begin();active=true;$('#preparation-panel').hidden=false;message('Archivio precedente eliminato. Inquadra il QRVideo mostrato dal capo.');await ready();await activate();}catch(error){message(error.message);onError(error);}finally{initializing=false;}
  };
  $('#restart-camp-camera').onclick=async()=>{
    try{if(!sessionId)throw Error('Premi Prepara con QRVideo per iniziare una nuova preparazione.');active=true;await ready();await activate();}catch(error){message(error.message);onError(error);}
  };
  $('#pause-camp-camera').onclick=()=>{stopScan();message('Videocamera fermata. Puoi riattivarla per continuare la ricezione.');};
  window.addEventListener('pagehide',stopScan);
  return {restore(id){if(sessionId!==id){stopScan();receiver.reset();progress();}sessionId=id;active=!!id;},stop:stopScan};
}
