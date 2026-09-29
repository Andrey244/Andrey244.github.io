const SUPABASE_URL='https://ylriyjxcefovzwzinpqd.supabase.co';
const SUPABASE_KEY='sb_publishable_FHpGzrS604yrbzE8ciM83Q_2045GubX';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const el=id=>document.getElementById(id);
const GROUPING_VERSION='2.3';
const GROUPING_RULE='Server-isolated MT4 overlap · MT5 exposure · duplicate guard';
const LATEST_MT4_CONNECTOR='1.20';
let model={trades:[],daily:[],symbols:[],weekday:[],summary:{}},monthDate=null,activeTrade=null,liveToken='';
let membership=null,allTrades=[],scopedTrades=[],scopedRawEvents=[],tradeNotes=[],dailyReviewRows=[],accountSettings=[],connectorStatuses=[],brokerConnections=[],detectedAccounts=[],memberRows=[],selectedAccountKey='all',declineTarget=null,rawEvents=[],dailyReviewMap={},activeReviewDate=null;
let directCollectorKey=null,directCollectorCheckPromise=null;
let bulkSelectMode=false,selectedTradeIds=new Set(),tradeReviewSnapshot='',dailyReviewSnapshot='';
let journalRealtimeChannel=null,realtimeRebuildTimer=null,lastFullLoadAt=0;
let dateRange={mode:'all',start:null,end:null,label:'All time'};
let rangeDraft={mode:'custom',start:null,end:null,label:'Custom range'},rangeViewMonth=null;
let rangeDrag={active:false,pointerId:null,anchor:null,last:null};

const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const USD=String.fromCharCode(36);
const money=n=>{n=Number(n||0);return (n<0?'-'+USD:n>0?'+'+USD:USD)+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:2})};
const balanceMoney=n=>{n=Number(n||0);return (n<0?'-'+USD:USD)+Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})};
const price=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:5});
let currentLang=(()=>{try{return localStorage.getItem('tj_lang')==='en'?'en':'ru'}catch(_e){return 'ru'}})();
const tx=(en,ru)=>currentLang==='ru'?ru:en;
const uiLocale=()=>currentLang==='ru'?'ru-RU':'en-US';
const STATIC_I18N=[
  ['One idea. One logical trade.','Одна идея. Одна логическая сделка.'],
  ['PRIVATE ACCESS','ПРИВАТНЫЙ ДОСТУП'],['ACCESS PENDING','ДОСТУП ОЖИДАЕТ ОДОБРЕНИЯ'],
  ['Password','Пароль'],['Insights','Аналитика'],['Trades','Сделки'],['Accounts','Счета'],['Connection','Подключение'],['Access','Доступ'],
  ['All time','Всё время'],['Account','Счёт'],['All accounts','Все счета'],['PERFORMANCE','РЕЗУЛЬТАТЫ'],['Total P&L','Общий P&L'],
  ['Win Rate','Винрейт'],['Trading Days','Торговые дни'],['Logical Trades','Логические сделки'],['Best Day','Лучший день'],['Worst Day','Худший день'],
  ['Avg / Day','Среднее / день'],['Streak','Серия'],['EQUITY CURVE','КРИВАЯ КАПИТАЛА'],['AVG P&L BY DAY OF WEEK','СРЕДНИЙ P&L ПО ДНЯМ НЕДЕЛИ'],
  ['RISK / QUALITY','РИСК / КАЧЕСТВО'],['Profit Factor','Profit Factor'],['Max Drawdown','Макс. просадка'],['MISTAKE ANALYTICS','АНАЛИТИКА ОШИБОК'],
  ['SYMBOLS','ИНСТРУМЕНТЫ'],['TRADING CALENDAR','ТОРГОВЫЙ КАЛЕНДАРЬ'],['TRADING HISTORY','ИСТОРИЯ СДЕЛОК'],
  ['BUY + SELL','BUY + SELL'],['Worked + SL + Other','Worked + SL + Другое'],['Worked','Worked'],['Other','Другое'],
  ['All reviews','Все разборы'],['Reviewed','Разобрано'],['Unreviewed','Не разобрано'],['All history','Вся история'],['Counted only','Только учитываемые'],['Ghost only','Только Ghost'],
  ['Select','Выбрать'],['Export','Экспорт'],['Mark as Ghost','Отметить Ghost'],['Cancel','Отмена'],['Date','Дата'],['Symbol','Инструмент'],['Side','Сторона'],['Orders','Ордера'],['Setup','Сетап'],
  ['ACCOUNTS','СЧЕТА'],['LOGIN / SECURITY','ВХОД / БЕЗОПАСНОСТЬ'],['DIRECT BROKER CONNECTION','ПРЯМОЕ ПОДКЛЮЧЕНИЕ К БРОКЕРУ'],
  ['Platform','Платформа'],['Login','Логин'],['Server','Сервер'],['Investor Password','Investor Password'],['Connect read-only','Подключить read-only'],
  ['MANUAL CONNECTOR · FALLBACK','РУЧНОЙ CONNECTOR · РЕЗЕРВ'],['Supabase URL','Supabase URL'],['Private ingest token','Приватный ingest token'],['Copy token','Копировать token'],
  ['DATA HEALTH','СОСТОЯНИЕ ДАННЫХ'],['Backup / Export','Backup / Экспорт'],['LOGICAL TRADE GROUPING','ГРУППИРОВКА ЛОГИЧЕСКИХ СДЕЛОК'],
  ['Review','Разбор'],['More','Ещё'],['EXPORT / BACKUP','ЭКСПОРТ / BACKUP'],['Logical Trades CSV','Logical Trades CSV'],['Raw MT Events CSV','Raw MT Events CSV'],
  ['Trade Reviews CSV','Trade Reviews CSV'],['Daily Reviews CSV','Daily Reviews CSV'],['Full Backup JSON','Full Backup JSON'],['PASSWORD RECOVERY','ВОССТАНОВЛЕНИЕ ПАРОЛЯ'],
  ['DAILY REVIEW','РАЗБОР ДНЯ'],['What worked?','Что сработало?'],['What went wrong?','Что пошло не так?'],['Tomorrow focus','Фокус на завтра'],['Notes','Заметки'],
  ['Save daily review','Сохранить разбор дня'],['TRADE REVIEW','РАЗБОР СДЕЛКИ'],['Tier / Model','Tier / Model'],['Probability %','Вероятность %'],['Plan followed?','План соблюдён?'],
  ['Mistake / violation','Ошибка / нарушение'],['No mistake','Без ошибки'],['Bad entry','Плохой вход'],['Against bias','Против bias'],['News','Новости'],['EA error','Ошибка EA'],
  ['Overtrade','Овертрейдинг'],['Plan violation','Нарушение плана'],['Save review','Сохранить разбор'],['Strategy outcome','Исход стратегии'],['Auto','Авто'],['Other / manual','Другое / вручную'],
  ['Review next','Разобрать следующую'],['Confirm','Подтверждение'],['Close','Закрыть'],['Discard','Отменить изменения'],['Keep editing','Продолжить редактирование'],
  ['Sign in','Войти'],['Create account','Создать аккаунт'],['New accounts get access only after owner approval.','Новые аккаунты получают доступ только после одобрения владельцем.'],['Forgot password?','Забыли пароль?'],
  ['The account was created, but the journal owner has not approved access yet. After approval, refresh the page or click Check again.','Аккаунт создан, но владелец журнала ещё не одобрил доступ. После одобрения обнови страницу или нажми «Проверить снова».'],['Check again','Проверить снова'],['Log out','Выйти'],
  ['Change password','Изменить пароль'],['New password','Новый пароль'],['Repeat password','Повтори пароль'],['Download data','Скачать данные'],['Save new password','Сохранить новый пароль'],
  ['JOURNAL PERIOD','ПЕРИОД ЖУРНАЛА'],['Choose period','Выберите период'],['Today','Сегодня'],['Yesterday','Вчера'],['This week','Эта неделя'],['Last 7 days','Последние 7 дней'],['Last 30 days','Последние 30 дней'],['This month','Этот месяц'],['Custom range','Свой период'],['Apply','Применить']
];
function bindStaticI18n(){
  const byText=new Map();
  STATIC_I18N.forEach(([en,ru],i)=>{byText.set(en,{en,ru,key:String(i)});byText.set(ru,{en,ru,key:String(i)})});
  document.querySelectorAll('body *').forEach(node=>{
    if(node.children.length)return;
    const value=(node.textContent||'').replace(/\s+/g,' ').trim();
    const pair=byText.get(value);
    if(!pair)return;
    node.dataset.i18nKey=pair.key;
    node.dataset.i18nEn=pair.en;
    node.dataset.i18nRu=pair.ru;
  });
}
function applyLanguage(){
  document.documentElement.lang=currentLang;
  document.querySelectorAll('[data-i18n-key]').forEach(node=>{
    node.textContent=currentLang==='ru'?node.dataset.i18nRu:node.dataset.i18nEn;
  });
  const langBtn=el('langToggleBtn');
  if(langBtn){langBtn.textContent=currentLang==='ru'?'EN':'RU';langBtn.setAttribute('aria-label',tx('Switch to English','Переключить на русский'))}
  const attrs={
    search:['Symbol / setup / tag','Инструмент / сетап / тег'],
    password:['Enter password','Введите пароль'],
    newLoginPassword:['Minimum 6 characters','Минимум 6 символов'],
    newLoginPassword2:['Repeat password','Повтори пароль'],
    recoveryPassword:['Minimum 6 characters','Минимум 6 символов'],
    recoveryPassword2:['Repeat password','Повтори пароль'],
    fMistake:['Example: EA left enabled','Например: EA left enabled'],
    fExclusionReason:['Reason, e.g. EA reopened after manual close','Причина, например: EA переоткрыл сделку после ручного закрытия']
  };
  Object.entries(attrs).forEach(([id,[en,ru]])=>{const n=el(id);if(n)n.placeholder=tx(en,ru)});
  const setText=(id,en,ru)=>{const n=el(id);if(n)n.textContent=tx(en,ru)};
  setText('accountHint','Connect multiple MT4/MT5 accounts and view their statistics together or separately.','Можно подключить несколько MT4/MT5 счетов и смотреть статистику вместе или отдельно.');
  setText('accountsIntroHint','Accounts are detected automatically from MetaTrader data. Give them clear names such as “Alpari Demo” or “Main MT4”.','Счета определяются автоматически по данным MetaTrader. Здесь можно дать им понятные названия, например «Alpari Demo» или «Main MT4».');
  setText('passwordIntroHint','If you do not remember the password for another device, change it here while you are already signed in.','Если не помнишь пароль для входа с другого устройства, можешь изменить его здесь, пока уже вошёл в журнал.');
  setText('directIntro','Read-only connection through Investor Password. A master password is not needed and will be rejected if the terminal allows trading.','Read-only подключение через Investor Password. Master password не нужен и будет отклонён, если терминал разрешает торговлю.');
  setText('directSecretHint','The password is encrypted with RSA-OAEP/SHA-256 in the browser and is not stored in browser storage.','Пароль шифруется RSA-OAEP/SHA-256 в браузере и не сохраняется в browser storage.');
  if(!liveToken)setText('tokenBox','Click “Create / rotate token”.','Нажми «Создать / обновить token».');
  setText('tokenBtn','Create / rotate token','Создать / обновить token');
  setText('mt4DownloadBtn','Download MT4 Connector v1.20','Скачать MT4 Connector v1.20');
  setText('exportHint','CSV uses the selected Account + Period. Full Backup JSON keeps the full journal account history.','CSV учитывает выбранные Account + Period. Full Backup JSON сохраняет всю историю аккаунта журнала.');
  setText('rangeDragHint','Hold the left mouse button on a date and drag to the end date.','Зажми левую кнопку мыши на дате и протяни до конечного дня.');
  setText('declineHint','Choose what to do with this request. In both cases the pending account is removed completely so it does not remain in the list.','Выбери, что сделать с этой заявкой. В обоих вариантах pending-аккаунт удаляется полностью, чтобы он не висел в списке.');
  setText('declineRemoveBtn','Delete request','Просто удалить заявку');
  setText('declineBlockBtn','Delete + block 5 minutes','Удалить + блок 5 минут');
  setText('ghostHelpText','Ghost trade — accidental / technical trade. Keep it in history but exclude it completely from P&L, Win Rate, Drawdown and all analytics.','Ghost trade — случайная / техническая сделка. Оставить в истории, но полностью исключить из P&L, Win Rate, Drawdown и всей аналитики.');
  const manualHint=el('manualConnectorHint');
  if(manualHint)manualHint.innerHTML=currentLang==='ru'
    ? 'В MetaTrader добавь <b>https://ylriyjxcefovzwzinpqd.supabase.co</b> в Tools → Options → Expert Advisors → Allow WebRequest. В Connector EA вставляется только этот ingest token.'
    : 'In MetaTrader add <b>https://ylriyjxcefovzwzinpqd.supabase.co</b> under Tools → Options → Expert Advisors → Allow WebRequest. Put only this ingest token into the Connector EA.';
  const groupingIntro=el('groupingIntro');
  if(groupingIntro)groupingIntro.innerHTML=currentLang==='ru'
    ? 'Журнал не считает каждый MT order отдельным трейдом. Доливки и частичные закрытия объединяются в одну campaign. Для максимально точного разделения одновременно живущих стратегий используй comment вида <b>TG:EU_0551 STRAT:EURUSD_V05</b>.'
    : 'The journal does not treat every MT order as a separate trade. Scale-ins and partial closes are grouped into one campaign. For the most precise separation of simultaneous strategies, use a comment such as <b>TG:EU_0551 STRAT:EURUSD_V05</b>.';
  setText('groupingDetail','MT5: grouping uses TG, or exposure within Account + Symbol + Strategy/Magic when TG is absent. MT4: same Symbol + Side + Strategy/Magic are grouped only while order lifetimes actually overlap. Once exposure is flat, the next order is a new Logical Trade even if the EA reopens in the same second.','MT5: группировка идёт по TG, а если его нет — по экспозиции внутри Account + Symbol + Strategy/Magic. MT4: одинаковые Symbol + Side + Strategy/Magic объединяются только пока периоды жизни ордеров реально пересекаются. Как только позиция полностью закрыта, следующий ордер считается новым Logical Trade — даже если EA переоткрыл его в ту же секунду.');
  const declineDetail=el('declineDetail');
  if(declineDetail)declineDetail.innerHTML=currentLang==='ru'
    ? '«Просто удалить» — человек сможет зарегистрироваться снова сразу (полезно, если ошиблись email).<br>«Блок 5 минут» — этот email не сможет создать новую заявку в течение 5 минут.'
    : '“Delete request” lets the person sign up again immediately (useful for a mistyped email).<br>“Block 5 minutes” prevents this email from creating a new request for 5 minutes.';
  const clearPeriod=el('clearPeriodBtn');
  if(clearPeriod){clearPeriod.title=tx('Clear period','Сбросить период');clearPeriod.setAttribute('aria-label',tx('Clear period','Сбросить период'))}
  const ariaPairs={
    prevMonth:['Previous month','Предыдущий месяц'],
    nextMonth:['Next month','Следующий месяц'],
    rangePrevMonth:['Previous month','Предыдущий месяц'],
    rangeNextMonth:['Next month','Следующий месяц'],
    search:['Search trades','Поиск сделок'],
    sideFilter:['Trade side','Сторона сделки'],
    sourceFilter:['Trade source','Источник сделки'],
    resultFilter:['Trade result','Результат сделки'],
    reviewFilter:['Review status','Статус разбора'],
    ghostFilter:['Ghost trade filter','Фильтр Ghost-сделок'],
    mobileReviewBtn:['Daily review','Разбор дня'],
    mobileMoreBtn:['More','Ещё']
  };
  Object.entries(ariaPairs).forEach(([id,[en,ru]])=>{const n=el(id);if(n)n.setAttribute('aria-label',tx(en,ru))});
  document.querySelectorAll('[data-mobile-view="insights"]').forEach(n=>n.setAttribute('aria-label',tx('Insights','Аналитика')));
  document.querySelectorAll('[data-mobile-view="trades"]').forEach(n=>n.setAttribute('aria-label',tx('Trades','Сделки')));
  const placeholderPairs={
    directLogin:['Broker account login','Логин брокерского счёта'],
    directServer:['Exact broker server','Точное имя broker server'],
    directInvestorPassword:['Read-only password','Read-only пароль'],
    dWorked:['What worked well today?','Что сегодня сработало хорошо?'],
    dWrong:['What mistakes, violations or bad decisions happened?','Какие ошибки, нарушения или плохие решения были?'],
    dTomorrow:['What should you focus on next trading day?','На чём сфокусироваться в следующий торговый день?']
  };
  Object.entries(placeholderPairs).forEach(([id,[en,ru]])=>{const n=el(id);if(n)n.placeholder=tx(en,ru)});
  document.title='Trading Journal';
}
function setLanguage(lang){
  currentLang=lang==='en'?'en':'ru';
  try{localStorage.setItem('tj_lang',currentLang)}catch(_e){}
  applyLanguage();
  if(membership?.approved){
    renderPeriodFilter();renderAll();renderHealth();renderAccounts();renderConnectorStatus();renderDirectConnections();
    if(!el('rangeModal').classList.contains('hide'))renderRangePicker();
  }
}
function showToast(message,type='info',timeout=3200){
  const host=el('toastHost');if(!host)return;
  const node=document.createElement('div');
  node.className='toast '+type;
  node.setAttribute('role',type==='error'?'alert':'status');
  node.textContent=String(message||'');
  host.appendChild(node);
  requestAnimationFrame(()=>node.classList.add('on'));
  setTimeout(()=>{node.classList.remove('on');setTimeout(()=>node.remove(),180)},timeout);
}
let confirmResolver=null;
function closeConfirm(result=false){
  const modal=el('confirmModal');
  if(modal)modal.classList.add('hide');
  const resolve=confirmResolver;confirmResolver=null;
  if(resolve)resolve(!!result);
}
function askConfirm(message,{title,confirmText,danger=false}={}){
  if(confirmResolver)closeConfirm(false);
  el('confirmTitle').textContent=title||tx('Confirm','Подтверждение');
  el('confirmMessage').textContent=String(message||'');
  el('confirmOkBtn').textContent=confirmText||tx('Confirm','Подтвердить');
  el('confirmCancelBtn').textContent=tx('Cancel','Отмена');
  el('confirmOkBtn').classList.toggle('danger',!!danger);
  el('confirmOkBtn').classList.toggle('primary',!danger);
  el('confirmModal').classList.remove('hide');
  return new Promise(resolve=>{confirmResolver=resolve});
}
function paint(node,n){node.classList.remove('green','red');if(n>0)node.classList.add('green');if(n<0)node.classList.add('red')}
async function withBusyButton(btn,busyText,task){
  if(!btn||btn.disabled)return;
  const oldText=btn.textContent;
  btn.disabled=true;btn.setAttribute('aria-busy','true');btn.textContent=busyText;
  try{return await task()}finally{btn.disabled=false;btn.removeAttribute('aria-busy');btn.textContent=oldText}
}
function dayKey(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function utcDayKey(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function sourceTimeZone(source){return String(source||'').toUpperCase()==='MT4'?'UTC':'Asia/Tashkent'}
function sourceDayKey(ts,source){
  if(!ts)return null;
  return new Intl.DateTimeFormat('en-CA',{timeZone:sourceTimeZone(source),year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));
}
function formatSourceDateTime(ts,source,options){
  if(!ts)return '—';
  const d=new Date(ts);
  if(!Number.isFinite(d.getTime()))return '—';
  return d.toLocaleString(uiLocale(),Object.assign({timeZone:sourceTimeZone(source)},options||{}));
}
function tradeDayKey(t){return sourceDayKey(t.closedAt,t.source)}
function eventDayKey(e){
  const ts=e.close_time||e.event_time||e.received_at;
  return sourceDayKey(ts,e.source);
}
function dateFromKey(k){const [y,m,d]=String(k).split('-').map(Number);return new Date(y,m-1,d,12,0,0)}
function shiftKey(k,days){const d=dateFromKey(k);d.setDate(d.getDate()+days);return dayKey(d)}
function firstOfMonthKey(k){return String(k).slice(0,7)+'-01'}
function mondayOfWeekKey(k){
  const d=dateFromKey(k),dow=d.getDay(),back=dow===0?6:dow-1;
  d.setDate(d.getDate()-back);return dayKey(d);
}
function formatRangeDate(k){return dateFromKey(k).toLocaleDateString(uiLocale(),{day:'numeric',month:'short',year:'numeric'})}
function rangeLabel(r){
  if(r.mode==='all')return tx('All time','Всё время');
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
  if(mode==='all')return{mode:'all',start:null,end:null,label:tx('All time','Всё время')};
  if(mode==='today')return{mode,start:today,end:today,label:tx('Today','Сегодня')};
  if(mode==='yesterday'){const y=shiftKey(today,-1);return{mode,start:y,end:y,label:tx('Yesterday','Вчера')}}
  if(mode==='week')return{mode,start:mondayOfWeekKey(today),end:today,label:tx('This week','Эта неделя')};
  if(mode==='last7')return{mode,start:shiftKey(today,-6),end:today,label:tx('Last 7 days','Последние 7 дней')};
  if(mode==='last30')return{mode,start:shiftKey(today,-29),end:today,label:tx('Last 30 days','Последние 30 дней')};
  if(mode==='month')return{mode,start:firstOfMonthKey(today),end:today,label:tx('This month','Этот месяц')};
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
  if(id==='confirmModal')return closeConfirm(false);
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
  if(!session){membership=null;stopJournalRealtime();return;}

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
  startJournalRealtime(session.user.id);
  if(canManageAccess()) await loadMembers();
}
el('loginBtn').onclick=()=>withBusyButton(el('loginBtn'),tx('Signing in…','Вхожу…'),async()=>{
  const {error}=await sb.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});
  el('authMsg').textContent=error?error.message:tx('Signed in','Вход выполнен');
});
el('forgotPasswordBtn').onclick=async()=>{
  const email=el('email').value.trim();
  if(!email){el('authMsg').textContent=tx('Enter the account email first.','Сначала введи email аккаунта.');return}
  el('authMsg').textContent=tx('Sending password reset email…','Отправляю письмо для сброса пароля…');
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:'https://andrey244.github.io/'});
  el('authMsg').textContent=error?error.message:tx('Password reset email sent. Open it on this device.','Письмо для сброса пароля отправлено. Открой его на этом устройстве.');
};

el('signupBtn').onclick=()=>withBusyButton(el('signupBtn'),tx('Creating…','Создаю…'),async()=>{
  const email=el('email').value.trim();
  if(!email){el('authMsg').textContent=tx('Enter email.','Введи email.');return;}

  const wait=await sb.rpc('signup_wait_seconds',{p_email:email});
  if(!wait.error && Number(wait.data||0)>0){
    const sec=Number(wait.data||0),min=Math.floor(sec/60),rem=sec%60;
    el('authMsg').textContent=tx('A new request for this email is temporarily blocked. Try again in ','Новая заявка для этого email временно заблокирована. Попробуй через ')+(min?min+tx(' min ',' мин '):'')+rem+tx(' sec.',' сек.');
    return;
  }

  const {error}=await sb.auth.signUp({email,password:el('password').value});
  if(error){
    const msg=String(error.message||'');
    if(/email.*rate|rate.*email/i.test(msg)){
      el('authMsg').textContent=tx('Supabase confirmation-email limit is exhausted. The account was not created. For this private journal, keep owner approval and disable email confirmation in Supabase.','Лимит Supabase на отправку confirmation email исчерпан. Аккаунт не создан. Для этого приватного журнала лучше отключить email confirmation в Supabase и оставить ручной Approve владельцем.');
    }else{
      el('authMsg').textContent=msg;
    }
    return;
  }
  el('authMsg').textContent=tx('Account created. The journal owner must approve access now.','Аккаунт создан. Теперь владелец журнала должен одобрить доступ.');
});
function bindPasswordToggle(inputId,buttonId){
  const p=el(inputId),b=el(buttonId);
  if(!p||!b)return;
  b.onclick=()=>{
    const show=p.type==='password';
    p.type=show?'text':'password';
    b.classList.toggle('on',show);
    b.setAttribute('aria-label',show?tx('Hide password','Скрыть пароль'):tx('Show password','Показать пароль'));
    b.title=show?tx('Hide password','Скрыть пароль'):tx('Show password','Показать пароль');
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
  el('authMsg').textContent=tx('Password reset was cancelled. Sign in normally.','Сброс пароля отменён. Войди в аккаунт обычным способом.');
};
el('saveRecoveryPassword').onclick=async()=>{
  const p1=el('recoveryPassword').value,p2=el('recoveryPassword2').value,msg=el('recoveryMsg'),btn=el('saveRecoveryPassword');
  msg.textContent='';
  if(p1.length<6){msg.textContent=tx('Password must be at least 6 characters.','Пароль должен быть минимум 6 символов.');return}
  if(p1!==p2){msg.textContent=tx('Passwords do not match.','Пароли не совпадают.');return}
  btn.disabled=true;
  const oldText=btn.textContent;
  btn.textContent=tx('Saving…','Сохраняю…');
  const {error}=await sb.auth.updateUser({password:p1});
  if(error){
    btn.disabled=false;
    btn.textContent=oldText;
    const raw=String(error.message||'');
    msg.textContent=(error.code==='same_password'||/different from the old password/i.test(raw))
      ?tx('This password is already set on the account. Try signing in with it.','Этот пароль уже установлен на аккаунте. Попробуй войти с ним.')
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
  el('authMsg').textContent=tx('Password changed successfully. Sign in with the new password.','Пароль успешно изменён. Войди с новым паролем.');
};

el('logoutBtn').onclick=()=>sb.auth.signOut();
el('pendingLogoutBtn').onclick=()=>sb.auth.signOut();
bindPasswordToggle('password','togglePasswordBtn');
el('changeLoginPasswordBtn').onclick=async()=>{
  const p1=el('newLoginPassword').value,p2=el('newLoginPassword2').value,msg=el('passwordChangeMsg');
  msg.textContent='';
  if(p1.length<6){msg.textContent=tx('Password must be at least 6 characters.','Пароль должен быть минимум 6 символов.');return}
  if(p1!==p2){msg.textContent=tx('Passwords do not match.','Пароли не совпадают.');return}
  const {error}=await sb.auth.updateUser({password:p1});
  if(error){msg.textContent=error.message;return}
  el('newLoginPassword').value='';el('newLoginPassword2').value='';
  msg.textContent=tx('Password changed. You can now use it to sign in from your phone.','Пароль изменён. Теперь используй его для входа с телефона.');
};
el('pendingRefreshBtn').onclick=async()=>{const {data}=await sb.auth.getSession();await handleSession(data.session)};

function hideEquityTooltip(){
  const chart=el('equityChart');
  if(!chart)return;
  const line=chart.querySelector('.equityHoverLine');
  const dot=chart.querySelector('.equityHoverDot');
  const tip=chart.querySelector('.equitySvgTooltip');
  const a11y=chart.querySelector('.equityTooltipA11y');
  if(line)line.classList.remove('on');
  if(dot)dot.classList.remove('on');
  if(tip)tip.classList.remove('on');
  if(a11y)a11y.textContent='';
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
  if(view==='insights')requestAnimationFrame(renderEquity);
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
let equityResizeTimer=null;
window.addEventListener('resize',()=>{
  if(equityResizeTimer)clearTimeout(equityResizeTimer);
  equityResizeTimer=setTimeout(()=>{
    equityResizeTimer=null;
    const insights=el('insights');
    if(membership?.approved&&insights&&!insights.classList.contains('hide'))renderEquity();
  },120);
});

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
  const legacyId='LT_'+hash([e.source,e.account,e.symbol,strategy,gid||'',e.event_id].join('|'));
  const stableId='LT_'+hash([String(e.source||'').toUpperCase(),e.account,e.server||'',e.event_id].join('|'));
  return {id:stableId,legacyId,source:e.source,account:e.account,server:e.server||'',symbol:e.symbol,side,strategy,openedAt:e.event_time||e.open_time,closedAt:null,pnl:0,entryQty:0,exitQty:0,entryVal:0,exitVal:0,entries:0,exits:0,orders:{},events:[]};
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
  const stableCounts={},legacyCounts={};
  trades.forEach(t=>{
    stableCounts[t.id]=(stableCounts[t.id]||0)+1;
    if(t.legacyId)legacyCounts[t.legacyId]=(legacyCounts[t.legacyId]||0)+1;
  });
  trades.forEach(t=>{
    t.legacyCollision=!!(t.legacyId&&legacyCounts[t.legacyId]>1);
    if(stableCounts[t.id]>1){
      t.id='LT_'+hash([t.source,t.account,t.server||'',(t.events||[])[0]||'',t.openedAt].join('|'));
    }
  });
  return trades;
}
function strategyOrderCount(t){return Number(t.orderCount||0)}
function strategyOutcome(t){
  const override=String(t.outcome_override||'').toLowerCase();
  if(override==='worked')return 'win';
  if(override==='loss')return 'loss';
  if(override==='other')return 'other';
  return t.stopLossHit?'loss':'win';
}
function isStrategyWin(t){return strategyOutcome(t)==='win'}
function isStrategyLoss(t){return strategyOutcome(t)==='loss'}
function isStrategyOther(t){return strategyOutcome(t)==='other'}
function outcomeLabel(t){
  const x=strategyOutcome(t);
  return x==='loss'?'SL':x==='other'?'Other':'Worked';
}
function isTradeReviewed(t){return !!t.reviewed_at}
function buildModel(trades){
  const dayMap={};
  trades.forEach(t=>{
    const d=tradeDayKey(t);
    if(!dayMap[d])dayMap[d]={date:d,pnl:0,trades:0,wins:0,losses:0,other:0};
    const x=dayMap[d];
    x.pnl+=t.pnl;x.trades++;
    if(isStrategyLoss(t))x.losses++;else if(isStrategyOther(t))x.other++;else x.wins++;
  });
  const daily=Object.values(dayMap).sort((a,b)=>a.date.localeCompare(b.date));
  daily.forEach(d=>{const classified=d.wins+d.losses;d.wr=classified?d.wins/classified*100:null});

  const pnl=trades.reduce((s,t)=>s+t.pnl,0);
  const wins=trades.filter(isStrategyWin).length;
  const losses=trades.filter(isStrategyLoss).length;
  const other=trades.filter(isStrategyOther).length;
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
    const z=isStrategyLoss(trades[i])?'L':isStrategyOther(trades[i])?'O':'W';
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
    if(isStrategyLoss(t))s.losses=(s.losses||0)+1;
    s.days[tradeDayKey(t)]=1;
  });
  const symbols=Object.values(sm)
    .map(s=>({symbol:s.symbol,pnl:s.pnl,trades:s.trades,wr:(s.wins+(s.losses||0))?s.wins/(s.wins+(s.losses||0))*100:0,days:Object.keys(s.days).length}))
    .sort((a,b)=>b.pnl-a.pnl);

  return{trades,daily,weekday,symbols,summary:{
    pnl,wins,losses,other,wr:(wins+losses)?wins/(wins+losses)*100:0,
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
    el('tradeRows').innerHTML=Array.from({length:5},()=>'<tr class="skeletonRow"><td colspan="7"><span class="skeletonLine"></span></td></tr>').join('');
  }
}
function rebuildJournalData(){
  dailyReviewMap={};dailyReviewRows.forEach(r=>dailyReviewMap[r.review_date]=r);
  const noteMap={};tradeNotes.forEach(n=>noteMap[n.trade_id]=n);
  const groupingEvents=dedupeEvents(rawEvents);
  const grouped=stabilizeTradeIds(
    groupMT5(groupingEvents.filter(e=>String(e.source).toUpperCase()==='MT5'))
      .concat(groupMT4(groupingEvents.filter(e=>String(e.source).toUpperCase()==='MT4')))
      .filter(t=>t.closedAt)
  );
  allTrades=grouped.map(t=>Object.assign(t,noteMap[t.id]||(!t.legacyCollision?noteMap[t.legacyId]:null)||{}))
    .sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt));
  buildDetectedAccounts(rawEvents);
  restoreRange();
  applyFilters();
  renderAccounts();
  renderConnectorStatus();
  renderDirectConnections();
}
async function loadData({silent=false}={}){
  if(!silent)setDataLoading(true);
  try{
    el('sync').textContent='Syncing…';
    const rawResult=await fetchAll('raw_events');
    const optional=await Promise.allSettled([
      fetchAll('trade_notes'),
      fetchAll('account_settings'),
      fetchAll('daily_reviews'),
      fetchAll('connector_status'),
      fetchAll('broker_connections')
    ]);
    rawEvents=rawResult||[];
    const targets=['tradeNotes','accountSettings','dailyReviewRows','connectorStatuses','brokerConnections'];
    const degraded=[];
    optional.forEach((result,i)=>{
      if(result.status==='fulfilled')globalThis[targets[i]]=result.value||[];
      else degraded.push(targets[i]);
    });
    // globalThis assignment does not update lexical lets in all browsers; assign explicitly.
    if(optional[0].status==='fulfilled')tradeNotes=optional[0].value||[];
    if(optional[1].status==='fulfilled')accountSettings=optional[1].value||[];
    if(optional[2].status==='fulfilled')dailyReviewRows=optional[2].value||[];
    if(optional[3].status==='fulfilled')connectorStatuses=optional[3].value||[];
    if(optional[4].status==='fulfilled')brokerConnections=optional[4].value||[];
    rebuildJournalData();
    lastFullLoadAt=Date.now();
    el('sync').textContent=(degraded.length?tx('Synced · partial','Синхронизировано · частично'):tx('Synced · live','Синхронизировано · live'))+' · '+new Date().toLocaleTimeString(uiLocale(),{hour:'2-digit',minute:'2-digit'});
  }catch(e){
    el('sync').textContent=tx('Sync error','Ошибка синхронизации');
    if(typeof showToast==='function')showToast(String(e?.message||e),'error');
  }finally{
    if(!silent)setDataLoading(false);
  }
}
function stopJournalRealtime(){
  if(realtimeRebuildTimer){clearTimeout(realtimeRebuildTimer);realtimeRebuildTimer=null}
  if(journalRealtimeChannel){
    try{sb.removeChannel(journalRealtimeChannel)}catch(_e){}
    journalRealtimeChannel=null;
  }
}
function scheduleRealtimeRebuild(){
  if(realtimeRebuildTimer)clearTimeout(realtimeRebuildTimer);
  realtimeRebuildTimer=setTimeout(()=>{
    realtimeRebuildTimer=null;
    rebuildJournalData();
    el('sync').textContent=tx('Synced · live','Синхронизировано · live')+' · '+new Date().toLocaleTimeString(uiLocale(),{hour:'2-digit',minute:'2-digit'});
  },350);
}
function startJournalRealtime(userId){
  stopJournalRealtime();
  if(!userId)return;
  journalRealtimeChannel=sb.channel('journal-raw-'+userId)
    .on('postgres_changes',{
      event:'INSERT',
      schema:'public',
      table:'raw_events',
      filter:'user_id=eq.'+userId
    },payload=>{
      const row=payload?.new;
      if(!row)return;
      if(rawEvents.some(e=>String(e.id)===String(row.id)))return;
      rawEvents.push(row);
      scheduleRealtimeRebuild();
    })
    .subscribe();
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible'||!membership?.approved)return;
  if(Date.now()-lastFullLoadAt>5*60*1000)loadData({silent:true});
});
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
  select.innerHTML='<option value="all">'+esc(tx('All accounts','Все счета'))+'</option>'+detectedAccounts.map(a=>'<option value="'+esc(a.key)+'">'+esc(a.label||((a.source?a.source+' · ':'')+a.account+(a.server?' · '+a.server:'')))+'</option>').join('');
  if(selectedAccountKey!=='all'&&!detectedAccounts.some(a=>a.key===selectedAccountKey))selectedAccountKey='all';
  select.value=selectedAccountKey;
  if(detectedAccounts.length<=1){
    const a=detectedAccounts[0];
    staticScope.textContent=a?(a.label||((a.source?a.source+' · ':'')+a.account)):tx('No account connected','Нет подключённого счёта');
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
  el('periodLabel').textContent=dateRange.mode==='all'?tx('All time','Всё время'):rangeLabel(dateRange);
  el('periodSummary').textContent=dateRange.mode==='all'?tx('All history','Вся история'):(dateRange.label+' · '+rangeLabel(dateRange));
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
    rangeDraft={mode:'custom',start:today,end:today,label:tx('Custom range','Свой период')};
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
  const names=currentLang==='ru'?['Пн','Вт','Ср','Чт','Пт','Сб','Вс']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const r=normalizedDraft(),today=dayKey(new Date());
  let html='<div class="rangeMonth"><div class="rangeMonthTitle">'+d.toLocaleDateString(uiLocale(),{month:'long',year:'numeric'})+'</div><div class="rangeWeek">'+names.map(x=>'<span>'+x+'</span>').join('')+'</div><div class="rangeDays">';
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
    el('rangePreview').textContent=tx('All time','Всё время');
  }else if(r.start&&r.end){
    const days=Math.round((dateFromKey(r.end)-dateFromKey(r.start))/86400000)+1;
    el('rangePreview').textContent=rangeLabel(r)+' · '+days+tx(' d',' дн.');
  }else{
    el('rangePreview').textContent=tx('Choose a period','Выбери период');
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
  rangeDraft={mode:'custom',start:a<=key?a:key,end:a<=key?key:a,label:tx('Custom range','Свой период')};
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
    rangeDraft={mode:'custom',start:key,end:key,label:tx('Custom range','Свой период')};

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
  if(!r.start||!r.end){showToast(tx('Choose a period.','Выбери период.'),'error');return;}
  setRange({...r,label:r.mode==='custom'?tx('Custom range','Свой период'):r.label});
};
document.querySelectorAll('[data-range-preset]').forEach(b=>b.onclick=()=>{
  const mode=b.dataset.rangePreset;
  if(mode==='custom'){
    rangeDraft={...normalizedDraft(),mode:'custom',label:tx('Custom range','Свой период')};
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
      '<label class="accountEdit"><span class="accountEditLabel">'+esc(tx('Account name','Название счёта'))+'</span><input class="input" id="accountLabel_'+i+'" value="'+esc(a.label||'')+'" placeholder="Main MT4"></label>'+
      '<label class="accountEdit"><span class="accountEditLabel">'+esc(tx('Starting balance','Начальный баланс'))+'</span><input class="input" id="accountBalance_'+i+'" type="number" min="0" step="0.01" inputmode="decimal" value="'+(a.starting_balance==null?'':esc(a.starting_balance))+'" placeholder="10000"></label>'+
      '<button class="btn" data-account-index="'+i+'">'+esc(tx('Save','Сохранить'))+'</button>'+
    '</div>'
  ).join(''):'<div class="empty">'+esc(tx('No connected accounts yet.','Подключённых счетов пока нет.'))+'</div>';
  document.querySelectorAll('[data-account-index]').forEach(b=>b.onclick=()=>saveAccountLabel(Number(b.dataset.accountIndex)));
}
async function saveAccountLabel(i){
  const a=detectedAccounts[i];if(!a)return;
  const balanceRaw=el('accountBalance_'+i).value.trim();
  const startingBalance=balanceRaw===''?null:Number(balanceRaw);
  if(startingBalance!==null&&(!Number.isFinite(startingBalance)||startingBalance<0)){
    el('accountBalance_'+i).focus();
    showToast(tx('Starting balance must be 0 or higher.','Starting balance должен быть 0 или выше.'),'error');return;
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
  if(error){showToast(error.message,'error');return;}
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
      actionUi='<span class="memberActionPlaceholder">'+esc(tx('Protected','Защищено'))+'</span>';
    }else if(m.approved&&canManage){
      actionUi='<button class="btn danger" data-revoke-index="'+i+'">'+esc(tx('Revoke','Отключить'))+'</button>';
    }else if(!m.approved&&canManage){
      actionUi='<div class="memberActions"><button class="btn primary" data-approve-index="'+i+'">'+esc(tx('Approve','Одобрить'))+'</button><button class="btn danger" data-decline-index="'+i+'">'+esc(tx('Decline','Отклонить'))+'</button></div>';
    }else if(m.role==='admin'){
      actionUi='<span class="memberActionPlaceholder">'+esc(tx('Owner only','Только Owner'))+'</span>';
    }

    return '<div class="memberRow">'+
      '<div class="memberMeta"><b>'+esc(m.email||tx('No email','Нет email'))+'</b><div class="sub">'+esc(m.approved?tx('Approved account','Аккаунт одобрен'):tx('Waiting approval','Ожидает одобрения'))+'</div></div>'+
      '<div class="memberRoleCell">'+roleUi+'</div>'+
      '<div class="memberAccessCell"><span class="memberAccessState '+(m.approved?'green':'amber')+'">'+esc(m.approved?tx('Active','Активен'):tx('Pending','Ожидает'))+'</span><span class="memberAccessHint">'+esc(m.approved?tx('Access on','Доступ включён'):tx('No journal access','Нет доступа к журналу'))+'</span></div>'+
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
  if(!(await askConfirm(tx('Assign role ','Выдать роль ')+label+tx(' to ',' для ')+m.email+'?'))){renderMembers();return}
  const {error}=await sb.rpc('set_member_role',{p_user_id:m.user_id,p_role:role});
  if(error){showToast(error.message,'error');return loadMembers()}
  await loadMembers();
}
async function approveMember(i){
  const m=memberRows[i];if(!m||m.role==='owner'||m.approved)return;
  if(membership?.role==='admin'&&m.role!=='member'){showToast(tx('Admin can approve Members only.','Admin может одобрять только Members.'),'error');return;}
  const {error}=await sb.rpc('approve_member',{p_user_id:m.user_id,p_approved:true});
  if(error){showToast(error.message,'error');return;}
  await loadMembers();
}
async function revokeMember(i){
  const m=memberRows[i];if(!m||m.role==='owner'||!m.approved)return;
  if(membership?.role==='admin'&&m.role!=='member'){showToast(tx('Admin can revoke Members only.','Admin может отзывать доступ только у Members.'),'error');return;}
  if(!(await askConfirm(tx('Revoke access for ','Отключить доступ для ')+m.email+tx('? The account will remain, but Journal access and token will be disabled.','? Его аккаунт останется, но журнал и token будут недоступны.'),{danger:true,confirmText:tx('Revoke','Отключить')})))return;
  const {error}=await sb.rpc('approve_member',{p_user_id:m.user_id,p_approved:false});
  if(error){showToast(error.message,'error');return;}
  await loadMembers();
}
function openDecline(i){
  const m=memberRows[i];if(!m||m.role==='owner'||m.approved)return;
  if(membership?.role==='admin'&&m.role!=='member'){showToast(tx('Admin can decline Members only.','Admin может отклонять только Members.'),'error');return;}
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
  const email=declineTarget.email||tx('this email','этот email');
  const text=mode==='block_5m'
    ? tx('Delete the request for ','Удалить заявку ')+email+tx(' and block new requests from this email for 5 minutes?',' и заблокировать новые заявки от этого email на 5 минут?')
    : tx('Delete the pending request for ','Полностью удалить pending-заявку ')+email+tx('? Sign-up will be available again immediately.','? Повторная регистрация будет доступна сразу.');
  if(!(await askConfirm(text,{danger:true})))return;

  const {error}=await sb.rpc('decline_member',{p_user_id:declineTarget.user_id,p_mode:mode});
  if(error){showToast(error.message,'error');return;}
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
  const times=healthEvents.map(e=>new Date(e.close_time||e.event_time||e.open_time||0).getTime()).filter(Number.isFinite).filter(x=>x>0);
  const received=healthEvents.map(e=>new Date(e.received_at||0).getTime()).filter(Number.isFinite).filter(x=>x>0);
  const fmtAge=ms=>{
    if(!ms)return '—';
    const sec=Math.max(0,Math.round((Date.now()-ms)/1000));
    if(sec<60)return sec+tx('s ago','с назад');
    if(sec<3600)return Math.round(sec/60)+tx('m ago','м назад');
    if(sec<86400)return Math.round(sec/3600)+tx('h ago','ч назад');
    return Math.round(sec/86400)+tx('d ago','дн назад');
  };
  const coverage=times.length>1?Math.max(0,Math.round((Math.max(...times)-Math.min(...times))/86400000))+'d':'—';
  el('healthGrid').innerHTML=[
    [tx('Raw ↔ Logical','Raw ↔ Logical'),Math.abs(diff)<0.01?tx('Matched','Совпадает'):'Δ '+money(diff)],
    [tx('Eligible events','Подходящие события'),String(eligible.length)],
    [tx('Unassigned','Не назначено'),String(orphan)],
    [tx('Duplicate assignment','Дубликаты назначения'),String(dup)],
    [tx('Latest broker event','Последнее событие брокера'),times.length?fmtAge(Math.max(...times)):'—'],
    [tx('Latest ingest','Последний ingest'),received.length?fmtAge(Math.max(...received)):'—'],
    [tx('Loaded coverage','Загруженный период'),coverage],
    [tx('Logical trades','Логические сделки'),String(healthTrades.length)]
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
  badge.textContent=state==='ready'?tx('Ready','Готов'):state==='wait'?tx('Not provisioned','Не настроен'):state==='error'?tx('Unavailable','Недоступен'):tx('Checking…','Проверка…');
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
  if(directCollectorKey&&!force){setDirectFormEnabled(true);setDirectCollectorUi('ready',tx('Direct collector is ready. Use Investor Password only.','Direct collector готов. Используй только Investor Password.'));return directCollectorKey}
  if(directCollectorCheckPromise&&!force)return directCollectorCheckPromise;
  directCollectorKey=null;
  setDirectFormEnabled(false);
  setDirectCollectorUi('',tx('Checking direct collector availability…','Проверяю доступность direct collector…'));
  directCollectorCheckPromise=(async()=>{
    try{
      const data=await edgePost('broker-key',{});
      if(data?.algorithm!=='RSA-OAEP-SHA256'||!data?.key_id||!String(data?.public_key_pem||'').includes('BEGIN PUBLIC KEY'))throw Object.assign(new Error('Invalid collector key response.'),{code:'invalid_collector_key'});
      directCollectorKey={key_id:String(data.key_id),algorithm:String(data.algorithm),public_key_pem:String(data.public_key_pem)};
      setDirectFormEnabled(true);
      setDirectCollectorUi('ready',tx('Direct collector is ready. Password is encrypted before sending.','Direct collector готов. Пароль шифруется до отправки.'));
      return directCollectorKey;
    }catch(error){
      directCollectorKey=null;
      setDirectFormEnabled(false);
      if(error?.status===503||error?.code==='collector_not_ready'){
        setDirectCollectorUi('wait',tx('Direct collector is not provisioned yet. Use the Manual Connector below for now.','Direct collector ещё не provisioned. Пока используй Manual Connector ниже.'));
      }else{
        setDirectCollectorUi('error',tx('Direct collector is temporarily unavailable. The Manual Connector below still works.','Direct collector временно недоступен. Manual Connector ниже продолжает работать.'));
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
  const labels={
    PENDING_VALIDATION:tx('Pending validation','Ожидает проверки'),
    VALIDATING:tx('Validating','Проверка'),
    CONNECTED:tx('Connected','Подключено'),
    DEGRADED:tx('Degraded','Есть проблемы'),
    ERROR:tx('Error','Ошибка'),
    DISCONNECTED:tx('Disconnected','Отключено')
  };
  return labels[value]||value||tx('Unknown','Неизвестно');
}
function renderDirectConnections(){
  const host=el('directConnectionList');if(!host)return;
  const rows=(brokerConnections||[]).filter(row=>row.enabled!==false&&String(row.state||'').toUpperCase()!=='DISCONNECTED');
  if(!rows.length){host.innerHTML='<div class="hint directFallbackNote">'+esc(tx('Direct connections will appear here after a successful connection.','Прямые подключения появятся здесь после успешного подключения.'))+'</div>';return}
  host.innerHTML=rows.map(row=>{
    const state=String(row.state||'').toLowerCase();
    const seen=row.last_sync_at?(tx('Last sync','Последняя синхронизация')+' · '+new Date(row.last_sync_at).toLocaleString(uiLocale())):(row.last_error_at?(tx('Last error','Последняя ошибка')+' · '+new Date(row.last_error_at).toLocaleString(uiLocale())):tx('Waiting for collector','Ожидание collector'));
    const err=row.last_error_code?(' · '+String(row.last_error_code)):'';
    return '<div class="directConnectionRow"><div class="directConnectionMeta"><b>'+esc(String(row.platform||'')+' · '+String(row.login||'')+' · '+String(row.server||''))+'</b><span>'+esc(seen+err)+'</span></div><div class="directConnectionState '+esc(state)+'">'+esc(directStateLabel(row.state))+'</div><button class="btn" type="button" data-direct-disconnect="'+esc(row.id)+'">'+esc(tx('Disconnect','Отключить'))+'</button></div>';
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
  if(!(await askConfirm(tx('Disconnect this broker account? The encrypted Investor Password will be deleted.','Отключить этот брокерский счёт? Зашифрованный Investor Password будет удалён.'),{danger:true,confirmText:tx('Disconnect','Отключить')})))return;
  await withBusyButton(button,'Disconnecting…',async()=>{
    try{
      await edgePost('broker-disconnect',{connection_id:connectionId});
      await refreshDirectConnections();
      el('directConnectMsg').textContent=tx('Direct connection disconnected. Encrypted credential deleted.','Direct connection отключён. Encrypted credential удалён.');
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
      if(!/^[0-9]+$/.test(login)){el('directLogin').focus();throw new Error(tx('Login must contain digits only.','Login должен содержать только цифры.'))}
      if(!server||/[\r\n]/.test(server)){el('directServer').focus();throw new Error(tx('Enter the exact broker server name.','Укажи точное имя broker server.'))}
      const key=directCollectorKey||await ensureDirectCollectorReady(true);
      if(!key)throw new Error(tx('Direct collector is not ready yet. Use the Manual Connector.','Direct collector ещё не готов. Используй Manual Connector.'));
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
      el('directConnectMsg').textContent=tx('Connection queued · ','Подключение поставлено в очередь · ')+String(result.state||'PENDING_VALIDATION')+tx('. Collector will validate the Investor Password.','. Collector проверит Investor Password.');
      await refreshDirectConnections();
    }catch(error){
      if(error?.code==='collector_key_stale'){
        directCollectorKey=null;
        await ensureDirectCollectorReady(true);
        el('directConnectMsg').textContent=tx('Collector key changed. Enter the Investor Password again.','Collector key обновился. Введи Investor Password ещё раз.');
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
    const state=current?tx('Current','Актуально'):version?tx('Update available','Доступно обновление'):tx('Install v','Установить v')+LATEST_MT4_CONNECTOR;
    const cls=current?'current':version?'update':'unknown';
    const seen=s?.last_seen?new Date(s.last_seen).toLocaleString(uiLocale()):tx('No live version report yet','Пока нет live-отчёта о версии');
    return '<div class="connectorStatusRow"><div class="connectorStatusMeta"><b>'+esc(a.label||a.account)+' · MT4 '+(version?'v'+version:tx('version unknown','версия неизвестна'))+'</b><span>'+esc(seen)+'</span></div><span class="connectorState '+cls+'">'+esc(state)+'</span></div>';
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
      {label:'Opened',key:'openedAt'},{label:'Closed',key:'closedAt'},{label:'Net P&L',key:'pnl'},{label:'Orders',key:'orderCount'},{label:'Strategy result',get:r=>outcomeLabel(r)},{label:'Strategy',key:'strategy'},
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
    const keys=['trade_id','setup','tier','probability','cr_value','plan_ok','outcome_override','mistake','excluded_from_stats','exclusion_reason','notes','reviewed_at','updated_at'];
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
    ? tx('Broker ','Broker ')+'<b>'+money(brokerPnl)+'</b> · Ghost <b>'+money(ghostPnl)+'</b> '+tx('excluded','исключено')
    : '';
  el('mWr').textContent=s.wr.toFixed(1)+'%';
  el('mTrades').textContent=s.trades;
  el('mStreak').textContent=s.streak;
  el('mPf').textContent=s.pf===Infinity?'∞':Number(s.pf).toFixed(2);
  el('mDd').textContent=money(s.dd);paint(el('mDd'),s.dd);
  el('avgWinLoss').innerHTML='<span>'+esc(tx('Avg Win','Средний Win'))+' <b class="green">'+money(s.avgWin)+'</b></span><span>'+esc(tx('Avg Loss','Средний Loss'))+' <b class="red">'+money(s.avgLoss)+'</b></span>';

  if(singleDay){
    el('lblDays').textContent=tx('Worked / SL / Other','Worked / SL / Другое');
    el('mDays').textContent=s.wins+'W / '+s.losses+'L / '+s.other+'O';
    el('lblBest').textContent=tx('Best Trade','Лучшая сделка');
    el('lblWorst').textContent=tx('Worst Trade','Худшая сделка');
    el('lblAvg').textContent=tx('Avg / Trade','Среднее / сделка');
    [['mBest',s.bestTrade],['mWorst',s.worstTrade],['mAvg',s.avgTrade]].forEach(([id,n])=>{el(id).textContent=money(n);paint(el(id),n)});
  }else{
    el('lblDays').textContent=tx('Trading Days','Торговые дни');
    el('mDays').textContent=s.days;
    el('lblBest').textContent=tx('Best Day','Лучший день');
    el('lblWorst').textContent=tx('Worst Day','Худший день');
    el('lblAvg').textContent=tx('Avg / Day','Среднее / день');
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
  const chart=el('equityChart');
  if(!trades.length){
    el('equityMeta').innerHTML='';
    chart.innerHTML='<div class="empty emptyChart">'+esc(tx('No counted trades yet','Пока нет учитываемых сделок'))+'</div>';
    chart.tabIndex=-1;chart.setAttribute('role','status');chart.setAttribute('aria-label',tx('No counted trades yet','Пока нет учитываемых сделок'));
    return;
  }

  const ctx=equityScopeContext();
  let eq=ctx.base,peak=ctx.base,tradeNumber=0;
  const timeline=trades.map(t=>({kind:'trade',time:t.closedAt,amount:Number(t.pnl||0),trade:t}))
    .concat(ctx.periodCashFlows)
    .sort((a,b)=>new Date(a.time)-new Date(b.time));
  const points=[{equity:ctx.base,trade:null,kind:'start',tradeNumber:null}];
  timeline.forEach(item=>{
    eq+=Number(item.amount||0);
    peak=Math.max(peak,eq);
    if(item.kind==='trade')tradeNumber++;
    points.push({
      equity:eq,
      trade:item.trade||null,
      kind:item.kind,
      cash:item.event||null,
      amount:item.amount,
      time:item.time,
      tradeNumber:item.kind==='trade'?tradeNumber:null
    });
  });

  const vals=points.map(p=>p.equity);
  const min=Math.min(...vals),max=Math.max(...vals);
  const pad=Math.max(1,(max-min)*0.08);
  const chartMin=min-pad,chartMax=max+pad,span=Math.max(1,chartMax-chartMin);
  const W=Math.max(320,Math.round(chart.getBoundingClientRect().width||1000));
  const H=Math.max(160,Math.round(chart.getBoundingClientRect().height||270));
  const px=22,py=18,plotW=W-px*2,plotH=H-py*2;
  const X=i=>px+(i/(vals.length-1||1))*plotW;
  const Y=v=>py+(chartMax-v)/span*plotH;
  const path=vals.map((v,i)=>(i?'L':'M')+X(i).toFixed(2)+' '+Y(v).toFixed(2)).join(' ');
  const floorY=H-py;
  const area=path+' L '+X(vals.length-1).toFixed(2)+' '+floorY+' L '+X(0).toFixed(2)+' '+floorY+' Z';

  el('equityMeta').innerHTML=
    '<span class="equityChip">'+esc(tx('Start','Старт'))+' <b>'+balanceMoney(ctx.base)+'</b></span>'+
    '<span class="equityChip">'+esc(tx('Current','Текущий'))+' <b>'+balanceMoney(eq)+'</b></span>'+
    '<span class="equityChip">'+esc(tx('Peak','Пик'))+' <b>'+balanceMoney(peak)+'</b></span>'+
    '<span class="equityChip">'+trades.length+' '+esc(tx('counted trades','учитываемых сделок'))+'</span>'+
    (!ctx.configured?'<span class="equityChip amber">'+esc(tx('Set starting balance in Accounts','Задай стартовый баланс в Счетах'))+'</span>':'');

  chart.tabIndex=0;chart.setAttribute('role','group');
  chart.setAttribute(
    'aria-label',
    tx(
      'Equity curve. Start '+balanceMoney(ctx.base)+', current '+balanceMoney(eq)+'. Use left and right arrow keys to inspect points.',
      'Кривая капитала. Старт '+balanceMoney(ctx.base)+', текущий '+balanceMoney(eq)+'. Используй стрелки влево и вправо для просмотра точек.'
    )
  );

  const tipMinW=150,tipMaxW=Math.min(260,W-16),tipH=58;
  chart.innerHTML=
    '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true" focusable="false">'+
      '<defs><linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#21df8c" stop-opacity=".24"/><stop offset="100%" stop-color="#21df8c" stop-opacity=".01"/></linearGradient></defs>'+
      '<path d="'+area+'" fill="url(#eqFill)"/>'+
      '<path d="'+path+'" fill="none" stroke="#21df8c" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>'+
      '<line class="equityHoverLine" x1="0" y1="'+py+'" x2="0" y2="'+(H-py)+'"></line>'+
      '<circle class="equityHoverDot" cx="0" cy="0" r="5" vector-effect="non-scaling-stroke"></circle>'+
      '<rect class="equityHitArea" x="0" y="0" width="'+W+'" height="'+H+'" fill="transparent"></rect>'+
      '<g class="equitySvgTooltip" aria-hidden="true">'+
        '<rect class="equityTipBg" width="'+tipMinW+'" height="'+tipH+'" rx="10" ry="10"></rect>'+
        '<text class="equityTipDate" x="10" y="14"></text>'+
        '<text class="equityTipValue" x="10" y="32"><tspan class="equityTipLabel"></tspan><tspan class="equityTipBalance" dx="5"></tspan></text>'+
        '<text class="equityTipMeta" x="10" y="49"></text>'+
      '</g>'+
    '</svg>'+
    '<div class="srOnly equityTooltipA11y" role="status" aria-live="polite" aria-atomic="true"></div>';

  const svg=chart.querySelector('svg');
  const hit=chart.querySelector('.equityHitArea');
  const line=chart.querySelector('.equityHoverLine');
  const dot=chart.querySelector('.equityHoverDot');
  const tip=chart.querySelector('.equitySvgTooltip');
  const dateEl=tip.querySelector('.equityTipDate');
  const valueEl=tip.querySelector('.equityTipValue');
  const labelEl=tip.querySelector('.equityTipLabel');
  const balanceEl=tip.querySelector('.equityTipBalance');
  const metaEl=tip.querySelector('.equityTipMeta');
  const a11yEl=chart.querySelector('.equityTooltipA11y');

  function showPoint(clientX,{announce=false}={}){
    const rect=svg.getBoundingClientRect();
    if(!rect.width)return;
    const vx=(clientX-rect.left)/rect.width*W;
    const idx=Math.max(0,Math.min(points.length-1,Math.round((vx-px)/plotW*(points.length-1))));
    const p=points[idx],cx=X(idx),cy=Y(p.equity);
    line.setAttribute('x1',cx);
    line.setAttribute('x2',cx);
    line.classList.add('on');
    dot.setAttribute('cx',cx);
    dot.setAttribute('cy',cy);
    dot.classList.add('on');

    const prevPoint=idx>0?points[idx-1]:null;
    const balanceClass=!prevPoint?'':p.equity>prevPoint.equity?'up':p.equity<prevPoint.equity?'down':'';
    labelEl.textContent=tx('Equity','Капитал');
    balanceEl.setAttribute('class','equityTipBalance'+(balanceClass?' '+balanceClass:''));
    balanceEl.textContent=balanceMoney(p.equity);

    let spokenMeta='';
    if(p.kind==='start'){
      dateEl.textContent=tx('Start','Старт');
      spokenMeta=dateRange.mode==='all'?tx('Starting balance','Стартовый баланс'):tx('Balance at period start','Баланс на начало периода');
      metaEl.textContent=spokenMeta;
    }else{
      const source=p.kind==='trade'?p.trade?.source:p.cash?.source;
      dateEl.textContent=formatSourceDateTime(p.time||p.trade?.closedAt,source,{
        year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'
      });

      if(p.kind==='cash'){
        const amount=Number(p.amount||0);
        const label=amount>=0?tx('Deposit / credit','Пополнение / кредит'):tx('Withdrawal / adjustment','Вывод / корректировка');
        metaEl.innerHTML=esc(label)+' · <tspan class="equityTipPnl '+(amount>=0?'win':'loss')+'">'+esc(money(amount))+'</tspan>';
        spokenMeta=label+' '+money(amount);
      }else{
        const tradePnl=Number(p.trade.pnl||0);
        const side=String(p.trade.side||'').toUpperCase();
        const sideClass=side==='BUY'?'buy':side==='SELL'?'sell':'';
        const pnlClass=tradePnl>0?'win':tradePnl<0?'loss':'flat';
        const symbol=String(p.trade.symbol||'');
        metaEl.innerHTML='#'+esc(p.tradeNumber)+' · '+esc(symbol)+' <tspan class="equityTipSide '+sideClass+'">'+esc(side)+'</tspan> · '+esc(tx('Trade','Сделка'))+' <tspan class="equityTipPnl '+pnlClass+'">'+esc(money(tradePnl))+'</tspan>';
        spokenMeta='#'+p.tradeNumber+' '+symbol+' '+side+' '+tx('Trade','Сделка')+' '+money(tradePnl);
      }
    }

    const measuredW=Math.ceil(Math.max(
      dateEl.getComputedTextLength(),
      valueEl.getComputedTextLength(),
      metaEl.getComputedTextLength()
    )+20);
    const tipW=Math.max(tipMinW,Math.min(tipMaxW,measuredW));
    tip.querySelector('.equityTipBg').setAttribute('width',tipW);
    let tipX=Math.max(8,Math.min(W-tipW-8,cx-tipW/2));
    let tipY=cy-tipH-10;
    if(tipY<8)tipY=Math.min(H-tipH-8,cy+10);
    tip.setAttribute('transform','translate('+tipX.toFixed(2)+' '+tipY.toFixed(2)+')');
    tip.classList.add('on');

    if(announce){
      a11yEl.textContent=dateEl.textContent+'. '+tx('Equity','Капитал')+' '+balanceMoney(p.equity)+'. '+spokenMeta;
    }
  }

  function hidePoint(){
    line.classList.remove('on');
    dot.classList.remove('on');
    tip.classList.remove('on');
    a11yEl.textContent='';
  }

  hit.addEventListener('pointermove',e=>showPoint(e.clientX));
  hit.addEventListener('pointerdown',e=>showPoint(e.clientX));
  hit.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')hidePoint()});
  let keyboardIdx=points.length-1;
  const showKeyboardPoint=()=>{
    const rect=svg.getBoundingClientRect();
    if(rect.width)showPoint(rect.left+(X(keyboardIdx)/W)*rect.width,{announce:true});
  };
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
  let html='<div class="mistakeSummary"><div class="mistakeCard"><div class="metricLabel">'+esc(tx('No mistake marked','Без отмеченной ошибки'))+'</div><div class="metricValue compactMetric '+(sum(clean)>=0?'green':'red')+'">'+money(sum(clean))+'</div><div class="sub">'+clean.length+' '+esc(tx('trades','сделок'))+'</div></div><div class="mistakeCard"><div class="metricLabel">'+esc(tx('With mistake / violation','С ошибкой / нарушением'))+'</div><div class="metricValue compactMetric '+(sum(withMistake)>=0?'green':'red')+'">'+money(sum(withMistake))+'</div><div class="sub">'+withMistake.length+' '+esc(tx('trades','сделок'))+'</div></div></div>';
  if(list.length)html+='<div class="mistakeList">'+list.map(g=>'<div class="mistakeRow"><div><b>'+esc(g.label)+'</b><div class="sub">'+g.count+' trades</div></div><b class="'+(g.pnl>=0?'green':'red')+'">'+money(g.pnl)+'</b><span class="mistakeWr sub">'+(g.count?Math.round(g.wins/g.count*100):0)+'% WR</span></div>').join('')+'</div>';
  else html+='<div class="hint">'+esc(tx('Once you start marking Mistake / violation in Trade Review, their impact on results will appear here.','Когда начнёшь отмечать Mistake / violation в Trade Review, здесь появится влияние ошибок на результат.'))+'</div>';
  el('mistakeAnalytics').innerHTML=html;
}
function renderWeekday(){
  const a=model.weekday.filter(x=>x.name!=='Sun'&&x.name!=='Sat'),mx=Math.max(1,...a.map(x=>Math.abs(x.value)));
  const weekdayLabels={Mon:tx('Mon','Пн'),Tue:tx('Tue','Вт'),Wed:tx('Wed','Ср'),Thu:tx('Thu','Чт'),Fri:tx('Fri','Пт')};
  el('weekday').innerHTML=a.map(x=>{const pct=(Math.abs(x.value)/mx*100).toFixed(2);return '<div class="rowbar"><div>'+esc(weekdayLabels[x.name]||x.name)+'</div><svg class="weekdayTrack" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true"><rect class="weekdayTrackBg" x="0" y="0" width="100" height="18" rx="6"></rect><rect class="weekdayTrackFill" x="0" y="0" width="'+pct+'" height="18" rx="6"></rect></svg><div class="rowValue '+(x.value>=0?'green':'red')+'">'+money(x.value)+'</div></div>'}).join('');
}
function renderSymbols(){el('symbols').innerHTML=model.symbols.length?model.symbols.map(s=>'<div class="sym"><b>'+esc(s.symbol)+'</b><div class="metricValue compactMetric '+(s.pnl>=0?'green':'red')+'">'+money(s.pnl)+'</div><div class="sub">'+s.trades+' '+esc(tx('trades','сделок'))+' · '+s.wr.toFixed(0)+'% WR · '+s.days+'d</div></div>').join(''):'<div class="empty">'+esc(tx('No trades yet','Сделок пока нет'))+'</div>'}
function renderCalendar(){
  const y=monthDate.getFullYear(),m=monthDate.getMonth(),ym=y+'-'+String(m+1).padStart(2,'0');
  el('monthLabel').textContent=monthDate.toLocaleDateString(uiLocale(),{month:'long',year:'numeric'});
  const map={};model.daily.forEach(d=>map[d.date]=d);
  const monthRows=model.daily.filter(d=>d.date.startsWith(ym+'-'));
  const mpnl=monthRows.reduce((s,d)=>s+d.pnl,0),mtr=monthRows.reduce((s,d)=>s+d.trades,0),mw=monthRows.reduce((s,d)=>s+d.wins,0),ml=monthRows.reduce((s,d)=>s+d.losses,0);
  el('calendarSummary').innerHTML='<span class="calChip pnl '+(mpnl>0?'pos':mpnl<0?'neg':'')+'">'+money(mpnl)+'</span><span class="calChip">'+mtr+' '+esc(tx('trades','сделок'))+'</span><span class="calChip">'+((mw+ml)?(mw/(mw+ml)*100).toFixed(0):'—')+'% WR</span>';

  const dowLabels=currentLang==='ru'?['Вс','Пн','Вт','Ср','Чт','Пт','Сб']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html=dowLabels.map(x=>'<div class="dow">'+x+'</div>').join('')+'<div class="dow weekHead">'+esc(tx('WEEK','НЕДЕЛЯ'))+'</div>';
  const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate(),cells=Math.ceil((first+days)/7)*7;
  let weekPnl=0,weekTrades=0;
  for(let i=0;i<cells;i++){
    const d=i-first+1;
    if(d>=1&&d<=days){
      const k=ym+'-'+String(d).padStart(2,'0'),x=map[k],review=dailyReviewMap[k];
      if(x){weekPnl+=x.pnl;weekTrades+=x.trades}
      const title=x?(money(x.pnl)+' · '+(x.wr==null?'—':x.wr.toFixed(0)+'% WR')+' · '+x.trades+' '+tx('trades','сделок')):tx('No counted trades','Нет учитываемых сделок');
      const todayClass=k===dayKey(new Date())?' today':'';
      const reviewSaved=tx('Daily review saved','Разбор дня сохранён');
      html+='<button type="button" class="day clickable '+(x?(x.pnl>=0?'pos':'neg'):'')+todayClass+'" data-review-date="'+k+'" title="'+esc(title)+'" aria-label="'+esc(k+' · '+title+(review?' · '+reviewSaved:''))+'"><div class="dnum">'+d+(review?'<span class="reviewDot" title="'+esc(reviewSaved)+'" aria-hidden="true"></span>':'')+'</div>'+(x?'<div class="dpnl '+(x.pnl>=0?'green':'red')+'">'+money(x.pnl)+'</div><div class="dmeta">'+(x.wr==null?'—':x.wr.toFixed(0)+'%')+' · '+x.trades+' '+esc(tx('trades','сделок'))+'</div>':'')+'</button>';
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

function tradeEmptyMessage({q,result,ghost,side,source,review}){
  if(q)return tx('No trades match your search.','Нет сделок по этому поиску.');
  if(ghost==='ghost')return tx('No ghost trades in this period.','Нет Ghost-сделок за этот период.');
  if(ghost==='counted')return tx('No counted trades in this period.','Нет учитываемых сделок за этот период.');
  if(result==='loss')return tx('No SL trades in this period.','Нет SL-сделок за этот период.');
  if(result==='worked')return tx('No worked trades in this period.','Нет Worked-сделок за этот период.');
  if(result==='other')return tx('No Other trades in this period.','Нет сделок Other за этот период.');
  if(review==='reviewed')return tx('No reviewed trades in this period.','Нет разобранных сделок за этот период.');
  if(review==='unreviewed')return tx('No unreviewed trades in this period.','Нет неразобранных сделок за этот период.');
  if(side)return tx('No ','Нет сделок ')+side+tx(' trades in this period.',' за этот период.');
  if(source)return tx('No ','Нет сделок ')+source+tx(' trades in this period.',' за этот период.');
  return dateRange.mode==='all'?tx('No trades yet.','Сделок пока нет.'):tx('No trades in the selected period.','Нет сделок в выбранном периоде.');
}
function updateBulkGhostBar(){
  el('bulkGhostBar').classList.toggle('hide',!bulkSelectMode);
  el('bulkHead').classList.toggle('hide',!bulkSelectMode);
  el('bulkSelectBtn').classList.toggle('on',bulkSelectMode);
  el('bulkGhostCount').textContent=selectedTradeIds.size+' '+tx('selected','выбрано');
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
  if(!(await askConfirm(tx('Mark ','Отметить ')+ids.length+tx(' selected trade(s) as Ghost? They stay in history but are excluded from analytics.',' выбранных сделок как Ghost? Они останутся в истории, но будут исключены из аналитики.'))))return;
  const u=(await sb.auth.getUser()).data.user;
  const now=new Date().toISOString();
  const rows=ids.map(id=>({user_id:u.id,trade_id:id,excluded_from_stats:true,exclusion_reason:'Bulk marked as accidental / technical trade',updated_at:now}));
  const {error}=await sb.from('trade_notes').upsert(rows,{onConflict:'user_id,trade_id'});
  if(error){showToast(error.message,'error');return;}
  setBulkSelectMode(false);
  await loadData();
}
function renderReviewQueue(){
  const counted=scopedTrades.filter(t=>!t.excluded_from_stats);
  const reviewed=counted.filter(isTradeReviewed).length;
  const pending=counted.length-reviewed;
  el('reviewProgressText').textContent=reviewed+' / '+counted.length+' '+tx('reviewed','разобрано');
  el('reviewNextBtn').disabled=pending===0;
  el('reviewQueue').classList.toggle('complete',pending===0&&counted.length>0);
}
function openNextUnreviewed(){
  const next=scopedTrades.filter(t=>!t.excluded_from_stats&&!isTradeReviewed(t))
    .sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt))[0];
  if(next)openTrade(next.id);
}
function renderTrades(){
  const q=el('search').value.toLowerCase().trim(),side=el('sideFilter').value,source=el('sourceFilter').value,result=el('resultFilter').value,ghost=el('ghostFilter').value,review=el('reviewFilter').value;
  const rows=scopedTrades.filter(t=>(!side||t.side===side)&&(!source||t.source===source))
    .filter(t=>result==='worked'?isStrategyWin(t):result==='loss'?isStrategyLoss(t):result==='other'?isStrategyOther(t):true)
    .filter(t=>review==='reviewed'?isTradeReviewed(t):review==='unreviewed'?!isTradeReviewed(t):true)
    .filter(t=>ghost==='ghost'?!!t.excluded_from_stats:ghost==='counted'?!t.excluded_from_stats:true)
    .filter(t=>!q||[t.symbol,t.setup,t.tags,t.strategy,t.mistake,t.exclusion_reason].join(' ').toLowerCase().includes(q));

  const emptyCols=bulkSelectMode?7:6;
  el('tradeRows').innerHTML=rows.length?rows.map(t=>{
    const selected=selectedTradeIds.has(t.id);
    const check=bulkSelectMode?'<td class="bulkCheck"><input type="checkbox" '+(selected?'checked':'')+' tabindex="-1" aria-label="'+esc(tx('Select trade','Выбрать сделку'))+'"></td>':'';
    return '<tr class="tradeRow '+(t.excluded_from_stats?'ghostRow ':'')+(selected?'bulkSelected':'')+'" data-id="'+esc(t.id)+'">'+check+'<td class="tradeDate">'+esc(formatSourceDateTime(t.closedAt,t.source))+'</td><td class="tradeSymbol"><button type="button" class="tradeOpenBtn" data-open-trade="'+esc(t.id)+'" aria-label="'+esc(tx('Open','Открыть'))+' '+esc(t.symbol)+' '+esc(t.side)+' '+esc(tx('trade','сделку'))+'">'+esc(t.symbol)+'</button>'+(t.excluded_from_stats?'<span class="ghostBadge">GHOST</span>':'')+(isTradeReviewed(t)?'<span class="reviewedBadge">'+esc(tx('REVIEWED','РАЗОБРАНО'))+'</span>':'')+'</td><td class="tradeSide"><span class="pill">'+esc(t.side)+'</span></td><td class="tradePnl '+(t.pnl>=0?'green':'red')+'">'+money(t.pnl)+'</td><td class="tradeOrders">'+t.orderCount+(isStrategyLoss(t)?'<span class="slBadge">SL</span>':'')+'</td><td class="tradeSetup">'+esc(t.setup||t.strategy||'')+'</td></tr>';
  }).join(''):'<tr><td colspan="'+emptyCols+'" class="empty">'+esc(tradeEmptyMessage({q,result,ghost,side,source,review}))+'</td></tr>';

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
  renderReviewQueue();
}

el('search').oninput=renderTrades;el('sideFilter').onchange=renderTrades;el('sourceFilter').onchange=renderTrades;el('resultFilter').onchange=renderTrades;el('ghostFilter').onchange=renderTrades;el('reviewFilter').onchange=renderTrades;
el('bulkSelectBtn').onclick=()=>setBulkSelectMode(!bulkSelectMode);
el('bulkCancelBtn').onclick=()=>setBulkSelectMode(false);
el('bulkGhostBtn').onclick=markSelectedGhost;
el('reviewNextBtn').onclick=openNextUnreviewed;

function openDailyReview(date){
  activeReviewDate=date;
  const dayTrades=model.trades.filter(t=>tradeDayKey(t)===date);
  const pnl=dayTrades.reduce((s,t)=>s+t.pnl,0),wins=dayTrades.filter(isStrategyWin).length,losses=dayTrades.filter(isStrategyLoss).length,other=dayTrades.filter(isStrategyOther).length;
  const wr=(wins+losses)?wins/(wins+losses)*100:0;
  el('dailyTitle').textContent=new Date(date+'T12:00:00').toLocaleDateString(uiLocale(),{year:'numeric',month:'long',day:'numeric'});
  const stats=[['P&L',money(pnl)],[tx('Logical Trades','Логические сделки'),dayTrades.length],[tx('Win Rate','Винрейт'),wr.toFixed(1)+'%'],[tx('Worked / SL / Other','Worked / SL / Другое'),wins+' / '+losses+' / '+other]];
  el('dailyStats').innerHTML=stats.map(x=>'<div class="kv"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join('');
  const r=dailyReviewMap[date]||{};
  el('dWorked').value=r.what_worked||'';
  el('dWrong').value=r.what_wrong||'';
  el('dTomorrow').value=r.tomorrow_focus||'';
  el('dNotes').value=r.notes||'';
  dailyReviewSnapshot=dailyReviewState();
  el('dailyModal').classList.remove('hide');
}
function dailyReviewState(){
  return JSON.stringify({worked:el('dWorked').value,wrong:el('dWrong').value,tomorrow:el('dTomorrow').value,notes:el('dNotes').value});
}
async function closeDailyReview(force=false){
  if(!force&&activeReviewDate&&dailyReviewSnapshot&&dailyReviewState()!==dailyReviewSnapshot){
    if(!(await askConfirm(tx('Discard unsaved daily review changes?','Отменить несохранённые изменения разбора дня?'),{danger:true,confirmText:tx('Discard','Отменить изменения')})))return false;
  }
  el('dailyModal').classList.add('hide');activeReviewDate=null;dailyReviewSnapshot='';return true;
}
el('closeDailyModal').onclick=()=>closeDailyReview();
el('saveDailyReview').onclick=async()=>{
  if(!activeReviewDate)return;
  const u=(await sb.auth.getUser()).data.user;
  const row={user_id:u.id,review_date:activeReviewDate,what_worked:el('dWorked').value,what_wrong:el('dWrong').value,tomorrow_focus:el('dTomorrow').value,notes:el('dNotes').value,updated_at:new Date().toISOString()};
  const {error}=await sb.from('daily_reviews').upsert(row,{onConflict:'user_id,review_date'});
  if(error){if(typeof showToast==='function')showToast(error.message,'error');return}
  dailyReviewSnapshot=dailyReviewState();
  await closeDailyReview(true);
  await loadData({silent:true});
}

function tradeReviewState(){
  return JSON.stringify({
    setup:el('fSetup').value,
    tier:el('fTier').value,
    probability:el('fProbability').value,
    cr:el('fCr').value,
    plan:el('fPlan').value,
    outcome:el('fOutcome').value,
    mistake:el('fMistake').value,
    excluded:el('fExcluded').checked,
    exclusionReason:el('fExclusionReason').value,
    notes:el('fNotes').value
  });
}
async function closeTradeReview(force=false){
  if(!force&&activeTrade&&tradeReviewSnapshot&&tradeReviewState()!==tradeReviewSnapshot){
    if(!(await askConfirm(tx('Discard unsaved changes?','Отменить несохранённые изменения?'),{danger:true,confirmText:tx('Discard','Отменить изменения')})))return false;
  }
  el('tradeModal').classList.add('hide');
  activeTrade=null;
  tradeReviewSnapshot='';
  return true;
}
function openTrade(id){
  const t=scopedTrades.find(x=>x.id===id)||allTrades.find(x=>x.id===id);if(!t)return;activeTrade=t;
  el('modalTitle').textContent=t.symbol+' '+t.side+' · '+money(t.pnl)+(t.excluded_from_stats?' · GHOST':'');
  const details=[[tx('Source','Источник'),t.source],[tx('Account','Счёт'),t.account+(t.server?' · '+t.server:'')],[tx('Opened','Открыта'),formatSourceDateTime(t.openedAt,t.source)],[tx('Closed','Закрыта'),formatSourceDateTime(t.closedAt,t.source)],[tx('Orders','Ордера'),t.orderCount],[tx('Result','Результат'),outcomeLabel(t)],[tx('Entries / exits','Входы / выходы'),t.entries+' / '+t.exits],[tx('Strategy','Стратегия'),t.strategy]];
  el('tradeDetails').innerHTML=details.map(x=>'<div class="kv"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join('');
  el('fSetup').value=t.setup||'';el('fTier').value=t.tier||'';el('fProbability').value=t.probability==null?'':t.probability;el('fCr').value=t.cr_value==null?'':t.cr_value;el('fPlan').value=t.plan_ok||'';el('fOutcome').value=t.outcome_override||'';el('fMistake').value=t.mistake||'';document.querySelectorAll('[data-mistake]').forEach(b=>b.classList.toggle('on',b.dataset.mistake===(t.mistake||'')));el('fExcluded').checked=!!t.excluded_from_stats;el('fExclusionReason').value=t.exclusion_reason||'';el('fExclusionReason').disabled=!el('fExcluded').checked;el('fNotes').value=t.notes||'';
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
    showToast(tx('Probability must be between 0% and 100%.','Вероятность должна быть от 0% до 100%.'),'error');return;
  }
  const u=(await sb.auth.getUser()).data.user;
  const now=new Date().toISOString();
  const row={user_id:u.id,trade_id:activeTrade.id,setup:el('fSetup').value,tier:el('fTier').value,probability,cr_value:el('fCr').value===''?null:Number(el('fCr').value),plan_ok:el('fPlan').value,outcome_override:el('fOutcome').value||null,mistake:el('fMistake').value,excluded_from_stats:el('fExcluded').checked,exclusion_reason:el('fExcluded').checked?(el('fExclusionReason').value.trim()||'Accidental / technical trade'):null,notes:el('fNotes').value,reviewed_at:now,updated_at:now};
  const {error}=await sb.from('trade_notes').upsert(row,{onConflict:'user_id,trade_id'});if(error){if(typeof showToast==='function')showToast(error.message,'error');return}
  tradeReviewSnapshot=tradeReviewState();
  closeTradeReview(true);
  await loadData({silent:true});
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
  if(!(await askConfirm(tx('Create a new ingest token? Any previous token will stop working.','Создать новый ingest token? Если старый уже был, он перестанет работать.'))))return;
  const {data,error}=await sb.rpc('create_or_rotate_ingest_token');if(error){showToast(error.message,'error');return}
  liveToken=data;el('tokenBox').textContent=data;showToast(tx('Token created.','Token создан.'),'success');
};
el('copyTokenBtn').onclick=async()=>{
  if(!liveToken){showToast(tx('Create a token first.','Сначала создай token.'),'error');return}
  await navigator.clipboard.writeText(liveToken);showToast(tx('Token copied.','Token скопирован'),'success');
};
el('langToggleBtn').onclick=()=>setLanguage(currentLang==='ru'?'en':'ru');
el('confirmCancelBtn').onclick=()=>closeConfirm(false);
el('confirmOkBtn').onclick=()=>closeConfirm(true);

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker
      .register('/service-worker.js',{updateViaCache:'none'})
      .then(reg=>reg.update())
      .catch(()=>{});
  });
}
bindStaticI18n();
applyLanguage();
setupModalAccessibility();
boot();