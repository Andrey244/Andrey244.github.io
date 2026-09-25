import fs from 'node:fs/promises';

function ok(cond,msg){ if(!cond) throw new Error(msg); }

const [arch, pyproject, mt5, mt4py, mt4mql] = await Promise.all([
  fs.readFile('docs/INVESTOR_COLLECTOR_V1.md','utf8'),
  fs.readFile('collector/pyproject.toml','utf8'),
  fs.readFile('collector/src/trading_journal_collector/adapters/mt5.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/adapters/mt4.py','utf8'),
  fs.readFile('collector/mt4/TradeJournalExport_MT4.mq4','utf8'),
]);

ok(arch.includes('MetaTrader 4') && arch.includes('MetaTrader 5'),'architecture must cover MT4 and MT5');
ok(arch.includes('v1 is not complete until both MT4 and MT5'),'dual-platform completion gate missing');
ok(arch.includes('Do not ship the Investor Password form yet.'),'credential-entry security gate missing');
ok(arch.includes('collector_private.broker_credentials'),'private credential storage design missing');
ok(arch.includes('RSA-OAEP-SHA256'),'credential encryption contract missing');

ok(pyproject.includes('MetaTrader5==5.0.6180'),'MetaTrader5 version is not pinned');

for(const pair of [['MT5 Python adapter',mt5],['MT4 Python adapter',mt4py]]){
  const name=pair[0], src=pair[1];
  ok(!/\border_send\b|\border_check\b|\bOrderSend\b|\bOrderModify\b|\bOrderClose\b/.test(src),name+': trade API reference is forbidden');
}

ok(mt5.includes('trade_allowed'),'MT5 adapter: read-only gate missing');
ok(mt5.includes('WriteCapableCredentialError'),'MT5 adapter: write-capable rejection missing');
ok(mt4py.includes('ExpertsTrades=false'),'MT4 startup: ExpertsTrades=false missing');
ok(mt4py.includes('ExpertsDllImport=false'),'MT4 startup: DLL import must be disabled');

ok(mt4mql.includes('ACCOUNT_TRADE_ALLOWED'),'MT4 exporter: account trade permission gate missing');
ok(mt4mql.includes('TERMINAL_CONNECTED'),'MT4 exporter: terminal connection gate missing');
ok(mt4mql.includes('closed_by_sl'),'MT4 exporter: SL evidence missing');
ok(!/\bOrderSend\s*\(|\bOrderModify\s*\(|\bOrderClose\s*\(|\bOrderDelete\s*\(/.test(mt4mql),'MT4 exporter contains a trading operation');

console.log('Collector contract regression passed.');
