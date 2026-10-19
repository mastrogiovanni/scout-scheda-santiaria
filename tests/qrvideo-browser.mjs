import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {basic,complete} from './fixtures.mjs';
const require=createRequire(import.meta.url);let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
await mkdir('tmp/secure',{recursive:true});
const browser=await chromium.launch({headless:true});
let activePage;
let profile=null,groups=[],sheets=[],captured=[],failFirst=true,requestBodies=[];
const uid='11111111-1111-4111-8111-111111111111';
try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true});
  await context.addInitScript(()=>{
    // Tests feed real, generated QR pixels through a MediaStream. No camera permission or hardware needed.
    const camera=document.createElement('canvas');camera.width=1280;camera.height=960;window.testCameraCanvas=camera;
    window.testShowQR=text=>{const c=document.createElement('canvas');const code=window.qrcode(0,'M');code.addData(text,'Byte');code.make();const n=code.getModuleCount(),scale=Math.max(4,Math.floor(720/(n+8)));c.width=c.height=(n+8)*scale;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#000';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(code.isDark(y,x))ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);const v=camera.getContext('2d');v.fillStyle='#fff';v.fillRect(0,0,1280,960);v.drawImage(c,(1280-c.width)/2,(960-c.height)/2);window.testCameraStream?.getVideoTracks()[0]?.requestFrame?.();};
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{const s=camera.captureStream(15);window.testCameraStream=s;return s;}});
    const original=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(...args){if(window.jsQR&&this.width>100){const ctx=this.getContext('2d'),p=ctx?.getImageData(0,0,this.width,this.height),qr=p&&window.jsQR(p.data,p.width,p.height);if(qr?.data.startsWith('SCOUT-KEY-1:'))window.testPrivateQR=qr.data;}return original.apply(this,args);};
  });
  await context.route('**/src/supabase-config.js',r=>r.fulfill({contentType:'text/javascript',body:"export const SUPABASE_URL='https://wbzwxutrholchzodzwuy.supabase.co';export const SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';"}));
  await context.route('https://wbzwxutrholchzodzwuy.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();if(body)requestBodies.push(JSON.stringify(body));
    const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data),headers:{'Access-Control-Allow-Origin':base}});
    if(url.pathname.endsWith('/user'))return send({id:uid,email:'capo@example.org'});
    if(url.pathname.includes('/token'))return send({access_token:'test-session',refresh_token:'test-refresh',user:{id:uid}});
    if(url.pathname.endsWith('/logout'))return send(null);
    const name=url.pathname.split('scout_secure_')[1];
    if(name==='profile')return send(profile);
    if(name==='register'){profile={user_id:uid,display_name:body.p_name,public_key:body.p_public_key,key_id:body.p_key_id};return send(null);}
    if(name==='groups')return send(groups);
    if(name==='create_group'){const g={id:crypto.randomUUID(),name:body.p_name,scout_year:body.p_year,closed:false};groups.push(g);captured.push(body.p_token);return send(g);}
    if(name==='sheets')return send(sheets.filter(s=>s.group_id===body.p_group_id).slice(body.p_offset,body.p_offset+20));
    if(name==='group_info')return send({groupId:groups[0].id,name:groups[0].name,year:groups[0].scout_year,leader:profile.display_name,closed:false,publicKey:profile.public_key,keyId:profile.key_id});
    if(name==='submit'){
      if(failFirst){failFirst=false;return send({message:'Interruzione simulata, riprova.'},503);}
      const prior=sheets.find(s=>s.id===body.p_envelope.submissionId);if(!prior)sheets.push({id:body.p_envelope.submissionId,group_id:groups[0].id,envelope:body.p_envelope,received_at:new Date().toISOString()});return send({receipt:body.p_envelope.submissionId,receivedAt:new Date().toISOString()});
    }
    throw Error('Unexpected API: '+url.pathname);
  });
  const page=await context.newPage(),errors=[];activePage=page;page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/capi/');await page.locator('#leader-email').fill('capo@example.org');await page.locator('#leader-password').fill('password-fittizia-2026');await page.getByRole('button',{name:'Accedi',exact:true}).click();await page.locator('#leader-name').fill('Capo Test');
  const pdfDownload=page.waitForEvent('download');await page.locator('#generate-key').click();await(await pdfDownload).saveAs('tmp/secure/chiave-privata.pdf');
  const secret=await page.evaluate(()=>window.testPrivateQR);assert(secret?.startsWith('SCOUT-KEY-1:'));await page.locator('#key-kept').check();await page.locator('#register-key').click();await page.locator('#group-name').fill('Esploratori');await page.locator('#group-year').fill('2026-2027');await page.getByRole('button',{name:'Crea gruppo e link'}).click();
  const link=await page.locator('#share-link').inputValue();assert(link.includes('#gruppo='));assert.equal(profile.public_key.d,undefined);assert(!requestBodies.some(body=>body.includes(secret)));
  // Family submits through the real form integration. Only ciphertext reaches the API, retries keep UUID/ciphertext.
  await page.goto(link);await page.locator('#delivery-banner').getByText('Capo destinatario:',{exact:false}).waitFor();
  const zip=await page.evaluate(async data=>Array.from(await(await import('/src/archive.js')).createArchive(data)),complete);
  await page.locator('#import-file').setInputFiles({name:'scheda.zip',mimeType:'application/zip',buffer:Buffer.from(zip)});await page.locator('#delivery-consent').check();await page.locator('#submit-package').click();await page.getByText('Interruzione simulata, riprova.',{exact:true}).last().waitFor();await page.locator('#submit-package').click();await page.getByRole('heading',{name:'Scheda ricevuta'}).waitFor();assert.equal(sheets.length,1);
  const submissions=requestBodies.map(b=>JSON.parse(b)).filter(b=>b.p_envelope);assert.equal(submissions.length,2);assert.deepEqual(submissions[0].p_envelope,submissions[1].p_envelope);assert(!JSON.stringify(submissions).includes('Giulia'));assert(!JSON.stringify(submissions).includes('allergiesDetails'));
  const duplicate=await page.evaluate(async({data,group,profile})=>{const {seal}=await import('/src/crypto.js'),{createPayload}=await import('/src/archive.js');return seal(await createPayload({...data,fiscalCode:data.fiscalCode.toLowerCase()}),{groupId:group.id,publicKey:profile.public_key,keyId:profile.key_id});},{data:complete,group:groups[0],profile});
  sheets.push({id:duplicate.submissionId,group_id:groups[0].id,envelope:duplicate,received_at:new Date().toISOString()});
  const damagedId=crypto.randomUUID();sheets.push({id:damagedId,group_id:groups[0].id,envelope:{...duplicate,submissionId:damagedId},received_at:new Date().toISOString()});
  const another=await page.evaluate(async({data,group,profile})=>{const {seal}=await import('/src/crypto.js'),{createPayload}=await import('/src/archive.js');return seal(await createPayload({...data,name:'Luisa',surname:'Verdi',fiscalCode:'VRDLSA13E54H501Z'}),{groupId:group.id,publicKey:profile.public_key,keyId:profile.key_id});},{data:basic,group:groups[0],profile});
  sheets.push({id:another.submissionId,group_id:groups[0].id,envelope:another,received_at:new Date().toISOString()});
  // Leader loads encrypted JSON, scans printed-key pixels, and produces a QRVideo.
  await page.goto(base+'/capi/');await page.locator('[data-group]').click();assert(await page.locator('#export-compact').isHidden());await page.locator('#scan-key').click();await page.evaluate(s=>window.testShowQR(s),secret);await page.locator('[data-sheet]').first().waitFor({timeout:20000});assert.equal(await page.locator('[data-sheet]').count(),3);
  await page.getByText('Consegna non decifrabile',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-sheet]:checked').count(),1);await page.locator('[data-sheet]').nth(2).uncheck();await page.locator('#export-compact').click();await page.getByText('Seleziona almeno una scheda.',{exact:true}).waitFor();
  await page.locator('[data-sheet]').nth(0).check();await page.locator('[data-sheet]').nth(1).check();await page.locator('#export-compact').click();await page.getByText('Seleziona una sola versione per ogni codice fiscale.',{exact:true}).waitFor();await page.locator('#send-video').click();await page.getByText('Seleziona una sola versione per ogni codice fiscale.',{exact:true}).waitFor();await page.locator('[data-sheet]').nth(1).uncheck();
  await page.locator('[data-sheet]').nth(2).check();const groupDownload=page.waitForEvent('download');await page.locator('#export-compact').click();const groupPdf=await groupDownload;assert.equal(groupPdf.suggestedFilename(),'schede-ridotte-esploratori-2026-2027.pdf');await groupPdf.saveAs('tmp/secure/schede-ridotte-campo.pdf');
  assert.equal(await page.evaluate(async bytes=>(await window.PDFLib.PDFDocument.load(new Uint8Array(bytes))).getPageCount(),Array.from(await readFile('tmp/secure/schede-ridotte-campo.pdf'))),2);
  await page.screenshot({path:'tmp/secure/capi-pdf-ridotto.png',fullPage:true});
  await page.locator('#forget-clear').click();assert(await page.locator('#export-compact').isHidden());assert.equal(await page.locator('[data-sheet]').count(),0);
  await page.locator('#scan-key').click();await page.evaluate(s=>window.testShowQR(s),secret);await page.locator('[data-sheet]').first().waitFor({timeout:20000});await page.locator('[data-sheet]').nth(0).check();await page.locator('[data-sheet]').nth(2).uncheck();
  await page.locator('#send-video').click();
  const frames=[];let count;do{const value=await page.locator('#transfer-qr').evaluate(canvas=>{for(const scale of [1,.75]){const sample=document.createElement('canvas');sample.width=Math.round(canvas.width*scale);sample.height=Math.round(canvas.height*scale);const c=sample.getContext('2d');c.drawImage(canvas,0,0,sample.width,sample.height);const p=c.getImageData(0,0,sample.width,sample.height),qr=window.jsQR(p.data,p.width,p.height,{inversionAttempts:'dontInvert'});if(qr)return qr.data;}});if(!value){console.error({failedFrame:frames.length+1,canvas:await page.locator('#transfer-qr').evaluate(c=>({w:c.width,h:c.height})),status:await page.locator('#frame-status').innerText(),errors});await page.locator('#transfer-qr').screenshot({path:'tmp/secure/failed-qr.png'});}assert(value?.startsWith('SQV1|'));frames.push(value);count=Number((await page.locator('#frame-status').innerText()).split('/')[1]);if(frames.length<count)await page.locator('#next-frame').click();}while(frames.length<count);
  assert(frames.length>1);await page.screenshot({path:'tmp/secure/qrvideo-desktop.png',fullPage:true});await page.locator('#close-video').click();
  assert(!await page.evaluate(s=>JSON.stringify({...localStorage,...sessionStorage}).includes(s),secret));
  // Prepare phone: old records erased before acquisition, invalid/duplicate/out-of-order QR frames handled.
  await page.goto(base+'/campo/');await page.waitForFunction(()=>document.querySelector('#offline-status')?.dataset.ready==='true');
  await page.evaluate(async data=>{const s=await import('/campo/store.js');await s.saveScouts([{record:{id:data.fiscalCode,data,archive:null,revision:'old',importedAt:new Date().toISOString()},expectedRevision:null}]);},basic);
  page.once('dialog',d=>d.accept());await page.locator('#prepare-qrvideo').click();await page.waitForFunction(()=>document.body.dataset.mode==='preparation');
  assert.equal(await page.evaluate(async()=>((await(await import('/campo/store.js')).loadState()).records.length)),0);
  // qrcode is a sender dependency only. Load its already-vendored script in this test to simulate camera pixels.
  await page.addScriptTag({url:base+'/public/vendor/qrcode.js'});
  await page.evaluate(f=>window.testShowQR(f),frames.at(-1));await page.waitForFunction(()=>document.querySelector('#fragment-progress').getAttribute('aria-valuenow')==='1');
  for(const f of frames.slice(0,-1).reverse()){const before=await page.locator('#fragment-progress').getAttribute('aria-valuenow');await page.evaluate(text=>window.testShowQR(text),f);await page.waitForFunction(previous=>document.body.dataset.mode==='use'||document.querySelector('#fragment-progress').getAttribute('aria-valuenow')!==previous,before,{timeout:15000});}
  await page.waitForFunction(()=>document.body.dataset.mode==='use');assert.equal(await page.locator('#count-all').innerText(),'1');await page.locator('.scout-row').click();await page.getByRole('heading',{name:'Giulia Rossi',exact:true}).waitFor();
  assert(await page.evaluate(()=>window.testCameraStream.getTracks().every(t=>t.readyState==='ended')));
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#offline-status').dataset.ready==='true');await page.locator('.scout-row').click();await page.getByRole('heading',{name:'Giulia Rossi',exact:true}).waitFor();
  const compact=page.waitForEvent('download');await page.locator('#download-compact').click();await(await compact).saveAs('tmp/secure/scheda-offline.pdf');
  const pack=page.waitForEvent('download');await page.locator('#download-package').click();const packDownload=await pack;assert(packDownload.suggestedFilename().endsWith('.zip'));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/secure/campo-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // A fresh preparation while offline clears the previous archive, persists mode, and survives reload.
  page.once('dialog',d=>d.accept());await page.locator('#prepare-qrvideo').click();await page.waitForFunction(()=>document.body.dataset.mode==='preparation');await page.reload();await page.waitForFunction(()=>document.body.dataset.mode==='preparation');assert.equal(await page.locator('#count-all').innerText(),'0');
  const staleRejected=await page.evaluate(async data=>{const s=await import('/campo/store.js'),old=await s.loadState();await s.beginPreparation();let rejected=false;try{await s.completePreparation([{id:data.fiscalCode,data,revision:'stale'}],'Vecchio campo',old.preparationId);}catch{rejected=true;}const state=await s.loadState();return rejected&&state.records.length===0&&state.mode==='preparation';},basic);assert(staleRejected);
  assert.deepEqual(errors,[]);console.log(`Censimento/PDF privato, invio cifrato con retry, decifratura via camera, ${frames.length} QR reali, preparazione e riapertura offline verificati.`);
}catch(error){if(activePage){await activePage.screenshot({path:'tmp/secure/failure.png',fullPage:true}).catch(()=>{});console.error(await activePage.locator('#preparation-status').textContent({timeout:1000}).catch(()=>''));console.error(await activePage.evaluate(()=>{const c=window.testCameraCanvas,v=document.querySelector('#camp-video');if(!c||!v)return {};const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height);const q=window.jsQR(pixels.data,c.width,c.height);return {canvasQRLength:q?.data.length,videoWidth:v.videoWidth,tracks:window.testCameraStream?.getTracks().map(t=>t.readyState)};}));}throw error;}finally{await browser.close();}
