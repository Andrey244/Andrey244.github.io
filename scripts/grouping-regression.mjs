import fs from 'node:fs/promises';
import vm from 'node:vm';

function ok(cond,msg){ if(!cond) throw new Error('grouping regression: '+msg); }

const html=await fs.readFile('index.html','utf8');

function extractFunction(name){
  const start=html.indexOf('function '+name+'(');
  if(start<0) throw new Error('missing function '+name);
  const brace=html.indexOf('{',start);
  let depth=0,quote=null,escape=false;
  for(let i=brace;i<html.length;i++){
    const ch=html[i];
    if(quote){
      if(escape){escape=false;continue}
      if(ch==='\\'){escape=true;continue}
      if(ch===quote)quote=null;
      continue;
    }
    if(ch==="'"||ch==='"'||ch==='\`'){quote=ch;continue}
    if(ch==='{')depth++;
    else if(ch==='}'){
      depth--;
      if(depth===0)return html.slice(start,i+1);
    }
  }
  throw new Error('unterminated function '+name);
}

const names=['dayKey','hash','tag','accountKey','dedupeEvents','freshTrade','finalize','addMT5','groupMT5','summarizeMT4','groupMT4','stabilizeTradeIds','buildModel'];
const context=vm.createContext({console});
for(const name of names) vm.runInContext(extractFunction(name),context);

const {
  dedupeEvents,groupMT4,groupMT5,buildModel
}=context;

const base={
  source:'MT4',account:'100',server:'Server-A',symbol:'EURUSD',side:'BUY',
  magic:'10',volume:0.1,open_price:1.1,close_price:1.11,price:1.1,
  profit:1,commission:0,swap:0,fee:0,comment:'',entry_type:'ORDER'
};
const mt4=(id,open,close,extra={})=>({...base,event_id:String(id),order_id:String(id),open_time:open,close_time:close,event_time:close,event_time_ms:new Date(close).getTime(),...extra});

// 1) Three overlapping orders are one Logical Trade.
let rows=[
  mt4(1,'2026-09-22T10:00:00Z','2026-09-22T10:10:00Z'),
  mt4(2,'2026-09-22T10:05:00Z','2026-09-22T10:12:00Z'),
  mt4(3,'2026-09-22T10:07:00Z','2026-09-22T10:15:00Z')
];
let trades=groupMT4(rows);
ok(trades.length===1,'overlapping MT4 orders should group into one trade');
ok(trades[0].orderCount===3,'overlapping trade should contain 3 orders');

// 2) Same-second EA re-entry after flat is a NEW trade.
rows=[
  mt4(10,'2026-09-22T10:00:00Z','2026-09-22T10:10:00Z'),
  mt4(11,'2026-09-22T10:10:00Z','2026-09-22T10:20:00Z')
];
trades=groupMT4(rows);
ok(trades.length===2,'same-second re-entry after flat must be a new Logical Trade');

// 3) Different Magic => different trades.
rows=[
  mt4(20,'2026-09-22T10:00:00Z','2026-09-22T10:20:00Z',{magic:'10'}),
  mt4(21,'2026-09-22T10:05:00Z','2026-09-22T10:15:00Z',{magic:'11'})
];
ok(groupMT4(rows).length===2,'different Magic numbers must not merge');

// 4) Same account number on different servers => different trades.
rows=[
  mt4(30,'2026-09-22T10:00:00Z','2026-09-22T10:20:00Z',{server:'Server-A'}),
  mt4(31,'2026-09-22T10:05:00Z','2026-09-22T10:15:00Z',{server:'Server-B'})
];
ok(groupMT4(rows).length===2,'different servers must not merge');

// 5) Duplicate raw event is defensively removed before grouping.
const duplicate=mt4(40,'2026-09-22T10:00:00Z','2026-09-22T10:10:00Z',{profit:7});
rows=[duplicate,{...duplicate}];
const unique=dedupeEvents(rows);
ok(unique.length===1,'duplicate event guard failed');
trades=groupMT4(unique);
ok(trades.length===1&&trades[0].pnl===7,'duplicate event must not double P&L');

// 6) Cash events never become Logical Trades.
rows=[{
  source:'MT4',account:'100',server:'Server-A',event_id:'cash1',order_id:'cash1',
  event_time:'2026-09-22T09:00:00Z',event_time_ms:new Date('2026-09-22T09:00:00Z').getTime(),
  symbol:'CASH',side:null,entry_type:'BALANCE',volume:0,profit:1000
}];
ok(groupMT4(rows).length===0,'cash flow must not become a Logical Trade');

// 7) MT5 round-trip exposure forms one trade.
const mt5=[
  {source:'MT5',account:'200',server:'S',event_id:'a',order_id:'a',symbol:'EURUSD',side:'BUY',magic:'1',volume:1,price:1.1,profit:0,commission:0,swap:0,fee:0,event_time:'2026-09-22T10:00:00Z',event_time_ms:1},
  {source:'MT5',account:'200',server:'S',event_id:'b',order_id:'b',symbol:'EURUSD',side:'SELL',magic:'1',volume:1,price:1.11,profit:12,commission:0,swap:0,fee:0,event_time:'2026-09-22T10:05:00Z',event_time_ms:2}
];
trades=groupMT5(mt5);
ok(trades.length===1&&trades[0].pnl===12,'MT5 exposure round-trip regression');

// 8) Ghost trade exclusion must remove it from analytics.
const analyticsInput=[
  {pnl:10,closedAt:'2026-09-22T10:00:00Z',symbol:'EURUSD',excluded_from_stats:false},
  {pnl:-99,closedAt:'2026-09-22T11:00:00Z',symbol:'EURUSD',excluded_from_stats:true}
];
const m=buildModel(analyticsInput.filter(t=>!t.excluded_from_stats));
ok(m.summary.trades===1&&m.summary.pnl===10&&m.summary.wins===1&&m.summary.losses===0,'Ghost trade leaked into analytics');

console.log('Grouping regression tests: PASS');
