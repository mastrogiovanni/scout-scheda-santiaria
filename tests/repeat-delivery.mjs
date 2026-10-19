import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {generateIdentity,importIdentity,unseal} from '../src/crypto.js';
import {cleanData} from '../src/schema.js';
import {basic,complete} from './fixtures.mjs';

const require=createRequire(import.meta.url);let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const identity=await generateIdentity(),groupId='33333333-3333-4333-8333-333333333333',token='a'.repeat(64);
const privateKey=await importIdentity(identity.secret,identity.keyId);
const submissions=[],stored=new Map(),errors=[];let failFirst=true,lookups=0;
await mkdir('tmp/delivery',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1280,height:1000}});
  await context.route('**/src/supabase-config.js',r=>r.fulfill({contentType:'text/javascript',body:"export const SUPABASE_URL='https://wbzwxutrholchzodzwuy.supabase.co';export const SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';"}));
  await context.route('https://wbzwxutrholchzodzwuy.supabase.co/**',async route=>{
    const req=route.request(),body=req.postDataJSON(),path=new URL(req.url()).pathname;
    const send=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    assert.equal(body.p_token,token,'Every delivery must keep the original group link');
    if(path.endsWith('scout_secure_group_info')){lookups++;return send({groupId,name:'Guide',year:'2026-2027',leader:'Capo Test',closed:false,publicKey:identity.publicKey,keyId:identity.keyId});}
    assert(path.endsWith('scout_secure_submit'),'Unexpected API '+path);
    submissions.push(body.p_envelope);const envelope=body.p_envelope;
    assert.equal(envelope.groupId,groupId);assert.equal(envelope.keyId,identity.keyId);
    if(!stored.has(envelope.submissionId))stored.set(envelope.submissionId,{envelope,payload:await unseal(envelope,privateKey,{groupId,keyId:identity.keyId})});
    // Simulate a response lost after the database committed: retry must keep the same UUID/ciphertext.
    if(failFirst){failFirst=false;return send({message:'Risposta interrotta. Riprova lo stesso invio.'},503);}
    return send({receipt:envelope.submissionId,receivedAt:new Date().toISOString()});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#'+new URLSearchParams({gruppo:token,chiave:identity.keyId}));
  await page.locator('#delivery-banner').getByText('Capo destinatario:',{exact:false}).waitFor();assert(!page.url().includes('#'));
  await page.evaluate(()=>{window.testZipGenerations=0;const generate=JSZip.prototype.generateAsync;JSZip.prototype.generateAsync=function(...args){window.testZipGenerations++;return generate.apply(this,args);};});
  let fixtureZips=0;
  const fixtureZip=async data=>{fixtureZips++;return Buffer.from(await page.evaluate(async data=>Array.from(await(await import('/src/archive.js')).createArchive(data,{includeCompact:false})),data));};
  const upload=async(data,name='scheda.zip')=>page.locator('#import-file').setInputFiles({name,mimeType:'application/zip',buffer:await fixtureZip(data)});
  const ready=async()=>{await page.locator('#submit-package').waitFor();await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.equal(await page.locator('#export-zip, #download-zip, #retry-zip, #zip-status').count(),0);assert.equal(await page.getByText('ZIP · COPIA DEI DATI',{exact:true}).count(),0);assert.equal(await page.locator('#delivery-consent').isChecked(),false);assert(await page.locator('#submit-package').isDisabled());};
  const submit=async()=>{await page.locator('#delivery-consent').check();await page.locator('#submit-package').click();await page.getByRole('heading',{name:'Scheda ricevuta',exact:true}).waitFor();return page.locator('.receipt-code strong').innerText();};

  await upload(complete);await ready();assert.equal(submissions.length,0);
  await page.locator('.download-grid').scrollIntoViewIfNeeded();await page.screenshot({path:'tmp/delivery/compilazione-senza-zip-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.locator('.download-grid').scrollIntoViewIfNeeded();await page.screenshot({path:'tmp/delivery/compilazione-senza-zip-mobile.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1280,height:1000});
  await page.locator('#delivery-consent').check();await page.locator('#submit-package').click();await page.getByText('Risposta interrotta. Riprova lo stesso invio.',{exact:true}).last().waitFor();
  assert.equal(stored.size,1);assert.equal(await page.locator('#new-sheet').count(),0);
  await page.locator('#submit-package').click();await page.getByRole('heading',{name:'Scheda ricevuta',exact:true}).waitFor();
  const first=await page.locator('.receipt-code strong').innerText();assert.deepEqual(submissions[0],submissions[1]);
  await page.locator('#delivery-card').screenshot({path:'tmp/delivery/seconda-compilazione.png'});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#delivery-card').screenshot({path:'tmp/delivery/seconda-compilazione-mobile.png'});await page.setViewportSize({width:1280,height:1000});

  // A second intentional delivery of the same answers is independent from a network retry.
  await page.locator('#correct-sheet').click();assert.equal(await page.locator('#name').inputValue(),complete.name);
  await page.locator('[data-step="7"]').click();await ready();assert.equal(submissions.length,2);
  const second=await submit();assert.notEqual(second,first);assert.equal(stored.size,2);
  assert.deepEqual(stored.get(second).payload.data,stored.get(first).payload.data);

  // Editing a confirmed sheet directly must also clear the previous delivery state.
  await page.locator('[data-step="2"]').click();await page.locator('#allergiesDetails').fill('Allergia aggiornata: dato fittizio.');
  await page.locator('[data-step="7"]').click();await ready();const third=await submit();assert.notEqual(third,second);
  assert.equal(stored.get(first).payload.data.allergiesDetails,complete.allergiesDetails);
  assert.equal(stored.get(third).payload.data.allergiesDetails,'Allergia aggiornata: dato fittizio.');

  // Starting another child clears every answer while retaining the group's in-memory link.
  await page.locator('#new-sheet').click();await page.getByRole('heading',{name:'Prima di iniziare',exact:true}).waitFor();assert.equal(await page.locator('#readInfo').isChecked(),false);
  await page.locator('[data-step="1"]').click();assert.equal(await page.locator('#name').inputValue(),'');assert.equal(await page.locator('#fiscalCode').inputValue(),'');await page.locator('[data-step="0"]').click();
  await page.locator('[data-step="7"]').click();await ready();await page.locator('#delivery-consent').check();assert(await page.locator('#submit-package').isDisabled());assert(await page.locator('#export-original').isDisabled());await page.locator('[data-step="0"]').click();
  const other={...basic,name:'Luisa',surname:'Verdi',fiscalCode:'VRDLSA13E54H501Z'};
  for(let step=0;step<7;step++){
    const fields=await page.locator('#section-content input, #section-content textarea, #section-content select').evaluateAll(els=>els.map(e=>({id:e.id,type:e.type})));
    for(const {id,type} of fields){if(!Object.hasOwn(other,id))continue;if(type==='checkbox'){if(other[id])await page.locator('#'+id).check();}else if(type==='select-one')await page.locator('#'+id).selectOption(other[id]);else await page.locator('#'+id).fill(other[id]);}
    for(const id of ['tetanusDate','boosterDate'])if(await page.locator('#'+id).count())await page.locator('#'+id).fill(other[id]);
    await page.locator('#next').click();assert.equal(await page.locator('.field-error:not(:empty)').count(),0,'Step '+step);
  }
  await ready();const fourth=await submit();assert.equal(stored.size,4);assert.deepEqual(stored.get(fourth).payload.data,cleanData(other));
  assert.equal(lookups,1);assert.match(await page.locator('#delivery-banner').innerText(),/Guide · 2026-2027/);

  // A replacement import and the existing clear-form button must both allow another delivery.
  page.once('dialog',d=>d.accept());await upload(complete,'correzione.zip');await ready();const fifth=await submit();assert.equal(stored.size,5);assert.notEqual(fifth,first);
  page.once('dialog',d=>d.accept());await page.locator('#reset').click();await page.getByRole('heading',{name:'Prima di iniziare',exact:true}).waitFor();await upload(basic);await ready();
  assert.equal(submissions.length,6,'No automatic submissions on edit, reset, import or starting a new sheet');
  assert.equal(await page.evaluate(()=>window.testZipGenerations),fixtureZips,'Only the test fixture helper may generate ZIPs; form/review/delivery must not');
  assert(!JSON.stringify(submissions).includes('Giulia'));assert(!JSON.stringify(submissions).includes('allergiesDetails'));assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS: same link, intentional repeat with distinct receipt, unchanged prior deliveries, correction, new child with empty form, replacement import/reset, explicit consent each time, encrypted payloads and idempotent network retry. Auth/RPC mocked; no real records sent.');
}finally{await browser.close();}
