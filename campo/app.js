import {setupPreparation} from './preparation.js';
import {fullName,dateIT} from '/src/schema.js';
import {dataBlocks} from '/src/pdf.js';
import {loadState,saveCampName,eraseGroup,requestPersistence,beginPreparation,completePreparation} from './store.js';

const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it');
let preparation=null,mode='unprepared',loadEpoch=0;
let records=[],campName='',selected=null,filter='all',query='',unit='',busy=false,offlineReady=false,storageAvailable=false,deferredInstall,refreshing=false;
const healthFilters={all:()=>true,allergies:d=>d.allergiesPresent==='yes',therapy:d=>d.currentPresent==='yes'||d.medicinesPresent==='yes'||d.administration==='yes',diet:d=>d.dietPresent==='yes'};
const filterNames={all:'Tutti gli scout',allergies:'Con allergie',therapy:'Terapie / farmaci',diet:'Diete particolari'};
function notice(message,error=false){$('#camp-notice').textContent=message;$('#camp-notice').className=message?'notice '+(error?'error':'success'):'';}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);$('#prepare-qrvideo').disabled=value||!storageAvailable||mode==='use';$('#erase-group').disabled=value||!storageAvailable;$('#save-name').disabled=value||mode!=='use';$('#confirm-erase').disabled=value||!$('#erase-confirmation').checked;$('#cancel-erase').disabled=value;}
function refreshList(){
  const visible=records.filter(r=>healthFilters[filter](r.data)&&(!unit||r.data.unit===unit)&&fold([r.data.name,r.data.surname,r.data.name+' '+r.data.surname,r.data.surname+' '+r.data.name,r.data.fiscalCode,r.data.memberCode,r.data.unit].join(' ')).includes(fold(query).trim())).sort((a,b)=>(a.data.surname+' '+a.data.name).localeCompare(b.data.surname+' '+b.data.name,'it'));
  for(const [key,test] of Object.entries(healthFilters))$('#count-'+key).textContent=records.filter(r=>test(r.data)).length;
  document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
  $('#result-count').textContent=`${visible.length} ${visible.length===1?'scout':'scout'}${filter!=='all'?' · '+filterNames[filter]:''}`;
  $('#clear-filters').hidden=!query&&!unit&&filter==='all';
  $('#scout-list').innerHTML=visible.length?visible.map(r=>{
    const d=r.data;return `<button class="scout-row ${r.id===selected?'selected':''}" data-id="${r.id}" aria-pressed="${r.id===selected}"><span class="scout-avatar" aria-hidden="true">${esc(d.name[0]+d.surname[0])}</span><span class="scout-label"><strong>${esc(d.surname)} ${esc(d.name)}</strong><span>${esc(d.unit)} · ${dateIT(d.birthDate)}</span><span class="scout-tags">${d.allergiesPresent==='yes'?'<i class="tag allergy">Allergie</i>':''}${healthFilters.therapy(d)?'<i class="tag">Terapie / farmaci</i>':''}${d.dietPresent==='yes'?'<i class="tag">Dieta</i>':''}${d.consent==='no'?'<i class="tag">Consenso negato</i>':''}</span></span><span class="row-arrow" aria-hidden="true">→</span></button>`;
  }).join(''):`<div class="empty-list"><strong>${records.length?'Nessuno scout trovato':'Il gruppo prende forma qui.'}</strong><p>${records.length?'Prova un altro nome o azzera i filtri.':'Sincronizza le schede con il QRVideo del capo.'}</p></div>`;
  $('#scout-list').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>selectScout(b.dataset.id));
}
function render(){
  $('#camp-title').textContent=campName||'Il nostro campo';
  $('#unit-filter').innerHTML='<option value="">Tutte le unità</option>'+[...new Set(records.map(r=>r.data.unit))].sort((a,b)=>a.localeCompare(b,'it')).map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join('');
  if(!records.some(r=>r.data.unit===unit))unit='';$('#unit-filter').value=unit;
  if(selected&&!records.some(r=>r.id===selected)){selected=null;$('#camp-workspace').classList.remove('show-detail');}
  refreshList();renderDetail();setBusy(busy);
}
function phoneHtml(value){
  return String(value||'').split(/[;,\n/]+/).filter(s=>s.trim()).map(part=>{
    const number=part.trim();return /^[+\d() .-]{5,}$/.test(number)?`<a class="phone-link" href="tel:${number.replace(/[^+\d]/g,'')}">${esc(number)} <span aria-hidden="true">↗</span></a>`:esc(number);
  }).join('<br>');
}
function contactHtml(d){
  const cards=['father','mother','guardian','extra'].filter(id=>d[id+'Name']||d[id+'Phone']).map(id=>`<article class="contact-tile"><span>${esc({father:'Padre',mother:'Madre',guardian:'Rappresentante',extra:d.extraRole||'Altro contatto'}[id])}</span><strong>${esc([d[id+'Name'],d[id+'Surname']].filter(Boolean).join(' '))}</strong>${phoneHtml(d[id+'Phone'])}</article>`);
  if(d.phone)cards.push(`<article class="contact-tile"><span>Recapito della scheda</span>${phoneHtml(d.phone)}</article>`);
  if(d.gpName||d.gpPhone)cards.push(`<article class="contact-tile"><span>Medico curante</span><strong>${esc(d.gpName)}</strong>${phoneHtml(d.gpPhone)}</article>`);
  if(d.landlines)cards.push(`<article class="contact-tile"><span>Altri numeri fissi</span>${phoneHtml(d.landlines)}</article>`);
  if(d.mobiles)cards.push(`<article class="contact-tile"><span>Altri cellulari</span>${phoneHtml(d.mobiles)}</article>`);
  return cards.join('');
}
function renderDetail(){
  const record=records.find(r=>r.id===selected);
  if(!record){$('#scout-detail').innerHTML='<div class="empty-detail"><span class="empty-symbol" aria-hidden="true"></span><h2>Ogni scout, una scheda.</h2><p>Seleziona un nome dall’elenco per consultare le informazioni sanitarie e chiamare i contatti.</p><p class="small">Tutte le schede caricate restano sul dispositivo, anche dopo la chiusura dell’app.</p></div>';return;}
  const d=record.data;
  const attention=[['allergies','Allergie'],['current','Patologie e terapie in corso'],['diet','Dieta e alimenti vietati'],['aids','Protesi e ausili'],['doctorNotes','Indicazioni per il medico'],['updates','Aggiornamenti']].filter(([id])=>d[id+'Present']==='yes').map(([id,label])=>`<article class="health-card ${id==='allergies'?'allergy-card':''}"><h3>${label}</h3><p>${esc(d[id+'Details'])}</p></article>`);
  if(d.mri==='yes')attention.push(`<article class="health-card allergy-card"><h3>Controindicazioni alla risonanza magnetica</h3><p>${esc(d.mriDetails||'Controindicazione dichiarata nella scheda.')}</p></article>`);
  if(d.contrast==='yes')attention.push(`<article class="health-card allergy-card"><h3>Reazioni a mezzi di contrasto / farmaci diagnostici</h3><p>${esc(d.contrastDetails)}</p></article>`);
  $('#scout-detail').innerHTML=`<button class="text-button back-list" id="back-list">← Torna agli scout</button><div class="detail-heading"><div class="eyebrow">${esc(d.unit)} · SCHEDA DEL ${dateIT(d.date)}</div><h2 tabindex="-1">${esc(fullName(d))}</h2><p>${esc(d.birthPlace)} · ${dateIT(d.birthDate)} <span class="identity-code">${esc(d.fiscalCode)}</span></p></div>${d.consent==='no'?'<div class="info-box warning"><strong>Consenso al trattamento negato nella scheda.</strong><p>La scelta espressa è riportata integralmente nei documenti e nel riepilogo.</p></div>':''}<nav class="detail-jumps" aria-label="Vai a una sezione della scheda"><a href="#health-summary">Salute</a><a href="#quick-contacts">Contatti</a><a href="#medicine-record">Farmaci</a><a href="#all-information">Scheda completa</a></nav><section id="health-summary" class="health-overview" aria-label="Informazioni sanitarie in evidenza">${attention.length?attention.join(''):'<div class="all-clear">Nessuna delle sezioni sanitarie in evidenza è stata compilata. Consulta comunque farmaci, vaccinazioni e scheda completa qui sotto.</div>'}</section><section id="quick-contacts" class="contact-section"><h3>Contatti a portata di mano</h3><div class="contact-grid">${contactHtml(d)}</div></section><section id="all-information" class="full-record"><h3>Tutte le informazioni della scheda</h3>${dataBlocks(d).map(([title,rows])=>`<details ${title.includes('Farmaci')?'id="medicine-record"':''} ${title.includes('Farmaci')||title.startsWith('Richiesta')?'open':''}><summary>${esc(title)}</summary><dl>${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></details>`).join('')}<details><summary>Dichiarazioni e consenso</summary><dl>${[['Dichiarante',d.declarant||fullName(d)],['Consenso',d.consent==='yes'?'Presto il consenso':'Non presto il consenso'],['Dichiarazioni confermate',d.declarationAccepted?'Sì':'No'],...(d.subjectType==='minor'?[['Dichiarazione sulle malattie trasmissibili',d.noContagion?'Confermata':'Non confermata']]:[]),['Luogo e data di compilazione',d.place+', '+dateIT(d.date)],['Prescrizione da consegnare',d.administration==='yes'&&d.prescriptionAttached?'Consegna confermata dal compilatore; documento da verificare separatamente':'Richiesta non necessaria']].map(([l,v])=>`<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="small">Le conferme digitali non attestano che siano state apposte le firme sulla carta.</p><button class="text-button" id="show-declaration">Leggi il testo delle dichiarazioni</button><div id="declaration-text" class="document-text" hidden></div></details></section><div class="record-footer"><span>Salvata il ${new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(record.importedAt))}</span></div>`;
  $('#back-list').onclick=()=>{$('#camp-workspace').classList.remove('show-detail');document.querySelector(`.scout-row[data-id="${selected}"]`)?.focus();};
  $('#show-declaration').onclick=async()=>{try{const content=await(await fetch('/src/content.json')).json();$('#declaration-text').textContent=content.declaration+'\n\n(*) Il punto 4 riguarda solo i minorenni.';$('#declaration-text').hidden=false;$('#show-declaration').hidden=true;}catch{notice('Testo non disponibile: completa la preparazione offline.',true);}};
}
function selectScout(id){selected=id;refreshList();renderDetail();$('#camp-workspace').classList.add('show-detail');$('#scout-detail h2')?.focus();if(matchMedia('(max-width:760px)').matches)$('#scout-detail').scrollIntoView({block:'start',behavior:'smooth'});}
async function reload(){const epoch=++loadEpoch,state=await loadState();if(epoch!==loadEpoch)return;records=state.records;campName=state.campName;mode=state.mode;document.body.dataset.mode=mode;$('#sync-screen').hidden=mode==='use';$('#camp-use').hidden=mode!=='use';$('#prepare-qrvideo').hidden=mode!=='unprepared';$('#preparation-panel').hidden=mode!=='preparation';preparation?.restore(state.preparationId);render();}
async function task(work){if(busy)return;setBusy(true);try{await work();}catch(error){notice(error.name==='QuotaExceededError'?'Memoria insufficiente: libera spazio sul dispositivo e ripeti la sincronizzazione.':error.message||'Operazione non riuscita.',true);}finally{setBusy(false);}}
function resetView(){loadEpoch++;preparation?.reset();records=[];campName='';selected=null;query='';unit='';filter='all';$('#scout-search').value='';$('#camp-name').value='';$('#camp-workspace').classList.remove('show-detail');$('#scout-list').replaceChildren();$('#scout-detail').replaceChildren();notice('');}
const stateChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('scout-campo-state'):null;
stateChannel?.addEventListener('message',async e=>{if(e.data?.type!=='erased')return;resetView();$('#erase-dialog').close();$('#settings-dialog').close();try{await reload();await updateStorage();}catch(error){notice(error.message,true);}});

$('#scout-search').oninput=e=>{query=e.target.value;refreshList();};
$('#unit-filter').onchange=e=>{unit=e.target.value;refreshList();};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;refreshList();$('#camp-workspace').classList.remove('show-detail');});
$('#clear-filters').onclick=()=>{query='';unit='';filter='all';$('#scout-search').value='';$('#unit-filter').value='';refreshList();};
$('#device-settings').onclick=()=>{if(!busy){$('#camp-name').value=campName;$('#settings-dialog').showModal();}};
$('#close-settings').onclick=()=>$('#settings-dialog').close();
$('#save-name').onclick=()=>task(async()=>{const name=$('#camp-name').value.trim();await saveCampName(name);await reload();notice('Nome del campo salvato.');});
$('#persist-storage').onclick=()=>updateStorage(true);
function resetErase(){ $('#erase-confirmation').checked=false;setBusy(busy);}
$('#erase-group').onclick=()=>{if(busy||!storageAvailable)return;resetErase();$('#erase-dialog').showModal();};
$('#erase-confirmation').onchange=()=>setBusy(busy);
$('#cancel-erase').onclick=()=>{if(!busy)$('#erase-dialog').close();};
$('#erase-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('#erase-dialog').addEventListener('close',resetErase);
$('#confirm-erase').onclick=()=>{if(busy||!$('#erase-confirmation').checked)return;task(async()=>{preparation?.reset();await eraseGroup();resetView();stateChannel?.postMessage({type:'erased'});$('#erase-dialog').close();$('#settings-dialog').close();await reload();await updateStorage();notice('Memoria del campo cancellata. Puoi iniziare una nuova sincronizzazione.');});};
async function updateStorage(request=false){
  let persistent=false;try{persistent=request?await requestPersistence():await navigator.storage?.persisted?.();}catch{}
  $('#storage-status').textContent=records.length?`${records.length} schede nella memoria del dispositivo${persistent?' · Memoria persistente accordata':''}`:'Nessuna scheda salvata sul dispositivo';
  $('#persist-result').textContent=persistent?'Il browser ha accordato la memoria persistente. La cancellazione manuale dei dati del sito elimina comunque le schede.':'Il browser può liberare la memoria del sito se manca spazio. Se le schede vengono eliminate, sarà necessario ripetere la sincronizzazione con il capo.';
}
function showOfflineStatus(){const el=$('#offline-status');el.textContent=offlineReady?(navigator.onLine?'Pronta offline':'Senza rete · Pronta offline'):'Preparazione offline…';el.classList.toggle('ready',offlineReady);el.dataset.ready=String(offlineReady);}
async function checkOffline(){
  const controller=navigator.serviceWorker?.controller;if(!controller)return;
  const channel=new MessageChannel();let timeout;
  const result=await new Promise(resolve=>{channel.port1.onmessage=e=>{clearTimeout(timeout);resolve(e.data);};timeout=setTimeout(()=>resolve({ready:false}),5000);controller.postMessage({type:'CHECK_OFFLINE'},[channel.port2]);});channel.port1.close();offlineReady=!!result.ready;showOfflineStatus();
}
async function offlineSetup(){
  $('#https-note').textContent=location.hostname==='127.0.0.1'||location.hostname==='localhost'?'Questa è l’anteprima locale sul computer. Sul telefono apri la versione pubblicata via HTTPS: l’indirizzo 127.0.0.1 del computer non è raggiungibile dal telefono.':'L’uso offline richiede che l’app sia aperta inizialmente via HTTPS. Attendi “Pronta offline” prima di partire.';
  if(!('serviceWorker'in navigator)||!window.isSecureContext){$('#offline-status').textContent='Offline non disponibile';notice('Per preparare l’app offline aprila via HTTPS in un browser compatibile, oppure usa localhost per l’anteprima.',true);return;}
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing){location.reload();return;}checkOffline();});
  try{
    const registration=await navigator.serviceWorker.getRegistration('/campo/')||await navigator.serviceWorker.register('/campo/sw.js',{scope:'/campo/',updateViaCache:'none'});
    const offerUpdate=()=>{$('#update-app').hidden=!(registration.waiting&&registration.active);};offerUpdate();navigator.serviceWorker.addEventListener('controllerchange',offerUpdate);registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',offerUpdate));
    $('#update-app').onclick=()=>{if(!busy&&registration.waiting){refreshing=true;registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});}};
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>{const done=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();};const timer=setTimeout(done,5000);navigator.serviceWorker.addEventListener('controllerchange',done);});
    await checkOffline();
    if(!offlineReady){$('#offline-status').textContent='Preparazione offline incompleta';notice('La preparazione offline non è completa. Riapri l’app con connessione e attendi “Pronta offline”.',true);}
  }catch{$('#offline-status').textContent='Offline non pronto';notice('Non è stato possibile preparare l’app offline. Mantieni la connessione e ricarica.',true);}
}
window.addEventListener('online',()=>{showOfflineStatus();checkOffline();});window.addEventListener('offline',showOfflineStatus);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#install-app').hidden=false;});
$('#install-app').onclick=async()=>{if(deferredInstall){await deferredInstall.prompt();deferredInstall=null;$('#install-app').hidden=true;}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!busy&&storageAvailable)reload().catch(e=>notice(e.message,true));});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
setBusy(false);
try{await reload();storageAvailable=true;setBusy(false);await updateStorage();}catch(error){notice('Impossibile aprire la memoria del dispositivo: '+error.message,true);$('#storage-status').textContent='Memoria non disponibile: le schede non possono essere salvate.';setBusy(false);}
preparation=setupPreparation({
  available:()=>!busy&&storageAvailable&&mode==='unprepared',
  begin:async()=>{if(busy)throw Error('Attendi il completamento dell’operazione in corso.');const id=await beginPreparation();const registration=await navigator.serviceWorker.getRegistration('/campo/');if(navigator.onLine)registration?.update().catch(()=>{});await reload();return id;},
  ready:async()=>{await checkOffline();if(!offlineReady)throw Error('Risorse offline incomplete. Collega il telefono a Internet e riapri l’app prima della scansione.');},
  commit:async(incoming,name,id)=>{setBusy(true);try{await completePreparation(incoming,name,id);await reload();notice(`${incoming.length} schede disponibili offline. Puoi riaprire l’app in modalità aereo.`);await updateStorage(true);}finally{setBusy(false);}},
  onError:error=>notice(error.message,true)
});
await reload().catch(e=>notice(e.message,true));
offlineSetup();
