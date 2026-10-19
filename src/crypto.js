// Web Crypto only. Private key material is never written to storage or sent over the network.
const encoder=new TextEncoder();
export const utf8=value=>encoder.encode(value);
export const decodeUtf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export function base64url(bytes){let raw='';for(const b of new Uint8Array(bytes))raw+=String.fromCharCode(b);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function unbase64url(value,max=400000){if(typeof value!=='string'||!value.length||value.length>max||!/^[\w-]+$/.test(value)||value.length%4===1)throw Error('Codifica non valida.');const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));if(base64url(bytes)!==value)throw Error('Codifica non canonica.');return bytes;}
export async function digest(bytes){return base64url(await crypto.subtle.digest('SHA-256',bytes));}
export function publicJwk(jwk){if(jwk?.kty!=='EC'||jwk.crv!=='P-256'||unbase64url(jwk.x,43).length!==32||unbase64url(jwk.y,43).length!==32||Object.hasOwn(jwk,'d'))throw Error('Chiave pubblica non valida.');return {kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,ext:true};}
export async function fingerprint(jwk){const key=publicJwk(jwk);return digest(utf8(JSON.stringify({crv:key.crv,kty:key.kty,x:key.x,y:key.y})));}
export async function generateIdentity(){
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const priv=await crypto.subtle.exportKey('jwk',pair.privateKey),pub=publicJwk(await crypto.subtle.exportKey('jwk',pair.publicKey));
  const secret='SCOUT-KEY-1:'+base64url(utf8(JSON.stringify({kty:priv.kty,crv:priv.crv,x:priv.x,y:priv.y,d:priv.d})));
  return {publicKey:pub,keyId:await fingerprint(pub),secret};
}
export async function importIdentity(text,expectedKeyId){
  if(typeof text!=='string'||!text.startsWith('SCOUT-KEY-1:')||text.length>600)throw Error('Questo QR non contiene una chiave privata scout.');
  const jwk=JSON.parse(decodeUtf8(unbase64url(text.slice(12),588)));
  const pub=publicJwk({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y});
  if(unbase64url(jwk.d,43).length!==32||await fingerprint(pub)!==expectedKeyId)throw Error('La chiave privata non appartiene al capo di questo gruppo.');
  const key=await crypto.subtle.importKey('jwk',{...pub,d:jwk.d},{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  // Check consistency of the public and private components, even on engines that accept inconsistent JWKs.
  const probe=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const publicKey=await crypto.subtle.importKey('jwk',pub,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const [a,b]=await Promise.all([crypto.subtle.deriveBits({name:'ECDH',public:probe.publicKey},key,256),crypto.subtle.deriveBits({name:'ECDH',public:publicKey},probe.privateKey,256)]);
  if(base64url(a)!==base64url(b))throw Error('Chiave privata non coerente.');
  return key;
}
const aad=meta=>utf8(JSON.stringify(['scout-sealed',1,meta.groupId,meta.keyId,meta.submissionId]));
async function aesKey(privateKey,publicKey,salt,context){
  const shared=await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},privateKey,256);
  const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);new Uint8Array(shared).fill(0);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:context},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function seal(data,{groupId,publicKey,keyId},submissionId=crypto.randomUUID()){
  if(await fingerprint(publicKey)!==keyId)throw Error('Impronta della chiave pubblica errata.');
  const recipient=await crypto.subtle.importKey('jwk',publicJwk(publicKey),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const salt=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
  const meta={format:'scout-sealed',version:1,groupId,keyId,submissionId};const context=aad(meta);
  const key=await aesKey(ephemeral.privateKey,recipient,salt,context);
  const plaintext=utf8(JSON.stringify(data));if(plaintext.length>256*1024)throw Error('Scheda troppo grande.');
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context},key,plaintext);plaintext.fill(0);
  return {...meta,ephemeral:publicJwk(await crypto.subtle.exportKey('jwk',ephemeral.publicKey)),salt:base64url(salt),iv:base64url(iv),ciphertext:base64url(ciphertext)};
}
export async function unseal(envelope,privateKey,{groupId,keyId}){
  if(envelope?.format!=='scout-sealed'||envelope.version!==1||envelope.groupId!==groupId||envelope.keyId!==keyId||!/^[-\da-f]{36}$/.test(envelope.submissionId))throw Error('Scheda cifrata non compatibile con il gruppo.');
  const pub=await crypto.subtle.importKey('jwk',publicJwk(envelope.ephemeral),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const salt=unbase64url(envelope.salt,43),iv=unbase64url(envelope.iv,16),ciphertext=unbase64url(envelope.ciphertext,350000);
  if(salt.length!==32||iv.length!==12||ciphertext.length<16)throw Error('Parametri di cifratura non validi.');
  const context=aad(envelope),key=await aesKey(privateKey,pub,salt,context);
  let plaintext;try{plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:context},key,ciphertext));}catch{throw Error('Decifratura fallita: chiave errata o scheda alterata.');}
  try{return JSON.parse(decodeUtf8(plaintext));}finally{plaintext.fill(0);}
}
