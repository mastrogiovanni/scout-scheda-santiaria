import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {createHandler} from '../server/api.js';
import {inspectZip,MAX_ZIP} from '../server/zip.js';
import {cleanup} from '../server/cleanup.js';
import {basic} from './fixtures.mjs';
import {TEMPLATE} from '../src/schema.js';
import content from '../src/content.json' with {type:'json'};
const module={exports:{}};
runInNewContext(await readFile(new URL('../public/vendor/jszip.min.js',import.meta.url),'utf8'),{module,exports:module.exports,require:createRequire(import.meta.url),Buffer,Uint8Array,ArrayBuffer,setImmediate,setTimeout,clearTimeout,Promise});
const JSZip=module.exports;
async function archive(overrides={}){const zip=new JSZip();zip.file('scheda.json',JSON.stringify({format:'scout-sanitaria',version:1,template:TEMPLATE,templateSha256:content.sourceSha256,data:basic,...overrides}));zip.file('scheda-compatta.pdf','%PDF-1.7\nSynthetic test only');return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
const bytes=await archive();const checked=inspectZip(bytes);assert.equal(checked.data.name,basic.name);assert.equal(checked.size,bytes.length);
for(const invalid of [Buffer.alloc(20),Buffer.alloc(MAX_ZIP+1),await archive({version:2}),await archive({data:{...basic,email:'bad'}}),await archive({data:{...basic,unknown:'bad'}})])assert.throws(()=>inspectZip(invalid));
const damaged=Buffer.from(bytes);damaged[45]^=255;assert.throws(()=>inspectZip(damaged));
const zip=new JSZip();zip.file('scheda.json','{}');zip.file('scheda-compatta.pdf','%PDF-');zip.file('extra.exe','bad');const extraFile=await zip.generateAsync({type:'nodebuffer'});assert.throws(()=>inspectZip(extraFile));
// Invalid MIME/PDF and unexpected files are rejected before any receipt.
assert.throws(()=>inspectZip(Buffer.from('not a zip')));
const cid='11111111-1111-4111-8111-111111111111',iid='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333';
const token='a'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
const col={id:cid,name:'Campo di prova',deadline:'2090-01-01T00:00:00Z',delete_after:'2090-02-01T00:00:00Z',closed:false};
const inv={id:iid,collection_id:cid,label:'Famiglia di prova',revoked:false};
let sub=null,received=0,denyRate=false,enabled=true,userEmail='capo@example.invalid',storedBytes=bytes;
const calls=[];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-server-secret',SITE_URL:'https://scout.example.invalid'};
async function fakeFetch(input,options={}){
  const url=new URL(input);calls.push({path:url.pathname,options});
  assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);
  if(url.pathname==='/rest/v1/rpc/scout_rate_check')return json(!denyRate);
  if(url.pathname==='/auth/v1/user')return options.headers.Authorization==='Bearer valid'?json({id:sid,email:userEmail,email_confirmed_at:'2026-01-01T00:00:00Z'}):json({},401);
  if(url.pathname==='/auth/v1/otp')return json({});
  if(url.pathname==='/auth/v1/token')return json({user:{email:userEmail},access_token:'valid',refresh_token:'refresh',expires_in:3600});
  if(url.pathname==='/rest/v1/scout_leaders')return json(enabled?[{email:userEmail,role:'admin',enabled:true}]:[]);
  if(url.pathname==='/rest/v1/scout_invitations')return json(url.searchParams.get('token_hash')==='eq.'+hash||!url.searchParams.has('token_hash')?[inv]:[]);
  if(url.pathname==='/rest/v1/scout_collections')return json([col]);
  if(url.pathname==='/rest/v1/scout_submissions')return json(sub?[sub]:[]);
  if(url.pathname==='/rest/v1/rpc/scout_begin_upload'){
    const body=JSON.parse(options.body);
    sub??={id:sid,collection_id:cid,invitation_id:iid,object_path:cid+'/'+sid+'.zip',status:'uploading',sha256:body.p_sha256,size:body.p_size};return json(sub);
  }
  if(url.pathname==='/rest/v1/rpc/scout_create_invitation')return json({id:iid});
  if(url.pathname==='/rest/v1/rpc/scout_complete_upload'){received++;sub.status='received';sub.receipt=iid;sub.received_at='2026-10-18T10:00:00Z';return json({receipt:iid,receivedAt:sub.received_at,collection:col.name});}
  if(url.pathname.startsWith('/storage/v1/object/upload/sign/'))return json({url:'/object/upload/sign/scout-packages/'+cid+'/'+sid+'.zip?token=temporary'});
  if(url.pathname.startsWith('/storage/v1/object/sign/'))return json({signedURL:'/object/sign/scout-packages/'+cid+'/'+sid+'.zip?token=temporary'});
  if(url.pathname.startsWith('/storage/v1/object/scout-packages/'))return new Response(storedBytes);
  throw Error('Unexpected request '+url.pathname);
}
const handle=createHandler({env,fetcher:fakeFetch});
async function call(action,body={},extra={}){return handle(new Request(env.SITE_URL+'/api/raccolta',{method:'POST',headers:{Origin:env.SITE_URL,'Content-Type':'application/json',...extra},body:JSON.stringify({action,...body})}),{ip:'test-address'});}
assert.equal((await call('dashboard')).status,401);
assert.equal((await call('dashboard',{}, {cookie:'scout_access=valid',origin:'https://attacker.invalid'})).status,403);
assert.equal((await call('dashboard',{}, {cookie:'scout_access=forged'})).status,401);
assert.equal((await call('dashboard',{}, {cookie:'scout_access=valid'})).status,200);
assert.match((await(await call('createInvitation',{collectionId:cid,label:'Synthetic family'},{cookie:'scout_access=valid'})).json()).url,/^https:\/\/scout.example.invalid\/#consegna=[a-f0-9]{64}$/);
assert.equal((await call('createInvitation',{collectionId:cid,label:'Synthetic family'})).status,401);
enabled=false;assert.equal((await call('dashboard',{}, {cookie:'scout_access=valid'})).status,403);enabled=true;
assert.equal((await call('invitation',{token:'b'.repeat(64)})).status,404);
assert.equal((await call('invitation',{token})).status,200);
denyRate=true;assert.equal((await call('begin',{token,sha256:checked.sha256,size:bytes.length})).status,429);denyRate=false;
const started=await(await call('begin',{token,sha256:checked.sha256,size:bytes.length})).json();assert.match(started.uploadUrl,/^https:\/\/example.supabase.co\/storage\/v1\/object\/upload\/sign\//);
storedBytes=await archive({data:{...basic,name:'Altro nome'}});assert.equal((await call('complete',{token,id:sid})).status,422);assert.equal(received,0);
storedBytes=Buffer.from('bad');assert.equal((await call('complete',{token,id:sid})).status,422);assert.equal(received,0);
storedBytes=bytes;const result=await(await call('complete',{token,id:sid})).json();assert.equal(result.receipt,iid);assert.equal(received,1);
assert.equal((await(await call('complete',{token,id:sid})).json()).receipt,iid);assert.equal(received,1,'Retry must return the existing receipt');
col.closed=true;assert.equal((await call('begin',{token,sha256:checked.sha256,size:bytes.length})).status,410);col.closed=false;
inv.revoked=true;assert.equal((await call('complete',{token,id:sid})).status,404);inv.revoked=false;
assert.equal((await call('file',{collectionId:cid,submissionId:sid})).status,401);
assert.match((await(await call('file',{collectionId:cid,submissionId:sid},{cookie:'scout_access=valid'})).json()).url,/\/storage\/v1\/object\/sign\//);
const login=await call('login',{email:userEmail});assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);const otp=calls.find(c=>c.path==='/auth/v1/otp');assert.equal(JSON.parse(otp.options.body).code_challenge_method,'s256');
const session=await call('session',{code:'code'},{cookie:'scout_pkce=verifier'});assert.equal(session.status,200);assert.ok(session.headers.getSetCookie().every(c=>/HttpOnly; SameSite=Strict/.test(c)&&c.includes('Secure')));
assert.equal((await call('session',{code:'code'})).status,401);
assert.equal((await call('invitation',{token:[token]})).status,404);
assert.equal((await createHandler({env:{},fetcher:fakeFetch})(new Request(env.SITE_URL+'/api/raccolta'))).status,503);
// Cleanup must remove Storage objects before rows and never touch other buckets.
const deleted=[];let listing=true;
await cleanup({env,fetcher:async(input,options={})=>{
  const u=new URL(input);deleted.push({path:u.pathname,method:options.method});
  if(u.pathname==='/rest/v1/scout_collections')return json(options.method==='DELETE'?[]:[{id:cid}]);
  if(u.pathname==='/storage/v1/object/list/scout-packages'){const result=listing?[{id:sid,name:sid+'.zip'}]:[];listing=false;return json(result);}
  return json([]);
}});
assert.ok(deleted.findIndex(c=>c.path==='/storage/v1/object/scout-packages'&&c.method==='DELETE')<deleted.findIndex(c=>c.path==='/rest/v1/scout_collections'&&c.method==='DELETE'));
assert.ok(!JSON.stringify(result).includes('test-server-secret'));
console.log('PASS: bounded ZIP validation, auth and disabled leaders, origin protection, PKCE and HttpOnly cookies, private upload/download URLs, no receipt on corrupt/mismatched uploads, retry idempotency, expiry, revocation and retention cleanup. All data synthetic; Supabase responses simulated.');
