import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {basic} from './fixtures.mjs';
const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch(error){if(!process.env.PLAYWRIGHT_MODULE)throw error;({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
const output=resolve('tmp/share');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844}});
  await context.addInitScript(()=>{
    window.shareMode='success';window.shareSupport='files';window.shareCalls=[];window.downloads=0;
    Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>{
      if(window.shareSupport==='throws')throw new Error('Blocked');
      return window.shareSupport==='files'&&data.files?.length===1&&data.files[0].type==='application/zip';
    }});
    Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
      const active=navigator.userActivation.isActive;
      window.shareCalls.push({active,keys:Object.keys(data),name:data.files[0].name,type:data.files[0].type});
      if(!active)return Promise.reject(new DOMException('A fresh tap is required','NotAllowedError'));
      if(window.shareMode!=='success')return Promise.reject(new DOMException('Test',window.shareMode));
      window.sharedFile=data.files[0];return Promise.resolve();
    }});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let downloads=0;page.on('download',()=>downloads++);
  await page.goto(base+'/');
  const zip=await page.evaluate(async data=>{
    const {createArchive}=await import('/src/archive.js');const bytes=await createArchive(data);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
  },basic);
  const input=output+'/input.zip';await writeFile(input,Buffer.from(zip,'base64'));
  // Make preparation outlast transient user activation, as PDF generation may on phones.
  await page.reload();let delayed=false;
  await page.route('**/public/modello-originale.pdf',async route=>{if(!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,6000));}await route.continue();});
  await page.locator('#import-file').setInputFiles(input);
  await page.locator('#export-zip').waitFor();assert.equal(await page.locator('#export-zip').isDisabled(),true);
  await page.locator('#export-zip:not([disabled])').waitFor({timeout:20000});
  assert.equal(await page.locator('#export-zip').innerText(),'Condividi ZIP ↗');
  assert.equal(await page.locator('#download-zip').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:output+'/mobile-share.png',fullPage:true});
  await page.locator('#export-zip').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Condivisione avviata'));
  assert.equal(downloads,0,'Sharing must not trigger a download too');
  const shared=await page.evaluate(async()=>{
    const zip=await JSZip.loadAsync(await window.sharedFile.arrayBuffer());return {call:window.shareCalls.at(-1),names:Object.keys(zip.files),data:JSON.parse(await zip.file('scheda.json').async('string')).data};
  });
  assert.equal(shared.call.active,true);assert.deepEqual(shared.call.keys,['files']);assert.equal(shared.call.name,'giulia-rossi-scheda.zip');assert.equal(shared.call.type,'application/zip');assert.equal(shared.data.name,'Giulia');assert.deepEqual(shared.names,['scheda.json','scheda-compatta.pdf']);
  // Canceling leaves the ZIP ready and does not download or regenerate it.
  await page.evaluate(()=>window.shareMode='AbortError');await page.locator('#export-zip').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Condivisione annullata'));
  assert.equal(downloads,0);assert.equal(await page.locator('#export-zip').isEnabled(),true);
  await page.evaluate(()=>window.shareMode='NotAllowedError');await page.locator('#export-zip').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Non è stato possibile condividere'));
  assert.equal(downloads,0);
  const fallback=page.waitForEvent('download');await page.locator('#download-zip').click();await(await fallback).saveAs(output+'/download-fallback.zip');assert.equal(downloads,1);
  // Editing invalidates the already prepared file: share must contain the new answers.
  await page.evaluate(()=>window.shareMode='success');await page.locator('[data-step="1"]').click();await page.locator('#name').fill('Luisa');await page.locator('[data-step="7"]').click();await page.locator('#export-zip:not([disabled])').waitFor();
  await page.locator('#export-zip').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Condivisione avviata'));
  assert.deepEqual(await page.evaluate(async()=>{const zip=await JSZip.loadAsync(await window.sharedFile.arrayBuffer());return [window.sharedFile.name,JSON.parse(await zip.file('scheda.json').async('string')).data.name];}),['luisa-rossi-scheda.zip','Luisa']);
  // Supporting text sharing alone is insufficient: ZIP-specific capability is tested.
  for(const support of ['text-only','throws']){
    await page.evaluate(value=>window.shareSupport=value,support);await page.locator('[data-step="0"]').click();await page.locator('[data-step="7"]').click();await page.locator('#export-zip:not([disabled])').waitFor();
    assert.equal(await page.locator('#export-zip').innerText(),'Scarica ZIP ↓');assert.equal(await page.locator('#download-zip').isHidden(),true);
    const count=await page.evaluate(()=>window.shareCalls.length);const download=page.waitForEvent('download');await page.locator('#export-zip').click();await(await download).saveAs(output+'/fallback-'+support+'.zip');assert.equal(await page.evaluate(()=>window.shareCalls.length),count);
  }
  assert.deepEqual(errors,[]);console.log('PASS: ZIP shared as a File with fresh user activation after slow preparation; correct JSON/PDF; cancellation, denied sharing, explicit download, revised answers, ZIP-unsupported fallback and mobile layout. Native share targets are mocked: no file is actually sent.');
}finally{await browser.close();}
