import { sections, allFields, active, validate, cleanData, fullName } from './schema.js';
import { dataBlocks, originalPdf } from './pdf.js';
import { readArchive, download, filename } from './archive.js';
import {initDelivery,deliveryHtml,mountDelivery,resetDelivery} from './collection.js';
const LAST=sections.length-1;
let data={}, current=0, errors={}, busy=false, dirty=false;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const content=await(await fetch('/src/content.json')).json();
function fieldHtml(f) {
  const value=data[f.id]??'';const error=errors[f.id];
  const attrs=`id="${f.id}" name="${f.id}" ${f.required?'required':''} ${f.max?`maxlength="${f.max}"`:''} ${error?'aria-invalid="true"':''} aria-describedby="${f.id}-hint ${f.id}-error"`;
  let input;
  if(f.type==='select')input=`<select ${attrs}>${f.options.map(([v,label])=>`<option value="${v}" ${value===v?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
  else if(f.type==='textarea')input=`<textarea ${attrs} rows="3">${esc(value)}</textarea>`;
  else if(f.type==='checkbox')input=`<div class="check-row"><input ${attrs} type="checkbox" ${value===true?'checked':''}><label for="${f.id}">${esc(f.label)}${f.required?' <span class="required">*</span>':''}</label></div>`;
  else input=`<input ${attrs} type="${f.type}" value="${esc(value)}" ${f.type==='number'?'min="1" step="1"':''} ${f.id==='fiscalCode'?'autocapitalize="characters"':''}>`;
  return `<div class="field ${f.type==='textarea'||f.type==='checkbox'||f.type==='select'?'wide':''}">${f.type!=='checkbox'?`<label for="${f.id}">${esc(f.label)}${f.required?' <span class="required">*</span>':''}</label>`:''}<span class="field-hint" id="${f.id}-hint">${esc(f.hint||'')}</span>${input}<span class="field-error" id="${f.id}-error">${esc(error||'')}</span></div>`;
}
function introduction() {return `<div class="info-box"><strong>Prima di compilare</strong><p>Puoi inviare la scheda cifrata al gruppo tramite il link del capo e scaricare il PDF originale completo delle pagine informative. Le copie ridotte per il campo vengono preparate dai capi.</p><p>Il PDF originale va firmato su carta da chi esercita la responsabilità genitoriale, dal rappresentante o dall’interessato maggiorenne, secondo il caso indicato.</p></div><details open><summary>Indicazioni del gruppo</summary><div class="document-text">${esc(content.intro)}</div></details><details><summary>Informativa sul trattamento dei dati personali · testo originale</summary><div class="document-text">${esc(content.privacy)}</div></details><details><summary>Indicazioni per la somministrazione di farmaci</summary><div class="document-text">${esc(content.medicationInfo)}</div></details>`;}
function declarationInfo(){return `<details open><summary>Dichiarazione del modello originale</summary><div class="document-text">${esc(content.declaration)}\n\n(*) Il punto 4 riguarda solo i minorenni.</div></details>${data.consent==='no'?'<div class="info-box warning">Hai scelto di non prestare il consenso. Il modello segnala che il rifiuto dei dati o la loro inesattezza potrebbe impedire la partecipazione alle attività. La tua scelta sarà riportata nel PDF originale.</div>':''}`;}
function review(){
  const invalid=validate(data);const count=Object.keys(invalid).length;
  return `${count?`<div class="info-box warning"><strong>Mancano ${count} risposte o correzioni.</strong><p>Torna alle sezioni evidenziate per completare la scheda.</p><button type="button" class="text-button" id="fix-errors">Vai al primo campo da correggere →</button></div>`:''}<div class="download-grid"><article><span class="file-tag">PDF · PER LA SEDE</span><h3>Il modello originale</h3><p>Le 11 pagine originali compilate, con eventuale allegato per i testi lunghi. Spazi per le firme lasciati liberi.</p><button type="button" class="button secondary" id="export-original" ${count?'disabled':''}>Scarica originale ↓</button></article></div><div class="info-box"><strong>Prima di consegnare</strong><p>Controlla e firma il PDF originale. ${data.administration==='yes'?'Allega la prescrizione medica e consegna i farmaci con la posologia al Capo Unità. ':''}${data.currentPresent==='yes'?'In caso di malattie croniche allega la copia del tesserino di esenzione. ':''}Conserva il PDF con cura: contiene dati sanitari leggibili.</p></div><div class="review-heading"><h3>Riepilogo · ${esc(fullName(data))}</h3><span>Controlla prima di stampare</span></div>${dataBlocks(data).map(([title,rows])=>`<details open class="review-section"><summary>${esc(title)}</summary><dl>${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></details>`).join('')}<details open class="review-section"><summary>Dichiarazioni e consenso</summary><dl>${[['Consenso',data.consent==='yes'?'Presto il consenso':data.consent==='no'?'Non presto il consenso':'Non indicato'],['Dichiarante',data.declarant||fullName(data)],['Dichiarazioni confermate',data.declarationAccepted?'Sì':'Non confermate'],['Luogo e data',[data.place,data.date].filter(Boolean).join(' · ')]].map(([l,v])=>`<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></details>`;
}
function render(focus=false) {
  const globalErrors=validate(data);
  $('#steps').innerHTML=sections.map((s,i)=>{const filled=s.fields.some(f=>data[f.id]);const valid=i!==LAST&&filled&&!s.fields.some(f=>globalErrors[f.id]);return `<button type="button" data-step="${i}" class="step ${i===current?'active':''}" ${i===current?'aria-current="step"':''}><span class="step-number ${valid?'complete':''}">${valid?'✓':String(i+1).padStart(2,'0')}</span><span>${s.short}</span>${i!==current&&filled&&s.fields.some(f=>globalErrors[f.id])?'<i class="step-error" aria-label="Da completare"></i>':''}</button>`;}).join('');
  const s=sections[current];
  $('#section-content').innerHTML=`<div class="section-header"><div class="eyebrow">${String(current+1).padStart(2,'0')} / ${String(sections.length).padStart(2,'0')}</div><h2 tabindex="-1">${s.title}</h2><p>${s.caption}</p></div>${current===0?introduction():''}${current===LAST-1?declarationInfo():''}${current===LAST?review():`<p class="required-note">* Campo richiesto</p><div class="fields-grid">${s.fields.filter(f=>active(f,data)).map(fieldHtml).join('')}</div>`}`;
  $('.form-actions').classList.toggle('last',current===LAST);$('#previous').hidden=current===0;$('#next').hidden=current===LAST;$('#next').textContent=current===LAST-1?'Rivedi la scheda →':'Continua →';$('#step-count').textContent=`${current+1} di ${sections.length}`;
  $('#steps').querySelectorAll('button').forEach(b=>b.onclick=()=>go(Number(b.dataset.step)));
  $('#fix-errors')?.addEventListener('click',()=>{const i=sections.findIndex(s=>s.fields.some(f=>globalErrors[f.id]));errors=globalErrors;go(i);setTimeout(()=>document.getElementById(Object.keys(globalErrors)[0])?.focus(),0);});
  $('#export-original')?.addEventListener('click',()=>exportOriginal());
  if(current===LAST){$('#section-content .download-grid').insertAdjacentHTML('afterend',deliveryHtml());mountDelivery();}
  if(focus){$('#section-content h2').focus();$('#section-content').scrollIntoView({behavior:'smooth',block:'start'});}
}
function go(index){if(busy)return;current=index;render(true);}
function notify(message,error=false){$('#notice').textContent=message;$('#notice').className=message?'notice '+(error?'error':'success'):'';}
$('#health-form').addEventListener('input',e=>{
  const f=allFields.find(f=>f.id===e.target.name);if(!f)return;
  data[f.id]=f.type==='checkbox'?e.target.checked:e.target.value;
  resetDelivery();
  dirty=true;delete errors[f.id];
  if(f.type==='select'){render();document.getElementById(f.id)?.focus();}
  else {e.target.removeAttribute('aria-invalid');document.getElementById(f.id+'-error').textContent='';}
});
$('#health-form').addEventListener('submit',e=>e.preventDefault());
$('#next').onclick=()=>{if(busy)return;errors=validate(data,current);if(Object.keys(errors).length){render();document.getElementById(Object.keys(errors)[0])?.focus();notify('Completa le voci evidenziate per continuare.',true);return;}notify('');go(Math.min(LAST,current+1));};
$('#previous').onclick=()=>go(Math.max(0,current-1));
$('#reset').onclick=()=>{if(busy)return;if(Object.keys(data).length&&!confirm('Svuotare tutti i dati inseriti? Assicurati di aver inviato la scheda o scaricato il PDF se vuoi conservarli.'))return;startSheet(false);};
function startSheet(keepAnswers){
  if(busy)return;
  resetDelivery();errors={};
  if(!keepAnswers){data={};dirty=false;}
  notify(keepAnswers?'Modifica i dati e invia una nuova versione. La consegna precedente resta salvata.':'Scheda svuotata. Puoi compilare una nuova scheda.');
  go(keepAnswers?1:0);
}
function currentData(){return Object.keys(validate(data)).length?null:cleanData(data);}
async function exportOriginal(){
  if(busy)return;const issues=validate(data);if(Object.keys(issues).length){errors=issues;render();return;}
  busy=true;document.body.classList.add('busy');notify('Preparazione del file in corso…');
  try{const clean=cleanData(data);const bytes=await originalPdf(clean);download(bytes,filename(clean)+'-originale-da-firmare.pdf','application/pdf');notify('PDF originale pronto. Controllalo e apponi le firme sulla copia stampata.');}
  catch(e){notify('Download non riuscito: '+e.message,true);}
  finally{busy=false;document.body.classList.remove('busy');mountDelivery();}
}
$('#import-trigger').onclick=()=>{if(!busy)$('#import-file').click();};
$('#import-file').onchange=async e=>{
  const file=e.target.files[0];if(!file||busy)return;busy=true;document.body.classList.add('busy');
  try{const imported=await readArchive(file);if(Object.keys(data).length&&!confirm('Sostituire i dati attuali con quelli contenuti nello ZIP?'))return;data=imported;errors={};dirty=false;resetDelivery();current=LAST;render(true);notify('Scheda importata. Puoi scaricare l’originale o modificare qualsiasi sezione.');}
  catch(err){notify('Importazione non riuscita: '+err.message,true);}
  finally{e.target.value='';busy=false;document.body.classList.remove('busy');mountDelivery();}
};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
render();
initDelivery({getData:currentData,onSent:sent=>{if(JSON.stringify(currentData())===JSON.stringify(sent))dirty=false;},onNewSheet:()=>startSheet(false),onCorrection:()=>startSheet(true),notify,setBusy:value=>{busy=value;document.body.classList.toggle('busy',value);mountDelivery();}});
