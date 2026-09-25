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
const mt4Connector=await fs.readFile('downloads/TradeJournalConnector_MT4_v1.16.mq4','utf8');
ok(mt4Connector.includes('#property version   "1.16"'),'MT4 connector: wrong version');
ok(mt4Connector.includes('const int TJ_OP_BALANCE = 6;'),'MT4 connector: balance operation constant missing');
ok(mt4Connector.includes('const int TJ_OP_CREDIT  = 7;'),'MT4 connector: credit operation constant missing');
ok(!/(^|[^A-Z_])OP_BALANCE([^A-Z_]|$)/m.test(mt4Connector.replace('const int TJ_OP_BALANCE = 6;','')),'MT4 connector: bare OP_BALANCE would not compile');
ok(!/(^|[^A-Z_])OP_CREDIT([^A-Z_]|$)/m.test(mt4Connector.replace('const int TJ_OP_CREDIT  = 7;','')),'MT4 connector: bare OP_CREDIT would not compile');
ok(/^<!doctype html>/i.test(html),'index.html: missing doctype');
ok(html.includes('<title>Trading Journal</title>'),'index.html: wrong/missing title');
ok(html.includes('@supabase/supabase-js@2'),'index.html: Supabase SDK missing');
ok(html.includes('create_or_rotate_ingest_token'),'index.html: token RPC missing');
ok(html.includes('raw_events'),'index.html: raw_events integration missing');
ok(html.includes('trade_notes'),'index.html: trade_notes integration missing');
ok(html.includes('groupMT5') && html.includes('groupMT4'),'index.html: MT grouping functions missing');
ok(html.includes("GROUPING_VERSION='2.3'"),'index.html: grouping version is not 2.3');
ok(html.includes("LATEST_MT4_CONNECTOR='1.16'"),'index.html: latest MT4 connector version is not 1.15');
ok(html.includes('markSelectedGhost'),'index.html: bulk Ghost workflow missing');
ok(html.includes('closeTradeReview'),'index.html: unsaved Trade Review guard missing');
ok(html.includes('connectorStatusList'),'index.html: connector version status UI missing');
ok(html.includes('avgWinLoss'),'index.html: avg win/loss breakdown missing');
ok(html.includes('isCashFlowEvent'),'index.html: cash-flow recognition missing');
ok(html.includes('strategyOrderCount'),'index.html: strategy synthetic SL step missing');
ok(mt4Connector.includes('closed_by_sl'),'MT4 connector: explicit SL marker missing');
ok(html.includes('stabilizeTradeIds'),'index.html: trade id collision guard missing');
ok(html.includes('syncContextualTradeFilters'),'index.html: contextual filter logic missing');
ok(html.includes('accountScopeStatic'),'index.html: single-account static scope missing');
ok(html.includes('One idea. One logical trade.'),'index.html: header microcopy regression');
ok(html.includes('set_member_role'),'index.html: role assignment workflow missing');
ok(html.includes('canManageAccess'),'index.html: admin access gate missing');
ok(html.includes("eqBalance.up") && html.includes("eqBalance.down"),'index.html: directional equity balance colors missing');
ok(html.includes(".eqBalance.down{color:var(--red)}"),'index.html: falling equity balance must be red');
ok(html.includes("valueEl.innerHTML='<span>Equity</span> <span class=\"eqBalance"),'index.html: Equity label/balance color split missing');
ok(html.includes('memberTableHead') && html.includes('memberActionPlaceholder'),'index.html: Access auto-layout/typography markers missing');
ok(html.includes('authHeader') && html.includes('authForm') && html.includes('authActions'),'index.html: auth page layout markers missing');
ok(html.includes('toggleRecoveryPasswordBtn') && html.includes('toggleRecoveryPassword2Btn'),'index.html: recovery password visibility controls missing');
ok(html.includes("Пароль успешно изменён. Войди с новым паролем."),'index.html: recovery completion flow missing');
ok(html.includes("Этот пароль уже установлен на аккаунте."),'index.html: same-password recovery message missing');
ok(html.includes('One idea. One logical trade.') && html.includes('PRIVATE ACCESS'),'index.html: auth typography/microcopy regression');

const mt5Section=html.slice(html.indexOf('function groupMT5'),html.indexOf('function summarizeMT4'));
const mt4Section=html.slice(html.indexOf('function groupMT4'),html.indexOf('function stabilizeTradeIds'));
ok(mt5Section.includes('accountKey(e)'),'groupMT5: server/account isolation missing');
ok(mt4Section.includes('accountKey(e)'),'groupMT4: server/account isolation missing');
ok(html.includes("(orderMap[table]||[]).forEach"),'fetchAll: deterministic pagination ordering missing');
ok(html.includes('dedupeEvents'),'index.html: duplicate raw-event guard missing');

await import('./grouping-regression.mjs');

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

// Direct anonymous table access must never reveal or mutate journal data.
const anonRead=await fetch(SUPABASE+'/rest/v1/raw_events?select=id&limit=1',{headers});
if(anonRead.ok){
  const data=await anonRead.json();
  ok(Array.isArray(data) && data.length===0,'anonymous raw_events read leaked data');
}else{
  ok([401,403].includes(anonRead.status),'anonymous raw_events read failed unexpectedly: '+anonRead.status);
}

const anonWrite=await fetch(SUPABASE+'/rest/v1/raw_events',{
  method:'POST',
  headers:{...headers,Prefer:'return=minimal'},
  body:JSON.stringify({
    user_id:'00000000-0000-0000-0000-000000000000',
    dedupe_key:'smoke|must-not-write',
    source:'MT4',account:'x',event_id:'x',raw:{}
  })
});
ok(!anonWrite.ok,'anonymous direct raw_events insert was unexpectedly allowed');

const anonRole=await fetch(SUPABASE+'/rest/v1/rpc/set_member_role',{
  method:'POST',
  headers,
  body:JSON.stringify({p_user_id:'00000000-0000-0000-0000-000000000000',p_role:'admin'})
});
ok(!anonRole.ok,'anonymous set_member_role execution was unexpectedly allowed');

const anonAdmin=await fetch(SUPABASE+'/rest/v1/rpc/is_admin',{
  method:'POST',
  headers,
  body:'{}'
});
ok(!anonAdmin.ok,'anonymous is_admin execution was unexpectedly allowed');

const anonMembers=await fetch(SUPABASE+'/rest/v1/app_members?select=user_id,role&limit=1',{headers});
if(anonMembers.ok){
  const data=await anonMembers.json();
  ok(Array.isArray(data) && data.length===0,'anonymous app_members read leaked data');
}else{
  ok([401,403].includes(anonMembers.status),'anonymous app_members read failed unexpectedly: '+anonMembers.status);
}

const anonApprove=await fetch(SUPABASE+'/rest/v1/rpc/approve_member',{
  method:'POST',
  headers,
  body:JSON.stringify({p_user_id:'00000000-0000-0000-0000-000000000000',p_approved:true})
});
ok(!anonApprove.ok,'anonymous approve_member execution was unexpectedly allowed');

const connectorStatusRead=await fetch(SUPABASE+'/rest/v1/connector_status?select=user_id&limit=1',{headers});
if(connectorStatusRead.ok){
  const data=await connectorStatusRead.json();
  ok(Array.isArray(data) && data.length===0,'anonymous connector_status read leaked data');
}else{
  ok([401,403].includes(connectorStatusRead.status),'anonymous connector_status read failed unexpectedly: '+connectorStatusRead.status);
}

const badStatus=await fetch(SUPABASE+'/rest/v1/rpc/report_connector_status',{
  method:'POST',
  headers,
  body:JSON.stringify({p_token:'healthcheck-invalid-token',p_source:'MT4',p_account:'x',p_server:'x',p_version:'0'})
});
ok(!badStatus.ok,'invalid connector status token was unexpectedly accepted');

const waitProbe=await fetch(SUPABASE+'/rest/v1/rpc/signup_wait_seconds',{
  method:'POST',
  headers,
  body:JSON.stringify({p_email:'smoke-test-nobody@example.invalid'})
});
ok(waitProbe.ok,'signup_wait_seconds should remain available before login');

console.log('Trading Journal smoke test: PASS');
