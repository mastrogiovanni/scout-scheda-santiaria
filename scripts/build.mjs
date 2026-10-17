import {mkdir,readdir,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=resolve(root,'dist');
const allowedExtensions=new Set(['.html','.css','.js','.json','.webmanifest','.png','.ttf','.pdf','.md','.markdown','.txt']);
const files=[];
async function collect(path){
  const stats=await lstat(path);
  if(stats.isSymbolicLink())throw Error('Il sito non può contenere link simbolici: '+relative(root,path));
  if(stats.isDirectory()){
    for(const name of (await readdir(path)).sort())if(!name.startsWith('.'))await collect(resolve(path,name));
  }else if(allowedExtensions.has(extname(path)))files.push({path:relative(root,path).split('\\').join('/'),bytes:await readFile(path)});
}
await collect(resolve(root,'index.html'));
for(const folder of ['campo','src','public'])await collect(resolve(root,folder));
for(const name of ['_headers','_redirects','404.html'])files.push({path:name,bytes:await readFile(resolve(root,'deploy',name))});
const known=new Set(files.map(f=>'/'+f.path));
known.add('/');known.add('/campo/');
const worker=files.find(f=>f.path==='campo/sw.js');
const assetsLiteral=worker.bytes.toString().match(/const ASSETS=(\[[\s\S]*?\]);/)?.[1];
if(!assetsLiteral)throw Error('Elenco delle risorse offline non trovato.');
const assets=[...assetsLiteral.matchAll(/'([^']+)'/g)].map(m=>m[1]);
for(const asset of assets)if(!known.has(asset))throw Error('Risorsa offline mancante: '+asset);
const hash=createHash('sha256');
for(const file of [...files].sort((a,b)=>a.path.localeCompare(b.path))){hash.update(file.path+'\0');hash.update(file.bytes);hash.update('\0');}
const version='scout-campo-shell-'+hash.digest('hex').slice(0,20);
const workerText=worker.bytes.toString();
if(!/const VERSION='[^']+';/.test(workerText))throw Error('Versione del service worker non trovata.');
worker.bytes=Buffer.from(workerText.replace(/const VERSION='[^']+';/,`const VERSION='${version}';`));
// Only explicitly collected public files can enter the deployment directory.
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
for(const file of files){const path=resolve(output,file.path);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,file.bytes);}
console.log(`Build Netlify: ${files.length} file in dist/ · ${assets.length} risorse offline · ${version}`);
