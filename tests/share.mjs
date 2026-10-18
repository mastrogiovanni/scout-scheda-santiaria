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
  await page.evaluate(()=>window.shareMode='NotAllowedError');await page.locator('#export-zip').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('(NotAllowedError)'));
  assert.equal(downloads,0);assert.equal(await page.locator('#zip-help').isVisible(),true);assert.match(await page.locator('#zip-status').innerText(),/NotAllowedError/);
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
  // Android Chromium's native backend rejects ZIPs even when canShare returns true.
  // Also cover desktop-mode/reduced UA with Android reported by Client Hints.
  for(const clientHints of [false,true]){
    const android=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844},userAgent:clientHints?'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36':'Mozilla/5.0 (Linux; Android 16; Motorola Edge 60) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'});
    await android.addInitScript(clientHints=>{
      if(clientHints)Object.defineProperty(navigator,'userAgentData',{value:{platform:'Android',brands:[{brand:'Chromium',version:'141'}]}});
      window.nativeShareCalls=0;
      Object.defineProperty(navigator,'canShare',{value:()=>true});
      Object.defineProperty(navigator,'share',{value:()=>{window.nativeShareCalls++;return Promise.reject(new DOMException('Permission denied','NotAllowedError'));}});
    },clientHints);
    const mobile=await android.newPage();await mobile.goto(base+'/');await mobile.locator('#import-file').setInputFiles(input);await mobile.locator('#export-zip:not([disabled])').waitFor();
    assert.equal(await mobile.locator('#export-zip').innerText(),'Scarica ZIP ↓');assert.match(await mobile.locator('#zip-status').innerText(),/Android.*bloccano/);
    assert.equal(await mobile.locator('#zip-help').isVisible(),true);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await mobile.evaluate(async()=>{const {canShareFile}=await import('/src/share.js');return canShareFile(new File(['example'],'example.pdf',{type:'application/pdf'}));}),true,'The Android guard must apply to ZIPs only');
    const downloaded=mobile.waitForEvent('download');await mobile.locator('#export-zip').click();await(await downloaded).saveAs(output+'/android-'+clientHints+'.zip');assert.equal(await mobile.evaluate(()=>window.nativeShareCalls),0);
    if(!clientHints)await mobile.screenshot({path:output+'/android-download.png',fullPage:true});
    // Optional local regression with a real private ZIP: no values, screenshots,
    // or generated artifacts are logged/saved; never run this against a remote host.
    if(process.env.PRIVATE_ZIP_PATH&&!clientHints){
      assert.equal(new URL(base).hostname,'127.0.0.1');
      mobile.on('dialog',dialog=>dialog.accept());
      await mobile.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
      await mobile.evaluate(()=>{document.getElementById('notice').textContent='';document.getElementById('import-file').addEventListener('change',e=>{window.privateZip=e.target.files[0];},{once:true,capture:true});});
      await mobile.locator('#import-file').setInputFiles(resolve(process.env.PRIVATE_ZIP_PATH));await mobile.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Scheda importata.'));await mobile.locator('#export-zip:not([disabled])').waitFor();
      // Compare only in memory: imported answers must survive ZIP regeneration.
      const checked=await mobile.evaluate(async()=>{
        const {readArchive,createArchive}=await import('/src/archive.js');
        const {cleanData}=await import('/src/schema.js');
        const original=await readArchive(window.privateZip);
        const regenerated=await readArchive(new File([await createArchive(original)],'check.zip',{type:'application/zip'}));
        return JSON.stringify(cleanData(original))===JSON.stringify(regenerated);
      });
      assert.equal(checked,true);console.log('PASS: private ZIP validated and round-tripped locally; no personal data logged or uploaded.');
    }
    await android.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS: ZIP sharing activation, JSON/PDF, cancellation, readable error, explicit download, edits, mobile layout and Android Chromium ZIP rejection fallback. Native share targets are mocked: no file is actually sent.');
}finally{await browser.close();}
