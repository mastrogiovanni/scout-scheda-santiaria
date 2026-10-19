import {rpc} from './supabase.js';
import {fingerprint,seal} from './crypto.js';
import {readArchive,createPayload} from './archive.js';
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const localDate=value=>new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(value));
const esc=escapeHtml,params=new URLSearchParams(location.hash.slice(1));
// The bearer link stays only in this page's memory; fragments never reach the host.
const token=params.get('gruppo')||'',pinnedKey=params.get('chiave')||'';
let info=null,problem='',sending=false,options={},pending=null,delivered=null;
if(token)history.replaceState(null,'',location.pathname+location.search);
export async function initDelivery(config){
  options=config;if(!token)return;
  try{if(!/^[a-f0-9]{64}$/.test(token)||!pinnedKey)throw Error('Link del gruppo incompleto. Usa il collegamento fornito dal capo.');
    info=await rpc('group_info',{p_token:token});if(info.keyId!==pinnedKey||await fingerprint(info.publicKey)!==pinnedKey){info=null;throw Error('La chiave pubblica non corrisponde al link del capo. Richiedi il link corretto.');}
  }catch(error){problem=error.message;}
  const banner=document.getElementById('delivery-banner');if(banner){banner.hidden=false;banner.innerHTML=info?`<strong>${esc(info.name)} · ${esc(info.year)}</strong><p>Capo destinatario: ${esc(info.leader)}. La scheda sarà cifrata sul dispositivo prima dell’invio.</p>`:`<strong>Consegna non disponibile</strong><p>${esc(problem)}</p>`;}
  mountDelivery();
}
export function deliveryHtml(){return token?'<section class="delivery-card" id="delivery-card" aria-label="Consegna cifrata al gruppo"></section>':'';}
export function resetDelivery(){
  if(sending)return;
  pending=null;delivered=null;
  document.getElementById('delivery-card')?.replaceChildren();
}
export function mountDelivery(){
  const card=document.getElementById('delivery-card');if(!card)return;
  if(!info){card.innerHTML=`<h3>Consegna al gruppo</h3><p>${esc(problem||'Controllo del link…')}</p><p>Puoi comunque scaricare lo ZIP.</p>`;return;}
  if(delivered){
    card.innerHTML=`<span class="file-tag">CONSEGNA CIFRATA CONFERMATA</span><h3>Scheda ricevuta</h3><p>${esc(info.name)} · ${esc(info.year)} · ${esc(localDate(delivered.receivedAt))}</p><p class="receipt-code">Ricevuta: <strong>${esc(delivered.receipt)}</strong></p><p>Puoi compilare un’altra scheda per lo stesso gruppo oppure correggere questa. Ogni nuovo invio avrà una ricevuta distinta; le consegne precedenti rimarranno disponibili al capo.</p><div class="delivery-actions"><button class="button primary" type="button" id="new-sheet">Compila un’altra scheda</button><button class="button secondary" type="button" id="correct-sheet">Correggi questa scheda</button></div>`;
    card.querySelector('#new-sheet').onclick=()=>options.onNewSheet?.();
    card.querySelector('#correct-sheet').onclick=()=>options.onCorrection?.();
    return;
  }
  if(info.closed){card.innerHTML='<h3>Consegne chiuse</h3><p>Contatta il capo per riaprire il gruppo.</p>';return;}
  if(!card.querySelector('#submit-package'))card.innerHTML=`<span class="file-tag">JSON CIFRATO · ${esc(info.year)}</span><h3>Invia a ${esc(info.name)}</h3><p>Solo il capo ${esc(info.leader)} potrà decifrare la scheda con il suo QR privato. Il backend riceve esclusivamente il JSON cifrato.</p><label class="check-row"><input id="delivery-consent" type="checkbox"><span>Voglio inviare questa scheda sanitaria al gruppo indicato.</span></label><button class="button primary" type="button" id="submit-package" disabled>Invia scheda cifrata ↑</button><p id="delivery-status" role="status" aria-live="polite"></p>`;
  const button=card.querySelector('#submit-package'),choice=card.querySelector('#delivery-consent');button.disabled=sending||!choice.checked||!options.getFile?.();choice.disabled=sending;button.textContent=sending?'Cifratura e invio…':'Invia scheda cifrata ↑';choice.onchange=mountDelivery;button.onclick=send;
}
async function send(){
  const file=options.getFile?.();if(sending||!file||!document.getElementById('delivery-consent')?.checked)return;
  sending=true;options.setBusy?.(true);mountDelivery();const status=document.getElementById('delivery-status');
  try{status.textContent='Cifratura locale della scheda…';
    // Reuse the same ciphertext/UUID on retry after an ambiguous network failure.
    if(pending?.file!==file)pending={file,envelope:await seal(await createPayload(await readArchive(file)),info)};
    status.textContent='Invio del solo JSON cifrato…';delivered=await rpc('submit',{p_token:token,p_envelope:pending.envelope});pending=null;options.onSent?.(file);options.notify?.('Scheda cifrata ricevuta. Conserva la ricevuta.');
  }catch(error){status.textContent=error.message;options.notify?.(error.message,true);}
  finally{sending=false;options.setBusy?.(false);mountDelivery();}
}
