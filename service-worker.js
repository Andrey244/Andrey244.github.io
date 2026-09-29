const CACHE='tj-shell-v14';
const ASSET_VERSION='20260929-equity-tooltip-fit-1';
const VERSIONED_STYLES='/styles.css?v='+ASSET_VERSION;
const VERSIONED_APP='/app.js?v='+ASSET_VERSION;
const SHELL=['/','/index.html',VERSIONED_STYLES,VERSIONED_APP,'/vendor/supabase-2.117.1.js','/manifest.webmanifest','/app-icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

async function networkFirst(req,fallback){
  try{
    const res=await fetch(req,{cache:'no-store'});
    if(res.ok){
      const copy=res.clone();
      const cache=await caches.open(CACHE);
      await cache.put(req,copy);
    }
    return res;
  }catch(error){
    const cached=await caches.match(req);
    if(cached)return cached;
    if(fallback){
      const fallbackCached=await caches.match(fallback);
      if(fallbackCached)return fallbackCached;
    }
    throw error;
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith(networkFirst(req,'/index.html'));
    return;
  }

  if(url.pathname==='/app.js'||url.pathname==='/styles.css'){
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(async res=>{
      if(res.ok){
        const copy=res.clone();
        const cache=await caches.open(CACHE);
        await cache.put(req,copy);
      }
      return res;
    }))
  );
});
