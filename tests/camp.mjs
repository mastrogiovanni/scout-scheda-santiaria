import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {basic,complete} from './fixtures.mjs';
const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch(error){if(!process.env.PLAYWRIGHT_MODULE)throw error;({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
const artifacts=resolve('tmp/camp');await mkdir(artifacts,{recursive:true});
const profile=await mkdtemp(resolve('tmp/camp/profile-'));
const errors=[],external=[],downloads=[];
const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('blob:'))external.push(r.url());});};
let context;
async function start(){context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1360,height:1050}});context.on('page',watch);return context.newPage();}
async function openErase(page){await page.locator('#device-settings').click();await page.locator('#erase-group').click();await page.locator('#erase-dialog').waitFor({state:'visible'});assert(await page.locator('#confirm-erase').isDisabled());assert(!await page.locator('#erase-confirmation').isChecked());}
try{
  let page=await start();await page.goto(base+'/campo/');await page.locator('#offline-status[data-ready="true"]').waitFor({timeout:30000});
  assert(await page.locator('#sync-screen').isVisible());assert(await page.locator('#camp-use').isHidden());assert(await page.locator('#preparation-panel').isHidden());
  assert.equal(await page.locator('input[type=file],#import-packages,#backup-group').count(),0);
  assert(await page.evaluate(()=>!window.JSZip&&!window.PDFLib&&!window.fontkit));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:artifacts+'/sync-mobile.png',fullPage:true});
  // Seed a previous-version database with a ZIP blob; v2 must preserve sheets and remove package copies.
  await context.close();context=null;
  const legacyProfile=await mkdtemp(resolve('tmp/camp/legacy-'));
  const legacy=await chromium.launchPersistentContext(legacyProfile,{headless:true});
  const legacyPage=await legacy.newPage();await legacyPage.goto(base+'/');
  await legacyPage.evaluate(async data=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('scout-sanitaria-campo',1);r.onupgradeneeded=()=>{r.result.createObjectStore('scouts',{keyPath:'id'});r.result.createObjectStore('settings',{keyPath:'key'});};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['scouts','settings'],'readwrite');tx.objectStore('scouts').put({id:data.fiscalCode,data,archive:new Uint8Array([80,75,3,4]),filename:'old.zip',revision:'legacy',importedAt:new Date().toISOString()});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);});},basic);
  await legacyPage.goto(base+'/campo/');await legacyPage.locator('.scout-row').waitFor();
  assert(await legacyPage.evaluate(async()=>{const s=await(await import('/campo/store.js')).loadState();return s.mode==='use'&&s.records.length===1&&!('archive'in s.records[0])&&!('filename'in s.records[0]);}));await legacy.close();
  page=await start();await page.goto(base+'/campo/');
  await page.evaluate(async({basic,complete})=>{const s=await import('/campo/store.js'),id=await s.beginPreparation();await s.completePreparation([basic,{...complete,name:'Luca',surname:'Bianchi',fiscalCode:'BNCLCU13E14H501X',unit:'Esploratori',allergiesDetails:'Allergia fittizia. <img src=x onerror=alert(1)>'},{...basic,fiscalCode:'RSSGLI13E54H501Y'}].map(data=>({id:data.fiscalCode,data,archive:new Uint8Array([1]),filename:'never.zip',revision:crypto.randomUUID(),importedAt:new Date().toISOString()})),'Campo estivo · Roma 21',id);},{basic,complete});
  await page.reload();await page.locator('.scout-row').first().waitFor();assert(await page.locator('#sync-screen').isHidden());assert(await page.locator('#camp-use').isVisible());assert.equal(await page.locator('#count-all').innerText(),'3');
  assert(await page.evaluate(async()=>{const s=await import('/campo/store.js');try{await s.beginPreparation();return false;}catch{return (await s.loadState()).records.every(r=>!('archive'in r)&&!('filename'in r));}}));
  await page.locator('#scout-search').fill('rossi');assert.equal(await page.locator('.scout-row').count(),2);
  await page.locator('#scout-search').fill('Luca Bianchi');await page.locator('.scout-row').click();assert.match(await page.locator('#scout-detail').innerText(),/Allergia fittizia/);assert.equal(await page.locator('#scout-detail img').count(),0);assert.equal(await page.locator('a[href="tel:3331111111"]').count(),1);
  assert.equal(await page.locator('#download-compact,#download-original,#download-package,#remove-scout').count(),0);
  await page.locator('#scout-search').fill('');await page.locator('[data-filter="allergies"]').click();assert.equal(await page.locator('.scout-row').count(),1);await page.locator('[data-filter="all"]').click();await page.locator('#unit-filter').selectOption('Guide');assert.equal(await page.locator('.scout-row').count(),2);await page.locator('#unit-filter').selectOption('');
  await page.locator('#device-settings').click();await page.locator('#camp-name').fill('Campo estivo · Roma 21');await page.locator('#save-name').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));await page.locator('#close-settings').click();
  await context.close();context=null;
  // New browser process, offline before navigation: app shell and records must still work.
  page=await start();await context.setOffline(true);await page.goto(base+'/campo/');await page.locator('#offline-status[data-ready="true"]').waitFor();assert.equal(await page.locator('#count-all').innerText(),'3');
  await page.setViewportSize({width:390,height:844});await page.locator('#scout-search').fill('bnclcu13e14h501x');await page.locator('.scout-row').click();await page.locator('.detail-jumps a[href="#medicine-record"]').click();assert.equal(await page.locator('#medicine-record').getAttribute('open'),'');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:artifacts+'/offline-mobile.png',fullPage:true});
  await openErase(page);
  // Handler must require the flag, even if someone bypasses the disabled button.
  await page.locator('#confirm-erase').evaluate(b=>{b.disabled=false;b.click();});assert.equal(await page.evaluate(async()=>(await(await import('/campo/store.js')).loadState()).records.length),3);
  await page.locator('#erase-confirmation').check();await page.locator('#cancel-erase').click();await page.locator('#erase-group').click();assert(!await page.locator('#erase-confirmation').isChecked());assert(await page.locator('#confirm-erase').isDisabled());
  await page.locator('#erase-confirmation').check();await page.keyboard.press('Escape');await page.locator('#erase-group').click();assert(!await page.locator('#erase-confirmation').isChecked());await page.screenshot({path:artifacts+'/erase-mobile.png',fullPage:false});
  const second=await context.newPage();await second.goto(base+'/campo/');await second.locator('.scout-row').first().click();
  await page.locator('#erase-confirmation').check();await page.locator('#confirm-erase').click();await page.locator('#sync-screen').waitFor({state:'visible'});await second.locator('#sync-screen').waitFor({state:'visible'});
  for(const tab of [page,second]){assert(!(await tab.locator('body').innerText()).includes('Giulia'));assert.match(await tab.locator('#scout-list').textContent(),/Il gruppo prende forma qui\..*Sincronizza le schede con il QRVideo del capo\./s);}
  await page.reload();await page.locator('#sync-screen').waitFor({state:'visible'});assert(await page.locator('#camp-use').isHidden());await page.locator('#offline-status[data-ready="true"]').waitFor();
  // A cancelled acquisition may never recreate records after erasure.
  assert(await page.evaluate(async data=>{const s=await import('/campo/store.js'),id=await s.beginPreparation();await s.eraseGroup();try{await s.completePreparation([{id:data.fiscalCode,data}],'Stale',id);return false;}catch{const state=await s.loadState();return state.records.length===0&&state.mode==='unprepared'&&!state.preparationId&&!state.campName;}},basic));
  assert(await page.evaluate(async data=>{const s=await import('/campo/store.js');let rejected=0;try{await s.saveCampName('Obsoleto');}catch{rejected++;}try{await s.completePreparation([{id:data.fiscalCode,data}],'Obsoleto');}catch{rejected++;}return rejected===2&&!(await s.loadState()).campName;},basic));
  assert.deepEqual(downloads,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: sync-only start, readonly use, no ZIP/PDF downloads, legacy ZIP cleanup, offline browser restart, search/contacts/mobile, mandatory erasure checkbox including cancel/Escape/bypass, cross-tab memory clearing, stale transfer rejection.');
}finally{await context?.close();}
