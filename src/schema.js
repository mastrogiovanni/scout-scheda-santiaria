export const TEMPLATE = 'fse-roma21-2026-2027-v1';
const f = (id,label,type='text',extra={}) => ({id,label,type,...extra});
const choices = [['','Seleziona una risposta'],['no','No'],['yes','Sì']];
export const optionalHealth = [
  ['past','Patologie pregresse','Ad esempio morbillo, parotite, rosolia, varicella, scarlattina, pertosse o altre patologie.'],
  ['current','Patologie in atto e terapie in corso','Indica la patologia e l’eventuale terapia prescritta.'],
  ['allergies','Allergie','Indica sostanze, reazioni e indicazioni ricevute dal medico.'],
  ['diet','Dieta particolare','Specifica gli alimenti vietati e le esigenze alimentari.'],
  ['doctorNotes','Notizie utili per il medico','Ogni altra informazione sanitaria utile.'],
  ['aids','Apparecchi protesici e altri ausili','Indica gli ausili utilizzati.'],
  ['updates','Aggiornamenti successivi alla compilazione','Indica data e variazione delle condizioni di salute.']
];
export const medicineRows = [['fever','Febbre'],['burns','Piccole ustioni'],['insects','Punture di insetti'],['bruises','Contusioni e distorsioni'],['other','Altro']];
export const sections = [
  {title:'Prima di iniziare',short:'Informazioni',caption:'Leggi le indicazioni del gruppo e l’informativa del modello originale.',fields:[f('readInfo','Ho letto le indicazioni e l’informativa riportate sopra.','checkbox',{required:true})]},
  {title:'Chi parte con noi?',short:'Dati personali',caption:'I dati anagrafici della persona a cui si riferisce la scheda.',fields:[
    f('subjectType','La scheda riguarda','select',{required:true,options:[['','Seleziona'],['minor','Un minorenne'],['adult','Un maggiorenne'],['protected','Una persona sottoposta a tutela / curatela / amministrazione di sostegno']]}),
    f('surname','Cognome','text',{required:true,max:80}),f('name','Nome','text',{required:true,max:80}),f('birthPlace','Luogo di nascita','text',{required:true,max:120}),f('birthDate','Data di nascita','date',{required:true}),f('city','Comune di residenza','text',{required:true,max:120}),f('street','Via / piazza','text',{required:true,max:160}),f('houseNumber','Numero civico','text',{required:true,max:20}),f('postalCode','CAP','text',{required:true,max:12}),f('phone','Recapito telefonico','tel',{required:true,max:80}),f('fiscalCode','Codice fiscale','text',{required:true,max:16}),f('memberCode','Codice socio','text',{max:50}),f('email','Email','email',{required:true,max:160}),f('unit','Unità scout','text',{required:true,max:100})]},
  {title:'Salute, senza tralasciare nulla',short:'Salute',caption:'Rispondi a ogni voce. Se non è pertinente, scegli “No”: non saranno richiesti altri dettagli.',fields:optionalHealth.flatMap(([id,label,hint])=>[f(id+'Present',label,'select',{required:true,options:choices,hint}),f(id+'Details','Dettagli: '+label.toLowerCase(),'textarea',{required:true,when:d=>d[id+'Present']==='yes',max:6000})])},
  {title:'Vaccinazioni e farmaci',short:'Vaccini e farmaci',caption:'Riporta le informazioni disponibili e le prescrizioni già ricevute.',fields:[
    f('tetanusStatus','Data della vaccinazione contro il tetano','select',{required:true,options:[['','Seleziona'],['known','Data conosciuta'],['unknown','Data non conosciuta'],['none','Vaccinazione non effettuata']]}),f('tetanusDate','Data vaccinazione antitetanica','date',{required:true,when:d=>d.tetanusStatus==='known'}),
    f('boosterStatus','Ultimo richiamo antitetanica','select',{required:true,options:[['','Seleziona'],['known','Data conosciuta'],['unknown','Data non conosciuta'],['none','Richiamo non effettuato']]}),f('boosterDate','Data ultimo richiamo','date',{required:true,when:d=>d.boosterStatus==='known'}),
    f('mri','Apparecchiature, protesi o corpi estranei ferromagnetici che controindicano la risonanza magnetica?','select',{required:true,options:choices}),f('mriDetails','Dettagli sulla controindicazione RM','textarea',{when:d=>d.mri==='yes',max:4000}),
    f('contrast','Reazioni allergiche a mezzi di contrasto o farmaci per esami diagnostici / radiologici?','select',{required:true,options:choices}),f('contrastDetails','Circostanze della reazione e farmaco','textarea',{required:true,when:d=>d.contrast==='yes',max:4000}),
    f('medicinesPresent','Farmaci di cui la persona è personalmente dotata per le occasioni elencate?','select',{required:true,options:choices}),
    ...medicineRows.flatMap(([id,label])=>[f(id+'Drug',label+' · Tipo di farmaco','text',{when:d=>d.medicinesPresent==='yes',max:600}),f(id+'Dose',label+' · Posologia','text',{when:d=>d.medicinesPresent==='yes',max:600}),f(id+'Route',label+' · Modalità di assunzione','text',{when:d=>d.medicinesPresent==='yes',max:600})])]},
  {title:'Le persone da contattare',short:'Contatti',caption:'Inserisci i recapiti dei genitori o di chi esercita la responsabilità, più gli eventuali contatti aggiuntivi.',fields:[
    f('signerRole','Chi compilerà e firmerà?','select',{required:true,options:[['','Seleziona'],['parents','Entrambi i genitori'],['exclusive','Genitore affidatario esclusivo'],['guardian','Tutore / curatore / amministratore di sostegno'],['self','La persona maggiorenne']]}),
    ...['father','mother','guardian','extra'].flatMap(id=>{const label={father:'Padre',mother:'Madre',guardian:'Tutore / rappresentante',extra:'Altro contatto'}[id];return [f(id+'Surname',label+' · Cognome','text',{max:100}),f(id+'Name',label+' · Nome','text',{max:100}),...(id==='extra'?[f('extraRole','Altro contatto · Relazione','text',{max:80})]:[]),f(id+'Address',label+' · Residenza','text',{max:200}),f(id+'Phone',label+' · Telefono','tel',{max:100})];}),
    f('landlines','Numeri fissi aggiuntivi','textarea',{max:1000,hint:'Un numero per riga.'}),f('mobiles','Numeri cellulari aggiuntivi','textarea',{max:1000}),f('gpName','Medico curante · Nome','text',{max:150}),f('gpPhone','Medico curante · Telefono','tel',{max:100})]},
  {title:'Somministrazione durante le attività',short:'Richiesta farmaci',caption:'La richiesta al Capo Unità è facoltativa. Compilala solo se necessaria.',fields:[
    f('administration','Serve la richiesta di somministrazione farmaci al Capo Unità?','select',{required:true,options:choices}),
    ...[f('requester1','Primo richiedente','text',{required:true,max:120}),f('requester2','Secondo richiedente','text',{max:120}),f('requestRole','Qualità dei richiedenti','select',{required:true,options:[['','Seleziona'],['parents','Genitori'],['foster','Genitori affidatari'],['guardians','Tutori legali']]}),f('therapyFrom','Inizio terapia','date',{required:true}),f('therapyTo','Fine terapia','date',{required:true}),f('prescriptionDate','Data prescrizione medica allegata','date',{required:true}),f('prescriber','Medico che ha rilasciato la prescrizione','text',{required:true,max:160}),f('administrationMode','Modalità richiesta','select',{required:true,options:[['','Seleziona'],['leaders','Somministrazione da parte dei capi incaricati'],['supervision','Auto-somministrazione con vigilanza dei capi (A)'],['assistance','Auto-somministrazione con affiancamento dei capi (B)']]}),f('packages','Numero di confezioni integre consegnate','number',{required:true,max:20}),f('batch','Lotto / lotti','text',{required:true,max:300}),f('expiry','Scadenza delle confezioni','date',{required:true}),f('prescriptionAttached','Consegnerò la prescrizione medica insieme alla scheda firmata.','checkbox',{required:true})].map(x=>({...x,when:d=>d.administration==='yes'}))]},
  {title:'Dichiarazioni e consenso',short:'Dichiarazioni',caption:'Leggi le dichiarazioni e scegli esplicitamente il consenso. Le firme si appongono sulla carta.',fields:[
    f('declarant','Nome e cognome del dichiarante per il consenso','text',{required:true,max:160,when:d=>d.subjectType!=='adult'}),
    f('noContagion','Confermo che il minore non presenta sintomi o segni di malattie trasmissibili in atto, né convive o ha avuto contatti con persone in fase di contagiosità tali da precludere l’ammissione in comunità.','checkbox',{required:true,when:d=>d.subjectType==='minor'}),
    f('declarationAccepted','Confermo le dichiarazioni sopra riportate, inclusa l’esattezza e completezza dei dati e l’impegno a comunicare per iscritto e con firma ogni variazione.','checkbox',{required:true}),
    f('consent','Consenso al trattamento dei dati sanitari per le finalità del modello','select',{required:true,options:[['','Esprimi una scelta'],['yes','Presto il consenso'],['no','Non presto il consenso']]}),f('place','Luogo di compilazione','text',{required:true,max:120}),f('date','Data di compilazione','date',{required:true})]},
  {title:'La tua scheda è pronta',short:'Scarica',caption:'Controlla i dati e prepara le copie per le attività e per la sede.',fields:[]}
];
export const allFields = sections.flatMap(s=>s.fields);
export const fieldMap = Object.fromEntries(allFields.map(f=>[f.id,f]));
export function active(f,d) { return !f.when || f.when(d); }
export function cleanData(data) {
  return Object.fromEntries(allFields.filter(f=>active(f,data)).map(f=>[f.id,data[f.id] ?? (f.type==='checkbox'?false:'')]));
}
export function validate(data, sectionIndex) {
  const errors={};
  const fields=sectionIndex===undefined?allFields:sections[sectionIndex].fields;
  for(const field of fields) {
    if(!active(field,data)) continue;
    const value=data[field.id];
    if(field.required && (value===undefined || value===false || String(value).trim()==='')) errors[field.id]='Compila questa voce.';
    if(field.required && errors[field.id]) errors[field.id]='Compila questa voce.';
    if(typeof value==='string' && field.max && value.length>field.max) errors[field.id]=`Massimo ${field.max} caratteri.`;
    if(field.type==='select' && value && !field.options.some(([v])=>v===value)) errors[field.id]='Scegli un valore valido.';
    if(field.type==='date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) errors[field.id]='Inserisci una data valida.';
    if(field.type==='email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[field.id]='Inserisci un indirizzo email valido.';
  }
  const includes=id=>fields.some(f=>f.id===id);
  if(includes('fiscalCode') && data.fiscalCode && !/^[A-Z0-9]{16}$/i.test(data.fiscalCode)) errors.fiscalCode='Il codice fiscale deve contenere 16 lettere o numeri.';
  if(includes('birthDate') && data.birthDate) {
    if(data.birthDate>new Date().toISOString().slice(0,10)) errors.birthDate='La data di nascita non può essere futura.';
    const reference=data.date || new Date().toISOString().slice(0,10);
    const adultDate=String(Number(data.birthDate.slice(0,4))+18)+data.birthDate.slice(4);
    if(data.subjectType==='adult' && adultDate>reference) errors.birthDate='La persona risulta minorenne alla data di compilazione.';
    if(data.subjectType==='minor' && adultDate<=reference) errors.birthDate='La persona risulta maggiorenne alla data di compilazione.';
  }
  if(includes('therapyTo') && data.administration==='yes') {
    if(data.therapyTo<data.therapyFrom) errors.therapyTo='La fine deve essere successiva o uguale all’inizio.';
    if(!/^\d+$/.test(data.packages||'') || Number(data.packages)<1) errors.packages='Indica almeno una confezione.';
  }
  if(includes('medicinesPresent') && data.medicinesPresent==='yes' && !medicineRows.some(([id])=>data[id+'Drug']?.trim())) errors.medicinesPresent='Indica almeno un farmaco.';
  if(includes('medicinesPresent') && data.medicinesPresent==='yes') for(const [id] of medicineRows) {
    if([data[id+'Drug'],data[id+'Dose'],data[id+'Route']].some(v=>v?.trim())) for(const suffix of ['Drug','Dose','Route']) if(!data[id+suffix]?.trim()) errors[id+suffix]='Completa farmaco, posologia e modalità.';
  }
  if(includes('signerRole')) {
    if(data.subjectType==='minor' && data.signerRole==='self') errors.signerRole='Per il minore occorre un genitore o tutore.';
    if(data.subjectType==='adult' && data.signerRole!=='self') errors.signerRole='Per il maggiorenne seleziona la firma dell’interessato.';
    if(data.subjectType==='protected' && data.signerRole!=='guardian') errors.signerRole='Per la persona sottoposta a tutela seleziona il rappresentante.';
    const contacts=data.signerRole==='parents'?['father','mother']:data.signerRole==='guardian'?['guardian']:data.signerRole==='exclusive'?[]:[];
    for(const id of contacts) for(const suffix of ['Surname','Name','Address','Phone']) if(!data[id+suffix]?.trim()) errors[id+suffix]='Necessario per il firmatario selezionato.';
    if(data.signerRole==='exclusive' && !['father','mother'].some(id=>['Surname','Name','Address','Phone'].every(s=>data[id+s]?.trim()))) errors.signerRole='Completa i recapiti del genitore affidatario (padre o madre).';
    for(const id of ['father','mother','guardian','extra']) if(['Surname','Name','Address','Phone'].some(s=>data[id+s]?.trim())) for(const suffix of ['Surname','Name','Address','Phone']) if(!data[id+suffix]?.trim()) errors[id+suffix]='Completa i dati di questo contatto.';
  }
  return errors;
}
export const fullName=d=>[d.name,d.surname].filter(Boolean).join(' ');
export const address=d=>[d.street,d.houseNumber,d.postalCode,d.city].filter(Boolean).join(', ');
export const dateIT=v=>v?/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):v:'';
