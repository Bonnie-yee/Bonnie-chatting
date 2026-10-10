'use strict';
const CACHE='bonnie-private-reference-206a87f0cfe9';
const DOCUMENT='/__bonnie_cached_document__';
async function remember(response) {
  const url=new URL(response.url);
  if(!response.ok||url.origin!==self.location.origin||url.pathname!=='/'||!response.headers.get('content-type')?.includes('text/html'))return;
  const text=await response.clone().text();
  if(!text.includes('window.REPLY_LOCAL_KNOWLEDGE=')||!text.includes('reference-list'))return;
  await (await caches.open(CACHE)).put(DOCUMENT,response.clone());
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  try{await remember(await fetch('/',{credentials:'same-origin',cache:'reload'}));}catch{}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('bonnie-private-reference-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||event.request.mode!=='navigate'||url.origin!==self.location.origin||url.pathname!=='/')return;
  event.respondWith((async()=>{
    try{const response=await fetch(event.request);await remember(response);return response;}
    catch(error){const cached=await(await caches.open(CACHE)).match(DOCUMENT);if(cached)return cached;throw error;}
  })());
});
