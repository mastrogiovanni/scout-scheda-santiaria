import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';
let session=null;
try{session=JSON.parse(sessionStorage.getItem('scout-auth')||'null');}catch{}
export function configured(){return /^https:\/\/[\w-]+\.supabase\.co$/.test(SUPABASE_URL)&&!!SUPABASE_PUBLISHABLE_KEY;}
function remember(value){session=value;try{if(value)sessionStorage.setItem('scout-auth',JSON.stringify(value));else sessionStorage.removeItem('scout-auth');}catch{}}
async function request(path,body,{authenticated=false,method='POST',retry=true}={}){
  if(!configured())throw Error('Configura URL e chiave pubblicabile Supabase in src/supabase-config.js.');
  if(authenticated&&!session?.access_token)throw Error('Accedi come capo per continuare.');
  let response;
  try{response=await fetch(SUPABASE_URL+path,{method,headers:{apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+session.access_token}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(60000)});}catch{throw Error('Connessione a Supabase non disponibile. Riprova quando sei online.');}
  if(response.status===401&&authenticated&&retry&&session?.refresh_token){const result=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});remember(result);return request(path,body,{authenticated,method,retry:false});}
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error(result?.msg||result?.message||result?.error_description||'Operazione Supabase non riuscita.');
  return result;
}
export async function login(email,password){remember(await request('/auth/v1/token?grant_type=password',{email,password}));}
export async function signup(email,password){const result=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+'/capi/'),{email,password});if(result.access_token)remember(result);return !!result.access_token;}
export async function logout(){try{if(session)await request('/auth/v1/logout',{}, {authenticated:true});}finally{remember(null);}}
export async function currentUser(){if(!session)return null;return request('/auth/v1/user',null,{authenticated:true,method:'GET'});}
export const rpc=(name,body={},authenticated=false)=>request('/rest/v1/rpc/scout_secure_'+name,body,{authenticated});
