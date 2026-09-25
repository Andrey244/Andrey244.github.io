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
const appJs=await fs.readFile('app.js','utf8');
const clientSource=html+'\n'+appJs;
const mt4Connector=await fs.readFile('downloads/TradeJournalConnector_MT4_v1.17.mq4','utf8');
ok(mt4Connector.includes('#property version   "1.17"'),'MT4 connector: wrong version');
ok(mt4Connector.includes('const int TJ_OP_BALANCE = 6;'),'MT4 connector: balance operation constant missing');
ok(mt4Connector.includes('const int TJ_OP_CREDIT  = 7;'),'MT4 connector: credit operation constant missing');
ok(!/(^|[^A-Z_])OP_BALANCE([^A-Z_]|$)/m.test(mt4Connector.replace('const int TJ_OP_BALANCE = 6;','')),'MT4 connector: bare OP_BALANCE would not compile');
ok(!/(^|[^A-Z_])OP_CREDIT([^A-Z_]|$)/m.test(mt4Connector.replace('const int TJ_OP_CREDIT  = 7;','')),'MT4 connector: bare OP_CREDIT would not compile');
ok(/^<!doctype html>/i.test(html),'index.html: missing doctype');
ok(html.includes('<title>Trading Journal</title>'),'index.html: wrong/missing title');
ok(html.includes('@supabase/supabase-js@2.117.1/dist/umd/supabase.js'),'index.html: Supabase SDK must be exactly pinned');
ok(!html.includes('@supabase/supabase-js@2"'),'index.html: floating Supabase major-version CDN dependency returned');
ok(html.includes('Content-Security-Policy'),'index.html: CSP meta missing');
ok(html.includes("script-src 'self' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js"),'index.html: CSP script-src is not pinned');
ok(html.includes("script-src-attr 'none'"),'index.html: inline script attributes must be blocked');
ok(html.includes('<script src="/app.js"></script>'),'index.html: external app.js missing');
ok(clientSource.includes('create_or_rotate_ingest_token'),'index.html: token RPC missing');
ok(clientSource.includes('raw_events'),'index.html: raw_events integration missing');
ok(clientSource.includes('trade_notes'),'index.html: trade_notes integration missing');
ok(clientSource.includes('groupMT5') && clientSource.includes('groupMT4'),'index.html: MT grouping functions missing');
ok(clientSource.includes("GROUPING_VERSION='2.3'"),'index.html: grouping version is not 2.3');
ok(clientSource.includes("LATEST_MT4_CONNECTOR='1.17'"),'index.html: latest MT4 connector version is not 1.15');
ok(clientSource.includes('markSelectedGhost'),'index.html: bulk Ghost workflow missing');
ok(clientSource.includes('closeTradeReview'),'index.html: unsaved Trade Review guard missing');
ok(clientSource.includes('connectorStatusList'),'index.html: connector version status UI missing');
ok(clientSource.includes('avgWinLoss'),'index.html: avg win/loss breakdown missing');
ok(clientSource.includes('isCashFlowEvent'),'index.html: cash-flow recognition missing');
ok(clientSource.includes('strategyOrderCount'),'index.html: strategy order-count helper missing');
ok(clientSource.includes("function strategyOutcome(t){return t.stopLossHit?'loss':'win'}"),'index.html: strategy outcome must depend on explicit SL marker');
ok(mt4Connector.includes('closed_by_sl'),'MT4 connector: explicit SL marker missing');
ok(clientSource.includes('stabilizeTradeIds'),'index.html: trade id collision guard missing');
ok(clientSource.includes('syncContextualTradeFilters'),'index.html: contextual filter logic missing');
ok(clientSource.includes('accountScopeStatic'),'index.html: single-account static scope missing');
ok(clientSource.includes('One idea. One logical trade.'),'index.html: header microcopy regression');
ok(clientSource.includes('set_member_role'),'index.html: role assignment workflow missing');
ok(clientSource.includes('canManageAccess'),'index.html: admin access gate missing');
ok(clientSource.includes("eqBalance.up") && clientSource.includes("eqBalance.down"),'index.html: directional equity balance colors missing');
ok(clientSource.includes(".eqBalance.down{color:var(--red)}"),'index.html: falling equity balance must be red');
ok(clientSource.includes("valueEl.innerHTML='<span>Equity</span> <span class=\"eqBalance"),'index.html: Equity label/balance color split missing');
ok(clientSource.includes('memberTableHead') && clientSource.includes('memberActionPlaceholder'),'index.html: Access auto-layout/typography markers missing');
ok(clientSource.includes('authHeader') && clientSource.includes('authForm') && clientSource.includes('authActions'),'index.html: auth page layout markers missing');
ok(clientSource.includes('toggleRecoveryPasswordBtn') && clientSource.includes('toggleRecoveryPassword2Btn'),'index.html: recovery password visibility controls missing');
ok(clientSource.includes("Пароль успешно изменён. Войди с новым паролем."),'index.html: recovery completion flow missing');
ok(clientSource.includes("Этот пароль уже установлен на аккаунте."),'index.html: same-password recovery message missing');
ok(clientSource.includes('One idea. One logical trade.') && clientSource.includes('PRIVATE ACCESS'),'index.html: auth typography/microcopy regression');
ok(clientSource.includes(':focus-visible'),'index.html: global focus-visible system missing');
ok(clientSource.includes('prefers-reduced-motion:reduce'),'index.html: reduced-motion handling missing');
ok(clientSource.includes('touch-action:manipulation'),'index.html: touch interaction baseline missing');
ok(clientSource.includes('@media (hover:hover) and (pointer:fine)'),'index.html: hover capability gate missing');
ok(clientSource.includes('role="dialog"') && clientSource.includes('aria-modal="true"'),'index.html: dialog semantics missing');
ok(clientSource.includes('setupModalAccessibility'),'index.html: modal focus management missing');
ok(clientSource.includes('<button type="button" class="tab on"'),'index.html: desktop navigation is not semantic buttons');
ok(clientSource.includes('<button type="button" class="day clickable '),'index.html: calendar keyboard semantics missing');
ok(clientSource.includes('tradeOpenBtn') && clientSource.includes('data-open-trade'),'index.html: trade row keyboard open control missing');
ok(clientSource.includes('for="fSetup"') && clientSource.includes('for="dWorked"'),'index.html: review form labels missing');
ok(clientSource.includes("chart.onkeydown=e=>"),'index.html: Equity keyboard inspection missing');

const mt5Section=appJs.slice(appJs.indexOf('function groupMT5'),appJs.indexOf('function summarizeMT4'));
const mt4Section=appJs.slice(appJs.indexOf('function groupMT4'),appJs.indexOf('function stabilizeTradeIds'));
ok(mt5Section.includes('accountKey(e)'),'groupMT5: server/account isolation missing');
ok(mt4Section.includes('accountKey(e)'),'groupMT4: server/account isolation missing');
ok(clientSource.includes("(orderMap[table]||[]).forEach"),'fetchAll: deterministic pagination ordering missing');
ok(clientSource.includes('dedupeEvents'),'index.html: duplicate raw-event guard missing');

await import('./grouping-regression.mjs');

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const dup=ids.filter((x,i)=>ids.indexOf(x)!==i);
ok(dup.length===0,'index.html: duplicate ids: '+[...new Set(dup)].join(', '));

const refs=[...appJs.matchAll(/\bel\('([^']+)'\)/g)].map(m=>m[1]);
const missing=[...new Set(refs.filter(x=>!ids.includes(x)))];
ok(missing.length===0,'index.html: JS references missing DOM ids: '+missing.join(', '));

const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());
ok(inline.length===0,'index.html: inline JavaScript returned; CSP would block it');
new vm.Script(appJs);

await retry(async()=>{
  const r=await fetch(SITE,{redirect:'follow',cache:'no-store'});
  ok(r.ok,'site HTTP '+r.status);
  ok((r.headers.get('content-type')||'').includes('text/html'),'site is not text/html');
  const body=await r.text();
  ok(body.includes('Trading Journal'),'deployed site body mismatch');
});

await retry(async()=>{
  const r=await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js',{redirect:'follow',cache:'no-store'});
  ok(r.ok,'pinned Supabase SDK HTTP '+r.status);
  ok((r.headers.get('content-type')||'').includes('javascript'),'pinned Supabase SDK is not JavaScript');
  const body=await r.text();
  ok(body.includes('createClient'),'pinned Supabase SDK body mismatch');
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

const anonBrokerConnections=await fetch(SUPABASE+'/rest/v1/broker_connections?select=id&limit=1',{headers});
ok(!anonBrokerConnections.ok,'anonymous broker_connections read was unexpectedly allowed');

const privateProfile=await fetch(SUPABASE+'/rest/v1/broker_credentials?select=connection_id&limit=1',{
  headers:{...headers,'Accept-Profile':'collector_private'}
});
ok(!privateProfile.ok,'collector_private schema was unexpectedly exposed through Data API');

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
