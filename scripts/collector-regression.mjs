import fs from 'node:fs/promises';

function ok(cond,msg){ if(!cond) throw new Error(msg); }

const [arch, pyproject, mt5, mt4py, mt4mql, crypto, dpapi, identity] = await Promise.all([
  fs.readFile('docs/INVESTOR_COLLECTOR_V1.md','utf8'),
  fs.readFile('collector/pyproject.toml','utf8'),
  fs.readFile('collector/src/trading_journal_collector/adapters/mt5.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/adapters/mt4.py','utf8'),
  fs.readFile('collector/mt4/TradeJournalExport_MT4.mq4','utf8'),
  fs.readFile('collector/src/trading_journal_collector/crypto.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/windows_dpapi.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/identity.py','utf8'),
]);

ok(arch.includes('MetaTrader 4') && arch.includes('MetaTrader 5'),'architecture must cover MT4 and MT5');
ok(arch.includes('v1 is not complete until both MT4 and MT5'),'dual-platform completion gate missing');
ok(arch.includes('Do not ship the Investor Password form yet; backend/collector phases are still incomplete.'),'credential-entry release gate missing');
ok(arch.includes('Supabase JS is pinned to 2.117.1'),'frontend SDK pinning record missing');
ok(arch.includes('CSP script-src permits only self plus that exact Supabase SDK path'),'frontend CSP record missing');
ok(arch.includes('collector_private.broker_credentials'),'private credential storage design missing');
ok(arch.includes('RSA-OAEP-SHA256'),'credential encryption contract missing');

ok(pyproject.includes('MetaTrader5==5.0.6180'),'MetaTrader5 version is not pinned');
ok(pyproject.includes('cryptography==50.0.1'),'cryptography version is not pinned');
ok(crypto.includes('RSA_KEY_BITS = 3072'),'collector RSA key size changed');
ok(crypto.includes('RSA-OAEP-SHA256'),'collector RSA algorithm marker missing');
ok(crypto.includes('padding.MGF1(algorithm=hashes.SHA256())'),'collector OAEP MGF1 SHA-256 missing');
ok(crypto.includes('algorithm=hashes.SHA256()'),'collector OAEP SHA-256 missing');
ok(dpapi.includes('CryptProtectData') && dpapi.includes('CryptUnprotectData'),'Windows DPAPI protection missing');
ok(!/^\s*CRYPTPROTECT_LOCAL_MACHINE\s*=/m.test(dpapi),'DPAPI must not define machine-wide protection flag');
ok(!/\|\s*CRYPTPROTECT_LOCAL_MACHINE\b/.test(dpapi),'DPAPI must not enable machine-wide protection flag');
ok(identity.includes('hash_collector_token'),'collector token hash contract missing');
ok(!identity.includes('print('),'collector identity code must not print secret material');

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
