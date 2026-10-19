import {setupPreparation} from './preparation.js';
import {fullName,dateIT,fieldMap} from '/src/schema.js';
import {dataBlocks,compactPdf,originalPdf} from '/src/pdf.js';
import {download,filename,createArchive} from '/src/archive.js';
import {loadState,saveScouts,saveCampName,removeScout,eraseGroup,requestPersistence,beginPreparation,completePreparation} from './store.js';
import {preparePackages,planImport,groupBackup,MAX_PACKAGES} from './packages.js';

const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it');
let preparation=null,mode='unprepared';
let records=[],campName='',selected=null,filter='all',query='',unit='',busy=false,staged=null,offlineReady=false,storageAvailable=false,deferredInstall,refreshing=false;
const healthFilters={all:()=>true,allergies:d=>d.allergiesPresent==='yes',therapy:d=>d.currentPresent==='yes'||d.medicinesPresent==='yes'||d.administration==='yes',diet:d=>d.dietPresent==='yes'};
const filterNames={all:'Tutti gli scout',allergies:'Con allergie',therapy:'Terapie / farmaci',diet:'Diete particolari'};
function notice(message,error=false){$('#camp-notice').textContent=message;$('#camp-notice').className=message?'notice '+(error?'error':'success'):'';}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);$('#import-packages').disabled=value||!storageAvailable||mode==='preparation';$('#prepare-qrvideo').disabled=value||!storageAvailable;$('#backup-group').disabled=value||!records.length;$('#confirm-import').disabled=value||!staged||!staged.additions.length&&!staged.conflicts.length;$('#cancel-import').disabled=value;$('#erase-group').disabled=value;$('#save-name').disabled=value;}
function refreshList(){
  const visible=records.filter(r=>healthFilters[filter](r.data)&&(!unit||r.data.unit===unit)&&fold([r.data.name,r.data.surname,r.data.name+' '+r.data.surname,r.data.surname+' '+r.data.name,r.data.fiscalCode,r.data.memberCode,r.data.unit].join(' ')).includes(fold(query).trim())).sort((a,b)=>(a.data.surname+' '+a.data.name).localeCompare(b.data.surname+' '+b.data.name,'it'));
  for(const [key,test] of Object.entries(healthFilters))$('#count-'+key).textContent=records.filter(r=>test(r.data)).length;
  document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
  $('#result-count').textContent=`${visible.length} ${visible.length===1?'scout':'scout'}${filter!=='all'?' · '+filterNames[filter]:''}`;
  $('#clear-filters').hidden=!query&&!unit&&filter==='all';
  $('#scout-list').innerHTML=visible.length?visible.map(r=>{
    const d=r.data;return `<button class="scout-row ${r.id===selected?'selected':''}" data-id="${r.id}" aria-pressed="${r.id===selected}"><span class="scout-avatar" aria-hidden="true">${esc(d.name[0]+d.surname[0])}</span><span class="scout-label"><strong>${esc(d.surname)} ${esc(d.name)}</strong><span>${esc(d.unit)} · ${dateIT(d.birthDate)}</span><span class="scout-tags">${d.allergiesPresent==='yes'?'<i class="tag allergy">Allergie</i>':''}${healthFilters.therapy(d)?'<i class="tag">Terapie / farmaci</i>':''}${d.dietPresent==='yes'?'<i class="tag">Dieta</i>':''}${d.consent==='no'?'<i class="tag">Consenso negato</i>':''}</span></span><span class="row-arrow" aria-hidden="true">→</span></button>`;
  }).join(''):`<div class="empty-list"><strong>${records.length?'Nessuno scout trovato':'Il gruppo prende forma qui.'}</strong><p>${records.length?'Prova un altro nome o azzera i filtri.':'Carica insieme gli ZIP delle famiglie. Le schede saranno disponibili anche senza rete.'}</p></div>`;
  $('#scout-list').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>selectScout(b.dataset.id));
}
function render(){
  $('#camp-title').textContent=campName||'Il nostro campo';
  $('#unit-filter').innerHTML='<option value="">Tutte le unità</option>'+[...new Set(records.map(r=>r.data.unit))].sort((a,b)=>a.localeCompare(b,'it')).map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join('');
  if(!records.some(r=>r.data.unit===unit))unit='';$('#unit-filter').value=unit;
  if(selected&&!records.some(r=>r.id===selected)){selected=null;$('#camp-workspace').classList.remove('show-detail');}
  refreshList();renderDetail();setBusy(busy);
}
function displayValue(key,value){const f=fieldMap[key];if(value===undefined||value==='')return 'Non presente';if(f?.type==='checkbox')return value?'Confermato':'Non confermato';if(f?.type==='select')return f.options.find(([id])=>id===value)?.[1]||value;if(f?.type==='date')return dateIT(value);return value;}
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
  $('#scout-detail').innerHTML=`<button class="text-button back-list" id="back-list">← Torna agli scout</button><div class="detail-heading"><div class="eyebrow">${esc(d.unit)} · SCHEDA DEL ${dateIT(d.date)}</div><h2 tabindex="-1">${esc(fullName(d))}</h2><p>${esc(d.birthPlace)} · ${dateIT(d.birthDate)} <span class="identity-code">${esc(d.fiscalCode)}</span></p></div>${d.consent==='no'?'<div class="info-box warning"><strong>Consenso al trattamento negato nella scheda.</strong><p>La scelta espressa è riportata integralmente nei documenti e nel riepilogo.</p></div>':''}<div class="detail-actions"><button class="button secondary" id="download-compact">PDF compatto ↓</button><button class="button secondary" id="download-original">PDF originale ↓</button><button class="text-button" id="download-package">Pacchetto ZIP ↓</button></div><nav class="detail-jumps" aria-label="Vai a una sezione della scheda"><a href="#health-summary">Salute</a><a href="#quick-contacts">Contatti</a><a href="#medicine-record">Farmaci</a><a href="#all-information">Scheda completa</a></nav><section id="health-summary" class="health-overview" aria-label="Informazioni sanitarie in evidenza">${attention.length?attention.join(''):'<div class="all-clear">Nessuna delle sezioni sanitarie in evidenza è stata compilata. Consulta comunque farmaci, vaccinazioni e scheda completa qui sotto.</div>'}</section><section id="quick-contacts" class="contact-section"><h3>Contatti a portata di mano</h3><div class="contact-grid">${contactHtml(d)}</div></section><section id="all-information" class="full-record"><h3>Tutte le informazioni della scheda</h3>${dataBlocks(d).map(([title,rows])=>`<details ${title.includes('Farmaci')?'id="medicine-record"':''} ${title.includes('Farmaci')||title.startsWith('Richiesta')?'open':''}><summary>${esc(title)}</summary><dl>${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></details>`).join('')}<details><summary>Dichiarazioni e consenso</summary><dl>${[['Dichiarante',d.declarant||fullName(d)],['Consenso',d.consent==='yes'?'Presto il consenso':'Non presto il consenso'],['Dichiarazioni confermate',d.declarationAccepted?'Sì':'No'],...(d.subjectType==='minor'?[['Dichiarazione sulle malattie trasmissibili',d.noContagion?'Confermata':'Non confermata']]:[]),['Luogo e data di compilazione',d.place+', '+dateIT(d.date)],['Prescrizione da consegnare',d.administration==='yes'&&d.prescriptionAttached?'Consegna confermata dal compilatore; documento da verificare separatamente':'Richiesta non necessaria']].map(([l,v])=>`<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="small">Le conferme digitali non attestano che siano state apposte le firme sulla carta.</p><button class="text-button" id="show-declaration">Leggi il testo delle dichiarazioni</button><div id="declaration-text" class="document-text" hidden></div></details></section><div class="record-footer"><span>Salvata il ${new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(record.importedAt))}</span><button class="text-button danger" id="remove-scout">Rimuovi questa scheda</button></div>`;
  $('#back-list').onclick=()=>{$('#camp-workspace').classList.remove('show-detail');document.querySelector(`.scout-row[data-id="${selected}"]`)?.focus();};
  $('#download-compact').onclick=()=>exportPdf('compact',record);
  $('#download-original').onclick=()=>exportPdf('original',record);
  $('#download-package').onclick=()=>task(async()=>download(record.archive||await createArchive(record.data),filename(d)+'-scheda.zip','application/zip'));
  $('#remove-scout').onclick=async()=>{
    if(busy||!confirm(`Rimuovere la scheda di ${fullName(d)} da questo dispositivo? Per recuperarla servirà il suo ZIP o un backup del gruppo.`))return;
    await task(async()=>{await removeScout(record.id);await reload();notice('Scheda rimossa dal dispositivo.');});
  };
  $('#show-declaration').onclick=async()=>{try{const content=await(await fetch('/src/content.json')).json();$('#declaration-text').textContent=content.declaration+'\n\n(*) Il punto 4 riguarda solo i minorenni.';$('#declaration-text').hidden=false;$('#show-declaration').hidden=true;}catch{notice('Testo non disponibile: completa la preparazione offline.',true);}};
}
function selectScout(id){selected=id;refreshList();renderDetail();$('#camp-workspace').classList.add('show-detail');$('#scout-detail h2')?.focus();if(matchMedia('(max-width:760px)').matches)$('#scout-detail').scrollIntoView({block:'start',behavior:'smooth'});}
async function reload(){const state=await loadState();records=state.records;campName=state.campName;mode=state.mode;document.body.dataset.mode=mode;$('#camp-mode').textContent=mode==='use'?'Modalità uso':mode==='preparation'?'Modalità preparazione':'Da preparare';$('#preparation-panel').hidden=mode==='use';preparation?.restore(state.preparationId);render();}
async function task(work){if(busy)return;setBusy(true);try{await work();}catch(error){notice(error.name==='QuotaExceededError'?'Memoria del dispositivo insufficiente: nessuna modifica applicata. Esporta un backup e libera spazio.':error.message||'Operazione non riuscita.',true);}finally{setBusy(false);}}
async function exportPdf(type,record){await task(async()=>{notice('Preparazione PDF sul dispositivo…');const bytes=await(type==='compact'?compactPdf(record.data):originalPdf(record.data));download(bytes,filename(record.data)+(type==='compact'?'-compatta.pdf':'-originale.pdf'),'application/pdf');notice('PDF pronto.');});}

$('#scout-search').oninput=e=>{query=e.target.value;refreshList();};
$('#unit-filter').onchange=e=>{unit=e.target.value;refreshList();};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;refreshList();$('#camp-workspace').classList.remove('show-detail');});
$('#clear-filters').onclick=()=>{query='';unit='';filter='all';$('#scout-search').value='';$('#unit-filter').value='';refreshList();};
$('#import-packages').onclick=()=>{if(!busy)$('#package-files').click();};
$('#package-files').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length)return;
  await task(async()=>{
    notice(`Controllo di ${files.length} ${files.length===1?'archivio':'archivi'}…`);
    const incoming=await preparePackages(files);await reload();staged=planImport(incoming,records);
    $('#import-summary').innerHTML=`<p><strong>${staged.additions.length} nuove schede</strong> · ${staged.conflicts.length} aggiornamenti da scegliere · ${staged.repeated} già presenti e identiche.</p>${staged.errors.length?`<p class="import-error">${staged.errors.length} pacchetti non importabili. Gli altri possono essere salvati.</p>`:''}`;
    $('#import-results').innerHTML=staged.conflicts.map((item,i)=>`<article class="conflict-card"><label class="conflict-row"><input type="checkbox" data-conflict="${i}"><span><strong>Sostituisci ${esc(fullName(item.record.data))}</strong><span>${esc(item.record.id)}</span><span>Attuale: ${dateIT(item.old.data.date)} · In arrivo: ${dateIT(item.record.data.date)}</span></span></label><details><summary>Controlla le informazioni modificate</summary><div class="import-diff">${Object.keys({...item.old.data,...item.record.data}).filter(key=>item.old.data[key]!==item.record.data[key]).map(key=>`<div><strong>${esc(fieldMap[key]?.label||key)}</strong><p>Attuale: ${esc(displayValue(key,item.old.data[key]))}</p><p>In arrivo: ${esc(displayValue(key,item.record.data[key]))}</p></div>`).join('')}</div></details></article>`).join('')+staged.errors.map(e=>`<div class="import-error"><strong>${esc(e.name)}</strong><p>${esc(e.message)}</p></div>`).join('')+(staged.campName?`<label class="conflict-row"><input type="checkbox" id="import-camp-name" ${campName?'':'checked'}><span>Usa il nome del campo nel backup: <strong>${esc(staged.campName)}</strong></span></label>`:'')+`<p class="small">Le schede esistenti vengono conservate, salvo gli aggiornamenti selezionati. I nomi uguali con codice fiscale diverso restano separati.</p>`;
    $('#confirm-import').textContent=staged.additions.length||staged.conflicts.length?'Salva le schede':'Nessuna scheda da salvare';
    $('#import-dialog').showModal();notice('');
  });
};
$('#cancel-import').onclick=()=>{if(!busy){staged=null;$('#import-dialog').close();}};
$('#import-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else staged=null;});
$('#confirm-import').onclick=()=>task(async()=>{
  if(!staged)return;
  const updates=[...$('#import-results').querySelectorAll('[data-conflict]:checked')].map(c=>staged.conflicts[Number(c.dataset.conflict)]);
  const changes=[...staged.additions,...updates];const importedName=$('#import-camp-name')?.checked?staged.campName:undefined;
  if(!changes.length){staged=null;$('#import-dialog').close();notice('Nessuna modifica: le schede attuali sono state conservate.');return;}
  if(new Set([...records.map(r=>r.id),...changes.map(c=>c.record.id)]).size>MAX_PACKAGES)throw Error(`Massimo ${MAX_PACKAGES} scout nell’archivio del campo.`);
  const next=new Map(records.map(r=>[r.id,r]));changes.forEach(c=>next.set(c.record.id,c.record));
  if([...next.values()].reduce((sum,r)=>sum+(r.archive?.byteLength||JSON.stringify(r.data).length*3),0)>75*1024*1024)throw Error('L’archivio del campo supera 75 MB. Riduci i pacchetti prima di riprovare.');
  await saveScouts(changes,importedName);staged=null;$('#import-dialog').close();await reload();notice(`${changes.length} ${changes.length===1?'scheda salvata':'schede salvate'} sul dispositivo. Puoi chiudere e riaprire l’app.`);await updateStorage(true);
});
$('#backup-group').onclick=()=>task(async()=>{notice('Preparazione del backup del gruppo…');download(await groupBackup(records,campName),'scout-backup-gruppo.zip','application/zip');notice(`Backup pronto: ${records.length} schede. Importalo nell’app per ripristinare il gruppo anche offline.`);});
$('#device-settings').onclick=()=>{if(!busy){$('#camp-name').value=campName;$('#settings-dialog').showModal();}};
$('#close-settings').onclick=()=>$('#settings-dialog').close();
$('#save-name').onclick=()=>task(async()=>{const name=$('#camp-name').value.trim();await saveCampName(name);await reload();notice('Nome del campo salvato.');});
$('#persist-storage').onclick=()=>updateStorage(true);
$('#erase-group').onclick=async()=>{
  if(busy||!records.length)return;
  if(!confirm(`Eliminare tutte le ${records.length} schede e il nome del campo da questo dispositivo? Per ripristinarli servirà un backup ZIP.`))return;
  await task(async()=>{await eraseGroup();selected=null;query='';unit='';filter='all';$('#scout-search').value='';await reload();$('#settings-dialog').close();notice('Archivio del dispositivo svuotato. I backup già scaricati restano disponibili.');});
};
async function updateStorage(request=false){
  let persistent=false;try{persistent=request?await requestPersistence():await navigator.storage?.persisted?.();}catch{}
  $('#storage-status').textContent=persistent?'Schede salvate · Memoria persistente accordata':'Schede salvate nella memoria del dispositivo';
  $('#persist-result').textContent=persistent?'Il browser ha accordato la memoria persistente. La cancellazione manuale dei dati del sito elimina comunque le schede.':'I dati sono salvati. Il browser non ha accordato la protezione aggiuntiva o non la supporta: conserva un backup del gruppo.';
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
    const offerUpdate=()=>{$('#update-app').hidden=!(mode==='preparation'&&registration.waiting&&registration.active);};offerUpdate();navigator.serviceWorker.addEventListener('controllerchange',offerUpdate);registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',offerUpdate));
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
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!busy&&!staged&&storageAvailable)reload().catch(e=>notice(e.message,true));});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
setBusy(false);
try{await reload();storageAvailable=true;setBusy(false);await updateStorage();}catch(error){notice('Impossibile aprire la memoria del dispositivo: '+error.message,true);$('#storage-status').textContent='Memoria non disponibile: le schede non possono essere salvate.';setBusy(false);}
preparation=setupPreparation({
  available:()=>!busy&&storageAvailable,
  begin:async()=>{if(busy)throw Error('Attendi il completamento dell’operazione in corso.');const id=await beginPreparation();const registration=await navigator.serviceWorker.getRegistration('/campo/');if(navigator.onLine)registration?.update().catch(()=>{});staged=null;$('#import-dialog').close();selected=null;query='';unit='';filter='all';$('#scout-search').value='';await reload();return id;},
  ready:async()=>{await checkOffline();if(!offlineReady)throw Error('Risorse offline incomplete. Collega il telefono a Internet e riapri l’app prima della scansione.');},
  commit:async(incoming,name,id)=>{await completePreparation(incoming,name,id);await reload();notice(`${incoming.length} schede salvate. Modalità uso: prova a riaprire l’app in modalità aereo.`);await updateStorage(true);},
  onError:error=>notice(error.message,true)
});
await reload().catch(e=>notice(e.message,true));
offlineSetup();
