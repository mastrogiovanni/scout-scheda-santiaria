import {randomBytes,createHash} from 'node:crypto';
import {backend,HttpError} from './supabase.js';
import {inspectZip,MAX_ZIP} from './zip.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))throw new HttpError(400,'Controlla i campi inseriti.');return value.trim();};
const id=value=>{if(typeof value!=='string'||!UUID.test(value))throw new HttpError(400,'Identificativo non valido.');return value;};
function cookies(request){return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(p=>{const i=p.indexOf('=');return[p.slice(0,i).trim(),p.slice(i+1)];}));}
function cookie(headers,name,value,maxAge,secure){headers.append('Set-Cookie',`${name}=${value}; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`);}
function sessionCookies(headers,session,secure){cookie(headers,'scout_access',session.access_token,Math.min(session.expires_in||3600,3600),secure);cookie(headers,'scout_refresh',session.refresh_token,12*3600,secure);cookie(headers,'scout_pkce','',0,secure);}
const receipt=(sub,name)=>({receipt:sub.receipt,receivedAt:sub.received_at,collection:name});

export function createHandler({env=process.env,fetcher=fetch}={}){
 return async function handler(request,context={}){
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  const secure=new URL(request.url).protocol==='https:';
  try{
    const origin=env.SITE_URL||env.URL||new URL(request.url).origin;
    const db=backend(env,fetcher);
    if(request.method==='GET')return respond({enabled:true,storageOrigin:db.url});
    if(request.method!=='POST')throw new HttpError(405,'Metodo non consentito.');
    if(request.headers.get('origin')!==new URL(origin).origin||!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(403,'Richiesta non autorizzata.');
    if(Number(request.headers.get('content-length'))>16384)throw new HttpError(413,'Richiesta troppo grande.');
    const reader=request.body?.getReader();const chunks=[];let size=0;
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new HttpError(413,'Richiesta troppo grande.');}chunks.push(value);}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new HttpError(400,'Richiesta non valida.');}
    const action=body?.action;
    async function rate(scope,limit){
      // Netlify supplies the client IP through its trusted context, never an
      // arbitrary X-Forwarded-For header. The database stores only its hash.
      const key=digest(scope+':'+(context.ip||'local'));
      if(!await db.rpc('rate_check',{p_key:key,p_limit:limit}))throw new HttpError(429,'Troppi tentativi. Riprova tra 15 minuti.');
    }
    const jar=cookies(request);
    if(action==='login'){
      await rate('login',8);
      const email=text(body.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Email non valida.');
      const leaders=await db.table('leaders','?email=eq.'+encodeURIComponent(email)+'&enabled=eq.true&select=email');
      if(leaders.length){
        const verifier=randomBytes(32).toString('base64url');
        await db.call('/auth/v1/otp?redirect_to='+encodeURIComponent(new URL('/capi/',origin).href),{method:'POST',body:{email,create_user:true,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256'}});
        cookie(headers,'scout_pkce',verifier,600,secure);
      }
      return respond({message:'Se l’indirizzo è abilitato, riceverai un link di accesso. Aprilo nello stesso browser entro 10 minuti.'});
    }
    if(action==='session'){
      if(!jar.scout_pkce)throw new HttpError(401,'Apri il link nello stesso browser in cui lo hai richiesto.');
      const session=await db.call('/auth/v1/token?grant_type=pkce',{method:'POST',body:{auth_code:text(body.code,2048),code_verifier:jar.scout_pkce}});
      const leaders=await db.table('leaders','?email=eq.'+encodeURIComponent(session.user.email.toLowerCase())+'&enabled=eq.true&select=email');
      if(!leaders.length)throw new HttpError(403,'Questo account non è abilitato.');
      sessionCookies(headers,session,secure);return respond({ok:true});
    }
    if(action==='logout'){
      // Clear this application's session even if Supabase cannot be reached.
      if(jar.scout_access)try{await db.call('/auth/v1/logout?scope=local',{method:'POST',headers:{Authorization:'Bearer '+jar.scout_access}});}catch{}
      for(const name of ['scout_access','scout_refresh','scout_pkce'])cookie(headers,name,'',0,secure);
      return respond({ok:true});
    }
    if(['invitation','begin','complete'].includes(action)){
      if(typeof body.token!=='string'||!HEX.test(body.token))throw new HttpError(404,'Invito non valido.');
      await rate('delivery',60);
      const hash=digest(body.token);
      const invitations=await db.table('invitations','?token_hash=eq.'+hash+'&select=id,collection_id,label,revoked');
      const inv=invitations[0];if(!inv||inv.revoked)throw new HttpError(404,'Invito non valido o revocato.');
      const cols=await db.table('collections','?id=eq.'+inv.collection_id+'&select=*');const col=cols[0];
      if(!col||Date.parse(col.delete_after)<=Date.now())throw new HttpError(410,'Questa raccolta è scaduta.');
      const subs=await db.table('submissions','?invitation_id=eq.'+inv.id+'&select=*');const sub=subs[0];
      if(action==='invitation')return respond({collection:col.name,label:inv.label,closed:col.closed||Date.parse(col.deadline)<=Date.now(),delivered:sub&&sub.status!=='uploading'?receipt(sub,col.name):null});
      if(col.closed||Date.parse(col.deadline)<=Date.now())throw new HttpError(410,'La raccolta è chiusa o scaduta.');
      if(action==='begin'){
        if(typeof body.sha256!=='string'||!HEX.test(body.sha256)||!Number.isInteger(body.size)||body.size<1||body.size>MAX_ZIP)throw new HttpError(400,'Dimensione o impronta del pacchetto non valida.');
        const begun=await db.rpc('begin_upload',{p_token_hash:hash,p_sha256:body.sha256,p_size:body.size});
        if(begun.status!=='uploading')return respond({delivered:receipt(begun,col.name)});
        return respond({id:begun.id,uploadUrl:await db.signed(begun.object_path,true)});
      }
      if(!sub||sub.id!==id(body.id))throw new HttpError(404,'Invio non trovato.');
      if(sub.status!=='uploading')return respond(receipt(sub,col.name));
      const bytes=await db.download(sub.object_path,MAX_ZIP);
      let checked;try{checked=inspectZip(bytes);}catch{throw new HttpError(422,'ZIP non valido o incompleto. Usa un pacchetto generato da questa applicazione.');}
      if(checked.sha256!==sub.sha256||checked.size!==sub.size)throw new HttpError(422,'Il file ricevuto non corrisponde al pacchetto preparato. Riprova.');
      return respond(await db.rpc('complete_upload',{p_token_hash:hash,p_id:sub.id,p_sha256:checked.sha256,p_name:[checked.data.name,checked.data.surname].join(' '),p_unit:checked.data.unit}));
    }
    // Validate the Supabase session against Auth on every protected request.
    let token=jar.scout_access,user;
    if(token)try{user=await db.call('/auth/v1/user',{headers:{Authorization:'Bearer '+token}});}catch{}
    if(!user&&jar.scout_refresh){
      try{const session=await db.call('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:jar.scout_refresh}});user=session.user;token=session.access_token;sessionCookies(headers,session,secure);}catch{}
    }
    if(!user?.email||!user.email_confirmed_at)throw new HttpError(401,'Accedi per aprire l’area capi.');
    const [leader]=await db.table('leaders','?email=eq.'+encodeURIComponent(user.email.toLowerCase())+'&enabled=eq.true&select=*');
    if(!leader)throw new HttpError(403,'Questo account non è abilitato.');
    if(action==='dashboard'){
      const collections=await db.table('collections','?delete_after=gt.'+encodeURIComponent(new Date().toISOString())+'&order=created_at.desc&limit=200');
      return respond({user:{email:leader.email,role:leader.role},collections});
    }
    if(action==='createCollection'){
      const name=text(body.name,100);const deadline=new Date(body.deadline),deleteAfter=new Date(body.deleteAfter);
      if(!Number.isFinite(+deadline)||!Number.isFinite(+deleteAfter)||+deadline<=Date.now()||+deleteAfter<=+deadline||+deleteAfter>Date.now()+2*365*86400000)throw new HttpError(400,'Controlla scadenza e data di cancellazione, entro due anni da oggi.');
      const [col]=await db.table('collections','',{method:'POST',body:{name,deadline:deadline.toISOString(),delete_after:deleteAfter.toISOString(),created_by:user.id}});
      return respond(col);
    }
    if(['leaders','addLeader','disableLeader'].includes(action)){
      if(leader.role!=='admin')throw new HttpError(403,'Operazione riservata agli amministratori.');
      if(action==='leaders')return respond(await db.table('leaders','?select=email,role,enabled&order=email'));
      const email=text(body.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email===leader.email)throw new HttpError(400,'Usa l’indirizzo di un altro capo.');
      if(action==='disableLeader')await db.table('leaders','?email=eq.'+encodeURIComponent(email),{method:'PATCH',body:{enabled:false}});
      else await db.table('leaders','?on_conflict=email',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:{email,role:'leader',enabled:true}});
      return respond({ok:true});
    }
    const collectionId=id(body.collectionId);
    const [col]=await db.table('collections','?id=eq.'+collectionId+'&select=*');
    if(!col||Date.parse(col.delete_after)<=Date.now())throw new HttpError(404,'Raccolta non disponibile.');
    if(action==='collection'){
      const invitations=await db.table('invitations','?collection_id=eq.'+collectionId+'&select=id,label,revoked,created_at&order=created_at.asc&limit=400');
      const submissions=await db.table('submissions','?collection_id=eq.'+collectionId+'&status=neq.uploading&select=id,invitation_id,scout_name,unit,status,received_at,receipt,size&limit=400');
      return respond({collection:col,invitations,submissions});
    }
    if(action==='createInvitation'){
      if(col.closed||Date.parse(col.deadline)<=Date.now())throw new HttpError(409,'La raccolta è chiusa o scaduta.');
      const raw=randomBytes(32).toString('hex');
      const inv=await db.rpc('create_invitation',{p_collection:collectionId,p_label:text(body.label,160),p_hash:digest(raw)});
      return respond({id:inv.id,url:new URL('/#consegna='+raw,origin).href});
    }
    if(action==='closeCollection'){await db.table('collections','?id=eq.'+collectionId,{method:'PATCH',body:{closed:true}});return respond({ok:true});}
    if(action==='revokeInvitation'){
      await db.table('invitations','?id=eq.'+id(body.invitationId)+'&collection_id=eq.'+collectionId,{method:'PATCH',body:{revoked:true}});return respond({ok:true});
    }
    if(['file','check'].includes(action)){
      const [sub]=await db.table('submissions','?id=eq.'+id(body.submissionId)+'&collection_id=eq.'+collectionId+'&status=neq.uploading&select=*');
      if(!sub)throw new HttpError(404,'Pacchetto non trovato.');
      if(action==='file')return respond({url:await db.signed(sub.object_path),sha256:sub.sha256});
      await db.table('submissions','?id=eq.'+sub.id,{method:'PATCH',body:{status:'checked',checked_at:new Date().toISOString()}});return respond({ok:true});
    }
    throw new HttpError(400,'Operazione non riconosciuta.');
  }catch(error){return respond({error:error instanceof HttpError?error.message:'Operazione non riuscita. Riprova; la consegna non è confermata.'},error instanceof HttpError?error.status:500);}
 };
}
export default createHandler();
