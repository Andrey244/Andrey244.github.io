import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';

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
const stylesCss=await fs.readFile('styles.css','utf8');
const sw=await fs.readFile('service-worker.js','utf8');
const clientSource=html+'\n'+appJs;
const supabaseVendor=await fs.readFile('vendor/supabase-2.117.1.js');
const mt4Connector=await fs.readFile('downloads/TradeJournalConnector_MT4_v1.20.mq4','utf8');
ok(mt4Connector.includes('#property version   "1.20"'),'MT4 connector: wrong version');
ok(mt4Connector.includes('LAST_HISTORY_TOTAL'),'MT4 connector: history-change request gate missing');
ok(mt4Connector.includes('total == LAST_HISTORY_TOTAL'),'MT4 connector: unchanged-history skip missing');
ok(mt4Connector.includes('(last_ms/1000) - 120'),'MT4 connector: safe history overlap missing');
ok(mt4Connector.includes('TJ4_LAST_LOG20_'),'MT4 connector: v1.20 repair cursor missing');
ok(mt4Connector.includes('StatusEverySeconds = 1800'),'MT4 connector: low-frequency status default missing');
ok(mt4Connector.includes('const int TJ_OP_BALANCE = 6;'),'MT4 connector: balance operation constant missing');
ok(mt4Connector.includes('const int TJ_OP_CREDIT  = 7;'),'MT4 connector: credit operation constant missing');
ok(!/(^|[^A-Z_])OP_BALANCE([^A-Z_]|$)/m.test(mt4Connector.replace('const int TJ_OP_BALANCE = 6;','')),'MT4 connector: bare OP_BALANCE would not compile');
ok(!/(^|[^A-Z_])OP_CREDIT([^A-Z_]|$)/m.test(mt4Connector.replace('const int TJ_OP_CREDIT  = 7;','')),'MT4 connector: bare OP_CREDIT would not compile');
ok(/^<!doctype html>/i.test(html),'index.html: missing doctype');
const appScriptPos=html.indexOf('<script src="/app.js?v=20260929-ui-audit-1"></script>');
const confirmModalPos=html.indexOf('id="confirmModal"');
const bodyClosePos=html.lastIndexOf('</body>');
ok(confirmModalPos>=0 && appScriptPos>confirmModalPos,'index.html: app.js must load after confirmModal/all runtime DOM');
ok(appScriptPos<bodyClosePos,'index.html: app.js must load before closing body');
ok(html.includes('id="manualConnectorHint"') && html.includes('id="ghostHelpText"'),'index.html: rich RU/EN translation anchors missing');
ok(appJs.includes("setText('accountsIntroHint'") && appJs.includes("setText('groupingDetail'"),'app.js: full-surface RU/EN translations missing');
ok(appJs.includes("tx('REVIEWED','РАЗОБРАНО')"),'app.js: review badge localization missing');
ok(!appJs.includes("msg.textContent='Пароль должен быть минимум 6 символов.'"),'app.js: hard-coded Russian password validation returned');
ok(html.includes('<title>Trading Journal</title>'),'index.html: wrong/missing title');
ok(html.includes('<script src="/vendor/supabase-2.117.1.js"></script>'),'index.html: vendored Supabase SDK missing');
const scriptSrcs=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
ok(scriptSrcs.length===2,'index.html: unexpected external script count');
for(const src of scriptSrcs){
  const url=new URL(src,SITE);
  ok(url.origin===new URL(SITE).origin,'index.html: cross-origin runtime script returned: '+url.href);
}
ok(crypto.createHash('sha256').update(supabaseVendor).digest('hex')==='dff1e545f4f35bd42895cd6f46431e56137dd13031e46a9759c446447c11a567','vendored Supabase SDK hash mismatch');
ok(html.includes('Content-Security-Policy'),'index.html: CSP meta missing');
ok(html.includes("script-src 'self';"),'index.html: CSP script-src must be self-only');
ok(html.includes("script-src-attr 'none'"),'index.html: inline script attributes must be blocked');
ok(html.includes('<link rel="stylesheet" href="/styles.css?v=20260929-ui-audit-1">'),'index.html: versioned external stylesheet missing');
ok(html.includes("style-src 'self'; style-src-attr 'none';"),'index.html: stylesheet CSP must be self-only and block style attributes');
ok(!/<style[\s>]/i.test(html),'index.html: inline style block returned');
ok(!/\sstyle=["']/i.test(html),'index.html: inline style attribute returned');
ok(!/\.style\.[A-Za-z]/.test(appJs),'app.js: runtime inline style mutation returned');
ok(!/style=["']/.test(appJs),'app.js: generated inline style attribute returned');
ok(stylesCss.includes('.equityHoverLine.on') && stylesCss.includes('.weekdayTrackFill'),'styles.css: extracted dynamic visual rules missing');
ok(html.includes('<script src="/app.js?v=20260929-ui-audit-1"></script>'),'index.html: versioned external app.js missing');
ok(html.includes('id="directConnectForm"'),'Direct broker connection form missing');
ok(html.includes('id="directInvestorPassword"') && html.includes('id="directInvestorPassword" class="input" type="password"'),'Direct Investor Password field missing');
ok(html.includes('id="directInvestorPassword"') && html.includes('placeholder="Read-only password" disabled'),'Direct secret field must ship disabled until collector readiness');
ok(clientSource.includes("edgePost('broker-key'"),'Direct collector readiness check missing');
ok(clientSource.includes("edgePost('broker-connect'"),'Direct broker connect Edge Function integration missing');
ok(clientSource.includes("edgePost('broker-disconnect'"),'Direct broker disconnect Edge Function integration missing');
ok(clientSource.includes("crypto.subtle.importKey('spki'"),'WebCrypto SPKI import missing');
ok(clientSource.includes("name:'RSA-OAEP',hash:'SHA-256'"),'RSA-OAEP/SHA-256 browser encryption missing');
ok(clientSource.includes('plaintext.fill(0)'),'Direct secret encoded buffer zeroization missing');
ok(clientSource.includes("passwordInput.value=''"),'Direct password input must be cleared before network submission');
ok(!/localStorage\.setItem\([^\n;]*(investor|direct.*password|broker.*password)/i.test(appJs),'Broker secret must never be persisted to localStorage');

ok(clientSource.includes('create_or_rotate_ingest_token'),'index.html: token RPC missing');
ok(clientSource.includes('raw_events'),'index.html: raw_events integration missing');
ok(clientSource.includes('trade_notes'),'index.html: trade_notes integration missing');
ok(clientSource.includes('groupMT5') && clientSource.includes('groupMT4'),'index.html: MT grouping functions missing');
ok(clientSource.includes("GROUPING_VERSION='2.3'"),'index.html: grouping version is not 2.3');
ok(clientSource.includes("LATEST_MT4_CONNECTOR='1.20'"),'index.html: latest MT4 connector version is not 1.20');
ok(html.includes('downloads/TradeJournalConnector_MT4_v1.20.mq4') && html.includes('Скачать MT4 Connector v1.20'),'index.html: MT4 download link/version is stale');
ok(!html.includes('TradeJournalConnector_MT4_v1.17.mq4'),'index.html: stale MT4 v1.17 download link returned');
ok(clientSource.includes('markSelectedGhost'),'index.html: bulk Ghost workflow missing');
ok(clientSource.includes('closeTradeReview'),'index.html: unsaved Trade Review guard missing');
ok(clientSource.includes('langToggleBtn') && clientSource.includes("localStorage.setItem('tj_lang'"),'index.html: RU/EN language switch missing');
const txDecl=appJs.indexOf("const tx=");
const firstTxUse=appJs.indexOf("tx(");
ok(txDecl>=0 && firstTxUse>txDecl,'app.js: tx() used before declaration; this would break the whole UI bootstrap');
ok(appJs.includes("['Sign in','Войти']") && appJs.includes("['Create account','Создать аккаунт']"),'app.js: auth RU/EN dictionary incomplete');
ok(clientSource.includes("tx('Discard unsaved daily review changes?'"),'app.js: Daily Review guard must be localized');
ok(clientSource.includes("tx('Direct collector is temporarily unavailable."),'app.js: dynamic direct-collector copy must be localized');
ok(!appJs.includes("askConfirm('Discard unsaved daily review changes?')"),'app.js: hard-coded English Daily Review guard returned');
ok(sw.includes("tj-shell-v13"),'service-worker.js: cache version not bumped for cache-safe shell delivery');
ok(sw.includes("ASSET_VERSION='20260929-ui-audit-1'"),'service-worker.js: shell asset version missing');
ok(sw.includes("if(url.pathname==='/app.js'||url.pathname==='/styles.css')"),'service-worker.js: mutable shell assets must bypass cache-first');
ok(sw.includes("fetch(req,{cache:'no-store'})"),'service-worker.js: mutable shell assets must revalidate from network');
ok(appJs.includes("register('/service-worker.js',{updateViaCache:'none'})"),'app.js: service worker registration must bypass HTTP cache');
ok(appJs.includes(".then(reg=>reg.update())"),'app.js: service worker update check missing');
ok(clientSource.includes('toastHost') && clientSource.includes('showToast'),'index.html: toast notification system missing');
ok(clientSource.includes('confirmModal') && clientSource.includes('askConfirm'),'index.html: custom confirmation modal missing');
ok(!/\balert\s*\(/.test(appJs),'app.js: native alert() returned');
ok(!/\bconfirm\s*\(/.test(appJs),'app.js: native confirm() returned');
ok(clientSource.includes('connectorStatusList'),'index.html: connector version status UI missing');
ok(clientSource.includes('avgWinLoss'),'index.html: avg win/loss breakdown missing');
ok(clientSource.includes('isCashFlowEvent'),'index.html: cash-flow recognition missing');
ok(clientSource.includes('strategyOrderCount'),'index.html: strategy order-count helper missing');
ok(clientSource.includes("return t.stopLossHit?'loss':'win';"),'index.html: automatic strategy outcome must still depend on explicit SL marker');
ok(clientSource.includes("if(override==='other')return 'other';"),'index.html: manual Other strategy outcome override missing');
ok(mt4Connector.includes('closed_by_sl'),'MT4 connector: explicit SL marker missing');
ok(clientSource.includes('stabilizeTradeIds'),'index.html: trade id collision guard missing');
ok(clientSource.includes('syncContextualTradeFilters'),'index.html: contextual filter logic missing');
ok(clientSource.includes('accountScopeStatic'),'index.html: single-account static scope missing');
ok(clientSource.includes('One idea. One logical trade.'),'index.html: header microcopy regression');
ok(clientSource.includes('set_member_role'),'index.html: role assignment workflow missing');
ok(clientSource.includes('canManageAccess'),'index.html: admin access gate missing');
ok(stylesCss.includes(".equityTipBalance.up") && stylesCss.includes(".equityTipBalance.down"),'styles.css: directional equity balance colors missing');
ok(stylesCss.includes("height:clamp(184px,18vw,210px)"),'styles.css: Equity chart must use compact responsive desktop height');
ok(stylesCss.includes(".equityChart{height:168px}"),'styles.css: Equity chart mobile height must remain compact');
ok(!stylesCss.includes(".equityChart{height:260px"),'styles.css: oversized fixed Equity desktop height returned');
ok(stylesCss.includes(".tradeTableWrap table{min-width:720px}"),'styles.css: tablet trade table overflow guard missing');
ok(stylesCss.includes("max-height:92dvh"),'styles.css: modal dynamic viewport guard missing');
ok(stylesCss.includes("padding:calc(16px + env(safe-area-inset-top,0px))"),'styles.css: modal safe-area padding missing');
ok(stylesCss.includes(".detail{grid-template-columns:1fr}.healthGrid"),'styles.css: mobile detail cards must collapse to one column');
ok(stylesCss.includes("left:max(9px,env(safe-area-inset-left))") && stylesCss.includes("right:max(9px,env(safe-area-inset-right))"),'styles.css: fixed mobile UI must respect horizontal safe areas');
ok(stylesCss.includes(".reviewedBadge,.otherBadge") && stylesCss.includes("font-size:10px;font-weight:900") && !stylesCss.includes("font-size:8px;font-weight:900"),'styles.css: compact review badges must remain readable');
ok(stylesCss.includes(".equityTipBalance.down{fill:var(--red)}"),'styles.css: falling equity balance must be red');
ok(appJs.includes("tip.setAttribute('transform','translate('"),'app.js: Equity tooltip must follow the inspected point via SVG transform');
ok(appJs.includes("const tipW=Math.min(220,Math.max(180,W-16)),tipH=58"),'app.js: Equity tooltip density regression');
ok(appJs.includes("const W=Math.max(320,Math.round(chart.getBoundingClientRect().width||1000))"),'app.js: Equity SVG viewport must match the rendered chart width');
ok(appJs.includes("tradeNumber:item.kind==='trade'?tradeNumber:null"),'app.js: Equity trade numbering must ignore cash-flow points');
ok(!stylesCss.includes(".equityTooltip{right:12px;top:12px"),'styles.css: stale fixed-corner Equity tooltip override returned');
ok(appJs.includes("d.toLocaleString(uiLocale(),"),'app.js: Equity tooltip date must follow the journal RU/EN locale');
ok(clientSource.includes('memberTableHead') && clientSource.includes('memberActionPlaceholder'),'index.html: Access auto-layout/typography markers missing');
ok(clientSource.includes('authHeader') && clientSource.includes('authForm') && clientSource.includes('authActions'),'index.html: auth page layout markers missing');
ok(clientSource.includes('toggleRecoveryPasswordBtn') && clientSource.includes('toggleRecoveryPassword2Btn'),'index.html: recovery password visibility controls missing');
ok(clientSource.includes("Пароль успешно изменён. Войди с новым паролем."),'index.html: recovery completion flow missing');
ok(clientSource.includes("Этот пароль уже установлен на аккаунте."),'index.html: same-password recovery message missing');
ok(clientSource.includes('One idea. One logical trade.') && clientSource.includes('PRIVATE ACCESS'),'index.html: auth typography/microcopy regression');
ok(stylesCss.includes(':focus-visible'),'styles.css: global focus-visible system missing');
ok(stylesCss.includes('prefers-reduced-motion:reduce'),'styles.css: reduced-motion handling missing');
ok(stylesCss.includes('touch-action:manipulation'),'styles.css: touch interaction baseline missing');
ok(stylesCss.includes('@media (hover:hover) and (pointer:fine)'),'styles.css: hover capability gate missing');
ok(clientSource.includes('role="dialog"') && clientSource.includes('aria-modal="true"'),'index.html: dialog semantics missing');
ok(clientSource.includes('setupModalAccessibility'),'index.html: modal focus management missing');
ok(clientSource.includes('<button type="button" class="tab on"'),'index.html: desktop navigation is not semantic buttons');
ok(clientSource.includes('<button type="button" class="day clickable '),'index.html: calendar keyboard semantics missing');
ok(clientSource.includes('tradeOpenBtn') && clientSource.includes('data-open-trade'),'index.html: trade row keyboard open control missing');
ok(clientSource.includes('for="fSetup"') && clientSource.includes('for="dWorked"'),'index.html: review form labels missing');
ok(clientSource.includes("chart.onkeydown=e=>"),'index.html: Equity keyboard inspection missing');
ok(appJs.includes("equityTooltipA11y") && appJs.includes("aria-live=\"polite\""),'app.js: Equity keyboard inspection must retain an accessible live status');
ok(appJs.includes("new Date(t.closedAt).toLocaleString(uiLocale())"),'app.js: Trades timestamps must follow journal locale');
ok(appJs.includes("monthDate.toLocaleDateString(uiLocale()"),'app.js: Calendar month label must follow journal locale');
ok(appJs.includes("new Date(row.last_sync_at).toLocaleString(uiLocale())"),'app.js: Direct connection timestamps must follow journal locale');

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

function scriptBodies(source){
  const lower=source.toLowerCase();
  const bodies=[];
  let offset=0;
  while(true){
    const open=lower.indexOf('<script',offset);
    if(open<0) break;
    const openEnd=source.indexOf('>',open);
    ok(openEnd>=0,'index.html: malformed script start tag');
    const close=lower.indexOf('</script',openEnd+1);
    ok(close>=0,'index.html: script end tag missing');
    const closeEnd=source.indexOf('>',close);
    ok(closeEnd>=0,'index.html: malformed script end tag');
    bodies.push(source.slice(openEnd+1,close));
    offset=closeEnd+1;
  }
  return bodies;
}
const inline=scriptBodies(html).filter(x=>x.trim());
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
  const r=await fetch(new URL('/vendor/supabase-2.117.1.js',SITE),{redirect:'follow',cache:'no-store'});
  ok(r.ok,'vendored Supabase SDK HTTP '+r.status);
  ok((r.headers.get('content-type')||'').includes('javascript'),'vendored Supabase SDK is not JavaScript');
  const body=Buffer.from(await r.arrayBuffer());
  ok(crypto.createHash('sha256').update(body).digest('hex')==='dff1e545f4f35bd42895cd6f46431e56137dd13031e46a9759c446447c11a567','deployed vendored Supabase SDK hash mismatch');
});

const headers={
  apikey:LEGACY_ANON,
  Authorization:'Bearer '+LEGACY_ANON,
  'content-type':'application/json'
};


const serviceRpcProbe=await fetch(SUPABASE+'/rest/v1/rpc/collector_active_public_key_service',{
  method:'POST',
  headers,
  body:'{}'
});
ok(!serviceRpcProbe.ok,'anonymous service-only collector RPC was unexpectedly executable');

const functionPublicHeaders={apikey:LEGACY_ANON,'content-type':'application/json'};
for(const fn of ['broker-key','broker-connect','broker-disconnect']){
  const r=await fetch(SUPABASE+'/functions/v1/'+fn,{
    method:'POST',
    headers:functionPublicHeaders,
    body:'{}'
  });
  ok([401,403].includes(r.status),fn+' accepted request without authenticated user session: '+r.status);
}

const invalidCollectorHeaders={
  apikey:LEGACY_ANON,
  'content-type':'application/json',
  'x-collector-token':'healthcheck-invalid-collector-token-000000000000'
};
for(const fn of ['collector-next-job','collector-report','collector-ingest']){
  const r=await fetch(SUPABASE+'/functions/v1/'+fn,{
    method:'POST',
    headers:invalidCollectorHeaders,
    body:'{}'
  });
  ok(r.status===401,fn+' did not reject invalid collector token with 401: '+r.status);
}

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
