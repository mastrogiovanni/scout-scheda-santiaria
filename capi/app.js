import {collectionApi as api,escapeHtml as esc,localDate} from '/src/collection.js';
import {readArchive,download} from '/src/archive.js';
import {groupBackup} from '/campo/packages.js';
const $=selector=>document.querySelector(selector);
let user=null,collections=[],current=null,selected=new Set(),busy=false,storageOrigin='';
const params=new URLSearchParams(location.search),code=params.get('code'),authError=params.get('error_description');
if(code||authError)history.replaceState(null,'','/capi/');
function notice(message,error=false){$('#leaders-notice').textContent=message;$('#leaders-notice').className=message?'notice '+(error?'error':'success'):'';}
async function task(work){if(busy)return;busy=true;document.body.classList.add('busy');try{await work();}catch(error){notice(error.message,true);}finally{busy=false;document.body.classList.remove('busy');}}
function login(){
  $('#logout').hidden=true;
  $('#leaders-content').innerHTML='<section class="leader-card leader-login"><h2>Accedi come capo</h2><p>Usa l’indirizzo email abilitato dall’amministratore. Riceverai un link personale: aprilo nello stesso browser in cui lo richiedi.</p><form id="login-form"><label for="leader-email">Email</label><input id="leader-email" type="email" autocomplete="email" required maxlength="254"><button class="button primary">Ricevi il link di accesso →</button></form></section>';
  $('#login-form').onsubmit=e=>{e.preventDefault();task(async()=>{const result=await api('login',{email:$('#leader-email').value});notice(result.message);});};
}
async function dashboard(){
  const result=await api('dashboard');user=result.user;collections=result.collections;current=null;
  $('#logout').hidden=false;
  $('#leaders-content').innerHTML=`<p class="muted">Accesso riservato · ${esc(user.email)}</p><div class="leader-grid"><section class="leader-card"><h2>Le raccolte</h2><div class="collection-list">${collections.length?collections.map(col=>`<button class="collection-tile" data-collection="${esc(col.id)}"><strong>${esc(col.name)}</strong><span>${col.closed?'Chiusa':'Consegne entro '+esc(localDate(col.deadline))}</span></button>`).join(''):'<p>Crea la prima raccolta per distribuire gli inviti alle famiglie.</p>'}</div></section><section class="leader-card"><h2>Nuova raccolta</h2><form id="create-collection"><label for="collection-name">Nome del campo o dell’attività</label><input id="collection-name" required maxlength="100" placeholder="Campo estivo 2027"><label for="collection-deadline">Ultimo giorno per la consegna</label><input id="collection-deadline" type="date" required><label for="collection-delete">Cancella i pacchetti online dopo il</label><input id="collection-delete" type="date" required><p>La cancellazione automatica riguarda l’archivio online. Le copie già scaricate sui dispositivi vanno gestite separatamente.</p><button class="button primary">Crea raccolta →</button></form></section></div>${user.role==='admin'?'<section class="leader-card"><h2>I capi autorizzati</h2><p>Ogni capo abilitato può accedere a tutte le raccolte di questo gruppo.</p><div id="leader-list"></div><form id="add-leader"><label for="new-leader-email">Email di un altro capo</label><input type="email" id="new-leader-email" maxlength="254" required><button class="button secondary">Abilita capo</button></form></section>':''}`;
  document.querySelectorAll('[data-collection]').forEach(button=>button.onclick=()=>task(()=>openCollection(button.dataset.collection)));
  const day=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
  $('#collection-deadline').value=day(30);$('#collection-deadline').min=day(0);$('#collection-delete').value=day(120);
  $('#create-collection').onsubmit=e=>{e.preventDefault();task(async()=>{
    const date=value=>new Date(value+'T23:59:59').toISOString();
    const created=await api('createCollection',{name:$('#collection-name').value,deadline:date($('#collection-deadline').value),deleteAfter:date($('#collection-delete').value)});
    notice('Raccolta creata. Aggiungi gli inviti personali.');await openCollection(created.id);
  });};
  if(user.role==='admin'){
    await leaderList();
    $('#add-leader').onsubmit=e=>{e.preventDefault();const email=$('#new-leader-email').value;if(!confirm(`Abilitare ${email} alla lettura delle schede sanitarie e alla gestione di tutte le raccolte del gruppo?`))return;task(async()=>{await api('addLeader',{email});$('#new-leader-email').value='';await leaderList();notice('Capo abilitato. Potrà richiedere il link di accesso dalla pagina Area capi.');});};
  }
}
async function leaderList(){
  const leaders=await api('leaders');
  $('#leader-list').innerHTML=leaders.map(leader=>`<div class="delivery-row"><span><strong>${esc(leader.email)}</strong><small>${leader.role==='admin'?'Amministratore':'Capo'} · ${leader.enabled?'Abilitato':'Disabilitato'}</small></span>${leader.email!==user.email&&leader.enabled?`<button type="button" class="text-button leader-danger" data-disable="${esc(leader.email)}">Disabilita</button>`:''}</div>`).join('');
  document.querySelectorAll('[data-disable]').forEach(button=>button.onclick=()=>{if(confirm('Disabilitare l’accesso online di questo capo? Le copie già scaricate restano sui suoi dispositivi.'))task(async()=>{await api('disableLeader',{email:button.dataset.disable});await leaderList();});});
}
async function openCollection(collectionId,preserve=false){
  current=await api('collection',{collectionId});const {collection:col,invitations,submissions}=current;
  if(!preserve)selected=new Set(submissions.map(s=>s.id));
  $('#leaders-content').innerHTML=`<button class="text-button" id="back-dashboard">← Tutte le raccolte</button><section class="leader-card"><span class="file-tag">RACCOLTA DEL GRUPPO</span><h2>${esc(col.name)}</h2><p>Consegne entro ${esc(localDate(col.deadline))} · Cancellazione online dopo il ${esc(localDate(col.delete_after))}</p><div class="leader-stats"><span><strong>${invitations.length}</strong>Inviti</span><span><strong>${submissions.length}</strong>Ricevute</span><span><strong>${submissions.filter(s=>s.status==='checked').length}</strong>Controllate</span></div><div class="leader-tools"><button class="button primary" id="prepare-camp" ${submissions.length?'':'disabled'}>Prepara per il campo ↓</button><button class="button secondary" id="refresh-collection">Aggiorna consegne</button>${col.closed?'<span class="status-tag">Raccolta chiusa</span>':'<button class="text-button leader-danger" id="close-collection">Chiudi raccolta</button>'}</div><p class="leader-progress" id="backup-status" role="status"></p><p class="muted">Seleziona i pacchetti da scaricare. Importa il backup nell’app <a href="/campo/">Al campo</a> sul telefono, poi attendi “Pronta offline”.</p></section>${!col.closed&&Date.parse(col.deadline)>Date.now()?'<section class="leader-card"><h2>Invita una famiglia</h2><p>Ogni invito permette una consegna. Puoi copiare il link e inviarlo alla famiglia su WhatsApp o email. Per una correzione crea un nuovo invito.</p><form id="create-invitation"><label for="invitation-label">Nome o riferimento per riconoscere la consegna</label><input id="invitation-label" maxlength="160" required placeholder="Famiglia Rossi · Giulia"><button class="button secondary">Crea invito personale →</button></form><div id="new-invitation" class="invite-link"></div></section>':''}<section class="leader-card"><h2>Consegne e inviti</h2><label for="delivery-search">Cerca uno scout o un invito</label><input id="delivery-search" type="search" class="leader-search" placeholder="Nome, unità o riferimento"><div class="leader-tools"><button class="text-button" id="select-all">Seleziona tutti</button><button class="text-button" id="select-none">Deseleziona tutti</button></div><div id="deliveries"></div></section>`;
  $('#back-dashboard').onclick=()=>task(dashboard);$('#refresh-collection').onclick=()=>task(()=>openCollection(col.id,true));
  $('#close-collection')?.addEventListener('click',()=>{if(confirm('Chiudere le consegne? I pacchetti ricevuti restano disponibili fino alla data di cancellazione.'))task(async()=>{await api('closeCollection',{collectionId:col.id});await openCollection(col.id,true);});});
  $('#create-invitation')?.addEventListener('submit',e=>{e.preventDefault();task(async()=>{
    const label=$('#invitation-label').value;const inv=await api('createInvitation',{collectionId:col.id,label});
    await openCollection(col.id,true);
    $('#new-invitation').innerHTML=`<p><strong>Invito per ${esc(label)}</strong></p><p>Copia ora questo link personale: non verrà mostrato di nuovo.</p><label for="invite-url">Link da inviare alla famiglia</label><input id="invite-url" readonly value="${esc(inv.url)}"><button type="button" class="button primary" id="copy-invite">Copia link</button>`;
    $('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(inv.url);notice('Link copiato. Incollalo nel messaggio alla famiglia.');}catch{$('#invite-url').select();notice('Seleziona e copia il link dal campo.');}};
    $('#new-invitation').scrollIntoView({block:'center',behavior:'smooth'});
  });});
  $('#delivery-search').oninput=renderDeliveries;
  $('#select-all').onclick=()=>{selected=new Set(submissions.map(s=>s.id));renderDeliveries();};$('#select-none').onclick=()=>{selected.clear();renderDeliveries();};
  $('#prepare-camp').onclick=()=>task(prepareCamp);renderDeliveries();
}
function renderDeliveries(){
  const {collection:col,invitations,submissions}=current;const query=$('#delivery-search').value.toLocaleLowerCase('it');
  const rows=invitations.map(inv=>({inv,sub:submissions.find(s=>s.invitation_id===inv.id)})).filter(({inv,sub})=>[inv.label,sub?.scout_name,sub?.unit].filter(Boolean).join(' ').toLocaleLowerCase('it').includes(query));
  $('#deliveries').innerHTML=rows.length?rows.map(({inv,sub})=>`<article class="delivery-row"><label>${sub?`<input type="checkbox" data-select="${sub.id}" ${selected.has(sub.id)?'checked':''} aria-label="Seleziona ${esc(sub.scout_name)}">`:''}<span><strong>${esc(sub?.scout_name||inv.label)}</strong><small>${sub?esc(inv.label)+' · '+esc(sub.unit):'Invito personale'}</small><span class="status-tag ${sub?'':'waiting'}">${sub?(sub.status==='checked'?'Controllata':'Ricevuta · da controllare'):inv.revoked?'Invito revocato':'In attesa'}</span>${sub?`<small>${esc(localDate(sub.received_at))}</small>`:''}${inv.revoked&&sub?'<small>Invito revocato; il pacchetto ricevuto è conservato.</small>':''}</span></label><div class="row-buttons">${sub?`<button class="text-button" data-file="${sub.id}">Scarica ZIP</button>${sub.status==='received'?`<button class="text-button" data-check="${sub.id}">Segna controllata</button>`:''}`:''}${!inv.revoked&&!col.closed?`<button class="text-button leader-danger" data-revoke="${inv.id}">Revoca invito</button>`:''}</div></article>`).join(''):'<p>Nessuna consegna o invito corrispondente.</p>';
  document.querySelectorAll('[data-select]').forEach(input=>input.onchange=()=>{input.checked?selected.add(input.dataset.select):selected.delete(input.dataset.select);});
  document.querySelectorAll('[data-check]').forEach(button=>button.onclick=()=>{if(confirm('Confermi di aver controllato questo pacchetto? Questa indicazione non attesta le firme sulla carta.'))task(async()=>{await api('check',{collectionId:col.id,submissionId:button.dataset.check});await openCollection(col.id,true);});});
  document.querySelectorAll('[data-file]').forEach(button=>button.onclick=()=>task(async()=>{const file=await getPackage(button.dataset.file);download(file,'scheda-'+button.dataset.file+'.zip','application/zip');notice('Download del pacchetto avviato.');}));
  document.querySelectorAll('[data-revoke]').forEach(button=>button.onclick=()=>{if(confirm('Revocare questo link personale? Non sarà più possibile inviare con questo invito.'))task(async()=>{await api('revokeInvitation',{collectionId:col.id,invitationId:button.dataset.revoke});await openCollection(col.id,true);});});
}
async function getPackage(submissionId){
  const signed=await api('file',{collectionId:current.collection.id,submissionId});const url=new URL(signed.url);
  if(url.origin!==storageOrigin||!url.pathname.startsWith('/storage/v1/object/sign/scout-packages/'))throw Error('Collegamento al pacchetto non valido.');
  const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Download non riuscito. Riprova.');
  const bytes=await response.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==signed.sha256)throw Error('Il pacchetto non corrisponde alla consegna verificata.');
  return new File([bytes],submissionId+'.zip',{type:'application/zip'});
}
async function prepareCamp(){
  const subs=current.submissions.filter(s=>selected.has(s.id));
  if(!subs.length)throw Error('Seleziona almeno un pacchetto.');
  if(subs.reduce((sum,s)=>sum+s.size,0)>75*1024*1024)throw Error('La selezione supera 75 MB. Scarica gruppi più piccoli per importarli separatamente.');
  const records=[],identities=new Set();
  for(const [index,sub] of subs.entries()){
    $('#backup-status').textContent=`Preparazione ${index+1} di ${subs.length}… Mantieni aperta questa pagina.`;
    const file=await getPackage(sub.id);const data=await readArchive(file);
    if(identities.has(data.fiscalCode.toUpperCase()))throw Error('La selezione contiene più schede della stessa persona. Seleziona esplicitamente una sola versione per scout.');
    identities.add(data.fiscalCode.toUpperCase());records.push({data,archive:await file.arrayBuffer()});
  }
  const bytes=await groupBackup(records,current.collection.name);download(bytes,'campo-'+current.collection.id+'.zip','application/zip');
  $('#backup-status').textContent=`Backup di ${records.length} schede pronto. Caricalo nell’app Al campo sul telefono.`;notice('Download del backup avviato.');
}
$('#logout').onclick=()=>task(async()=>{await api('logout');user=null;current=null;collections=[];selected.clear();login();notice('Accesso chiuso. Le copie scaricate e l’archivio offline restano sui dispositivi.');});
try{
  const response=await fetch('/api/raccolta',{cache:'no-store'});const config=await response.json();if(!response.ok||!config.enabled)throw Error(config.error||'Raccolta online non ancora configurata.');storageOrigin=config.storageOrigin;
  if(authError)throw Error('Il link di accesso è scaduto. Richiedine uno nuovo.');
  if(code)await api('session',{code});
  try{await dashboard();}catch(error){if(error.status===401||error.status===403){login();if(code)notice(error.message,true);}else throw error;}
}catch(error){login();notice(error.message,true);}
