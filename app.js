const SUPABASE_URL='https://ylriyjxcefovzwzinpqd.supabase.co';
const SUPABASE_KEY='sb_publishable_FHpGzrS604yrbzE8ciM83Q_2045GubX';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const el=id=>document.getElementById(id);
const GROUPING_VERSION='2.3';
const GROUPING_RULE='Server-isolated MT4 overlap · MT5 exposure · duplicate guard';
const LATEST_MT4_CONNECTOR='1.18';
let model={trades:[],daily:[],symbols:[],weekday:[],summary:{}},monthDate=null,activeTrade=null,liveToken='';
let membership=null,allTrades=[],scopedTrades=[],scopedRawEvents=[],tradeNotes=[],dailyReviewRows=[],accountSettings=[],connectorStatuses=[],brokerConnections=[],detectedAccounts=[],memberRows=[],selectedAccountKey='all',declineTarget=null,rawEvents=[],dailyReviewMap={},activeReviewDate=null;
let directCollectorKey=null,directCollectorCheckPromise=null;
let bulkSelectMode=false,selectedTradeIds=new Set(),tradeReviewSnapshot='';
let dateRange={mode:'all',start:null,end:null,label:'All time'};
let rangeDraft={mode:'custom',start:null,end:null,label:'Свой период'},rangeViewMonth=null;
let rangeDrag={active:false,pointerId:null,anchor:null,last:null};

const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const USD=String.fromCharCode(36);
const money=n=>{n=Number(n||0);return (n<0?'-'+USD:n>0?'+'+USD:USD)+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:2})};
const balanceMoney=n=>{n=Number(n||0);return (n<0?'-'+USD:USD)+Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})};
const price=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:5});
function paint(node,n){node.classList.remove('green','red');if(n>0)node.classList.add('green');if(n<0)node.classList.add('red')}
async function withBusyButton(btn,busyText,task){
  if(!btn||btn.disabled)return;
  const oldText=btn.textContent;
  btn.disabled=true;btn.setAttribute('aria-busy','true');btn.textContent=busyText;
  try{return await task()}finally{btn.disabled=false;btn.removeAttribute('aria-busy');btn.textContent=oldText}
}
function dayKey(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function utcDayKey(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function tradeDayKey(t){
  const d=new Date(t.closedAt);
  return String(t.source||'').toUpperCase()==='MT4'?utcDayKey(d):dayKey(d);
}
function eventDayKey(e){
  const ts=e.close_time||e.event_time||e.received_at;
  if(!ts)return null;
  const d=new Date(ts);
  return String(e.source||'').toUpperCase()==='MT4'?utcDayKey(d):dayKey(d);
}
function dateFromKey(k){const [y,m,d]=String(k).split('-').map(Number);return new Date(y,m-1,d,12,0,0)}
function shiftKey(k,days){const d=dateFromKey(k);d.setDate(d.getDate()+days);return dayKey(d)}
function firstOfMonthKey(k){return String(k).slice(0,7)+'-01'}
function mondayOfWeekKey(k){
  const d=dateFromKey(k),dow=d.getDay(),back=dow===0?6:dow-1;
  d.setDate(d.getDate()-back);return dayKey(d);
}
function formatRangeDate(k){return dateFromKey(k).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}
function rangeLabel(r){
  if(r.mode==='all')return 'All time';
  if(r.start===r.end)return formatRangeDate(r.start);
  return formatRangeDate(r.start)+' — '+formatRangeDate(r.end);
}
function persistRange(){try{localStorage.setItem('tj_date_range',JSON.stringify(dateRange))}catch(_e){}}
function restoreRange(){
  try{
    const x=JSON.parse(localStorage.getItem('tj_date_range')||'null');
    if(x&&x.mode&&((x.mode==='all')||(x.start&&x.end))) dateRange=x;
  }catch(_e){}
}
function makePresetRange(mode){
  const today=dayKey(new Date());
  if(mode==='all')return{mode:'all',start:null,end:null,label:'All time'};
  if(mode==='today')return{mode,start:today,end:today,label:'Сегодня'};
  if(mode==='yesterday'){const y=shiftKey(today,-1);return{mode,start:y,end:y,label:'Вчера'}}
  if(mode==='week')return{mode,start:mondayOfWeekKey(today),end:today,label:'Эта неделя'};
  if(mode==='last7')return{mode,start:shiftKey(today,-6),end:today,label:'Последние 7 дней'};
  if(mode==='last30')return{mode,start:shiftKey(today,-29),end:today,label:'Последние 30 дней'};
  if(mode==='month')return{mode,start:firstOfMonthKey(today),end:today,label:'Этот месяц'};
  return dateRange;
}
function hash(s){let a=2166136261;for(let i=0;i<s.length;i++){a^=s.charCodeAt(i);a=Math.imul(a,16777619)}return (a>>>0).toString(36)}
function tag(comment,key){const m=String(comment||'').match(new RegExp('(?:^|\\s|\\|)'+key+':([A-Za-z0-9_\\-]+)','i'));return m?m[1]:''}

async function boot(){
  // Supabase recovery links can establish the session before onAuthStateChange
  // is attached, especially in Safari. Detect recovery directly from the URL too.
  const recoveryFromUrl=(()=>{
    try{
      const hashParams=new URLSearchParams((window.location.hash||'').replace(/^#/,''));
      const queryParams=new URLSearchParams(window.location.search||'');
      return hashParams.get('type')==='recovery' || queryParams.get('type')==='recovery';
    }catch(_e){return false}
  })();

  const {data}=await sb.auth.getSession();
  await handleSession(data.session);

  if(recoveryFromUrl && data.session){
    el('recoveryModal').classList.remove('hide');
  }

  sb.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      el('recoveryModal').classList.remove('hide');
    }
    handleSession(session);
  });
}

function requestCloseModal(id){
  if(id==='tradeModal')return closeTradeReview();
  if(id==='dailyModal')return closeDailyReview();
  if(id==='rangeModal')return closeRangeModal();
  if(id==='declineModal')return closeDecline();
  if(id==='exportModal')return closeExport();
  if(id==='recoveryModal')return el('closeRecoveryModal').click();
}
function setupModalAccessibility(){
  const focusable='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const topModal=()=>[...document.querySelectorAll('.modal:not(.hide)')].at(-1);
  document.querySelectorAll('.modal').forEach(modal=>{
    let wasOpen=!modal.classList.contains('hide');
    const sync=()=>{
      const open=!modal.classList.contains('hide');
      if(open&&!wasOpen){
        modal._returnFocus=document.activeElement;
        requestAnimationFrame(()=>{const target=modal.querySelector(focusable);(target||modal).focus()});
      }else if(!open&&wasOpen){
        const target=modal._returnFocus;
        if(target&&target.isConnected&&typeof target.focus==='function')requestAnimationFrame(()=>target.focus());
      }
      wasOpen=open;
    };
    new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class']});
    modal.addEventListener('keydown',e=>{
      if(e.key!=='Tab')return;
      const items=[...modal.querySelectorAll(focusable)].filter(x=>!x.closest('.hide')&&x.getClientRects().length);
      if(!items.length){e.preventDefault();modal.focus();return}
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    });
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    const modal=topModal();if(!modal)return;
    e.preventDefault();requestCloseModal(modal.id);
  });
}
function canManageAccess(){return membership?.role==='owner'||membership?.role==='admin'}
async function handleSession(session){
  el('auth').classList.toggle('hide',!!session);
  el('app').classList.add('hide');
  el('pendingAccess').classList.add('hide');
  if(!session){membership=null;return;}

  const {data,error}=await sb.from('app_members').select('*').eq('user_id',session.user.id).maybeSingle();
  if(error){el('authMsg').textContent=error.message;await sb.auth.signOut();return;}
  membership=data;

  if(!membership || !membership.approved){
    el('pendingAccess').classList.remove('hide');
    return;
  }

  el('app').classList.remove('hide');
  el('accessTab').classList.toggle('hide',!canManageAccess());
  el('mobileAccessBtn').classList.toggle('hide',!canManageAccess());
  await loadData();
  if(canManageAccess()) await loadMembers();
}
el('loginBtn').onclick=()=>withBusyButton(el('loginBtn'),'Вхожу…',async()=>{
  const {error}=await sb.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});
  el('authMsg').textContent=error?error.message:'Вход выполнен';
});
el('forgotPasswordBtn').onclick=async()=>{
  const email=el('email').value.trim();
  if(!email){el('authMsg').textContent='Сначала введи email аккаунта.';return}
  el('authMsg').textContent='Отправляю письмо для сброса пароля…';
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:'https://andrey244.github.io/'});
  el('authMsg').textContent=error?error.message:'Письмо для сброса пароля отправлено. Открой его на этом устройстве.';
};

el('signupBtn').onclick=()=>withBusyButton(el('signupBtn'),'Создаю…',async()=>{
  const email=el('email').value.trim();
  if(!email){el('authMsg').textContent='Введи email.';return;}

  const wait=await sb.rpc('signup_wait_seconds',{p_email:email});
  if(!wait.error && Number(wait.data||0)>0){
    const sec=Number(wait.data||0),min=Math.floor(sec/60),rem=sec%60;
    el('authMsg').textContent='Новая заявка для этого email временно заблокирована. Попробуй через '+(min?min+' мин ':'')+rem+' сек.';
    return;
  }

  const {error}=await sb.auth.signUp({email,password:el('password').value});
  if(error){
    const msg=String(error.message||'');
    if(/email.*rate|rate.*email/i.test(msg)){
      el('authMsg').textContent='Лимит Supabase на отправку confirmation email исчерпан. Аккаунт не создан. Для этого приватного журнала лучше отключить email confirmation в Supabase и оставить ручной Approve владельцем.';
    }else{
      el('authMsg').textContent=msg;
    }
    return;
  }
  el('authMsg').textContent='Аккаунт создан. Теперь владелец журнала должен одобрить доступ.';
});
function bindPasswordToggle(inputId,buttonId){
  const p=el(inputId),b=el(buttonId);
  if(!p||!b)return;
  b.onclick=()=>{
    const show=p.type==='password';
    p.type=show?'text':'password';
    b.classList.toggle('on',show);
    b.setAttribute('aria-label',show?'Скрыть пароль':'Показать пароль');
    b.title=show?'Скрыть пароль':'Показать пароль';
  };
}
bindPasswordToggle('recoveryPassword','toggleRecoveryPasswordBtn');
bindPasswordToggle('recoveryPassword2','toggleRecoveryPassword2Btn');

el('closeRecoveryModal').onclick=async()=>{
  el('recoveryPassword').value='';
  el('recoveryPassword2').value='';
  el('recoveryMsg').textContent='';
  el('recoveryModal').classList.add('hide');
  try{history.replaceState(null,'',window.location.pathname)}catch(_e){}
  await sb.auth.signOut();
  el('authMsg').textContent='Сброс пароля отменён. Войди в аккаунт обычным способом.';
};
el('saveRecoveryPassword').onclick=async()=>{
  const p1=el('recoveryPassword').value,p2=el('recoveryPassword2').value,msg=el('recoveryMsg'),btn=el('saveRecoveryPassword');
  msg.textContent='';
  if(p1.length<6){msg.textContent='Пароль должен быть минимум 6 символов.';return}
  if(p1!==p2){msg.textContent='Пароли не совпадают.';return}
  btn.disabled=true;
  const oldText=btn.textContent;
  btn.textContent='Сохраняю…';
  const {error}=await sb.auth.updateUser({password:p1});
  if(error){
    btn.disabled=false;
    btn.textContent=oldText;
    const raw=String(error.message||'');
    msg.textContent=(error.code==='same_password'||/different from the old password/i.test(raw))
      ?'Этот пароль уже установлен на аккаунте. Попробуй войти с ним.'
      :raw;
    return;
  }
  el('recoveryPassword').value='';
  el('recoveryPassword2').value='';
  el('recoveryModal').classList.add('hide');
  try{history.replaceState(null,'',window.location.pathname)}catch(_e){}
  await sb.auth.signOut();
  btn.disabled=false;
  btn.textContent=oldText;
  el('authMsg').textContent='Пароль успешно изменён. Войди с новым паролем.';
};

el('logoutBtn').onclick=()=>sb.auth.signOut();
el('pendingLogoutBtn').onclick=()=>sb.auth.signOut();
bindPasswordToggle('password','togglePasswordBtn');
el('changeLoginPasswordBtn').onclick=async()=>{
  const p1=el('newLoginPassword').value,p2=el('newLoginPassword2').value,msg=el('passwordChangeMsg');
  msg.textContent='';
  if(p1.length<6){msg.textContent='Пароль должен быть минимум 6 символов.';return}
  if(p1!==p2){msg.textContent='Пароли не совпадают.';return}
  const {error}=await sb.auth.updateUser({password:p1});
  if(error){msg.textContent=error.message;return}
  el('newLoginPassword').value='';el('newLoginPassword2').value='';
  msg.textContent='Пароль изменён. Теперь используй его для входа с телефона.';
};
el('pendingRefreshBtn').onclick=async()=>{const {data}=await sb.auth.getSession();await handleSession(data.session)};

function hideEquityTooltip(){
  const chart=el('equityChart');
  if(!chart)return;
  const line=chart.querySelector('.equityHoverLine');
  const dot=chart.querySelector('.equityHoverDot');
  const tip=chart.querySelector('.equityTooltip');
  if(line)line.style.opacity='0';
  if(dot)dot.style.opacity='0';
  if(tip)tip.classList.remove('on');
}
function switchView(view){
  hideEquityTooltip();
  if(view==='access'&&!canManageAccess())view='insights';
  ['insights','trades','accounts','connection','access'].forEach(v=>el(v).classList.toggle('hide',v!==view));
  document.querySelectorAll('.tab').forEach(x=>{const on=x.dataset.view===view;x.classList.toggle('on',on);if(on)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')});
  document.querySelectorAll('[data-mobile-view]').forEach(x=>{const on=x.dataset.mobileView===view;x.classList.toggle('on',on);if(on)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')});
  el('mobileMoreSheet').classList.add('hide');
  if(view==='access'&&canManageAccess())loadMembers();
  if(view==='connection')ensureDirectCollectorReady();
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
document.querySelectorAll('[data-mobile-view]').forEach(t=>t.onclick=()=>switchView(t.dataset.mobileView));
document.querySelectorAll('[data-more-view]').forEach(t=>t.onclick=()=>switchView(t.dataset.moreView));
el('mobileReviewBtn').onclick=()=>{el('mobileMoreSheet').classList.add('hide');openDailyReview(dayKey(new Date()))};
el('mobileMoreBtn').onclick=()=>el('mobileMoreSheet').classList.toggle('hide');
el('mobileLogoutBtn').onclick=()=>sb.auth.signOut();

document.addEventListener('pointerdown',e=>{
  const chart=el('equityChart');
  if(chart&&!chart.contains(e.target))hideEquityTooltip();
},true);
window.addEventListener('blur',hideEquityTooltip);

async function fetchAll(table){
  const orderMap={
    raw_events:[['id',true]],
    trade_notes:[['trade_id',true]],
    account_settings:[['source',true],['account',true],['server',true]],
    daily_reviews:[['review_date',true]],
    connector_status:[['source',true],['account',true],['server',true]],
    broker_connections:[['platform',true],['login',true],['server',true]]
  };
  let out=[],from=0;
  for(;;){
    let q=sb.from(table).select('*');
    (orderMap[table]||[]).forEach(([column,ascending])=>{q=q.order(column,{ascending})});
    const {data,error}=await q.range(from,from+999);
    if(error)throw error;
    out=out.concat(data||[]);
    if(!data||data.length<1000)break;
    from+=1000;
  }
  return out;
}
function dedupeEvents(events){
  const seen=new Set();
  return events.filter(e=>{
    const key=accountKey(e)+'|'+String(e.event_id||e.order_id||'')+'|'+String(e.event_time_ms||e.close_time||e.event_time||'');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
function freshTrade(e,side,strategy,gid){
  return {id:'LT_'+hash([e.source,e.account,e.symbol,strategy,gid||'',e.event_id].join('|')),source:e.source,account:e.account,server:e.server||'',symbol:e.symbol,side,strategy,openedAt:e.event_time||e.open_time,closedAt:null,pnl:0,entryQty:0,exitQty:0,entryVal:0,exitVal:0,entries:0,exits:0,orders:{},events:[]};
}
function finalize(t){t.avgEntry=t.entryQty?t.entryVal/t.entryQty:0;t.avgExit=t.exitQty?t.exitVal/t.exitQty:0;t.orderCount=Object.keys(t.orders).length;t.pnl=Math.round(t.pnl*100)/100;return t}
function addMT5(t,e,before){
  const v=Math.abs(Number(e.volume||0)),signed=(e.side==='BUY'?1:-1)*v,dir=t.side==='BUY'?1:-1;
  t.pnl+=Number(e.profit||0)+Number(e.commission||0)+Number(e.swap||0)+Number(e.fee||0);
  t.events.push(String(e.event_id));if(e.order_id)t.orders[String(e.order_id)]=1;
  const raw=e.raw||{},comment=String(e.comment||'').toLowerCase();
  if(raw.closed_by_sl===true||String(raw.closed_by_sl||'').toLowerCase()==='true'||comment.includes('[sl]')||comment.includes('stop loss')||comment.includes('stoploss'))t.stopLossHit=true;
  if(Math.sign(signed)===dir){t.entryQty+=v;t.entryVal+=v*Number(e.price||0);t.entries++}
  else{const q=Math.min(v,Math.abs(before));if(q>0){t.exitQty+=q;t.exitVal+=q*Number(e.price||0);t.exits++}}
}
function groupMT5(rows){
  rows=rows.slice().sort((a,b)=>Number(a.event_time_ms||0)-Number(b.event_time_ms||0));
  const state={},out=[],eps=1e-9;
  rows.forEach(e=>{
    if(!e.symbol||!e.side||!Number(e.volume))return;
    const gid=tag(e.comment,'TG'),strategy=tag(e.comment,'STRAT')||('MAGIC:'+String(e.magic||'0'));
    const key=[accountKey(e),e.symbol,gid?('TG:'+gid):strategy].join('|');
    if(!state[key])state[key]={exposure:0,trade:null};
    const s=state[key],signed=(e.side==='BUY'?1:-1)*Math.abs(Number(e.volume)),before=s.exposure;
    let after=before+signed;if(Math.abs(after)<eps)after=0;
    if(before===0&&after!==0)s.trade=freshTrade(e,after>0?'BUY':'SELL',strategy,gid);
    if(!s.trade&&after!==0)s.trade=freshTrade(e,after>0?'BUY':'SELL',strategy,gid);
    if(s.trade)addMT5(s.trade,e,before);
    const flipped=before!==0&&after!==0&&Math.sign(before)!==Math.sign(after);
    if(flipped&&s.trade){
      s.trade.closedAt=e.event_time;out.push(finalize(s.trade));
      const residue=Math.abs(after),z=Object.assign({},e,{volume:residue,profit:0,commission:0,swap:0,fee:0});
      s.trade=freshTrade(z,after>0?'BUY':'SELL',strategy,gid);addMT5(s.trade,z,0);
    }else if(after===0&&s.trade){s.trade.closedAt=e.event_time;out.push(finalize(s.trade));s.trade=null}
    s.exposure=after;
  });
  return out;
}
function summarizeMT4(group){
  const first=group[0],strategy=first._strategy,gid=first._gid,t=freshTrade(first,first.side,strategy,gid);
  t.openedAt=group.reduce((v,e)=>new Date(e.open_time)<new Date(v)?e.open_time:v,first.open_time);
  t.closedAt=group.reduce((v,e)=>new Date(e.close_time)>new Date(v)?e.close_time:v,first.close_time);
  group.forEach(e=>{const q=Math.abs(Number(e.volume||0));t.entryQty+=q;t.entryVal+=q*Number(e.open_price||e.price||0);t.exitQty+=q;t.exitVal+=q*Number(e.close_price||0);t.pnl+=Number(e.profit||0)+Number(e.commission||0)+Number(e.swap||0)+Number(e.fee||0);t.entries++;t.exits++;t.orders[String(e.order_id||e.event_id)]=1;t.events.push(String(e.event_id||e.order_id));const raw=e.raw||{},comment=String(e.comment||'').toLowerCase();if(raw.closed_by_sl===true||String(raw.closed_by_sl||'').toLowerCase()==='true'||comment.includes('[sl]')||comment.includes('stop loss')||comment.includes('stoploss'))t.stopLossHit=true;});
  return finalize(t);
}
function groupMT4(rows){
  const exact={},normal={},out=[];
  rows.forEach(e=>{
    if(!e.symbol||!e.side||!e.open_time||!e.close_time)return;
    const gid=tag(e.comment,'TG'),strategy=tag(e.comment,'STRAT')||('MAGIC:'+String(e.magic||'0'));e._gid=gid;e._strategy=strategy;
    const key=gid?[accountKey(e),e.symbol,'TG:'+gid].join('|'):[accountKey(e),e.symbol,e.side,strategy].join('|');
    const box=gid?exact:normal;(box[key]||(box[key]=[])).push(e);
  });
  Object.values(exact).forEach(g=>out.push(summarizeMT4(g)));
  Object.values(normal).forEach(g=>{
    g.sort((a,b)=>new Date(a.open_time)-new Date(b.open_time));let campaign=[],maxClose=0;
    g.forEach(e=>{
      const open=new Date(e.open_time).getTime(),close=new Date(e.close_time).getTime();
      // Without an explicit TG id, MT4 orders are one Logical Trade only while
      // their lifetimes truly overlap. If the previous exposure is already flat,
      // even an immediate same-second EA re-entry is a NEW trade.
      if(!campaign.length||open<maxClose){
        campaign.push(e);
        maxClose=Math.max(maxClose,close);
      }else{
        out.push(summarizeMT4(campaign));
        campaign=[e];
        maxClose=close;
      }
    });
    if(campaign.length)out.push(summarizeMT4(campaign));
  });
  return out;
}
function stabilizeTradeIds(trades){
  const counts={};
  trades.forEach(t=>counts[t.id]=(counts[t.id]||0)+1);
  trades.forEach(t=>{
    t.legacyId=t.id;
    t.legacyCollision=counts[t.id]>1;
    if(t.legacyCollision){
      t.id='LT_'+hash([t.source,t.account,t.server||'',t.symbol,t.strategy,t.openedAt,(t.events||[])[0]||''].join('|'));
    }
  });
  return trades;
}
function strategyOrderCount(t){return Number(t.orderCount||0)}
function strategyOutcome(t){return t.stopLossHit?'loss':'win'}
function isStrategyWin(t){return strategyOutcome(t)==='win'}
function isStrategyLoss(t){return strategyOutcome(t)==='loss'}
function buildModel(trades){
  const dayMap={};
  trades.forEach(t=>{
    const d=tradeDayKey(t);
    if(!dayMap[d])dayMap[d]={date:d,pnl:0,trades:0,wins:0,losses:0};
    const x=dayMap[d];
    x.pnl+=t.pnl;x.trades++;
    if(isStrategyLoss(t))x.losses++;else x.wins++;
  });
  const daily=Object.values(dayMap).sort((a,b)=>a.date.localeCompare(b.date));
  daily.forEach(d=>d.wr=d.trades?d.wins/d.trades*100:null);

  const pnl=trades.reduce((s,t)=>s+t.pnl,0);
  const wins=trades.filter(isStrategyWin).length;
  const losses=trades.filter(isStrategyLoss).length;
  const pnlWins=trades.filter(t=>Number(t.pnl)>0);
  const pnlLosses=trades.filter(t=>Number(t.pnl)<0);
  const gp=pnlWins.reduce((s,t)=>s+t.pnl,0);
  const gl=pnlLosses.reduce((s,t)=>s+t.pnl,0);

  const best=daily.length?daily.reduce((a,b)=>a.pnl>b.pnl?a:b):null;
  const worst=daily.length?daily.reduce((a,b)=>a.pnl<b.pnl?a:b):null;
  const bestTrade=trades.length?trades.reduce((a,b)=>a.pnl>b.pnl?a:b):null;
  const worstTrade=trades.length?trades.reduce((a,b)=>a.pnl<b.pnl?a:b):null;

  let eq=0,peak=0,dd=0;
  trades.slice().sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt)).forEach(t=>{
    eq+=t.pnl;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);
  });

  let streak='—',type='',n=0;
  for(let i=0;i<trades.length;i++){
    const z=isStrategyLoss(trades[i])?'L':'W';
    if(!type){type=z;n=1}
    else if(z===type)n++;
    else break;
  }
  if(n)streak=n+type;

  const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],bucket={};
  names.forEach(n=>bucket[n]=[]);
  daily.forEach(d=>bucket[names[new Date(d.date+'T12:00:00').getDay()]].push(d.pnl));
  const weekday=names.map(name=>{
    const a=bucket[name];
    return{name,value:a.length?a.reduce((p,q)=>p+q,0)/a.length:0};
  });

  const sm={};
  trades.forEach(t=>{
    if(!sm[t.symbol])sm[t.symbol]={symbol:t.symbol,pnl:0,trades:0,wins:0,days:{}};
    const s=sm[t.symbol];
    s.pnl+=t.pnl;s.trades++;
    if(isStrategyWin(t))s.wins++;
    s.days[tradeDayKey(t)]=1;
  });
  const symbols=Object.values(sm)
    .map(s=>({symbol:s.symbol,pnl:s.pnl,trades:s.trades,wr:s.trades?s.wins/s.trades*100:0,days:Object.keys(s.days).length}))
    .sort((a,b)=>b.pnl-a.pnl);

  return{trades,daily,weekday,symbols,summary:{
    pnl,wins,losses,wr:trades.length?wins/trades.length*100:0,
    days:daily.length,trades:trades.length,
    best:best?best.pnl:0,worst:worst?worst.pnl:0,avg:daily.length?pnl/daily.length:0,
    bestTrade:bestTrade?bestTrade.pnl:0,worstTrade:worstTrade?worstTrade.pnl:0,
    avgTrade:trades.length?pnl/trades.length:0,
    avgWin:pnlWins.length?gp/pnlWins.length:0,
    avgLoss:pnlLosses.length?gl/pnlLosses.length:0,
    streak,pf:gl<0?gp/Math.abs(gl):(gp>0?Infinity:0),dd
  }};
}

function setDataLoading(on){
  el('app').classList.toggle('dataLoading',!!on);
  if(on && !el('trades').classList.contains('hide')){
    el('tradeRows').innerHTML=Array.from({length:5},()=>'<tr class="skeletonRow"><td colspan="6"><span class="skeletonLine"></span></td></tr>').join('');
  }
}
async function loadData(){
  setDataLoading(true);
  try{
    el('sync').textContent='Syncing…';
    const [events,notes,settings,dailyReviews,statuses,directConnections]=await Promise.all([fetchAll('raw_events'),fetchAll('trade_notes'),fetchAll('account_settings'),fetchAll('daily_reviews'),fetchAll('connector_status'),fetchAll('broker_connections')]);
    rawEvents=events||[];
    tradeNotes=notes||[];
    dailyReviewRows=dailyReviews||[];
    accountSettings=settings||[];
    connectorStatuses=statuses||[];
    brokerConnections=directConnections||[];
    dailyReviewMap={};dailyReviewRows.forEach(r=>dailyReviewMap[r.review_date]=r);
    const noteMap={};tradeNotes.forEach(n=>noteMap[n.trade_id]=n);
    const groupingEvents=dedupeEvents(events);
    const grouped=stabilizeTradeIds(groupMT5(groupingEvents.filter(e=>String(e.source).toUpperCase()==='MT5')).concat(groupMT4(groupingEvents.filter(e=>String(e.source).toUpperCase()==='MT4'))).filter(t=>t.closedAt));
    allTrades=grouped.map(t=>Object.assign(t,noteMap[t.id]||(!t.legacyCollision?noteMap[t.legacyId]:null)||{})).sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt));
    buildDetectedAccounts(events);
    restoreRange();
    applyFilters();
    renderAccounts();
    renderConnectorStatus();
    renderDirectConnections();
    el('sync').textContent='Synced · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }catch(e){
    el('sync').textContent='Sync error';
    alert(e.message||String(e));
  }finally{
    setDataLoading(false);
  }
}

function accountKey(x){return [String(x.source||'').toUpperCase(),String(x.account||''),String(x.server||'')].join('|')}
function buildDetectedAccounts(events){
  const map={};
  events.forEach(e=>{
    const key=accountKey(e);
    if(!map[key])map[key]={key,source:String(e.source||'').toUpperCase(),account:String(e.account||''),server:String(e.server||''),raw:0,last:null};
    const a=map[key];a.raw++;const ts=e.received_at||e.event_time||e.close_time;if(ts&&(!a.last||new Date(ts)>new Date(a.last)))a.last=ts;
  });
  const settingsMap={};accountSettings.forEach(s=>settingsMap[[String(s.source||'').toUpperCase(),String(s.account||''),String(s.server||'')].join('|')]=s);
  detectedAccounts=Object.values(map).map(a=>Object.assign(a,settingsMap[a.key]||{})).sort((a,b)=>(a.label||a.account).localeCompare(b.label||b.account));
  const select=el('accountScope'),staticScope=el('accountScopeStatic');
  select.innerHTML='<option value="all">All accounts</option>'+detectedAccounts.map(a=>'<option value="'+esc(a.key)+'">'+esc(a.label||((a.source?a.source+' · ':'')+a.account+(a.server?' · '+a.server:'')))+'</option>').join('');
  if(selectedAccountKey!=='all'&&!detectedAccounts.some(a=>a.key===selectedAccountKey))selectedAccountKey='all';
  select.value=selectedAccountKey;
  if(detectedAccounts.length<=1){
    const a=detectedAccounts[0];
    staticScope.textContent=a?(a.label||((a.source?a.source+' · ':'')+a.account)):'No account connected';
    staticScope.classList.remove('hide');
    select.classList.add('hide');
  }else{
    staticScope.classList.add('hide');
    select.classList.remove('hide');
  }
}
function syncContextualTradeFilters(){
  const sides=[...new Set(scopedTrades.map(t=>String(t.side||'').toUpperCase()).filter(Boolean))];
  const sources=[...new Set(scopedTrades.map(t=>String(t.source||'').toUpperCase()).filter(Boolean))].sort();
  const outcomes=[...new Set(scopedTrades.map(strategyOutcome))];
  const ghostStates=[...new Set(scopedTrades.map(t=>t.excluded_from_stats?'ghost':'counted'))];

  const side=el('sideFilter'),sideWrap=el('sideFilterWrap');
  if(sides.length<=1){side.value='';sideWrap.classList.add('hide')}
  else{sideWrap.classList.remove('hide')}

  const source=el('sourceFilter'),sourceWrap=el('sourceFilterWrap');
  if(sources.length<=1){
    source.value='';
    source.innerHTML=sources.length?'<option value="">'+esc(sources[0])+'</option>':'';
    sourceWrap.classList.add('hide');
  }else{
    const current=source.value;
    source.innerHTML='<option value="">'+esc(sources.join(' + '))+'</option>'+sources.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
    source.value=sources.includes(current)?current:'';
    sourceWrap.classList.remove('hide');
  }

  const result=el('resultFilter'),resultWrap=el('resultFilterWrap');
  if(outcomes.length<=1){result.value='';resultWrap.classList.add('hide')}
  else resultWrap.classList.remove('hide');

  const ghost=el('ghostFilter'),ghostWrap=el('ghostFilterWrap');
  if(ghostStates.length<=1){ghost.value='';ghostWrap.classList.add('hide')}
  else ghostWrap.classList.remove('hide');
}

function applyFilters(){
  let trades=selectedAccountKey==='all'?allTrades:allTrades.filter(t=>accountKey(t)===selectedAccountKey);
  let events=selectedAccountKey==='all'?rawEvents:rawEvents.filter(e=>accountKey(e)===selectedAccountKey);
  if(dateRange.mode!=='all'){
    trades=trades.filter(t=>{
      const k=tradeDayKey(t);
      return k>=dateRange.start && k<=dateRange.end;
    });
    events=events.filter(e=>{
      const k=eventDayKey(e);
      if(!k)return false;
      return k>=dateRange.start && k<=dateRange.end;
    });
  }
  scopedTrades=trades;
  scopedRawEvents=events;
  syncContextualTradeFilters();
  model=buildModel(trades.filter(t=>!t.excluded_from_stats));
  renderPeriodFilter();
  renderAll();
  renderHealth();
}
el('accountScope').onchange=()=>{selectedAccountKey=el('accountScope').value;applyFilters()};

function renderPeriodFilter(){
  el('periodLabel').textContent=dateRange.mode==='all'?'All time':rangeLabel(dateRange);
  el('periodSummary').textContent=dateRange.mode==='all'?'Вся история':(dateRange.label+' · '+rangeLabel(dateRange));
  el('clearPeriodBtn').classList.toggle('hide',dateRange.mode==='all');
}
function monthStart(d){return new Date(d.getFullYear(),d.getMonth(),1)}
function addMonths(d,n){return new Date(d.getFullYear(),d.getMonth()+n,1)}
function normalizedDraft(){
  if(!rangeDraft.start||!rangeDraft.end)return rangeDraft;
  return rangeDraft.start<=rangeDraft.end?rangeDraft:{...rangeDraft,start:rangeDraft.end,end:rangeDraft.start};
}
function openRangeModal(){
  if(dateRange.mode==='all'){
    const today=dayKey(new Date());
    rangeDraft={mode:'custom',start:today,end:today,label:'Свой период'};
    rangeViewMonth=monthStart(new Date());
  }else{
    rangeDraft={...dateRange};
    rangeViewMonth=monthStart(dateFromKey(dateRange.start));
  }
  stopRangeDrag();
  renderRangePicker();
  el('rangeModal').classList.remove('hide');
}
function closeRangeModal(){stopRangeDrag();el('rangeModal').classList.add('hide')}
function setRange(r){
  dateRange=r;
  persistRange();
  if(dateRange.mode!=='all'&&dateRange.start)monthDate=new Date(dateFromKey(dateRange.start).getFullYear(),dateFromKey(dateRange.start).getMonth(),1);
  else monthDate=null;
  closeRangeModal();
  applyFilters();
}
function rangeMonthHtml(d){
  const y=d.getFullYear(),m=d.getMonth(),first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
  const mondayFirst=(first+6)%7;
  const names=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const r=normalizedDraft(),today=dayKey(new Date());
  let html='<div class="rangeMonth"><div class="rangeMonthTitle">'+d.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})+'</div><div class="rangeWeek">'+names.map(x=>'<span>'+x+'</span>').join('')+'</div><div class="rangeDays">';
  for(let i=0;i<mondayFirst;i++)html+='<button type="button" class="rangeDay blank" tabindex="-1"></button>';
  for(let day=1;day<=days;day++){
    const key=y+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    const inRange=r.start&&r.end&&key>=r.start&&key<=r.end;
    const edge=inRange&&(key===r.start||key===r.end);
    html+='<button type="button" class="rangeDay'+(inRange?' inRange':'')+(edge?' edge':'')+(key===today?' today':'')+'" data-range-day="'+key+'">'+day+'</button>';
  }
  html+='</div></div>';
  return html;
}
function renderRangePicker(){
  if(!rangeViewMonth)rangeViewMonth=monthStart(new Date());
  el('rangeMonths').innerHTML=rangeMonthHtml(rangeViewMonth)+rangeMonthHtml(addMonths(rangeViewMonth,1));
  const r=normalizedDraft();
  if(r.mode==='all'){
    el('rangePreview').textContent='Всё время';
  }else if(r.start&&r.end){
    const days=Math.round((dateFromKey(r.end)-dateFromKey(r.start))/86400000)+1;
    el('rangePreview').textContent=rangeLabel(r)+' · '+days+' дн.';
  }else{
    el('rangePreview').textContent='Выбери период';
  }
  document.querySelectorAll('[data-range-preset]').forEach(b=>b.classList.toggle('on',b.dataset.rangePreset===rangeDraft.mode));
  setupRangeDragHandlers();
}

function rangeDayAtPoint(x,y){
  const hit=document.elementFromPoint(x,y);
  const day=hit&&hit.closest?hit.closest('[data-range-day]'):null;
  return day&&el('rangeMonths').contains(day)?day.dataset.rangeDay:null;
}
function updateRangeDragTo(key){
  if(!rangeDrag.active||!rangeDrag.anchor||!key||key===rangeDrag.last)return;
  rangeDrag.last=key;
  const a=rangeDrag.anchor;
  rangeDraft={mode:'custom',start:a<=key?a:key,end:a<=key?key:a,label:'Свой период'};
  renderRangePicker();
}
function stopRangeDrag(e){
  const box=el('rangeMonths');
  if(e&&rangeDrag.active&&e.pointerId===rangeDrag.pointerId){
    const finalKey=rangeDayAtPoint(e.clientX,e.clientY);
    if(finalKey)updateRangeDragTo(finalKey);
  }
  if(box&&rangeDrag.pointerId!==null&&box.hasPointerCapture&&box.hasPointerCapture(rangeDrag.pointerId)){
    try{box.releasePointerCapture(rangeDrag.pointerId)}catch(_e){}
  }
  rangeDrag={active:false,pointerId:null,anchor:null,last:null};
}
function setupRangeDragHandlers(){
  const box=el('rangeMonths');
  if(!box||box.dataset.dragBound==='1')return;
  box.dataset.dragBound='1';

  box.addEventListener('pointerdown',e=>{
    const day=e.target.closest&&e.target.closest('[data-range-day]');
    if(!day||!box.contains(day))return;
    if(e.pointerType==='mouse'&&e.button!==0)return;

    e.preventDefault();
    const key=day.dataset.rangeDay;
    rangeDrag={active:true,pointerId:e.pointerId,anchor:key,last:key};
    rangeDraft={mode:'custom',start:key,end:key,label:'Свой период'};

    try{box.setPointerCapture(e.pointerId)}catch(_e){}
    renderRangePicker();
  });

  box.addEventListener('pointermove',e=>{
    if(!rangeDrag.active||e.pointerId!==rangeDrag.pointerId)return;

    // Critical: range may extend ONLY while the primary button/contact is held.
    if(e.pointerType==='mouse'&&(e.buttons&1)!==1){
      stopRangeDrag(e);
      return;
    }

    const key=rangeDayAtPoint(e.clientX,e.clientY);
    if(key)updateRangeDragTo(key);
  });

  box.addEventListener('pointerup',e=>{
    if(rangeDrag.active&&e.pointerId===rangeDrag.pointerId)stopRangeDrag(e);
  });
  box.addEventListener('pointercancel',e=>{
    if(rangeDrag.active&&e.pointerId===rangeDrag.pointerId)stopRangeDrag();
  });
  box.addEventListener('lostpointercapture',()=>{
    if(rangeDrag.active)rangeDrag={active:false,pointerId:null,anchor:null,last:null};
  });

  window.addEventListener('blur',()=>stopRangeDrag());
}
el('periodBtn').onclick=openRangeModal;
el('clearPeriodBtn').onclick=()=>setRange(makePresetRange('all'));
el('closeRangeModal').onclick=closeRangeModal;
el('cancelRangeBtn').onclick=closeRangeModal;
el('rangePrevMonth').onclick=()=>{rangeViewMonth=addMonths(rangeViewMonth,-1);renderRangePicker()};
el('rangeNextMonth').onclick=()=>{rangeViewMonth=addMonths(rangeViewMonth,1);renderRangePicker()};
el('applyCustomRangeBtn').onclick=()=>{
  const r=normalizedDraft();
  if(r.mode==='all')return setRange(makePresetRange('all'));
  if(!r.start||!r.end)return alert('Выбери период.');
  setRange({...r,label:r.mode==='custom'?'Свой период':r.label});
};
document.querySelectorAll('[data-range-preset]').forEach(b=>b.onclick=()=>{
  const mode=b.dataset.rangePreset;
  if(mode==='custom'){
    rangeDraft={...normalizedDraft(),mode:'custom',label:'Свой период'};
    renderRangePicker();
    return;
  }
  const preset=makePresetRange(mode);
  rangeDraft={...preset};
  if(preset.start)rangeViewMonth=monthStart(dateFromKey(preset.start));
  renderRangePicker();
});

function renderAccounts(){
  el('accountList').innerHTML=detectedAccounts.length?detectedAccounts.map((a,i)=>
    '<div class="accountRow">'+
      '<div class="memberMeta"><b>'+esc(a.label||a.account)+'</b><span class="badge">'+esc(a.source)+'</span><div class="sub">'+esc(a.account)+(a.server?' · '+esc(a.server):'')+' · '+a.raw+' raw events</div></div>'+
      '<label class="accountEdit"><span class="accountEditLabel">Account name</span><input class="input" id="accountLabel_'+i+'" value="'+esc(a.label||'')+'" placeholder="Main MT4"></label>'+
      '<label class="accountEdit"><span class="accountEditLabel">Starting balance</span><input class="input" id="accountBalance_'+i+'" type="number" min="0" step="0.01" inputmode="decimal" value="'+(a.starting_balance==null?'':esc(a.starting_balance))+'" placeholder="10000"></label>'+
      '<button class="btn" data-account-index="'+i+'">Save</button>'+
    '</div>'
  ).join(''):'<div class="empty">Подключённых счетов пока нет.</div>';
  document.querySelectorAll('[data-account-index]').forEach(b=>b.onclick=()=>saveAccountLabel(Number(b.dataset.accountIndex)));
}
async function saveAccountLabel(i){
  const a=detectedAccounts[i];if(!a)return;
  const balanceRaw=el('accountBalance_'+i).value.trim();
  const startingBalance=balanceRaw===''?null:Number(balanceRaw);
  if(startingBalance!==null&&(!Number.isFinite(startingBalance)||startingBalance<0)){
    el('accountBalance_'+i).focus();
    return alert('Starting balance must be 0 or higher.');
  }
  const user=(await sb.auth.getUser()).data.user;
  const row={
    user_id:user.id,
    source:a.source,
    account:a.account,
    server:a.server||'',
    label:el('accountLabel_'+i).value.trim()||null,
    starting_balance:startingBalance,
    enabled:true,
    updated_at:new Date().toISOString()
  };
  const {error}=await sb.from('account_settings').upsert(row,{onConflict:'user_id,source,account,server'});
  if(error)return alert(error.message);
  await loadData();
}

async function loadMembers(){
  if(!canManageAccess())return;
  const {data,error}=await sb.from('app_members').select('*').order('created_at',{ascending:true});
  if(error){el('memberList').innerHTML='<div class="red">'+esc(error.message)+'</div>';return;}
  memberRows=data||[];renderMembers();
}
function renderMembers(){
  const ownerView=membership?.role==='owner';
  el('memberList').innerHTML=memberRows.map((m,i)=>{
    const isOwner=m.role==='owner';
    const adminCanManage=membership?.role==='admin'&&m.role==='member';
    const canManage=(ownerView&&!isOwner)||adminCanManage;

    let roleUi='';
    if(isOwner){
      roleUi='<span class="memberRolePill">Owner</span>';
    }else if(ownerView){
      roleUi='<div class="memberRoleWrap"><select class="select memberRoleSelect" data-role-index="'+i+'" aria-label="Role for '+esc(m.email||'user')+'"><option value="member" '+(m.role==='member'?'selected':'')+'>Member</option><option value="admin" '+(m.role==='admin'?'selected':'')+'>Admin</option></select></div>';
    }else{
      roleUi='<span class="memberRolePill">'+esc(m.role==='admin'?'Admin':'Member')+'</span>';
    }

    let actionUi='';
    if(isOwner){
      actionUi='<span class="memberActionPlaceholder">Protected</span>';
    }else if(m.approved&&canManage){
      actionUi='<button class="btn danger" data-revoke-index="'+i+'">Revoke</button>';
    }else if(!m.approved&&canManage){
      actionUi='<div class="memberActions"><button class="btn primary" data-approve-index="'+i+'">Approve</button><button class="btn danger" data-decline-index="'+i+'">Decline</button></div>';
    }else if(m.role==='admin'){
      actionUi='<span class="memberActionPlaceholder">Owner only</span>';
    }

    return '<div class="memberRow">'+
      '<div class="memberMeta"><b>'+esc(m.email||'No email')+'</b><div class="sub">'+(m.approved?'Approved account':'Waiting approval')+'</div></div>'+
      '<div class="memberRoleCell">'+roleUi+'</div>'+
      '<div class="memberAccessCell"><span class="memberAccessState '+(m.approved?'green':'amber')+'">'+(m.approved?'Active':'Pending')+'</span><span class="memberAccessHint">'+(m.approved?'Access on':'No journal access')+'</span></div>'+
      '<div class="memberActionCell">'+actionUi+'</div>'+
    '</div>';
  }).join('');

  document.querySelectorAll('[data-role-index]').forEach(s=>s.onchange=()=>setMemberRole(Number(s.dataset.roleIndex),s.value));
  document.querySelectorAll('[data-approve-index]').forEach(b=>b.onclick=()=>approveMember(Number(b.dataset.approveIndex)));
  document.querySelectorAll('[data-revoke-index]').forEach(b=>b.onclick=()=>revokeMember(Number(b.dataset.revokeIndex)));
  document.querySelectorAll('[data-decline-index]').forEach(b=>b.onclick=()=>openDecline(Number(b.dataset.declineIndex)));
}

async function setMemberRole(i,role){
  const m=memberRows[i];
  if(membership?.role!=='owner'||!m||m.role==='owner'||!['admin','member'].includes(role))return;
  const oldRole=m.role;
  if(oldRole===role)return;
  const label=role==='admin'?'Admin':'Member';
  if(!confirm('Выдать роль '+label+' для '+m.email+'?')){renderMembers();return}
  const {error}=await sb.rpc('set_member_role',{p_user_id:m.user_id,p_role:role});
  if(error){alert(error.message);return loadMembers()}
  await loadMembers();
}
async function approveMember(i){
  const m=memberRows[i];if(!m||m.role==='owner'||m.approved)return;
  if(membership?.role==='admin'&&m.role!=='member')return alert('Admin может одобрять только Members.');
  const {error}=await sb.rpc('approve_member',{p_user_id:m.user_id,p_approved:true});
  if(error)return alert(error.message);
  await loadMembers();
}
async function revokeMember(i){
  const m=memberRows[i];if(!m||m.role==='owner'||!m.approved)return;
  if(membership?.role==='admin'&&m.role!=='member')return alert('Admin может отзывать доступ только у Members.');
  if(!confirm('Отключить доступ для '+m.email+'? Его аккаунт останется, но журнал и token будут недоступны.'))return;
  const {error}=await sb.rpc('approve_member',{p_user_id:m.user_id,p_approved:false});
  if(error)return alert(error.message);
  await loadMembers();
}
function openDecline(i){
  const m=memberRows[i];if(!m||m.role==='owner'||m.approved)return;
  if(membership?.role==='admin'&&m.role!=='member')return alert('Admin может отклонять только Members.');
  declineTarget=m;
  el('declineEmail').textContent=m.email||'No email';
  el('declineModal').classList.remove('hide');
}
function closeDecline(){
  el('declineModal').classList.add('hide');
  declineTarget=null;
}
async function declineMember(mode){
  if(!declineTarget)return;
  const email=declineTarget.email||'этот email';
  const text=mode==='block_5m'
    ? 'Удалить заявку '+email+' и заблокировать новые заявки от этого email на 5 минут?'
    : 'Полностью удалить pending-заявку '+email+'? Повторная регистрация будет доступна сразу.';
  if(!confirm(text))return;

  const {error}=await sb.rpc('decline_member',{p_user_id:declineTarget.user_id,p_mode:mode});
  if(error)return alert(error.message);
  closeDecline();
  await loadMembers();
}

function eventEligible(e){
  const src=String(e.source||'').toUpperCase();
  if(src==='MT4')return !!(e.symbol&&e.side&&e.open_time&&e.close_time);
  if(src==='MT5')return !!(e.symbol&&e.side&&Number(e.volume));
  return false;
}
function renderHealth(){
  const healthTrades=selectedAccountKey==='all'?allTrades:allTrades.filter(t=>accountKey(t)===selectedAccountKey);
  const healthEvents=selectedAccountKey==='all'?rawEvents:rawEvents.filter(e=>accountKey(e)===selectedAccountKey);
  const eligible=healthEvents.filter(eventEligible);
  const rawNet=eligible.reduce((z,e)=>z+Number(e.profit||0)+Number(e.commission||0)+Number(e.swap||0)+Number(e.fee||0),0);
  const logicalNet=healthTrades.reduce((z,t)=>z+Number(t.pnl||0),0);
  const counts={};healthTrades.forEach(t=>(t.events||[]).forEach(id=>{const k=accountKey(t)+'|'+String(id);counts[k]=(counts[k]||0)+1}));
  const orphan=eligible.filter(e=>!counts[accountKey(e)+'|'+String(e.event_id||e.order_id)]).length;
  const dup=Object.values(counts).filter(n=>n>1).length;
  const diff=Math.round((rawNet-logicalNet)*100)/100;
  const ok=Math.abs(diff)<0.01&&orphan===0&&dup===0;
  const status=el('healthStatus');
  status.classList.toggle('warn',!ok);
  status.innerHTML='<span class="healthDot"></span><span>'+(ok?'PASS':'CHECK')+'</span>';
  el('healthGrid').innerHTML=[
    ['Raw ↔ Logical',Math.abs(diff)<0.01?'Matched':'Δ '+money(diff)],
    ['Eligible events',String(eligible.length)],
    ['Unassigned',String(orphan)],
    ['Duplicate assignment',String(dup)]
  ].map(x=>'<div class="healthCell"><div class="metricLabel">'+esc(x[0])+'</div><b>'+esc(x[1])+'</b></div>').join('');
  el('groupingVersion').textContent='Grouping v'+GROUPING_VERSION+' · '+GROUPING_RULE;
}

function setDirectFormEnabled(enabled){
  ['directPlatform','directLogin','directServer','directInvestorPassword','directConnectBtn'].forEach(id=>{
    const node=el(id);if(node)node.disabled=!enabled;
  });
  if(!enabled&&el('directInvestorPassword'))el('directInvestorPassword').value='';
}
function setDirectCollectorUi(state,message){
  const badge=el('directCollectorState');
  if(!badge)return;
  badge.className='directReady'+(state?' '+state:'');
  badge.textContent=state==='ready'?'Ready':state==='wait'?'Not provisioned':state==='error'?'Unavailable':'Checking…';
  el('directCollectorMsg').textContent=message||'';
}
async function edgePost(name,body){
  const {data}=await sb.auth.getSession();
  const session=data?.session;
  if(!session)throw Object.assign(new Error('Session expired.'),{code:'unauthorized',status:401});
  const response=await fetch(SUPABASE_URL+'/functions/v1/'+name,{
    method:'POST',
    cache:'no-store',
    headers:{
      apikey:SUPABASE_KEY,
      Authorization:'Bearer '+session.access_token,
      'Content-Type':'application/json'
    },
    body:JSON.stringify(body||{})
  });
  let payload={};
  try{payload=await response.json()}catch(_e){}
  if(!response.ok){
    const error=Object.assign(new Error(String(payload?.error||('HTTP '+response.status))),{
      code:String(payload?.error||'edge_error'),
      status:response.status
    });
    throw error;
  }
  return payload;
}
async function ensureDirectCollectorReady(force=false){
  if(directCollectorKey&&!force){setDirectFormEnabled(true);setDirectCollectorUi('ready','Direct collector готов. Используй только Investor Password.');return directCollectorKey}
  if(directCollectorCheckPromise&&!force)return directCollectorCheckPromise;
  directCollectorKey=null;
  setDirectFormEnabled(false);
  setDirectCollectorUi('','Проверяю доступность direct collector…');
  directCollectorCheckPromise=(async()=>{
    try{
      const data=await edgePost('broker-key',{});
      if(data?.algorithm!=='RSA-OAEP-SHA256'||!data?.key_id||!String(data?.public_key_pem||'').includes('BEGIN PUBLIC KEY'))throw Object.assign(new Error('Invalid collector key response.'),{code:'invalid_collector_key'});
      directCollectorKey={key_id:String(data.key_id),algorithm:String(data.algorithm),public_key_pem:String(data.public_key_pem)};
      setDirectFormEnabled(true);
      setDirectCollectorUi('ready','Direct collector готов. Пароль шифруется до отправки.');
      return directCollectorKey;
    }catch(error){
      directCollectorKey=null;
      setDirectFormEnabled(false);
      if(error?.status===503||error?.code==='collector_not_ready'){
        setDirectCollectorUi('wait','Direct collector ещё не provisioned. Пока используй Manual Connector ниже.');
      }else{
        setDirectCollectorUi('error','Direct collector временно недоступен. Manual Connector ниже продолжает работать.');
      }
      return null;
    }finally{
      directCollectorCheckPromise=null;
    }
  })();
  return directCollectorCheckPromise;
}
function directStateLabel(state){
  const value=String(state||'').toUpperCase();
  return ({PENDING_VALIDATION:'Pending validation',VALIDATING:'Validating',CONNECTED:'Connected',DEGRADED:'Degraded',ERROR:'Error',DISCONNECTED:'Disconnected'})[value]||value||'Unknown';
}
function renderDirectConnections(){
  const host=el('directConnectionList');if(!host)return;
  const rows=(brokerConnections||[]).filter(row=>row.enabled!==false&&String(row.state||'').toUpperCase()!=='DISCONNECTED');
  if(!rows.length){host.innerHTML='<div class="hint directFallbackNote">Direct connections появятся здесь после успешного подключения.</div>';return}
  host.innerHTML=rows.map(row=>{
    const state=String(row.state||'').toLowerCase();
    const seen=row.last_sync_at?('Last sync · '+new Date(row.last_sync_at).toLocaleString()):(row.last_error_at?('Last error · '+new Date(row.last_error_at).toLocaleString()):'Waiting for collector');
    const err=row.last_error_code?(' · '+String(row.last_error_code)):'';
    return '<div class="directConnectionRow"><div class="directConnectionMeta"><b>'+esc(String(row.platform||'')+' · '+String(row.login||'')+' · '+String(row.server||''))+'</b><span>'+esc(seen+err)+'</span></div><div class="directConnectionState '+esc(state)+'">'+esc(directStateLabel(row.state))+'</div><button class="btn" type="button" data-direct-disconnect="'+esc(row.id)+'">Disconnect</button></div>';
  }).join('');
  host.querySelectorAll('[data-direct-disconnect]').forEach(btn=>btn.onclick=()=>disconnectDirectConnection(btn.dataset.directDisconnect,btn));
}
async function refreshDirectConnections(){
  brokerConnections=await fetchAll('broker_connections');
  renderDirectConnections();
}
function pemToSpkiBytes(pem){
  const body=String(pem||'').replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g,'');
  const binary=atob(body),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function bytesToBase64(buffer){
  const bytes=new Uint8Array(buffer);let binary='';
  for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function encryptInvestorPassword(secret,pem){
  const plaintext=new TextEncoder().encode(secret);
  try{
    if(!plaintext.length)throw new Error('Investor Password is required.');
    if(plaintext.length>256)throw new Error('Investor Password is too long.');
    const publicKey=await crypto.subtle.importKey('spki',pemToSpkiBytes(pem),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const ciphertext=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,plaintext);
    if(ciphertext.byteLength!==384)throw new Error('Unexpected collector ciphertext length.');
    return bytesToBase64(ciphertext);
  }finally{
    plaintext.fill(0);
  }
}
async function disconnectDirectConnection(connectionId,button){
  if(!connectionId)return;
  if(!confirm('Disconnect this broker account? The encrypted Investor Password will be deleted.'))return;
  await withBusyButton(button,'Disconnecting…',async()=>{
    try{
      await edgePost('broker-disconnect',{connection_id:connectionId});
      await refreshDirectConnections();
      el('directConnectMsg').textContent='Direct connection отключён. Encrypted credential удалён.';
    }catch(error){
      el('directConnectMsg').textContent='Disconnect failed: '+String(error?.code||error?.message||'unknown_error');
    }
  });
}
el('directConnectForm').onsubmit=async event=>{
  event.preventDefault();
  const button=el('directConnectBtn');
  await withBusyButton(button,'Connecting…',async()=>{
    const platform=el('directPlatform').value;
    const login=el('directLogin').value.trim();
    const server=el('directServer').value.trim();
    const passwordInput=el('directInvestorPassword');
    let secret=passwordInput.value;
    passwordInput.value='';
    el('directConnectMsg').textContent='';
    try{
      if(!/^[0-9]+$/.test(login)){el('directLogin').focus();throw new Error('Login должен содержать только цифры.')}
      if(!server||/[\r\n]/.test(server)){el('directServer').focus();throw new Error('Укажи точное имя broker server.')}
      const key=directCollectorKey||await ensureDirectCollectorReady(true);
      if(!key)throw new Error('Direct collector ещё не готов. Используй Manual Connector.');
      const ciphertext=await encryptInvestorPassword(secret,key.public_key_pem);
      const result=await edgePost('broker-connect',{
        platform,
        login,
        server,
        key_id:key.key_id,
        ciphertext_base64:ciphertext
      });
      el('directLogin').value='';
      el('directServer').value='';
      el('directConnectMsg').textContent='Connection queued · '+String(result.state||'PENDING_VALIDATION')+'. Collector проверит Investor Password.';
      await refreshDirectConnections();
    }catch(error){
      if(error?.code==='collector_key_stale'){
        directCollectorKey=null;
        await ensureDirectCollectorReady(true);
        el('directConnectMsg').textContent='Collector key обновился. Введи Investor Password ещё раз.';
      }else{
        el('directConnectMsg').textContent=String(error?.message||'Direct connection failed.');
      }
    }finally{
      secret='';
      passwordInput.value='';
    }
  });
};

function renderConnectorStatus(){
  const rows=detectedAccounts.filter(a=>a.source==='MT4');
  if(!rows.length){el('connectorStatusList').innerHTML='';return}
  const statusMap={};
  connectorStatuses.forEach(s=>statusMap[accountKey(s)]=s);
  el('connectorStatusList').innerHTML=rows.map(a=>{
    const s=statusMap[a.key],version=s?.version||'';
    const current=version===LATEST_MT4_CONNECTOR;
    const state=current?'Current':version?'Update available':'Install v'+LATEST_MT4_CONNECTOR;
    const cls=current?'current':version?'update':'unknown';
    const seen=s?.last_seen?new Date(s.last_seen).toLocaleString():'No live version report yet';
    return '<div class="connectorStatusRow"><div class="connectorStatusMeta"><b>'+esc(a.label||a.account)+' · MT4 '+(version?'v'+version:'version unknown')+'</b><span>'+esc(seen)+'</span></div><span class="connectorState '+cls+'">'+esc(state)+'</span></div>';
  }).join('');
}
function csvCell(v){
  const s=String(v==null?'':v);
  return '"'+s.replace(/"/g,'""')+'"';
}
function downloadText(name,textContent,type){
  const blob=new Blob([textContent],{type:type||'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function rowsToCsv(rows,columns){
  const head=columns.map(c=>csvCell(c.label)).join(',');
  const body=rows.map(r=>columns.map(c=>csvCell(typeof c.get==='function'?c.get(r):r[c.key])).join(',')).join('\n');
  return '\uFEFF'+head+(body?'\n'+body:'');
}
function exportData(kind){
  const stamp=dayKey(new Date());
  const tradeIds=new Set(scopedTrades.map(t=>t.id));
  if(kind==='trades'){
    const cols=[
      {label:'Trade ID',key:'id'},{label:'Source',key:'source'},{label:'Account',key:'account'},{label:'Server',key:'server'},{label:'Symbol',key:'symbol'},{label:'Side',key:'side'},
      {label:'Opened',key:'openedAt'},{label:'Closed',key:'closedAt'},{label:'Net P&L',key:'pnl'},{label:'Orders',key:'orderCount'},{label:'Strategy result',get:r=>strategyOutcome(r).toUpperCase()},{label:'Strategy',key:'strategy'},
      {label:'Setup',key:'setup'},{label:'Tier / Model',key:'tier'},{label:'Probability',key:'probability'},{label:'CR',key:'cr_value'},{label:'Plan followed',key:'plan_ok'},
      {label:'Mistake',key:'mistake'},{label:'Ghost',get:r=>r.excluded_from_stats?'YES':'NO'},{label:'Ghost reason',key:'exclusion_reason'},{label:'Notes',key:'notes'},
      {label:'Grouping version',get:()=>GROUPING_VERSION}
    ];
    downloadText('logical_trades_'+stamp+'.csv',rowsToCsv(scopedTrades,cols),'text/csv;charset=utf-8');return;
  }
  if(kind==='raw'){
    const rows=scopedRawEvents;
    const keys=['source','account','server','event_id','order_id','position_id','event_time','open_time','close_time','symbol','side','entry_type','volume','price','open_price','close_price','profit','commission','swap','fee','magic','comment'];
    downloadText('raw_mt_events_'+stamp+'.csv',rowsToCsv(rows,keys.map(k=>({label:k,key:k}))),'text/csv;charset=utf-8');return;
  }
  if(kind==='notes'){
    const rows=tradeNotes.filter(n=>tradeIds.has(n.trade_id));
    const keys=['trade_id','setup','tier','probability','cr_value','plan_ok','mistake','excluded_from_stats','exclusion_reason','notes','updated_at'];
    downloadText('trade_reviews_'+stamp+'.csv',rowsToCsv(rows,keys.map(k=>({label:k,key:k}))),'text/csv;charset=utf-8');return;
  }
  if(kind==='daily'){
    const rows=dailyReviewRows.filter(r=>dateRange.mode==='all'||(r.review_date>=dateRange.start&&r.review_date<=dateRange.end));
    const keys=['review_date','what_worked','what_wrong','tomorrow_focus','notes','updated_at'];
    downloadText('daily_reviews_'+stamp+'.csv',rowsToCsv(rows,keys.map(k=>({label:k,key:k}))),'text/csv;charset=utf-8');return;
  }
  if(kind==='backup'){
    const payload={exported_at:new Date().toISOString(),grouping:{version:GROUPING_VERSION,rule:GROUPING_RULE},raw_events:rawEvents,logical_trades:allTrades,trade_reviews:tradeNotes,daily_reviews:dailyReviewRows,account_settings:accountSettings};
    downloadText('trading_journal_backup_'+stamp+'.json',JSON.stringify(payload,null,2),'application/json;charset=utf-8');
  }
}
function openExport(){el('exportModal').classList.remove('hide')}
function closeExport(){el('exportModal').classList.add('hide')}

function renderAll(){
  const s=model.summary;
  const singleDay=dateRange.mode!=='all'&&dateRange.start&&dateRange.start===dateRange.end;

  el('mPnl').textContent=money(s.pnl);paint(el('mPnl'),s.pnl);
  const brokerPnl=scopedTrades.reduce((z,t)=>z+Number(t.pnl||0),0);
  const ghostPnl=scopedTrades.filter(t=>t.excluded_from_stats).reduce((z,t)=>z+Number(t.pnl||0),0);
  el('pnlBridge').innerHTML=Math.abs(ghostPnl)>=0.005
    ? 'Broker <b>'+money(brokerPnl)+'</b> · Ghost <b>'+money(ghostPnl)+'</b> excluded'
    : '';
  el('mWr').textContent=s.wr.toFixed(1)+'%';
  el('mTrades').textContent=s.trades;
  el('mStreak').textContent=s.streak;
  el('mPf').textContent=s.pf===Infinity?'∞':Number(s.pf).toFixed(2);
  el('mDd').textContent=money(s.dd);paint(el('mDd'),s.dd);
  el('avgWinLoss').innerHTML='<span>Avg Win <b class="green">'+money(s.avgWin)+'</b></span><span>Avg Loss <b class="red">'+money(s.avgLoss)+'</b></span>';

  if(singleDay){
    el('lblDays').textContent='Wins / Losses';
    el('mDays').textContent=s.wins+'W / '+s.losses+'L';
    el('lblBest').textContent='Best Trade';
    el('lblWorst').textContent='Worst Trade';
    el('lblAvg').textContent='Avg / Trade';
    [['mBest',s.bestTrade],['mWorst',s.worstTrade],['mAvg',s.avgTrade]].forEach(([id,n])=>{el(id).textContent=money(n);paint(el(id),n)});
  }else{
    el('lblDays').textContent='Trading Days';
    el('mDays').textContent=s.days;
    el('lblBest').textContent='Best Day';
    el('lblWorst').textContent='Worst Day';
    el('lblAvg').textContent='Avg / Day';
    [['mBest',s.best],['mWorst',s.worst],['mAvg',s.avg]].forEach(([id,n])=>{el(id).textContent=money(n);paint(el(id),n)});
  }

  renderEquity();renderWeekday();renderMistakes();renderSymbols();renderTrades();
  if(!monthDate){const d=model.daily.length?new Date(model.daily[model.daily.length-1].date+'T12:00:00'):new Date();monthDate=new Date(d.getFullYear(),d.getMonth(),1)}
  renderCalendar();
}
function isCashFlowEvent(e){
  const type=String(e.entry_type||'').toUpperCase();
  return type==='BALANCE'||type==='CREDIT';
}
function cashFlowAmount(e){
  return Number(e.profit||0)+Number(e.commission||0)+Number(e.swap||0)+Number(e.fee||0);
}
function cashFlowTime(e){
  return e.event_time||e.open_time||e.close_time||e.received_at||null;
}
function equityScopeContext(){
  const accounts=selectedAccountKey==='all'
    ? detectedAccounts
    : detectedAccounts.filter(a=>a.key===selectedAccountKey);
  const accountKeys=new Set(accounts.map(a=>a.key));

  const configured=accounts.length>0&&accounts.every(a=>
    a.starting_balance!==null&&a.starting_balance!==undefined&&a.starting_balance!==''
  );
  const startingBalance=accounts.reduce((sum,a)=>sum+Number(a.starting_balance||0),0);

  let historyTrades=selectedAccountKey==='all'
    ? allTrades
    : allTrades.filter(t=>accountKey(t)===selectedAccountKey);
  historyTrades=historyTrades.filter(t=>!t.excluded_from_stats);

  const firstTradeByAccount={};
  allTrades.forEach(t=>{
    const key=accountKey(t);
    if(!accountKeys.has(key))return;
    const ts=new Date(t.openedAt||t.closedAt).getTime();
    if(!Number.isFinite(ts))return;
    if(firstTradeByAccount[key]==null||ts<firstTradeByAccount[key])firstTradeByAccount[key]=ts;
  });

  const cashFlows=rawEvents.filter(e=>{
    const key=accountKey(e),ts=cashFlowTime(e);
    if(!accountKeys.has(key)||!isCashFlowEvent(e)||!ts)return false;
    const ms=new Date(ts).getTime(),first=firstTradeByAccount[key];
    return first!=null&&ms>first;
  }).map(e=>({kind:'cash',time:cashFlowTime(e),amount:cashFlowAmount(e),event:e}));

  let priorPnl=0,priorCash=0,periodCashFlows=cashFlows;
  if(dateRange.mode!=='all'&&dateRange.start){
    priorPnl=historyTrades
      .filter(t=>tradeDayKey(t)<dateRange.start)
      .reduce((sum,t)=>sum+Number(t.pnl||0),0);
    priorCash=cashFlows
      .filter(x=>String(x.event?.source||'').toUpperCase()==='MT4'?utcDayKey(new Date(x.time))<dateRange.start:dayKey(new Date(x.time))<dateRange.start)
      .reduce((sum,x)=>sum+Number(x.amount||0),0);
    periodCashFlows=cashFlows.filter(x=>{
      const k=String(x.event?.source||'').toUpperCase()==='MT4'?utcDayKey(new Date(x.time)):dayKey(new Date(x.time));
      return k>=dateRange.start&&k<=dateRange.end;
    });
  }
  return {base:startingBalance+priorPnl+priorCash,configured,periodCashFlows};
}

function renderEquity(){
  const trades=model.trades.slice().sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt));
  if(!trades.length){
    const chart=el('equityChart');
    el('equityMeta').innerHTML='';
    chart.innerHTML='<div class="empty" style="padding-top:100px">No counted trades yet</div>';
    chart.tabIndex=-1;chart.setAttribute('role','status');chart.setAttribute('aria-label','No counted trades yet');
    return;
  }

  const ctx=equityScopeContext();
  let eq=ctx.base,peak=ctx.base;
  const timeline=trades.map(t=>({kind:'trade',time:t.closedAt,amount:Number(t.pnl||0),trade:t}))
    .concat(ctx.periodCashFlows)
    .sort((a,b)=>new Date(a.time)-new Date(b.time));
  const points=[{equity:ctx.base,trade:null,kind:'start'}];
  timeline.forEach(item=>{
    eq+=Number(item.amount||0);
    peak=Math.max(peak,eq);
    points.push({equity:eq,trade:item.trade||null,kind:item.kind,cash:item.event||null,amount:item.amount,time:item.time});
  });

  const vals=points.map(p=>p.equity);
  const min=Math.min(...vals),max=Math.max(...vals);
  const pad=Math.max(1,(max-min)*0.08);
  const chartMin=min-pad,chartMax=max+pad,span=Math.max(1,chartMax-chartMin);
  const W=1000,H=260,px=22,py=18,plotW=W-px*2,plotH=H-py*2;
  const X=i=>px+(i/(vals.length-1||1))*plotW;
  const Y=v=>py+(chartMax-v)/span*plotH;
  const path=vals.map((v,i)=>(i?'L':'M')+X(i).toFixed(2)+' '+Y(v).toFixed(2)).join(' ');
  const floorY=H-py;
  const area=path+' L '+X(vals.length-1).toFixed(2)+' '+floorY+' L '+X(0).toFixed(2)+' '+floorY+' Z';

  el('equityMeta').innerHTML=
    '<span class="equityChip">Start <b>'+balanceMoney(ctx.base)+'</b></span>'+
    '<span class="equityChip">Current <b>'+balanceMoney(eq)+'</b></span>'+
    '<span class="equityChip">Peak <b>'+balanceMoney(peak)+'</b></span>'+
    '<span class="equityChip">'+trades.length+' counted trades</span>'+
    (!ctx.configured?'<span class="equityChip amber">Set starting balance in Accounts</span>':'');

  const chart=el('equityChart');
  chart.tabIndex=0;chart.setAttribute('role','group');
  chart.setAttribute('aria-label','Equity curve. Start '+balanceMoney(ctx.base)+', current '+balanceMoney(eq)+'. Use left and right arrow keys to inspect points.');
  chart.innerHTML=
    '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true" focusable="false">'+
      '<defs><linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#21df8c" stop-opacity=".24"/><stop offset="100%" stop-color="#21df8c" stop-opacity=".01"/></linearGradient></defs>'+
      '<path d="'+area+'" fill="url(#eqFill)"/>'+
      '<path d="'+path+'" fill="none" stroke="#21df8c" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>'+
      '<line class="equityHoverLine" x1="0" y1="'+py+'" x2="0" y2="'+(H-py)+'"></line>'+
      '<circle class="equityHoverDot" cx="0" cy="0" r="5" vector-effect="non-scaling-stroke"></circle>'+
      '<rect class="equityHitArea" x="0" y="0" width="'+W+'" height="'+H+'" fill="transparent" style="cursor:crosshair"></rect>'+
    '</svg>'+
    '<div class="equityTooltip" role="status"><div class="eqDate"></div><div class="eqValue"></div><div class="eqMeta"></div></div>';

  const svg=chart.querySelector('svg');
  const hit=chart.querySelector('.equityHitArea');
  const line=chart.querySelector('.equityHoverLine');
  const dot=chart.querySelector('.equityHoverDot');
  const tip=chart.querySelector('.equityTooltip');
  const dateEl=tip.querySelector('.eqDate');
  const valueEl=tip.querySelector('.eqValue');
  const metaEl=tip.querySelector('.eqMeta');

  function showPoint(clientX){
    const rect=svg.getBoundingClientRect();
    if(!rect.width)return;
    const vx=(clientX-rect.left)/rect.width*W;
    const idx=Math.max(0,Math.min(points.length-1,Math.round((vx-px)/plotW*(points.length-1))));
    const p=points[idx],cx=X(idx),cy=Y(p.equity);
    const screenX=cx/W*rect.width,screenY=cy/H*rect.height;

    line.setAttribute('x1',cx);
    line.setAttribute('x2',cx);
    line.style.opacity='1';
    dot.setAttribute('cx',cx);
    dot.setAttribute('cy',cy);
    dot.style.opacity='1';

    tip.style.left=Math.max(82,Math.min(rect.width-82,screenX))+'px';
    tip.style.top=Math.max(62,screenY-8)+'px';
    tip.classList.add('on');

    const prevPoint=idx>0?points[idx-1]:null;
    const balanceClass=!prevPoint?'':p.equity>prevPoint.equity?' up':p.equity<prevPoint.equity?' down':'';
    valueEl.className='eqValue';
    valueEl.innerHTML='<span>Equity</span> <span class="eqBalance'+balanceClass+'">'+esc(balanceMoney(p.equity))+'</span>';

    if(p.kind==='start'){
      dateEl.textContent='Start';
      metaEl.textContent=dateRange.mode==='all'?'Starting balance':'Balance at period start';
      return;
    }

    const d=new Date(p.time||p.trade?.closedAt);
    dateEl.textContent=d.toLocaleString([],{
      year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'
    });

    if(p.kind==='cash'){
      const amount=Number(p.amount||0),label=amount>=0?'Deposit / credit':'Withdrawal / adjustment';
      metaEl.innerHTML=esc(label)+' · <span class="eqTradePnl '+(amount>=0?'win':'loss')+'">'+esc(money(amount))+'</span>';
      return;
    }

    const tradePnl=Number(p.trade.pnl||0);
    const side=String(p.trade.side||'').toUpperCase();
    const sideClass=side==='BUY'?'buy':side==='SELL'?'sell':'';
    const pnlClass=tradePnl>0?'win':tradePnl<0?'loss':'flat';
    metaEl.innerHTML='#'+idx+' · '+esc(p.trade.symbol)+' <span class="eqSide '+sideClass+'">'+esc(side)+'</span> · Trade <span class="eqTradePnl '+pnlClass+'">'+esc(money(tradePnl))+'</span>';
  }

  function hidePoint(){
    line.style.opacity='0';
    dot.style.opacity='0';
    tip.classList.remove('on');
  }

  hit.addEventListener('pointermove',e=>showPoint(e.clientX));
  hit.addEventListener('pointerdown',e=>showPoint(e.clientX));
  hit.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')hidePoint()});
  let keyboardIdx=points.length-1;
  const showKeyboardPoint=()=>{const rect=svg.getBoundingClientRect();if(rect.width)showPoint(rect.left+(X(keyboardIdx)/W)*rect.width)};
  chart.onfocus=showKeyboardPoint;
  chart.onkeydown=e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();
    if(e.key==='Home')keyboardIdx=0;else if(e.key==='End')keyboardIdx=points.length-1;
    else keyboardIdx=Math.max(0,Math.min(points.length-1,keyboardIdx+(e.key==='ArrowLeft'?-1:1)));
    showKeyboardPoint();
  };
  chart.onblur=hidePoint;
}

function renderMistakes(){
  const trades=model.trades,withMistake=trades.filter(t=>String(t.mistake||'').trim()),clean=trades.filter(t=>!String(t.mistake||'').trim());
  const sum=a=>a.reduce((s,t)=>s+Number(t.pnl||0),0);
  const groups={};
  withMistake.forEach(t=>{const label=String(t.mistake).trim(),key=label.toLowerCase();if(!groups[key])groups[key]={label,count:0,pnl:0,wins:0};const g=groups[key];g.count++;g.pnl+=Number(t.pnl||0);if(isStrategyWin(t))g.wins++});
  const list=Object.values(groups).sort((a,b)=>a.pnl-b.pnl);
  let html='<div class="mistakeSummary"><div class="mistakeCard"><div class="metricLabel">No mistake marked</div><div class="metricValue '+(sum(clean)>=0?'green':'red')+'" style="font-size:21px">'+money(sum(clean))+'</div><div class="sub">'+clean.length+' trades</div></div><div class="mistakeCard"><div class="metricLabel">With mistake / violation</div><div class="metricValue '+(sum(withMistake)>=0?'green':'red')+'" style="font-size:21px">'+money(sum(withMistake))+'</div><div class="sub">'+withMistake.length+' trades</div></div></div>';
  if(list.length)html+='<div class="mistakeList">'+list.map(g=>'<div class="mistakeRow"><div><b>'+esc(g.label)+'</b><div class="sub">'+g.count+' trades</div></div><b class="'+(g.pnl>=0?'green':'red')+'">'+money(g.pnl)+'</b><span class="mistakeWr sub">'+(g.count?Math.round(g.wins/g.count*100):0)+'% WR</span></div>').join('')+'</div>';
  else html+='<div class="hint">Когда начнёшь отмечать Mistake / violation в Trade Review, здесь появится влияние ошибок на результат.</div>';
  el('mistakeAnalytics').innerHTML=html;
}
function renderWeekday(){
  const a=model.weekday.filter(x=>x.name!=='Sun'&&x.name!=='Sat'),mx=Math.max(1,...a.map(x=>Math.abs(x.value)));
  el('weekday').innerHTML=a.map(x=>'<div class="rowbar"><div>'+x.name+'</div><div class="track"><div class="fill" style="width:'+(Math.abs(x.value)/mx*100)+'%"></div></div><div class="'+(x.value>=0?'green':'red')+'" style="text-align:right;font-weight:800">'+money(x.value)+'</div></div>').join('');
}
function renderSymbols(){el('symbols').innerHTML=model.symbols.length?model.symbols.map(s=>'<div class="sym"><b>'+esc(s.symbol)+'</b><div class="metricValue '+(s.pnl>=0?'green':'red')+'" style="font-size:21px">'+money(s.pnl)+'</div><div class="sub">'+s.trades+' trades · '+s.wr.toFixed(0)+'% win · '+s.days+'d</div></div>').join(''):'<div class="empty">No trades yet</div>'}
function renderCalendar(){
  const y=monthDate.getFullYear(),m=monthDate.getMonth(),ym=y+'-'+String(m+1).padStart(2,'0');
  el('monthLabel').textContent=monthDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const map={};model.daily.forEach(d=>map[d.date]=d);
  const monthRows=model.daily.filter(d=>d.date.startsWith(ym+'-'));
  const mpnl=monthRows.reduce((s,d)=>s+d.pnl,0),mtr=monthRows.reduce((s,d)=>s+d.trades,0),mw=monthRows.reduce((s,d)=>s+d.wins,0),ml=monthRows.reduce((s,d)=>s+d.losses,0);
  el('calendarSummary').innerHTML='<span class="calChip pnl '+(mpnl>0?'pos':mpnl<0?'neg':'')+'">'+money(mpnl)+'</span><span class="calChip">'+mtr+' trades</span><span class="calChip">'+((mw+ml)?(mw/(mw+ml)*100).toFixed(0):'—')+'% WR</span>';

  let html=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>'<div class="dow">'+x+'</div>').join('')+'<div class="dow weekHead">WEEK</div>';
  const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate(),cells=Math.ceil((first+days)/7)*7;
  let weekPnl=0,weekTrades=0;
  for(let i=0;i<cells;i++){
    const d=i-first+1;
    if(d>=1&&d<=days){
      const k=ym+'-'+String(d).padStart(2,'0'),x=map[k],review=dailyReviewMap[k];
      if(x){weekPnl+=x.pnl;weekTrades+=x.trades}
      const title=x?(money(x.pnl)+' · '+(x.wr==null?'—':x.wr.toFixed(0)+'% WR')+' · '+x.trades+' trades'):'No counted trades';
      const todayClass=k===dayKey(new Date())?' today':'';
      html+='<button type="button" class="day clickable '+(x?(x.pnl>=0?'pos':'neg'):'')+todayClass+'" data-review-date="'+k+'" title="'+esc(title)+'" aria-label="'+esc(k+' · '+title+(review?' · Daily review saved':''))+'"><div class="dnum">'+d+(review?'<span class="reviewDot" title="Daily review saved" aria-hidden="true"></span>':'')+'</div>'+(x?'<div class="dpnl '+(x.pnl>=0?'green':'red')+'">'+money(x.pnl)+'</div><div class="dmeta">'+(x.wr==null?'—':x.wr.toFixed(0)+'%')+' · '+x.trades+' trades</div>':'')+'</button>';
    }else{
      html+='<div class="day"></div>';
    }
    if(i%7===6){
      html+='<div class="weekTotal '+(weekPnl>0?'pos':weekPnl<0?'neg':'')+'"><div class="wpnl '+(weekPnl>0?'green':weekPnl<0?'red':'')+'">'+money(weekPnl)+'</div><div class="wmeta">'+weekTrades+'T</div></div>';
      weekPnl=0;weekTrades=0;
    }
  }
  el('calendar').innerHTML=html;
  document.querySelectorAll('[data-review-date]').forEach(x=>x.onclick=()=>openDailyReview(x.dataset.reviewDate));
}
el('prevMonth').onclick=()=>{monthDate=new Date(monthDate.getFullYear(),monthDate.getMonth()-1,1);renderCalendar()};
el('nextMonth').onclick=()=>{monthDate=new Date(monthDate.getFullYear(),monthDate.getMonth()+1,1);renderCalendar()};

function tradeEmptyMessage({q,result,ghost,side,source}){
  if(q)return 'No trades match your search.';
  if(ghost==='ghost')return 'No ghost trades in this period.';
  if(ghost==='counted')return 'No counted trades in this period.';
  if(result==='loss')return 'No losing trades in this period.';
  if(result==='win')return 'No winning trades in this period.';
  if(side)return 'No '+side+' trades in this period.';
  if(source)return 'No '+source+' trades in this period.';
  return dateRange.mode==='all'?'No trades yet.':'No trades in the selected period.';
}
function updateBulkGhostBar(){
  el('bulkGhostBar').classList.toggle('hide',!bulkSelectMode);
  el('bulkHead').classList.toggle('hide',!bulkSelectMode);
  el('bulkSelectBtn').classList.toggle('on',bulkSelectMode);
  el('bulkGhostCount').textContent=selectedTradeIds.size+' selected';
  el('bulkGhostBtn').disabled=selectedTradeIds.size===0;
}
function setBulkSelectMode(on){
  bulkSelectMode=!!on;
  if(!bulkSelectMode)selectedTradeIds.clear();
  updateBulkGhostBar();
  renderTrades();
}
function toggleTradeSelection(id){
  if(selectedTradeIds.has(id))selectedTradeIds.delete(id);else selectedTradeIds.add(id);
  updateBulkGhostBar();
  renderTrades();
}
async function markSelectedGhost(){
  const ids=[...selectedTradeIds];
  if(!ids.length)return;
  if(!confirm('Mark '+ids.length+' selected trade'+(ids.length===1?'':'s')+' as Ghost? They will stay in history but be excluded from analytics.'))return;
  const u=(await sb.auth.getUser()).data.user;
  const now=new Date().toISOString();
  const rows=ids.map(id=>({user_id:u.id,trade_id:id,excluded_from_stats:true,exclusion_reason:'Bulk marked as accidental / technical trade',updated_at:now}));
  const {error}=await sb.from('trade_notes').upsert(rows,{onConflict:'user_id,trade_id'});
  if(error)return alert(error.message);
  setBulkSelectMode(false);
  await loadData();
}
function renderTrades(){
  const q=el('search').value.toLowerCase().trim(),side=el('sideFilter').value,source=el('sourceFilter').value,result=el('resultFilter').value,ghost=el('ghostFilter').value;
  const rows=scopedTrades.filter(t=>(!side||t.side===side)&&(!source||t.source===source))
    .filter(t=>result==='win'?isStrategyWin(t):result==='loss'?isStrategyLoss(t):true)
    .filter(t=>ghost==='ghost'?!!t.excluded_from_stats:ghost==='counted'?!t.excluded_from_stats:true)
    .filter(t=>!q||[t.symbol,t.setup,t.tags,t.strategy,t.mistake,t.exclusion_reason].join(' ').toLowerCase().includes(q));

  const emptyCols=bulkSelectMode?7:6;
  el('tradeRows').innerHTML=rows.length?rows.map(t=>{
    const selected=selectedTradeIds.has(t.id);
    const check=bulkSelectMode?'<td class="bulkCheck"><input type="checkbox" '+(selected?'checked':'')+' tabindex="-1" aria-label="Select trade"></td>':'';
    return '<tr class="tradeRow '+(t.excluded_from_stats?'ghostRow ':'')+(selected?'bulkSelected':'')+'" data-id="'+esc(t.id)+'">'+check+'<td class="tradeDate">'+new Date(t.closedAt).toLocaleString()+'</td><td class="tradeSymbol"><button type="button" class="tradeOpenBtn" data-open-trade="'+esc(t.id)+'" aria-label="Open '+esc(t.symbol)+' '+esc(t.side)+' trade">'+esc(t.symbol)+'</button>'+(t.excluded_from_stats?'<span class="ghostBadge">GHOST</span>':'')+'</td><td class="tradeSide"><span class="pill">'+esc(t.side)+'</span></td><td class="tradePnl '+(t.pnl>=0?'green':'red')+'">'+money(t.pnl)+'</td><td class="tradeOrders">'+t.orderCount+(isStrategyLoss(t)?'<span class="slBadge">SL</span>':'')+'</td><td class="tradeSetup">'+esc(t.setup||t.strategy||'')+'</td></tr>';
  }).join(''):'<tr><td colspan="'+emptyCols+'" class="empty">'+esc(tradeEmptyMessage({q,result,ghost,side,source}))+'</td></tr>';

  document.querySelectorAll('#tradeRows tr[data-id]').forEach(r=>r.onclick=e=>{
    const id=r.dataset.id;
    if(e.target.closest('[data-open-trade]'))return;
    if(bulkSelectMode){e.preventDefault();toggleTradeSelection(id);return}
    openTrade(id);
  });
  document.querySelectorAll('[data-open-trade]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const id=b.dataset.openTrade;
    if(bulkSelectMode){toggleTradeSelection(id);return}
    openTrade(id);
  });
  updateBulkGhostBar();
}

el('search').oninput=renderTrades;el('sideFilter').onchange=renderTrades;el('sourceFilter').onchange=renderTrades;el('resultFilter').onchange=renderTrades;el('ghostFilter').onchange=renderTrades;
el('bulkSelectBtn').onclick=()=>setBulkSelectMode(!bulkSelectMode);
el('bulkCancelBtn').onclick=()=>setBulkSelectMode(false);
el('bulkGhostBtn').onclick=markSelectedGhost;

function openDailyReview(date){
  activeReviewDate=date;
  const dayTrades=model.trades.filter(t=>tradeDayKey(t)===date);
  const pnl=dayTrades.reduce((s,t)=>s+t.pnl,0),wins=dayTrades.filter(isStrategyWin).length,losses=dayTrades.filter(isStrategyLoss).length;
  const wr=dayTrades.length?wins/dayTrades.length*100:0;
  el('dailyTitle').textContent=new Date(date+'T12:00:00').toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
  const stats=[['P&L',money(pnl)],['Logical Trades',dayTrades.length],['Win Rate',wr.toFixed(1)+'%'],['Wins / Losses',wins+' / '+losses]];
  el('dailyStats').innerHTML=stats.map(x=>'<div class="kv"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join('');
  const r=dailyReviewMap[date]||{};
  el('dWorked').value=r.what_worked||'';
  el('dWrong').value=r.what_wrong||'';
  el('dTomorrow').value=r.tomorrow_focus||'';
  el('dNotes').value=r.notes||'';
  el('dailyModal').classList.remove('hide');
}
function closeDailyReview(){el('dailyModal').classList.add('hide');activeReviewDate=null}
el('closeDailyModal').onclick=closeDailyReview;
el('saveDailyReview').onclick=async()=>{
  if(!activeReviewDate)return;
  const u=(await sb.auth.getUser()).data.user;
  const row={user_id:u.id,review_date:activeReviewDate,what_worked:el('dWorked').value,what_wrong:el('dWrong').value,tomorrow_focus:el('dTomorrow').value,notes:el('dNotes').value,updated_at:new Date().toISOString()};
  const {error}=await sb.from('daily_reviews').upsert(row,{onConflict:'user_id,review_date'});
  if(error)return alert(error.message);
  closeDailyReview();
  await loadData();
}

function tradeReviewState(){
  return JSON.stringify({
    setup:el('fSetup').value,
    tier:el('fTier').value,
    probability:el('fProbability').value,
    cr:el('fCr').value,
    plan:el('fPlan').value,
    mistake:el('fMistake').value,
    excluded:el('fExcluded').checked,
    exclusionReason:el('fExclusionReason').value,
    notes:el('fNotes').value
  });
}
function closeTradeReview(force=false){
  if(!force&&activeTrade&&tradeReviewSnapshot&&tradeReviewState()!==tradeReviewSnapshot){
    if(!confirm('Discard unsaved changes?'))return false;
  }
  el('tradeModal').classList.add('hide');
  activeTrade=null;
  tradeReviewSnapshot='';
  return true;
}
function openTrade(id){
  const t=scopedTrades.find(x=>x.id===id)||allTrades.find(x=>x.id===id);if(!t)return;activeTrade=t;
  el('modalTitle').textContent=t.symbol+' '+t.side+' · '+money(t.pnl)+(t.excluded_from_stats?' · GHOST':'');
  const details=[['Source',t.source],['Account',t.account+(t.server?' · '+t.server:'')],['Opened',new Date(t.openedAt).toLocaleString()],['Closed',new Date(t.closedAt).toLocaleString()],['Orders',t.orderCount],['Result',isStrategyLoss(t)?'SL':'Worked'],['Entries / exits',t.entries+' / '+t.exits],['Strategy',t.strategy]];
  el('tradeDetails').innerHTML=details.map(x=>'<div class="kv"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join('');
  el('fSetup').value=t.setup||'';el('fTier').value=t.tier||'';el('fProbability').value=t.probability==null?'':t.probability;el('fCr').value=t.cr_value==null?'':t.cr_value;el('fPlan').value=t.plan_ok||'';el('fMistake').value=t.mistake||'';document.querySelectorAll('[data-mistake]').forEach(b=>b.classList.toggle('on',b.dataset.mistake===(t.mistake||'')));el('fExcluded').checked=!!t.excluded_from_stats;el('fExclusionReason').value=t.exclusion_reason||'';el('fExclusionReason').disabled=!el('fExcluded').checked;el('fNotes').value=t.notes||'';
  el('tradeModal').classList.remove('hide');
  tradeReviewSnapshot=tradeReviewState();
}
el('closeModal').onclick=()=>closeTradeReview();
el('saveReview').onclick=async()=>{
  if(!activeTrade)return;
  const probabilityRaw=el('fProbability').value.trim();
  const probability=probabilityRaw===''?null:Number(probabilityRaw);
  if(probability!==null&&(!Number.isFinite(probability)||probability<0||probability>100)){
    el('fProbability').focus();
    return alert('Probability must be between 0% and 100%.');
  }
  const u=(await sb.auth.getUser()).data.user;
  const row={user_id:u.id,trade_id:activeTrade.id,setup:el('fSetup').value,tier:el('fTier').value,probability,cr_value:el('fCr').value===''?null:Number(el('fCr').value),plan_ok:el('fPlan').value,mistake:el('fMistake').value,excluded_from_stats:el('fExcluded').checked,exclusion_reason:el('fExcluded').checked?(el('fExclusionReason').value.trim()||'Accidental / technical trade'):null,notes:el('fNotes').value,updated_at:new Date().toISOString()};
  const {error}=await sb.from('trade_notes').upsert(row,{onConflict:'user_id,trade_id'});if(error)return alert(error.message);
  tradeReviewSnapshot=tradeReviewState();
  closeTradeReview(true);
  await loadData();
};

document.querySelectorAll('[data-mistake]').forEach(b=>b.onclick=()=>{el('fMistake').value=b.dataset.mistake||'';document.querySelectorAll('[data-mistake]').forEach(x=>x.classList.toggle('on',x===b))});
el('fMistake').oninput=()=>document.querySelectorAll('[data-mistake]').forEach(b=>b.classList.toggle('on',b.dataset.mistake===el('fMistake').value));
el('fExcluded').onchange=()=>{el('fExclusionReason').disabled=!el('fExcluded').checked;if(el('fExcluded').checked&&!el('fExclusionReason').value)el('fExclusionReason').focus()};

el('exportBtn').onclick=openExport;
el('exportBackupBtn').onclick=openExport;
el('closeExportModal').onclick=closeExport;
document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportData(b.dataset.export));

el('closeDeclineModal').onclick=closeDecline;
el('declineRemoveBtn').onclick=()=>declineMember('remove');
el('declineBlockBtn').onclick=()=>declineMember('block_5m');

el('tokenBtn').onclick=async()=>{
  if(!confirm('Создать новый ingest token? Если старый уже был, он перестанет работать.'))return;
  const {data,error}=await sb.rpc('create_or_rotate_ingest_token');if(error)return alert(error.message);
  liveToken=data;el('tokenBox').textContent=data;
};
el('copyTokenBtn').onclick=async()=>{if(!liveToken)return alert('Сначала создай token.');await navigator.clipboard.writeText(liveToken);alert('Token скопирован')};

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
}
setupModalAccessibility();
boot();