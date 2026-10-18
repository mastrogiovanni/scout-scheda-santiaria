const VERSION='scout-campo-shell-v5';
const ASSETS=[
  '/campo/','/campo/index.html','/campo/style.css','/campo/app.js','/campo/store.js','/campo/packages.js','/campo/manifest.webmanifest',
  '/public/brand/fse-emblem.png','/campo/icons/icon-192.png','/campo/icons/icon-512.png','/campo/icons/maskable-512.png',
  '/src/style.css','/src/schema.js','/src/pdf.js','/src/archive.js','/src/content.json',
  '/public/vendor/pdf-lib.min.js','/public/vendor/jszip.min.js','/public/vendor/fontkit.umd.min.js',
  '/public/vendor/NotoSans-Regular.ttf','/public/vendor/NotoSans-Bold.ttf','/public/modello-originale.pdf'
];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(VERSION);
  await cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();await Promise.all(names.filter(n=>n.startsWith('scout-campo-shell-')&&n!==VERSION).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  const url=new URL(event.request.url);if(!ASSETS.includes(url.pathname))return;
  event.respondWith((async()=>{const cache=await caches.open(VERSION);return await cache.match(url.pathname)||fetch(event.request);})());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_UPDATE'){self.skipWaiting();return;}
  if(event.data?.type==='CHECK_OFFLINE')event.waitUntil((async()=>{
    const cache=await caches.open(VERSION);const entries=await Promise.all(ASSETS.map(url=>cache.match(url)));
    event.ports[0]?.postMessage({ready:entries.every(Boolean),version:VERSION});
  })());
});
