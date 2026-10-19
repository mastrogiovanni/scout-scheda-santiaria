import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { basic,complete } from './fixtures.mjs';
const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require('playwright'));}catch(error){if(!process.env.PLAYWRIGHT_MODULE)throw Error('Installa Playwright con npm install e npx playwright install chromium.',{cause:error});({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
await mkdir('tmp/pdfs',{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}});
  const page=await context.newPage();const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(base+'/');await page.getByRole('heading',{name:'Prima di iniziare'}).waitFor();
  await page.screenshot({path:'tmp/pdfs/frontend-desktop.png',fullPage:true});
  await page.locator('#next').click();assert.equal(await page.locator('#readInfo').getAttribute('aria-invalid'),'true');
  // Complete every visible field through the public form, including conditional sections.
  for(let step=0;step<7;step++) {
    const ids=await page.locator('#section-content input, #section-content textarea, #section-content select').evaluateAll(els=>els.map(e=>({id:e.id,type:e.type})));
    for(const {id,type} of ids) {
      if(!Object.hasOwn(basic,id))continue;
      if(type==='checkbox'){if(basic[id])await page.locator('#'+id).check();}
      else if(type==='select-one')await page.locator('#'+id).selectOption(basic[id]);
      else await page.locator('#'+id).fill(basic[id]);
    }
    // Date fields are inserted after their status select is answered.
    for(const id of ['tetanusDate','boosterDate'])if(await page.locator('#'+id).count())await page.locator('#'+id).fill(basic[id]);
    await page.locator('#next').click();
    assert.equal(await page.locator('.field-error:not(:empty)').count(),0,'Step '+step+' validation failed');
  }
  await page.getByRole('heading',{name:'La tua scheda è pronta'}).waitFor();
  await page.locator('#export-zip:not([disabled])').waitFor();
  assert.equal(await page.locator('#section-content').getByRole('button',{name:/compatt|ridott/i}).count(),0);
  assert.equal(await page.locator('#export-zip').isEnabled(),true,'Export disabled: '+await page.locator('#section-content').innerText());
  const download=page.waitForEvent('download');await page.locator('#export-zip').click();await (await download.catch(async e=>{console.error(await page.locator('#notice').innerText());console.error(errors);throw e;})).saveAs('tmp/pdfs/basic.zip');
  const original=page.waitForEvent('download');await page.locator('#export-original').click();await(await original).saveAs('tmp/pdfs/basic-original.pdf');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/pdfs/frontend-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile overflow');
  await page.reload();await page.locator('#import-file').setInputFiles('tmp/pdfs/basic.zip');await page.locator('#export-original').waitFor();
  assert.match(await page.locator('#section-content').innerText(),/Giulia Rossi/);
  const imported=page.waitForEvent('download');await page.locator('#export-original').click();await(await imported).saveAs('tmp/pdfs/imported-original.pdf');
  const results=await page.evaluate(async({basic,complete})=>{
    const schema=await import('/src/schema.js');const pdf=await import('/src/pdf.js');const archive=await import('/src/archive.js');
    const bytesToString=bytes=>{let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);};
    const result={};
    async function save(name,d){const errors=schema.validate(d);if(Object.keys(errors).length)throw Error(name+JSON.stringify(errors));const compact=await pdf.compactPdf(schema.cleanData(d)),original=await pdf.originalPdf(schema.cleanData(d));result[name]={compact:bytesToString(compact),original:bytesToString(original),pages:[(await PDFLib.PDFDocument.load(compact)).getPageCount(),(await PDFLib.PDFDocument.load(original)).getPageCount()]};}
    await save('basic',basic);await save('complete',complete);
    const adult={...basic,subjectType:'adult',signerRole:'self',birthDate:'2000-05-14',fiscalCode:'RSSGLI00E54H501Z',consent:'no',tetanusStatus:'unknown',boosterStatus:'none'};await save('adult',adult);
    const guardian={...complete,subjectType:'protected',signerRole:'guardian',guardianName:'Ada',guardianSurname:'Neri',guardianAddress:'Via Tutela 2',guardianPhone:'3337777777',declarant:'Ada Neri',requestRole:'guardians',requester1:'Ada Neri',requester2:'',administrationMode:'assistance'};await save('guardian',guardian);
    const long={...complete,administrationMode:'leaders',landlines:'06001\n06002\n06003\n06004',mobiles:'33301\n33302\n33303\n33304'};
    for(const [id] of schema.optionalHealth)long[id+'Details']=('Informazione completa da preservare, con dettagli e accenti: è già così. '.repeat(80)+'FINE-'+id).slice(0,5900);
    await save('long',long);
    const group=await pdf.compactGroupPdf([basic,long,{...basic,name:'Luisa',surname:'Verdi',fiscalCode:'VRDLSA13E54H501Z'}],{groupName:'Guide',scoutYear:'2027-2028'});
    result.group=bytesToString(group);
    const parentZip=await JSZip.loadAsync(await archive.createArchive(basic,{includeCompact:false}));
    if(JSON.stringify(Object.keys(parentZip.files))!==JSON.stringify(['scheda.json']))throw Error('Parent ZIP contains a reduced PDF');
    // Import must use JSON rather than a PDF contained in the archive.
    const zipBytes=await archive.createArchive(basic);const zip=await JSZip.loadAsync(zipBytes);zip.file('scheda-compatta.pdf','PDF intenzionalmente non valido');
    const roundtrip=await archive.readArchive(new File([await zip.generateAsync({type:'uint8array'})],'roundtrip.zip'));
    if(JSON.stringify(roundtrip)!==JSON.stringify(schema.cleanData(basic)))throw Error('Roundtrip changed data');
    result.failures=[];
    for(const mode of ['version','missing','invalid','unknown','oversize','bad-date']) {
      const z=new JSZip();const payload=JSON.parse(await zip.file('scheda.json').async('string'));
      if(mode==='version')payload.version=99;if(mode==='invalid')payload.data.consent='maybe';if(mode==='unknown')payload.data.unexpected='value';if(mode==='bad-date')payload.data.birthDate='2013-02-31';
      if(mode!=='missing')z.file('scheda.json',mode==='oversize'?'x'.repeat(270000):JSON.stringify(payload));
      try{await archive.readArchive(new File([await z.generateAsync({type:'uint8array'})],mode+'.zip'));throw Error('Accepted '+mode);}catch(e){if(e.message==='Accepted '+mode)throw e;result.failures.push(mode);}
    }
    const stale={...basic,allergiesDetails:'THIS MUST NOT BE EXPORTED',administrationMode:'leaders',prescriber:'STALE'};const cleaned=schema.cleanData(stale);if('allergiesDetails'in cleaned||'prescriber'in cleaned)throw Error('Inactive details leaked');
    try{await pdf.compactPdf({...basic,name:'Giulia 🏕️'});throw Error('Unsupported characters accepted');}catch(e){if(e.message==='Unsupported characters accepted')throw e;}
    result.json=roundtrip;return result;
  },{basic,complete});
  for(const [key,value]of Object.entries(results))if(value?.compact){await writeFile('tmp/pdfs/'+key+'-compact.pdf',Buffer.from(value.compact,'base64'));await writeFile('tmp/pdfs/'+key+'-original.pdf',Buffer.from(value.original,'base64'));console.log(key+' pages (compact/original): '+value.pages.join('/'));}
  await writeFile('tmp/pdfs/group-reduced.pdf',Buffer.from(results.group,'base64'));
  await writeFile('tmp/pdfs/roundtrip.json',JSON.stringify(results.json,null,2));
  assert.deepEqual(errors,[],'Browser errors');assert.deepEqual(external,[],'External network request');assert.equal(results.failures.length,6);
  console.log('PASS: UI compilation, mobile, ZIP import/export, JSON roundtrip, all optional sections, adult/refusal, guardianship, long text, malformed archives, no external requests.');
}finally{await browser.close();}
