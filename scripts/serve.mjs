import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import {fileURLToPath} from 'node:url';
import api from '../server/api.js';
const project=resolve(fileURLToPath(new URL('..',import.meta.url)));
const preview=process.argv.includes('--dist');
const root=preview?resolve(project,'dist'):project;
const headerRules=[];
for(const line of (await readFile(resolve(project,preview?'dist/_headers':'deploy/_headers'),'utf8')).split('\n')){
  if(!line.trim()||line.trim().startsWith('#'))continue;
  if(!/^\s/.test(line)){headerRules.push({path:line.trim(),values:{}});continue;}
  const separator=line.indexOf(':');
  if(separator>0&&headerRules.length)headerRules.at(-1).values[line.slice(0,separator).trim()]=line.slice(separator+1).trim();
}
function responseHeaders(pathname,path){
  const result={'Content-Type':types[extname(path)]||'application/octet-stream'};
  for(const rule of headerRules)if(rule.path==='/*'||rule.path===pathname)Object.assign(result,rule.values);
  return result;
}
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.ttf':'font/ttf', '.pdf':'application/pdf' };
http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/api/raccolta'){
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413).end();return;}chunks.push(chunk);}
      const request=new Request('http://'+req.headers.host+pathname,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      const response=await api(request,{ip:req.socket.remoteAddress});
      const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();
      res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(pathname==='/capi'){res.writeHead(302,{'Location':'/capi/'}).end();return;}
    if(pathname==='/campo'){res.writeHead(302,{'Location':'/campo/'}).end();return;}
    if(pathname==='/compila'){res.writeHead(301,{'Location':'/'}).end();return;}
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname==='/campo/'?'/campo/index.html':pathname==='/capi/'?'/capi/index.html':pathname));
    if (!path.startsWith(root + '/') || /(^|\/)\./.test(pathname) || !['/index.html','/src/','/public/','/campo/','/capi/'].some(p=>pathname === '/' || pathname.startsWith(p))) { res.writeHead(404).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, responseHeaders(pathname,path));
    res.end(body);
  } catch {
    if(preview){try{const path=resolve(root,'404.html');res.writeHead(404,responseHeaders('/404.html',path)).end(await readFile(path));return;}catch{}}
    res.writeHead(404).end('Non trovato');
  }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`${preview?'Build Netlify':'Scheda scout'}: http://127.0.0.1:${process.env.PORT||4173}`));
