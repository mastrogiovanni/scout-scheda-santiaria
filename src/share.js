// Chromium's Android share service rejects ZIPs after canShare() can return true.
// Keep the real extension/MIME and offer a download; never disguise the archive.
// https://github.com/chromium/chromium/blob/main/components/browser_ui/webshare/android/java/src/org/chromium/components/browser_ui/webshare/ShareServiceImpl.java
export function fileShareRestriction(file){
  const android=navigator.userAgentData?.platform==='Android'||/Android/i.test(navigator.userAgent);
  const chromium=/\b(?:Chrome|Chromium)\//.test(navigator.userAgent)||navigator.userAgentData?.brands?.some(b=>/Chromium|Google Chrome|Microsoft Edge/i.test(b.brand));
  return android&&chromium&&/\.zip$/i.test(file.name)?'Su Android, Chrome e i browser basati su Chromium bloccano la condivisione diretta degli ZIP. Scarica il pacchetto e condividilo da File o Download.':'';
}

// Check the actual ZIP: some browsers share text or photos but reject archives.
export function canShareFile(file){
  if(fileShareRestriction(file))return false;
  if(!window.isSecureContext||typeof navigator.share!=='function'||typeof navigator.canShare!=='function')return false;
  try{return navigator.canShare({files:[file]});}catch{return false;}
}

// Call directly from a click, with a file prepared beforehand. Generating the PDF
// after the click can consume the temporary user activation required on phones.
export function shareFile(file){return navigator.share({files:[file]});}
