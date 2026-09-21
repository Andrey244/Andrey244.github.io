import fs from 'node:fs/promises';
import vm from 'node:vm';

const SITE='https://andrey244.github.io/';
const SUPABASE='https://ylriyjxcefovzwzinpqd.supabase.co';
const LEGACY_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlscml5anhjZWZvdnp3emlucHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5ODAxNzAsImV4cCI6MjEwNTU1NjE3MH0.Y95Tu9GzSPwVfV1kpMBKxQ1ozE0LUXuJDjjkD-bhi78';

function ok(cond,msg){ if(!cond) throw new Error(msg); }

async function retry(fn, attempts=8, delayMs=15000){
  let last;
  for(let i=0;i<attempts;i++){
    try{return await fn()}catch(e){last=e;if(i<attempts-1) await new Promise(r=>setTimeout(r,delayMs));}
  }
  throw last;
}

const html=await fs.readFile('index.html','utf8');
ok(/^<!doctype html>/i.test(html),'index.html: missing doctype');
ok(html.includes('<title>Trading Journal</title>'),'index.html: wrong/missing title');
ok(html.includes('@supabase/supabase-js@2'),'index.html: Supabase SDK missing');
ok(html.includes('create_or_rotate_ingest_token'),'index.html: token RPC missing');
ok(html.includes('raw_events'),'index.html: raw_events integration missing');
ok(html.includes('trade_notes'),'index.html: trade_notes integration missing');
ok(html.includes('groupMT5') && html.includes('groupMT4'),'index.html: MT grouping functions missing');

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const dup=ids.filter((x,i)=>ids.indexOf(x)!==i);
ok(dup.length===0,'index.html: duplicate ids: '+[...new Set(dup)].join(', '));

const refs=[...html.matchAll(/\bel\('([^']+)'\)/g)].map(m=>m[1]);
const missing=[...new Set(refs.filter(x=>!ids.includes(x)))];
ok(missing.length===0,'index.html: JS references missing DOM ids: '+missing.join(', '));

const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
for(const js of inline) new vm.Script(js);

await retry(async()=>{
  const r=await fetch(SITE,{redirect:'follow',cache:'no-store'});
  ok(r.ok,'site HTTP '+r.status);
  ok((r.headers.get('content-type')||'').includes('text/html'),'site is not text/html');
  const body=await r.text();
  ok(body.includes('Trading Journal'),'deployed site body mismatch');
});

const headers={
  apikey:LEGACY_ANON,
  Authorization:'Bearer '+LEGACY_ANON,
  'content-type':'application/json'
};

const ingest=await fetch(SUPABASE+'/rest/v1/rpc/ingest_mt_events',{
  method:'POST',
  headers,
  body:JSON.stringify({p_token:'healthcheck-invalid-token',p_events:[]})
});
const ingestText=await ingest.text();
ok(!ingest.ok,'invalid ingest token was unexpectedly accepted');
ok(ingestText.toLowerCase().includes('invalid ingest token'),'ingest RPC failed for an unexpected reason: '+ingestText.slice(0,300));

const rotate=await fetch(SUPABASE+'/rest/v1/rpc/create_or_rotate_ingest_token',{
  method:'POST',
  headers,
  body:'{}'
});
ok(!rotate.ok,'anonymous token rotation was unexpectedly allowed');

console.log('Trading Journal smoke test: PASS');
