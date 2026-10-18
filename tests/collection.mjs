import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {basic} from './fixtures.mjs';
import {inspectZip} from '../server/zip.js';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4183';
const storage='https://wbzwxutrholchzodzwuy.supabase.co';const token='a'.repeat(64);
const cid='11111111-1111-4111-8111-111111111111',iid='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333';
const col={id:cid,name:'Campo di prova',deadline:'2027-07-01T21:59:59Z',delete_after:'2027-10-01T21:59:59Z',closed:false};
const invite={id:iid,label:'Famiglia di prova',revoked:false};
const sub={id:sid,invitation_id:iid,scout_name:'Giulia Rossi',unit:'Guide',status:'received',received_at:'2026-10-18T10:00:00Z',receipt:sid,size:0};
const out=resolve('tmp/collection');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844}});
  let authenticated=false,uploaded=null,completeFails=true,receipt=null,zipBytes=null;const actions=[],errors=[],outside=[];
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===storage){
      if(url.pathname.includes('/upload/sign/')){assert.equal(req.method(),'PUT');uploaded=req.postDataBuffer();return route.fulfill({status:200,json:{ok:true}});}
      if(url.pathname.includes('/object/sign/'))return route.fulfill({status:200,body:zipBytes,contentType:'application/zip'});
      outside.push(req.url());return route.abort();
    }
    if(url.origin!==new URL(base).origin){outside.push(req.url());return route.abort();}
    if(url.pathname!=='/api/raccolta')return route.continue();
    if(req.method()==='GET')return route.fulfill({json:{enabled:true,storageOrigin:storage}});
    const body=req.postDataJSON();actions.push(body);let value={ok:true},status=200;
    switch(body.action){
      case 'invitation':value={collection:col.name,label:invite.label,closed:col.closed,delivered:receipt};break;
      case 'begin':value={id:sid,uploadUrl:storage+'/storage/v1/object/upload/sign/scout-packages/'+cid+'/'+sid+'.zip?token=fake'};break;
      case 'complete':
        if(completeFails){status=503;value={error:'Connessione interrotta. Nessuna consegna confermata.'};}
        else{inspectZip(uploaded);receipt={receipt:sid,receivedAt:sub.received_at,collection:col.name};value=receipt;}break;
      case 'login':value={message:'Se l’indirizzo è abilitato, riceverai un link di accesso.'};break;
      case 'session':authenticated=true;break;
      case 'dashboard':if(!authenticated){status=401;value={error:'Accedi per continuare.'};}else value={user:{email:'capo@example.invalid',role:'admin'},collections:[col]};break;
      case 'leaders':value=[{email:'capo@example.invalid',role:'admin',enabled:true}];break;
      case 'collection':value={collection:col,invitations:[invite,{id:'44444444-4444-4444-8444-444444444444',label:'Altra famiglia',revoked:false}],submissions:[sub]};break;
      case 'createInvitation':value={id:iid,url:base+'/#consegna='+token};break;
      case 'file':value={url:storage+'/storage/v1/object/sign/scout-packages/'+cid+'/'+sid+'.zip?token=fake',sha256:createHash('sha256').update(zipBytes).digest('hex')};break;
      case 'check':sub.status='checked';break;
      case 'logout':authenticated=false;break;
      default:throw Error('Unexpected action '+body.action);
    }
    return route.fulfill({status,json:value});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(base+'/#consegna='+token);await page.getByRole('heading',{name:'Prima di iniziare'}).waitFor();
  assert.ok(!page.url().includes(token),'Invitation secret must be removed from the URL');
  const encoded=await page.evaluate(async data=>{const {createArchive}=await import('/src/archive.js');const bytes=await createArchive(data);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);},basic);
  zipBytes=Buffer.from(encoded,'base64');sub.size=zipBytes.length;const path=out+'/input.zip';await writeFile(path,zipBytes);
  await page.locator('#import-file').setInputFiles(path);await page.locator('#export-zip:not([disabled])').waitFor();await page.locator('#submit-package').waitFor();
  assert.equal(uploaded,null);assert.equal(await page.locator('#submit-package').isDisabled(),true);
  await page.locator('#delivery-consent').check();assert.equal(await page.locator('#submit-package').isEnabled(),true);
  await page.locator('#submit-package').click();await page.waitForFunction(()=>document.getElementById('delivery-status')?.textContent.includes('Nessuna consegna confermata'));
  assert.equal(receipt,null);assert.equal(await page.getByText('Pacchetto ricevuto',{exact:true}).count(),0);assert.equal(inspectZip(uploaded).data.name,'Giulia');
  completeFails=false;await page.locator('#submit-package').click();await page.getByRole('heading',{name:'Pacchetto ricevuto'}).waitFor();
  assert.match(await page.locator('.receipt-code').innerText(),new RegExp(sid));
  assert.ok(actions.filter(a=>['begin','complete'].includes(a.action)).every(a=>!('data' in a)&&!('name' in a)),'Personal data must stay in the private ZIP, not request metadata');
  await page.reload();await page.getByRole('heading',{name:'Prima di iniziare'}).waitFor();await page.locator('#import-file').setInputFiles(path);await page.getByRole('heading',{name:'Pacchetto ricevuto'}).waitFor();
  await page.goto(base+'/capi/');await page.getByRole('heading',{name:'Accedi come capo'}).waitFor();
  await page.locator('#leader-email').fill('capo@example.invalid');await page.getByRole('button',{name:'Ricevi il link di accesso'}).click();await page.waitForFunction(()=>document.getElementById('leaders-notice').textContent.includes('riceverai'));
  await page.goto(base+'/capi/?code=synthetic');await page.locator('[data-collection]').waitFor();assert.ok(!page.url().includes('code='));
  await page.locator('[data-collection]').click();await page.locator('#create-invitation').waitFor();
  await page.locator('#invitation-label').fill('Famiglia di prova');await page.locator('#create-invitation button').click();await page.locator('#invite-url').waitFor();assert.equal(await page.locator('#invite-url').inputValue(),base+'/#consegna='+token);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:out+'/capi-mobile.png',fullPage:true});
  await page.locator('[data-check]').click();await page.getByText('Controllata',{exact:true}).waitFor();
  const downloaded=page.waitForEvent('download');await page.locator('#prepare-camp').click();const backup=out+'/campo.zip';await(await downloaded).saveAs(backup);
  const check=await page.evaluate(async base64=>{const z=await JSZip.loadAsync(base64,{base64:true});const meta=JSON.parse(await z.file('campo.json').async('string'));return {format:meta.format,count:meta.count,files:Object.keys(z.files).filter(p=>p.endsWith('.zip')).length};},(await readFile(backup)).toString('base64'));
  assert.deepEqual(check,{format:'scout-campo',count:1,files:1});
  await page.goto(base+'/campo/');await page.locator('#offline-status[data-ready="true"]').waitFor();
  await page.locator('#package-files').setInputFiles(backup);await page.locator('#import-dialog').waitFor({state:'visible'});await page.locator('#confirm-import').click();await page.locator('#import-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#count-all').innerText(),'1');
  await context.setOffline(true);await page.reload();await page.locator('#offline-status[data-ready="true"]').waitFor();assert.equal(await page.locator('#count-all').innerText(),'1');
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
  console.log('PASS: mobile invitation, explicit delivery choice, signed ZIP upload, failed completion without receipt, retry and restored receipt, leader login/callback, personal invitation link, review status, verified group backup, import into camp app and offline reload. Supabase/API simulated; no messages or real records sent.');
}finally{await browser.close();}
