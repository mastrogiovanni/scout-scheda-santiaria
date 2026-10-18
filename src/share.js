// Check the actual ZIP: some browsers share text or photos but reject archives.
export function canShareFile(file){
  if(!window.isSecureContext||typeof navigator.share!=='function'||typeof navigator.canShare!=='function')return false;
  try{return navigator.canShare({files:[file]});}catch{return false;}
}

// Call directly from a click, with a file prepared beforehand. Generating the PDF
// after the click can consume the temporary user activation required on phones.
export function shareFile(file){return navigator.share({files:[file]});}
