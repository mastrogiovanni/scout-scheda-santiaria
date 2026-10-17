const DB_NAME='scout-sanitaria-campo';
let connection;
function openDatabase(){
  if(!connection)connection=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(Error('Il browser non permette il salvataggio sul dispositivo.'));return;}
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('scouts',{keyPath:'id'});db.createObjectStore('settings',{keyPath:'key'});};
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=undefined;};resolve(request.result);};
    request.onerror=()=>{connection=undefined;reject(request.error);};
    request.onblocked=()=>{connection=undefined;reject(Error('Chiudi le altre finestre dell’app per aggiornare la memoria.'));};
  });
  return connection;
}
async function transaction(stores,mode,work){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result;let error;
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(error||tx.error||Error('Salvataggio annullato. Nessuna modifica applicata.'));
    tx.onerror=()=>{};
    try{result=work(tx,reason=>{error=reason;tx.abort();});}catch(reason){error=reason;tx.abort();}
  });
}
export async function loadState(){
  const result={records:[],campName:''};
  await transaction(['scouts','settings'],'readonly',tx=>{
    tx.objectStore('scouts').getAll().onsuccess=e=>result.records=e.target.result;
    tx.objectStore('settings').get('campName').onsuccess=e=>result.campName=e.target.result?.value||'';
  });return result;
}
export async function saveScouts(changes,campName){
  await transaction(['scouts','settings'],'readwrite',(tx,abort)=>{
    const store=tx.objectStore('scouts');
    for(const {record,expectedRevision=null} of changes){
      if(!record.id)throw Error('Identificativo della scheda mancante.');
      store.get(record.id).onsuccess=e=>{
        if((e.target.result?.revision||null)!==expectedRevision){abort(Error('L’archivio è cambiato in un’altra finestra. Ricarica e ripeti l’importazione.'));return;}
        store.put(record);
      };
    }
    if(campName!==undefined)tx.objectStore('settings').put({key:'campName',value:campName});
  });
}
export async function saveCampName(value){await transaction(['settings'],'readwrite',tx=>tx.objectStore('settings').put({key:'campName',value}));}
export async function removeScout(id){await transaction(['scouts'],'readwrite',tx=>tx.objectStore('scouts').delete(id));}
export async function eraseGroup(){await transaction(['scouts','settings'],'readwrite',tx=>{tx.objectStore('scouts').clear();tx.objectStore('settings').clear();});}
export async function requestPersistence(){
  if(!navigator.storage?.persist)return false;
  return navigator.storage.persist();
}
