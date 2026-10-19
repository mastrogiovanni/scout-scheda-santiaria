import assert from 'node:assert/strict';
import {generateIdentity,importIdentity,seal,unseal,unbase64url,base64url} from '../src/crypto.js';
import {encodeTransfer,QRVideoReceiver,SEGMENT_BYTES} from '../src/qrvideo.js';
const identity=await generateIdentity(),other=await generateIdentity(),group={groupId:crypto.randomUUID(),publicKey:identity.publicKey,keyId:identity.keyId};
const privateKey=await importIdentity(identity.secret,identity.keyId);
assert.equal(privateKey.extractable,false);await assert.rejects(()=>crypto.subtle.exportKey('jwk',privateKey));
await assert.rejects(()=>importIdentity(other.secret,identity.keyId));
const data={name:'Giulia',allergies:'Dati fittizi con accenti: è à'},sealed=await seal(data,group);
assert.deepEqual(await unseal(sealed,privateKey,group),data);
assert(!JSON.stringify(sealed).includes('Giulia'));assert(!JSON.stringify(sealed).includes('allergies'));assert(!JSON.stringify(sealed).includes('"d":'));
const sealedAgain=await seal(data,group);assert.notEqual(sealed.ciphertext,sealedAgain.ciphertext);
const corrupt=unbase64url(sealed.ciphertext);corrupt[0]^=1;
await assert.rejects(()=>unseal({...sealed,ciphertext:base64url(corrupt)},privateKey,group));
await assert.rejects(()=>unseal({...sealed,submissionId:crypto.randomUUID()},privateKey,group));
await assert.rejects(()=>unseal(sealed,privateKey,{...group,groupId:crypto.randomUUID()}));
await assert.rejects(()=>seal(data,{...group,keyId:other.keyId}));
// Incompressible data forces many segments, including a short final segment.
const payload={sheets:Array.from({length:12},()=>({data:base64url(crypto.getRandomValues(new Uint8Array(1400)))}))};
const transfer=await encodeTransfer(payload);assert(transfer.frames.length>20);assert(transfer.frames.every(f=>f.length<1100));
const receiver=new QRVideoReceiver();
const first=transfer.frames.at(-1);await receiver.accept(first);assert((await receiver.accept(first)).duplicate);assert.equal(receiver.progress.count,1);
const second=await encodeTransfer({different:true});assert((await receiver.accept(second.frames[0])).otherTransfer);
const fields=transfer.frames[0].split('|');fields[8]=(fields[8][0]==='A'?'B':'A')+fields[8].slice(1);await assert.rejects(()=>receiver.accept(fields.join('|')));assert.equal(receiver.progress.count,1);
let result;for(const frame of transfer.frames.slice(0,-1).reverse())result=await receiver.accept(frame);
assert.deepEqual(result.payload,payload);assert.equal(receiver.progress.bytes,transfer.bytes);
const invalid=transfer.frames[0].split('|');invalid[3]='9999999';await assert.rejects(()=>new QRVideoReceiver().accept(invalid.join('|')));
// Incorrect whole-transfer digest is rejected even when every chunk checksum is correct.
const forged=transfer.frames.map(f=>{const p=f.split('|');p[1]='A'.repeat(43);return p.join('|');});const badReceiver=new QRVideoReceiver();
await assert.rejects(async()=>{for(const f of forged)await badReceiver.accept(f);});assert.equal(badReceiver.progress.count,0);
const originalCompression=globalThis.CompressionStream;globalThis.CompressionStream=undefined;
try{const raw=await encodeTransfer({plain:'àèìòù'});assert.equal(raw.frames[0].split('|')[2],'j');assert.deepEqual((await new QRVideoReceiver().accept(raw.frames[0])).payload,{plain:'àèìòù'});}finally{globalThis.CompressionStream=originalCompression;}
console.log(`Cifratura, chiavi, autenticazione del ciphertext e QRVideo verificati (${SEGMENT_BYTES} byte/frammento).`);
