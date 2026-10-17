import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {basic,complete} from './fixtures.mjs';
const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch(error){if(!process.env.PLAYWRIGHT_MODULE)throw error;({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
const artifacts=resolve('tmp/camp');await mkdir(artifacts,{recursive:true});
const profile=await mkdtemp(resolve('tmp/camp/profile-'));
const errors=[],external=[];
const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('blob:'))external.push(r.url());});};
let context;
async function start(){context=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,viewport:{width:1360,height:1050}});context.on('page',watch);const page=await context.newPage();watch(page);return page;}
async function saveFile(page,button,path){const promise=page.waitForEvent('download');await page.locator(button).click();await(await promise).saveAs(path);}
async function choose(page,files){await page.locator('#package-files').setInputFiles(files);await page.locator('#import-dialog').waitFor({state:'visible'});}
async function commit(page){await page.locator('#confirm-import').click();await page.locator('#import-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.body.classList.contains('busy'));}
try{
  let page=await start();await page.goto(base+'/campo/');
  await page.locator('#offline-status[data-ready="true"]').waitFor({timeout:30000});
  assert.equal(await page.locator('#update-app').isHidden(),true,'First installation is not an update');
  await page.screenshot({path:artifacts+'/empty.png',fullPage:true});
  const fixtures=await page.evaluate(async({basic,complete})=>{
    const {createArchive}=await import('/src/archive.js');
    const second={...complete,name:'Luca',surname:'Bianchi',fiscalCode:'BNCLCU13E14H501X',unit:'Esploratori',allergiesDetails:'Allergia fittizia da non perdere. <img src=x onerror=alert(1)>'};
    const third={...basic,fiscalCode:'RSSGLI13E54H501Y',unit:'Guide'};
    const updated={...second,allergiesDetails:'Aggiornamento fittizio confermato.',date:'2026-10-18'};
    const out=[];for(const data of [basic,second,third,updated]){const bytes=await createArchive(data);let str='';for(let i=0;i<bytes.length;i+=8192)str+=String.fromCharCode(...bytes.subarray(i,i+8192));out.push(btoa(str));}return out;
  },{basic,complete});
  const files=[];for(let i=0;i<fixtures.length;i++){const path=artifacts+'/scout-'+i+'.zip';await writeFile(path,Buffer.from(fixtures[i],'base64'));files.push(path);}
  await writeFile(artifacts+'/invalid.zip','this is not a zip');
  await choose(page,[files[0],files[1],files[2],artifacts+'/invalid.zip']);
  assert.match(await page.locator('#import-summary').innerText(),/3 nuove schede/);assert.match(await page.locator('#import-results').innerText(),/invalid.zip/);
  await commit(page);assert.equal(await page.locator('#count-all').innerText(),'3');
  await choose(page,[files[0]]);assert.match(await page.locator('#import-summary').innerText(),/1 già presenti/);await page.locator('#cancel-import').click();
  await page.locator('#scout-search').fill('rossi');assert.equal(await page.locator('.scout-row').count(),2,'Namesakes must not merge');
  await page.locator('#scout-search').fill('Luca Bianchi');assert.equal(await page.locator('.scout-row').count(),1);await page.locator('.scout-row').click();
  assert.match(await page.locator('#scout-detail').innerText(),/Allergia fittizia da non perdere/);assert.equal(await page.locator('#scout-detail img').count(),0,'Imported markup must remain text');
  assert.equal(await page.locator('a[href="tel:3331111111"]').count(),1);
  await page.locator('#scout-search').fill('');await page.locator('[data-filter="allergies"]').click();assert.equal(await page.locator('.scout-row').count(),1);
  await page.locator('[data-filter="all"]').click();await page.locator('#unit-filter').selectOption('Guide');assert.equal(await page.locator('.scout-row').count(),2);await page.locator('#unit-filter').selectOption('');
  await choose(page,[files[3]]);await page.locator('.conflict-card summary').click();assert.match(await page.locator('.import-diff').innerText(),/Aggiornamento fittizio confermato/);assert.equal(await page.locator('[data-conflict]').isChecked(),false);await commit(page);
  await page.locator('[data-id="BNCLCU13E14H501X"]').click();assert.match(await page.locator('#scout-detail').innerText(),/Allergia fittizia da non perdere/);
  await choose(page,[files[3]]);await page.locator('[data-conflict]').check();await commit(page);
  assert.match(await page.locator('#scout-detail').innerText(),/Aggiornamento fittizio confermato/);
  await page.locator('#device-settings').click();await page.locator('#camp-name').fill('Campo estivo · Roma 21');await page.locator('#save-name').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));await page.locator('#close-settings').click();
  await page.screenshot({path:artifacts+'/desktop.png',fullPage:true});
  // A transaction failure must not leave even its first record saved.
  const rollback=await page.evaluate(async()=>{
    const store=await import('/campo/store.js');const state=await store.loadState();const r=state.records[0];
    try{await store.saveScouts([{record:{...r,id:'ROLLBACK',revision:'new'}},{record:{data:r.data}}]);return false;}catch{return !(await store.loadState()).records.some(r=>r.id==='ROLLBACK');}
  });assert.equal(rollback,true);
  // Simulate another window modifying a record after the conflict review.
  const race=await page.evaluate(async()=>{
    const store=await import('/campo/store.js');const r=(await store.loadState()).records[0];
    try{await store.saveScouts([{record:{...r,revision:'wrong'},expectedRevision:'obsolete'}]);return false;}catch{return (await store.loadState()).records.find(x=>x.id===r.id).revision===r.revision;}
  });assert.equal(race,true);
  await context.close();context=null;
  // A new browser process and page, with the network disabled before navigation.
  page=await start();await context.setOffline(true);await page.goto(base+'/campo/');
  await page.locator('#offline-status[data-ready="true"]').waitFor();assert.equal(await page.locator('#count-all').innerText(),'3');assert.equal(await page.locator('#camp-title').innerText(),'Campo estivo · Roma 21');
  await page.setViewportSize({width:390,height:844});await page.locator('#scout-search').fill('bnclcu13e14h501x');await page.locator('.scout-row').click();
  assert.match(await page.locator('#scout-detail').innerText(),/Aggiornamento fittizio confermato/);
  await page.locator('.detail-jumps a[href="#quick-contacts"]').click();assert.equal(new URL(page.url()).hash,'#quick-contacts');
  await page.locator('.detail-jumps a[href="#medicine-record"]').click();assert.equal(await page.locator('#medicine-record').getAttribute('open'),'');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile horizontal overflow');
  await page.screenshot({path:artifacts+'/offline-mobile.png',fullPage:true});
  await saveFile(page,'#download-compact',artifacts+'/offline-compact.pdf');await page.waitForFunction(()=>!document.body.classList.contains('busy'));
  await saveFile(page,'#download-original',artifacts+'/offline-original.pdf');await page.waitForFunction(()=>!document.body.classList.contains('busy'));
  await saveFile(page,'#backup-group',artifacts+'/group-backup.zip');await page.waitForFunction(()=>!document.body.classList.contains('busy'));
  page.once('dialog',dialog=>dialog.accept());await page.locator('#remove-scout').click();await page.waitForFunction(()=>document.getElementById('count-all').textContent==='2');
  await page.locator('#device-settings').click();page.once('dialog',dialog=>dialog.accept());await page.locator('#erase-group').click();await page.waitForFunction(()=>document.getElementById('count-all').textContent==='0');
  await choose(page,[artifacts+'/group-backup.zip']);assert.match(await page.locator('#import-summary').innerText(),/3 nuove schede/);await commit(page);assert.equal(await page.locator('#count-all').innerText(),'3');assert.equal(await page.locator('#camp-title').innerText(),'Campo estivo · Roma 21');
  await page.reload();await page.locator('#offline-status[data-ready="true"]').waitFor();assert.equal(await page.locator('#count-all').innerText(),'3');
  await choose(page,[artifacts+'/invalid.zip']);assert.equal(await page.locator('#confirm-import').isDisabled(),true);await page.locator('#cancel-import').click();assert.equal(await page.locator('#count-all').innerText(),'3');
  assert.deepEqual(errors,[],'Page errors');assert.deepEqual(external,[],'External network requests');
  console.log('PASS: bulk import, invalid packages, duplicate identities, explicit updates, search and filters, callable contacts, escaped markup, atomic transactions, conflict race, browser restart fully offline, PDF exports offline, group backup and restore offline, deletion, mobile layout.');
}finally{await context?.close();}
