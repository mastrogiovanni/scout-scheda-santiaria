import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
await mkdir('tmp/auth',{recursive:true});
const browser=await chromium.launch({headless:true});
const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.org'};
try{
  const context=await browser.newContext({viewport:{width:1200,height:1000}}),requests=[],errors=[];
  await context.route('**/src/supabase-config.js',route=>route.fulfill({contentType:'text/javascript',body:"export const SUPABASE_URL='https://wbzwxutrholchzodzwuy.supabase.co';export const SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';"}));
  let invalidLink=false;
  await context.route('https://wbzwxutrholchzodzwuy.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();requests.push({path:url.pathname,method:req.method(),body,url:req.url(),authorization:req.headers().authorization});
    const send=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if(url.pathname.endsWith('/recover'))return send({});
    if(url.pathname.endsWith('/signup'))return send({user:{...user,identities:[]}});
    if(url.pathname.endsWith('/user')){if(invalidLink&&req.method()==='GET')return send({message:'Invalid token'},401);return send(user);}
    if(url.pathname.endsWith('/logout'))return send({});
    if(url.pathname.endsWith('/scout_secure_profile'))return send(null);
    throw Error('Unexpected request '+url.pathname);
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/capi/');await page.locator('#leader-email').fill(user.email);
  // Recovery requires the email only and is never sent automatically on page load.
  assert.equal(requests.filter(r=>r.path.endsWith('/recover')).length,0);
  await page.locator('#recover-password').click();await page.getByText('Se l’indirizzo è associato a un account, riceverai un link per impostare la password. Controlla anche Spam.',{exact:true}).waitFor();
  const recover=requests.find(r=>r.path.endsWith('/recover'));assert.deepEqual(recover.body,{email:user.email});assert.equal(new URL(recover.url).searchParams.get('redirect_to'),base+'/capi/');
  await page.locator('#leader-password').fill('password-fittizia-2026');await page.getByRole('button',{name:'Crea account',exact:true}).click();
  await page.getByText('Richiesta di registrazione ricevuta.',{exact:false}).waitFor();assert(!(await page.locator('#leaders-notice').innerText()).includes('Account creato.'));
  // Consume a real-shaped recovery fragment; verify the token server-side before showing the password form.
  await page.goto('about:blank');await page.goto(base+'/capi/#type=recovery&access_token=fictional-recovery-access&refresh_token=fictional-recovery-refresh');
  await page.getByRole('heading',{name:'Imposta la tua password',exact:true}).waitFor();assert(!page.url().includes('access_token'));assert(!page.url().includes('#'));
  assert(requests.some(r=>r.path.endsWith('/user')&&r.method==='GET'&&r.authorization==='Bearer fictional-recovery-access'));
  assert.equal(await page.locator('#leaders-content strong').innerText(),user.email);
  await page.locator('#new-password').fill('nuova-password-fittizia-2026');await page.locator('#confirm-password').fill('altra-password-fittizia-2026');await page.getByRole('button',{name:'Salva la nuova password',exact:true}).click();
  await page.getByText('Le due password non coincidono.',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='PUT').length,0);
  await page.locator('#confirm-password').fill('nuova-password-fittizia-2026');await page.getByRole('button',{name:'Salva la nuova password',exact:true}).click();
  await page.getByRole('heading',{name:'Una chiave, custodita da te.',exact:true}).waitFor();
  const update=requests.find(r=>r.method==='PUT');assert.equal(update.authorization,'Bearer fictional-recovery-access');assert.deepEqual(update.body,{password:'nuova-password-fittizia-2026'});
  assert(!(await page.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}))).includes('nuova-password-fittizia-2026'));
  // Invalid recovery links never authenticate the browser or show a new-password form.
  await page.evaluate(()=>sessionStorage.clear());invalidLink=true;
  await page.goto('about:blank');await page.goto(base+'/capi/#type=recovery&access_token=expired-token&refresh_token=expired-refresh');
  await page.getByRole('heading',{name:'Accesso e censimento capi',exact:true}).waitFor();await page.getByText('Link di recupero scaduto o non valido. Richiedi una nuova email.',{exact:true}).waitFor();assert.equal(await page.locator('#new-password').count(),0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('scout-auth')),null);
  await page.goto('about:blank');await page.goto(base+'/capi/#type=recovery');await page.getByText('Link di recupero incompleto. Richiedi una nuova email.',{exact:true}).waitFor();assert(!page.url().includes('#'));
  assert.deepEqual(errors,[]);console.log('PASS: neutral signup response, explicit reset email, verified recovery token, token removal from URL, password validation/update, invalid links, no password persistence. All email/Auth calls mocked.');
}finally{await browser.close();}
