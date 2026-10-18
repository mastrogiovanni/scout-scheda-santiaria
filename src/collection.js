export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function collectionApi(action,body={}){
  let response;
  try{response=await fetch('/api/raccolta',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(60000)});}catch{throw Error('Connessione non disponibile. Nessuna consegna confermata: conserva lo ZIP e riprova quando sei online.');}
  const result=await response.json().catch(()=>({error:'Servizio non disponibile. Nessuna consegna confermata.'}));
  if(!response.ok){const error=Error(result.error||'Operazione non riuscita.');error.status=response.status;throw error;}
  return result;
}
export const localDate=value=>new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(value));
const esc=escapeHtml;
let token='',info=null,problem='',sending=false,options={},storageOrigin='';
const params=new URLSearchParams(location.hash.slice(1));
const incoming=params.get('consegna');
try{
  if(incoming&&/^[a-f0-9]{64}$/.test(incoming)){token=incoming;sessionStorage.setItem('scout-delivery-invite',token);}
  else token=sessionStorage.getItem('scout-delivery-invite')||'';
}catch{token=incoming||'';}
if(incoming)history.replaceState(null,'',location.pathname+location.search);

export async function initDelivery(config){
  options=config;if(!token)return;
  try{
    const response=await fetch('/api/raccolta',{cache:'no-store'});const settings=await response.json();
    if(!response.ok||!settings.enabled)throw Error(settings.error||'La raccolta online non è disponibile.');
    storageOrigin=settings.storageOrigin;
    info=await collectionApi('invitation',{token});
  }catch(error){problem=error.message;}
  const banner=document.getElementById('delivery-banner');
  if(banner){banner.hidden=false;banner.innerHTML=info?`<strong>Consegna a ${esc(info.collection)}</strong><p>Invito personale: ${esc(info.label)}. L’invio avverrà solo quando premi “Invia al gruppo”.</p>`:`<strong>Consegna al gruppo non disponibile</strong><p>${esc(problem)}</p>`;}
  mountDelivery();
}
export function deliveryHtml(){return token?'<section class="delivery-card" id="delivery-card" aria-label="Consegna al gruppo"></section>':'';}
export function mountDelivery(){
  const card=document.getElementById('delivery-card');if(!card)return;
  if(!info){card.innerHTML=`<h3>Consegna al gruppo</h3><p>${esc(problem||'Controllo dell’invito…')}</p><p>Puoi comunque scaricare e conservare lo ZIP.</p>`;return;}
  const delivered=info.delivered;
  if(delivered){card.innerHTML=`<span class="file-tag">CONSEGNA CONFERMATA</span><h3>Pacchetto ricevuto</h3><p>Da <strong>${esc(delivered.collection)}</strong> il ${esc(localDate(delivered.receivedAt))}.</p><p class="receipt-code">Ricevuta: <strong>${esc(delivered.receipt)}</strong></p><p>La ricezione non sostituisce il controllo dei capi o le firme sulla carta. Per correggere la scheda, chiedi un nuovo invito.</p>`;return;}
  if(info.closed){card.innerHTML='<h3>Raccolta chiusa</h3><p>Chiedi un nuovo invito al capo. Puoi comunque scaricare lo ZIP.</p>';return;}
  // Keep the explicit delivery choice while file preparation updates controls.
  if(!card.querySelector('#submit-package'))card.innerHTML=`<span class="file-tag">CONSEGNA ONLINE</span><h3>Invia a ${esc(info.collection)}</h3><p>Il pacchetto ZIP verrà salvato nell’archivio privato del gruppo, accessibile ai capi autorizzati. Non serve un account.</p><label class="check-row"><input id="delivery-consent" type="checkbox"><span>Voglio inviare questa scheda sanitaria a <strong>${esc(info.collection)}</strong>.</span></label><button class="button primary" type="button" id="submit-package" disabled>Invia al gruppo ↑</button><p id="delivery-status" role="status" aria-live="polite"></p>`;
  const button=card.querySelector('#submit-package'),choice=card.querySelector('#delivery-consent');
  button.disabled=sending||!choice.checked||!options.getFile?.();
  button.textContent=sending?'Invio in corso…':'Invia al gruppo ↑';
  choice.disabled=sending;choice.onchange=()=>mountDelivery();button.onclick=send;
}
async function send(){
  const file=options.getFile?.();if(sending||!file||!document.getElementById('delivery-consent')?.checked)return;
  sending=true;options.setBusy?.(true);mountDelivery();
  const status=document.getElementById('delivery-status');
  try{
    status.textContent='Preparazione della consegna…';
    const bytes=await file.arrayBuffer();const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const start=await collectionApi('begin',{token,sha256,size:file.size});
    let result=start.delivered;
    if(!result){
      const upload=new URL(start.uploadUrl);
      if(upload.origin!==storageOrigin||!upload.pathname.startsWith('/storage/v1/object/upload/sign/scout-packages/'))throw Error('Destinazione di invio non valida.');
      status.textContent='Caricamento del pacchetto… Mantieni aperta questa pagina.';
      const response=await fetch(upload,{method:'PUT',headers:{'Content-Type':'application/zip'},body:file,credentials:'omit',signal:AbortSignal.timeout(120000)});
      // An earlier upload may already have completed when the connection failed.
      // The server still verifies the stored bytes before issuing any receipt.
      if(!response.ok&&![400,409].includes(response.status))throw Error('Caricamento non riuscito. Nessuna consegna confermata: riprova.');
      status.textContent='Verifica e conferma della ricezione…';
      result=await collectionApi('complete',{token,id:start.id});
    }
    info.delivered=result;options.onSent?.(file);options.notify?.('Pacchetto ricevuto dal gruppo. Conserva una copia dello ZIP e la ricevuta.');
  }catch(error){if(status)status.textContent=error.message;options.notify?.(error.message,true);}
  finally{sending=false;options.setBusy?.(false);mountDelivery();}
}
