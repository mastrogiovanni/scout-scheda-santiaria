export function qrMatrix(text){if(!globalThis.qrcode)throw Error('Generatore QR non disponibile.');const code=globalThis.qrcode(0,'M');code.addData(text,'Byte');code.make();return code;}
export function drawQr(canvas,text){const code=qrMatrix(text),count=code.getModuleCount(),scale=Math.max(3,Math.floor(720/(count+8))),size=(count+8)*scale;canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#000';for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(code.isDark(y,x))ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);}
// A single scan/decode at a time. Camera tracks are released on completion, close, and backgrounding.
export async function startScanner(video,onCode,onError=()=>{},signal){
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Videocamera non disponibile. Apri il sito via HTTPS e autorizza la fotocamera.');
  let stream,stopped=false,timer;const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  const stop=()=>{stopped=true;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());video.srcObject=null;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',stop);signal?.removeEventListener('abort',stop);};
  const visibility=()=>{if(document.hidden){stop();onError(Error('Scansione in pausa. Premi Riattiva videocamera per riprendere.'));}};
  if(signal?.aborted)return stop;signal?.addEventListener('abort',stop,{once:true});
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    if(stopped){stop();return stop;}video.srcObject=stream;video.muted=true;video.playsInline=true;await video.play();
  }catch(error){stop();throw Error(error.name==='NotAllowedError'?'Accesso alla videocamera negato. Abilitalo nelle impostazioni del browser.':'Impossibile avviare la videocamera. Controlla che non sia usata da un’altra app.');}
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',stop);
  async function tick(){if(stopped)return;try{
    if(video.readyState>=2){const ratio=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*ratio);canvas.height=Math.round(video.videoHeight*ratio);ctx.drawImage(video,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const result=globalThis.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'});if(result&&await onCode(result.data)){stop();return;}}
  }catch(error){onError(error);}if(!stopped)timer=setTimeout(tick,80);}
  timer=setTimeout(tick,0);return stop;
}
export async function keyPdf(secret,keyId){
  const pdf=await window.PDFLib.PDFDocument.create(),page=pdf.addPage([595.28,841.89]);
  const font=await pdf.embedFont(window.PDFLib.StandardFonts.Helvetica),bold=await pdf.embedFont(window.PDFLib.StandardFonts.HelveticaBold);
  const write=(text,y,size=12,strong=false)=>page.drawText(text,{x:48,y,size,font:strong?bold:font});
  write('Chiave privata del capo',780,23,true);write('Schede sanitarie scout - custodire in luogo sicuro',754);
  const canvas=document.createElement('canvas');drawQr(canvas,secret);const png=await pdf.embedPng(canvas.toDataURL('image/png'));
  page.drawImage(png,{x:117.64,y:340,width:360,height:360});
  write('Impronta della chiave pubblica:',302,11,true);write(keyId,282,10);
  write('Questo QR consente di decifrare le schede dei tuoi gruppi.',240);
  write('Stampa il foglio e custodiscilo con cura, separato dai dati.',219);
  write('La chiave privata non viene salvata dal sito o dal backend.',198);
  write('Se la perdi, le schede gia cifrate non sono recuperabili.',177,12,true);
  write('Il PDF scaricato contiene la tua unica copia: gestiscila con cura.',135,11);
  return pdf.save();
}
