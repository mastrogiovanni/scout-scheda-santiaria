import { optionalHealth, medicineRows, fullName, address, dateIT, fieldMap } from './schema.js';
let assets;
async function loadAssets() {
  if(!assets) assets=Promise.all(['/public/modello-originale.pdf','/public/vendor/NotoSans-Regular.ttf','/public/vendor/NotoSans-Bold.ttf','/src/content.json'].map(async url=>{ const res=await fetch(url);if(!res.ok)throw Error('Impossibile caricare il modello o i font.');return url.endsWith('.json')?res.json():res.arrayBuffer(); }));
  return assets;
}
const normalize = t=>String(t??'').replace(/\r\n?/g,'\n').replace(/[\t\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').normalize('NFC');
function lines(text,font,size,width) {
  const result=[];
  for(const paragraph of normalize(text).split('\n')) {
    let line='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)) {
      if(font.widthOfTextAtSize((line?line+' ':'')+word,size)<=width) {line+=(line?' ':'')+word;continue;}
      if(line){result.push(line);line='';}
      for(const char of word) {if(font.widthOfTextAtSize(line+char,size)>width && line){result.push(line);line='';}line+=char;}
    }
    result.push(line);
  }
  return result;
}
async function fonts(pdf, data) {
  const [,regular,bold]=await loadAssets();pdf.registerFontkit(window.fontkit);
  const normal=await pdf.embedFont(regular,{subset:true}), strong=await pdf.embedFont(bold,{subset:true});
  const supported=new Set(normal.getCharacterSet());
  for(const record of Array.isArray(data)?data:[data])for(const [key,value] of Object.entries(record)) if(typeof value==='string') {
    const missing=[...new Set([...normalize(value)].filter(c=>c!=='\n'&&!supported.has(c.codePointAt(0))))];
    if(missing.length) throw Error(`Il campo “${fieldMap[key]?.label || key}” contiene caratteri non supportati dal font PDF: ${missing.join(' ')}. Usa una traslitterazione.`);
  }
  return {normal,strong};
}
const ink=()=>window.PDFLib.rgb(.10,.17,.16);
const contact=(d,id)=>[d[id+'Name'],d[id+'Surname'],d[id+'Address'],d[id+'Phone']].filter(Boolean).join(' · ');
const yesNo=v=>v==='yes'?'Sì':v==='no'?'No':'Non indicato';
const vaccine=(d,p)=>d[p+'Status']==='known'?dateIT(d[p+'Date']):d[p+'Status']==='none'?'Non effettuato/a':'Data non conosciuta';
export function dataBlocks(d) {
  const rows=[['Dati personali',[
    ['Nome e cognome',fullName(d)],['Nascita',`${d.birthPlace}, ${dateIT(d.birthDate)}`],['Residenza',address(d)],['Telefono',d.phone],['Codice fiscale',d.fiscalCode],['Codice socio',d.memberCode],['Email',d.email],['Gruppo / Unità',`ROMA 21 · ${d.unit} · Distretto ROMA EST · Regione LAZIO`],['Persona',({minor:'Minorenne',adult:'Maggiorenne',protected:'Persona sottoposta a tutela / curatela / amministrazione di sostegno'})[d.subjectType]]
  ]]];
  const health=optionalHealth.filter(([id])=>d[id+'Present']==='yes').map(([id,label])=>[label,d[id+'Details']]);
  const absent=optionalHealth.filter(([id])=>d[id+'Present']==='no').map(([,label])=>label.toLowerCase());
  if(absent.length) health.push(['Dichiarati assenti / non pertinenti',absent.join('; ')]);
  health.push(['Antitetanica',vaccine(d,'tetanus')],['Ultimo richiamo',vaccine(d,'booster')],['Controindicazioni RM',yesNo(d.mri)+(d.mri==='yes'&&d.mriDetails?': '+d.mriDetails:'')],['Reazioni a mezzi di contrasto / farmaci diagnostici',yesNo(d.contrast)+(d.contrast==='yes'?': '+d.contrastDetails:'')]);
  rows.push(['Dati sanitari',health]);
  if(d.medicinesPresent==='yes') rows.push(['Farmaci di cui la persona è dotata',medicineRows.filter(([id])=>d[id+'Drug']).map(([id,label])=>[label,`${d[id+'Drug']} · Posologia: ${d[id+'Dose']} · Modalità: ${d[id+'Route']}`])]);
  else rows.push(['Farmaci personali',[['Disponibilità per le occasioni indicate','Nessun farmaco dichiarato']]]);
  if(d.administration==='no')rows[rows.length-1][1].push(['Somministrazione al Capo Unità','Richiesta non necessaria']);
  rows.push(['Contatti',[
    ['Firmatari',fieldMap.signerRole.options.find(([v])=>v===d.signerRole)?.[1]],
    ...['father','mother','guardian','extra'].map(id=>[({father:'Padre',mother:'Madre',guardian:'Rappresentante',extra:'Altro contatto'+(d.extraRole?' ('+d.extraRole+')':'')})[id],contact(d,id)]),
    ['Altri numeri fissi',d.landlines],['Altri cellulari',d.mobiles],['Medico curante',[d.gpName,d.gpPhone].filter(Boolean).join(' · ')]
  ]]);
  if(d.administration==='yes') rows.push(['Richiesta somministrazione farmaci al Capo Unità',[
    ['Richiedenti',[d.requester1,d.requester2].filter(Boolean).join(' e ')],['Qualità',fieldMap.requestRole.options.find(([v])=>v===d.requestRole)?.[1]],['Periodo',`${dateIT(d.therapyFrom)} - ${dateIT(d.therapyTo)}`],['Prescrizione',`Dott. ${d.prescriber}, rilasciata il ${dateIT(d.prescriptionDate)}`],['Modalità',fieldMap.administrationMode.options.find(([v])=>v===d.administrationMode)?.[1]],['Consegna',`${d.packages} confezioni integre · Lotto: ${d.batch} · Scadenza: ${dateIT(d.expiry)}`],['Allegato da consegnare','Prescrizione medica']
  ]]);
  return rows.map(([title,values])=>[title,values.filter(([,v])=>v!==undefined&&v!=='')]);
}
function layout(pdf,font,heading,title,subtitle,{dense=false}={}) {
  let page,y;const margin=dense?28:34,width=595.56-2*margin,bottom=dense?32:38,startPage=pdf.getPageCount();
  function newPage(){page=pdf.addPage([595.56,842.04]);y=806;for(const line of lines(title,heading,13,width)){page.drawText(line,{x:margin,y,size:13,font:heading,color:ink()});y-=17;}for(const line of lines(subtitle,font,8,width)){page.drawText(line,{x:margin,y,size:8,font,color:ink()});y-=11;}y-=7;}
  newPage();
  const ensure=h=>{if(y-h<bottom)newPage();};
  function text(value,{bold=false,size=dense?8.5:9,space=dense?2:4}={}) {
    const face=bold?heading:font;const wrapped=lines(value,face,size,width);const lineHeight=size*(dense?1.22:1.3);
    for(const line of wrapped){ensure(lineHeight);page.drawText(line,{x:margin,y:y-size,size,font:face,color:ink()});y-=lineHeight;}y-=space;
  }
  function section(label){ensure(36);y-=3;page.drawRectangle({x:margin,y:y-16,width,height:16,color:window.PDFLib.rgb(.92,.95,.93)});page.drawText(label,{x:margin+6,y:y-11.5,size:9,font:heading,color:ink()});y-=21;}
  function row(label,value){text(label+': '+normalize(value),{size:dense?8.5:9,space:1});}
  function finish(){const pages=pdf.getPages().slice(startPage);pages.forEach((p,i)=>{const value=`${i+1} / ${pages.length}  ·  ${fullNameForFooter || ''}`;let size=7;while(font.widthOfTextAtSize(value,size)>width)size-=.25;p.drawText(value,{x:margin,y:20,size,font,color:ink()});});}
  let fullNameForFooter='';
  return {text,section,row,finish,setName:n=>fullNameForFooter=n};
}
export async function compactPdf(d) {
  return compactGroupPdf([d]);
}
export async function compactGroupPdf(records,{groupName='',scoutYear=''}={}) {
  if(!records.length)throw Error('Seleziona almeno una scheda.');
  const {PDFDocument}=window.PDFLib,pdf=await PDFDocument.create(),{normal,strong}=await fonts(pdf,[...records,{Gruppo:groupName,Anno:scoutYear}]);
  pdf.setTitle(records.length===1?'Scheda sanitaria ridotta - '+fullName(records[0]):'Schede sanitarie ridotte - '+(groupName||'Campo'));
  pdf.setSubject([groupName,scoutYear,'Roma 21'].filter(Boolean).join(' · '));
  for(const d of records)renderCompact(pdf,normal,strong,d,{groupName,scoutYear});
  return pdf.save();
}
function renderCompact(pdf,normal,strong,d,{groupName,scoutYear}) {
  const subtitle=[groupName,scoutYear,'Dati per il campo'].filter(Boolean).join(' · ');
  const out=layout(pdf,normal,strong,'SCHEDA SANITARIA · '+fullName(d),subtitle,{dense:true});out.setName(fullName(d));
  for(const [title,rows] of dataBlocks(d)){
    out.section(title==='Richiesta somministrazione farmaci al Capo Unità'?'Somministrazione farmaci':title);
    if(title==='Dati personali') {
      const groups=[['Nome e cognome','Persona'],['Nascita'],['Residenza'],['Telefono','Email'],['Codice fiscale','Codice socio'],['Gruppo / Unità']];
      for(const labels of groups)out.text(rows.filter(([label])=>labels.includes(label)).map(([label,value])=>label+': '+value).join(' · '),{space:1});
    }else for(const [label,value] of rows)if(!['Firmatari','Allegato da consegnare'].includes(label))out.row(label,value);
  }
  out.finish();
}
export async function originalPdf(d) {
  const {PDFDocument,rgb}=window.PDFLib;const [template,,,content]=await loadAssets();
  const pdf=await PDFDocument.load(template);const {normal,strong}=await fonts(pdf,d);
  const overflow=[];const scale=595.56/708;
  // Coordinates refer to the reviewed 708 x 1000 rendering. Original pages stay intact.
  function box(pageIndex,x,y,w,h,value,label,size=12){
    if(!value)return;
    const page=pdf.getPage(pageIndex);let fontSize=size;let wrapped;
    do{wrapped=lines(value,normal,fontSize,w-5);if(wrapped.length*fontSize*1.18<=h-2)break;fontSize-=.5;}while(fontSize>=7);
    if(wrapped.length*fontSize*1.18>h-2){overflow.push([`A${overflow.length+1} · ${label}`,normalize(value)]);value=`Vedi A${overflow.length}`;fontSize=8;wrapped=lines(value,normal,fontSize,w-5);}
    wrapped.forEach((line,i)=>page.drawText(line,{x:(x+2)*scale,y:842.04-(y+2+fontSize*(i*1.18+1))*scale,size:fontSize*scale,font:normal,color:rgb(.04,.16,.35)}));
  }
  const mark=(p,x,y)=>box(p,x,y,14,15,'X','Scelta',11);
  const line=(p,x,y,w,value,label,size=12)=>box(p,x,y,w,21,value,label,size);
  line(0,237,263,290,fullName(d),'Nome e cognome');
  const basic=[d.surname,d.name,`${d.birthPlace} - ${dateIT(d.birthDate)}`,address(d),d.phone,d.fiscalCode];
  basic.forEach((v,i)=>{if(i!==2)box(2,264,155+i*24,373,21,v,['Cognome','Nome','Nascita','Residenza','Telefono','Codice fiscale'][i]);});
  box(2,264,203,193,21,d.birthPlace,'Luogo di nascita');box(2,477,203,159,21,dateIT(d.birthDate),'Data di nascita');
  const healthBox={past:[383,67],current:[457,91],allergies:[555,91],diet:[653,91],doctorNotes:[751,91],aids:[849,66]};
  for(const [id,label] of optionalHealth){if(id==='updates')continue;const [y,h]=healthBox[id];box(2,212,y,424,h,d[id+'Present']==='yes'?d[id+'Details']:'Nessuna / non pertinente',label);}
  line(3,566,189,72,vaccine(d,'tetanus'),'Antitetanica',9);line(3,566,221,72,vaccine(d,'booster'),'Richiamo antitetanica',9);
  for(const [value,y] of [[d.mri,274.5],[d.contrast,338.5]])pdf.getPage(3).drawEllipse({x:(value==='yes'?578:615.5)*scale,y:842.04-y*scale,xScale:(value==='yes'?12:15)*scale,yScale:11*scale,borderWidth:1.2,borderColor:rgb(.04,.16,.35)});
  box(3,70,365,561,52,d.contrast==='yes'?d.contrastDetails:'Nessuna reazione dichiarata','Reazioni diagnostiche');
  for(const [i,[id,label]] of medicineRows.entries()) if(d.medicinesPresent==='yes') {
    [d[id+'Drug'],d[id+'Dose'],d[id+'Route']].forEach((v,j)=>box(3,[213,350,457][j],520+i*29.3,[132,102,181][j],i===4?25:26,v,`${label} - ${['Farmaco','Posologia','Modalità'][j]}`,10));
  }
  if(d.medicinesPresent!=='yes') line(3,214,520,420,'Nessun farmaco dichiarato','Farmaci');
  for(const [id,start] of [['father',733],['mother',830]]) [d[id+'Surname'],d[id+'Name'],d[id+'Address'],d[id+'Phone']].forEach((v,i)=>box(3,339,start+i*24,297,21,v,`${id==='father'?'Padre':'Madre'} - ${['Cognome','Nome','Residenza','Telefono'][i]}`));
  const third=d.guardianSurname?'guardian':'extra';
  [d[third+'Surname'],d[third+'Name'],d[third+'Address'],d[third+'Phone']].forEach((v,i)=>box(4,339,122+i*24,297,21,v,'Contatto aggiuntivo - '+['Cognome','Nome','Residenza','Telefono'][i]));
  const extras=[];
  if(d.updatesPresent==='yes')extras.push('AGGIORNAMENTI: '+d.updatesDetails);
  if(d.mri==='yes'&&d.mriDetails)extras.push('CONTROINDICAZIONI RM: '+d.mriDetails);
  if(d.guardianSurname)extras.push('RAPPRESENTANTE: '+contact(d,'guardian'));
  if(d.guardianSurname&&contact(d,'extra'))extras.push('ALTRO CONTATTO: '+contact(d,'extra'));
  if(d.extraRole)extras.push('RELAZIONE ALTRO CONTATTO: '+d.extraRole);
  extras.push('FIRMATARI: '+fieldMap.signerRole.options.find(([v])=>v===d.signerRole)?.[1]);
  if(d.administration==='no')extras.push('RICHIESTA SOMMINISTRAZIONE FARMACI: non necessaria.');
  if(d.subjectType==='adult')extras.push('Scheda riferita a persona maggiorenne. Il punto 4 della dichiarazione riguarda solo i minorenni.');
  box(4,71,303,564,275,extras.join('\n\n'),'Aggiornamenti e informazioni aggiuntive');
  line(4,112,908,145,d.place,'Luogo');line(4,295,908,170,dateIT(d.date),'Data');
  line(5,237,148,394,contactName(d,'father'),'Padre dichiarante');line(5,237,172,394,contactName(d,'mother'),'Madre dichiarante');
  if(d.subjectType!=='adult')line(5,145,196,486,fullName(d),'Figlio/a');else line(5,350,220,282,fullName(d),'Interessato maggiorenne');
  if(d.signerRole==='guardian')overflow.push(['Dichiarante (tutela / curatela / amministrazione di sostegno)',d.declarant]);
  line(5,113,849,144,d.place,'Luogo');line(5,295,849,171,dateIT(d.date),'Data');
  if(d.administration==='yes') {
    line(6,172,203,233,d.requester1,'Primo richiedente');line(6,429,203,205,d.requester2,'Secondo richiedente');
    mark(6,{parents:164,foster:254,guardians:404}[d.requestRole],230);
    line(6,82,251,550,fullName(d),'Persona');line(6,233,275,400,d.unit,'Unità');line(6,209,299,426,'ROMA 21','Gruppo');
    dateIT(d.therapyFrom).split('/').forEach((v,i)=>line(6,[234,273,335][i],346,[30,49,59][i],v,'Inizio terapia'));
    dateIT(d.therapyTo).split('/').forEach((v,i)=>line(6,[407,465,526][i],346,[43,44,50][i],v,'Fine terapia'));
    dateIT(d.prescriptionDate).split('/').forEach((v,i)=>line(6,[487,518,578][i],370,[17,45,51][i],v,'Data prescrizione',10));
    line(6,134,394,496,d.prescriber,'Medico prescrittore');
    if(d.administrationMode==='leaders')mark(6,68,495);else {mark(6,68,567);mark(6,130,d.administrationMode==='supervision'?586:623);}
    line(6,195,653,68,d.packages,'Confezioni');line(6,450,653,182,d.batch,'Lotti');
    dateIT(d.expiry).split('/').forEach((v,i)=>line(6,[195,246,308][i],678,[39,50,48][i],v,'Scadenza',10));
    line(6,112,899,145,d.place,'Luogo');line(6,295,899,171,dateIT(d.date),'Data');
  }
  const fixed=(d.landlines||'').split('\n').filter(Boolean),mobile=(d.mobiles||'').split('\n').filter(Boolean);
  fixed.slice(0,3).forEach((v,i)=>line(7,[166,321,488][i],174,[128,139,140][i],v,'Numeri fissi',10));
  mobile.slice(0,3).forEach((v,i)=>line(7,[195,321,488][i],200,[102,139,140][i],v,'Cellulari',10));
  if(fixed.length>3)overflow.push(['Altri numeri fissi',fixed.slice(3).join('; ')]);
  if(mobile.length>3)overflow.push(['Altri cellulari',mobile.slice(3).join('; ')]);
  line(7,305,226,328,d.gpName,'Medico curante');line(7,63,246,572,d.gpPhone,'Telefono medico');
  const isAdult=d.subjectType==='adult';const offset=isAdult?0:315;
  line(10,129,164+offset,501,isAdult?fullName(d):d.declarant,'Dichiarante del consenso');
  if(!isAdult) {
    if(d.subjectType==='minor')line(10,302,504,329,fullName(d),'Minore');
    else line(10,176,529,454,fullName(d),'Persona sottoposta a tutela');
  }
  // The lower block is 366 px below the upper one for biographical fields.
  const bioOffset=isAdult?0:366;
  line(10,102,190+bioOffset,188,d.birthPlace,'Luogo di nascita',10);line(10,306,190+bioOffset,121,dateIT(d.birthDate),'Data di nascita',10);line(10,491,190+bioOffset,139,d.memberCode,'Codice socio',10);
  line(10,129,215+bioOffset,198,d.city,'Comune',10);line(10,349,215+bioOffset,208,d.street,'Via',10);line(10,574,215+bioOffset,55,d.houseNumber,'Civico',10);
  line(10,103,239+bioOffset,192,d.postalCode,'CAP',10);line(10,336,239+bioOffset,295,d.email,'Email',10);
  mark(10,69,(isAdult?282:646)+(d.consent==='no'?15:0));
  line(10,70,773,73,d.place,'Luogo',10);line(10,161,773,92,dateIT(d.date),'Data',10);
  if(overflow.length) {
    const out=layout(pdf,normal,strong,'ALLEGATO ALLA SCHEDA SANITARIA',`${fullName(d)} · Dati integrali richiamati nelle pagine originali`);out.setName(fullName(d));
    for(const [label,value] of overflow){out.section(label);out.text(value);}
    // Number only appended pages; the original's page labels remain unchanged.
    const appended=pdf.getPages().slice(11);appended.forEach((p,i)=>p.drawText(`Allegato ${i+1} / ${appended.length}`,{x:34,y:20,size:7,font:normal}));
  }
  pdf.setTitle('Scheda sanitaria originale compilata - '+fullName(d));return pdf.save();
}
function contactName(d,id){return[d[id+'Name'],d[id+'Surname']].filter(Boolean).join(' ');}
