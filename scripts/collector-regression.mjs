import fs from 'node:fs/promises';

function ok(cond,msg){ if(!cond) throw new Error(msg); }

const [arch, pyproject, mt5, mt4py, mt4mql, crypto, dpapi, identity, serviceSql, cursorSql, registerSql, strictLeaseSql, unifiedIngestSql, edgeShared, brokerKey, brokerConnect, brokerDisconnect, collectorNext, collectorReport, collectorIngest, api, worker, main, provision, service, serviceConfig, installer, preflight, manualMt4] = await Promise.all([
  fs.readFile('docs/INVESTOR_COLLECTOR_V1.md','utf8'),
  fs.readFile('collector/pyproject.toml','utf8'),
  fs.readFile('collector/src/trading_journal_collector/adapters/mt5.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/adapters/mt4.py','utf8'),
  fs.readFile('collector/mt4/TradeJournalExport_MT4.mq4','utf8'),
  fs.readFile('collector/src/trading_journal_collector/crypto.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/windows_dpapi.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/identity.py','utf8'),
  fs.readFile('supabase/migrations/20260925195214_investor_collector_service_rpc_v1.sql','utf8'),
  fs.readFile('supabase/migrations/20260925200130_investor_collector_sync_cursor_v1.sql','utf8'),
  fs.readFile('supabase/migrations/20260925201608_investor_collector_node_registration_v1.sql','utf8'),
  fs.readFile('supabase/migrations/20260926121712_collector_strict_lease_expiry_v1.sql','utf8'),
  fs.readFile('supabase/migrations/20260926125551_unify_manual_and_collector_ingest_v1.sql','utf8'),
  fs.readFile('supabase/functions/broker-key/shared.ts','utf8'),
  fs.readFile('supabase/functions/broker-key/index.ts','utf8'),
  fs.readFile('supabase/functions/broker-connect/index.ts','utf8'),
  fs.readFile('supabase/functions/broker-disconnect/index.ts','utf8'),
  fs.readFile('supabase/functions/collector-next-job/index.ts','utf8'),
  fs.readFile('supabase/functions/collector-report/index.ts','utf8'),
  fs.readFile('supabase/functions/collector-ingest/index.ts','utf8'),
  fs.readFile('collector/src/trading_journal_collector/api.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/worker.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/main.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/provision.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/service.py','utf8'),
  fs.readFile('collector/src/trading_journal_collector/service_config.py','utf8'),
  fs.readFile('collector/windows/install-service.ps1','utf8'),
  fs.readFile('collector/windows/preflight.ps1','utf8'),
  fs.readFile('downloads/TradeJournalConnector_MT4_v1.18.mq4','utf8'),
]);

ok(arch.includes('MetaTrader 4') && arch.includes('MetaTrader 5'),'architecture must cover MT4 and MT5');
ok(arch.includes('v1 is not complete until both MT4 and MT5'),'dual-platform completion gate missing');
ok(arch.includes('The Investor Password form is implemented but remains fail-closed until the backend reports a real registered primary collector.'),'credential-entry fail-closed release gate missing');
ok(arch.includes('Supabase JS 2.117.1 is vendored at /vendor/supabase-2.117.1.js'),'frontend vendored SDK record missing');
ok(arch.includes('SHA-256 verified against jsDelivr package metadata'),'frontend SDK verification record missing');
ok(arch.includes('CSP script-src is self-only'),'frontend self-only CSP record missing');
ok(arch.includes('collector_private.broker_credentials'),'private credential storage design missing');
ok(arch.includes('RSA-OAEP-SHA256'),'credential encryption contract missing');

ok(pyproject.includes('MetaTrader5==5.0.6180'),'MetaTrader5 version is not pinned');
ok(pyproject.includes('cryptography==50.0.1'),'cryptography version is not pinned');
ok(pyproject.includes('pywin32==312'),'pywin32 service dependency is not pinned');
ok(service.includes('TradingJournalCollectorService'),'Windows service class missing');
ok(service.includes('ControlPlaneError'),'service must back off while node registration is pending');
ok(service.includes('registration.json'),'service must emit non-secret registration bundle');
ok(serviceConfig.includes('FORBIDDEN_KEY_PARTS'),'service config secret denylist missing');
ok(installer.includes('/inheritance:r'),'installer must remove inherited ProgramData ACLs');
ok(installer.includes('$Root = Join-Path $env:ProgramData "TradingJournalCollector"'),'installer runtime root must match service default config path');
ok(!installer.includes('[string]$Root ='),'installer must not advertise a root override the service cannot discover');
ok(installer.includes('$ServiceAccount = "NT SERVICE\\$ServiceName"'),'installer must use a per-service virtual account');
ok(installer.includes('"sc.exe" @("config", $ServiceName, "obj=", $ServiceAccount)'),'installer virtual-account configuration missing');
ok(!installer.includes('NT AUTHORITY\\LocalService'),'shared LocalService identity must not return');
ok(installer.includes('Get-BitLockerVolume'),'MT4 encrypted-volume verification missing');
ok(installer.includes('preflight.ps1'),'Windows installer must invoke fail-closed preflight');
ok(preflight.includes('python_3_12'),'Windows preflight must check Python 3.12');
ok(preflight.includes('supabase_network'),'Windows preflight must check Supabase connectivity');
ok(preflight.includes('mt4_exporter_ex4'),'Windows preflight must check compiled MT4 exporter');
ok(preflight.includes('mt4_all_history_attestation'),'Windows preflight must require MT4 All History attestation');
ok(preflight.includes('mt4_bitlocker'),'Windows preflight must verify MT4 BitLocker protection');
ok(installer.includes('ProtectionStatus') && installer.includes('FullyEncrypted') && installer.includes('EncryptionPercentage'),'MT4 BitLocker fail-closed criteria missing');
ok(installer.includes('Set-DirectoryAcl -Path $Root -ServiceRights "RX"'),'collector root must be read/execute for service');
ok(installer.includes('Set-DirectoryAcl -Path $IdentityDir -ServiceRights "M"'),'collector identity directory write ACL missing');
ok(installer.includes('Set-DirectoryAcl -Path $Mt4WorkRoot -ServiceRights "M"'),'collector MT4 work directory write ACL missing');
ok(installer.includes('Set-DirectoryAcl -Path $StateDir -ServiceRights "M"'),'collector state directory write ACL missing');
ok(service.includes('default_config_path().parent / "state"'),'registration bundle must live in dedicated writable state directory');
ok(!installer.toLowerCase().includes('--password'),'installer must not pass a reusable Windows account password');
ok(crypto.includes('RSA_KEY_BITS = 3072'),'collector RSA key size changed');
ok(crypto.includes('RSA-OAEP-SHA256'),'collector RSA algorithm marker missing');
ok(crypto.includes('padding.MGF1(algorithm=hashes.SHA256())'),'collector OAEP MGF1 SHA-256 missing');
ok(crypto.includes('algorithm=hashes.SHA256()'),'collector OAEP SHA-256 missing');
ok(dpapi.includes('CryptProtectData') && dpapi.includes('CryptUnprotectData'),'Windows DPAPI protection missing');
ok(!/^\s*CRYPTPROTECT_LOCAL_MACHINE\s*=/m.test(dpapi),'DPAPI must not define machine-wide protection flag');
ok(!/\|\s*CRYPTPROTECT_LOCAL_MACHINE\b/.test(dpapi),'DPAPI must not enable machine-wide protection flag');
ok(identity.includes('hash_collector_token'),'collector token hash contract missing');
ok((identity.match(/_atomic_write\(self\.token_path, protected\)/g)||[]).length===2,'collector token writes must use hardened fixed-permission atomic writer');
ok(!identity.includes('_atomic_write(self.token_path, protected, 0o600)'),'stale atomic-write mode argument returned');
ok(!identity.includes('print('),'collector identity code must not print secret material');

ok(serviceSql.includes('revoke all on function public.collector_active_public_key_service() from public,anon,authenticated'),'service RPC anon/auth revoke missing');
ok(serviceSql.includes('grant execute on function public.collector_active_public_key_service() to service_role'),'service RPC service_role grant missing');
ok(serviceSql.includes('collector_ingest_events_service'),'collector service ingest RPC missing');
ok(serviceSql.includes("e := e || jsonb_build_object('source',src,'account',acct,'server',srv)"),'collector ingest canonical identity override missing');

ok(edgeShared.includes('npm:@supabase/supabase-js@2.117.1'),'Edge Functions Supabase SDK must be exactly pinned');
ok(edgeShared.includes('auth.getUser(token)'),'Edge user authentication must validate user JWT server-side');
ok(edgeShared.includes('x-collector-token'),'collector custom token header auth missing');
ok(edgeShared.includes('collector_authenticate_service'),'collector token hash database authentication missing');
ok(!edgeShared.includes('console.log('),'Edge shared code must not log secrets');

ok(cursorSql.includes('last_sync_at timestamptz'),'collector lease must return sync cursor');
ok(cursorSql.includes("last_sync_at=case when v_job_type='SYNC' then now() else last_sync_at end"),'legacy cursor migration record missing');
ok(mt5.includes('history_deals_get'),'MT5 adapter history-deal reader missing');
ok(mt5.includes('history_deals_get(position=position)'),'MT5 boundary position-history repair missing');
ok(mt5.includes('"portable": self.portable'),'MT5 portable mode must be explicit/configurable');
ok(mt5.includes('portable: bool = False'),'MT5 portable mode must default to false');
ok(mt5.includes('DEAL_REASON_SL'),'MT5 adapter explicit SL reason mapping missing');
ok(mt5.includes('"closed_by_sl": bool(closed_by_sl)'),'MT5 adapter explicit SL payload missing');
ok(!/\border_send\b|\border_check\b/.test(mt5),'MT5 adapter must never contain trade APIs');
ok(api.includes('x-collector-token'),'collector HTTP client token header missing');
ok(!api.toLowerCase().includes('service_role'),'collector HTTP client must not contain service-role credentials');
ok(worker.includes('overlap_seconds'),'worker overlap cursor missing');
ok(worker.includes('sync_until_ms=sync_until_ms'),'worker must report exact sync upper bound');
ok(api.includes('"attempt": int(attempt)'),'collector API must fence ingest/report with job attempt');
ok(collectorReport.includes('p_sync_until_ms: syncUntilMs'),'collector report must persist exact sync upper bound');
ok(collectorReport.includes('p_attempt: attempt'),'collector report attempt fence missing');
ok(collectorIngest.includes('p_attempt: attempt'),'collector ingest attempt fence missing');
ok(strictLeaseSql.includes('j.lease_until >= now()'),'collector lease expiry must be enforced on ingest/report');
ok(strictLeaseSql.includes('for update of j'),'collector ingest lease fence must hold a row lock');
ok(unifiedIngestSql.includes('collector_private.canonical_ingest_mt_event'),'canonical ingest helper migration missing');
ok((unifiedIngestSql.match(/collector_private\.canonical_ingest_mt_event\(/g)||[]).length>=3,'manual and collector ingest must share canonical helper');
ok(unifiedIngestSql.includes('revoke all on function collector_private.canonical_ingest_mt_event'),'canonical ingest helper must not be directly executable by API roles');
ok(worker.includes('credential.clear()'),'worker credential buffer clearing missing');
ok(main.includes('TJ_SUPABASE_PUBLISHABLE_KEY'),'worker must use publishable key');
ok(!main.includes('SERVICE_ROLE')&&!main.includes('SECRET_KEY'),'worker must never require Supabase elevated keys');

ok(registerSql.includes('collector_register_node_service'),'collector node registration RPC missing');
ok(registerSql.includes('revoke all on function public.collector_register_node_service'),'collector registration anon/auth revoke missing');
ok(registerSql.includes('grant execute on function public.collector_register_node_service') && registerSql.includes('to service_role'),'collector registration must remain service-only');
ok(provision.includes('registration_payload'),'Windows provisioning bundle helper missing');
ok(!provision.includes('identity.token_text()'),'provisioning CLI must never read/export collector token');
ok(!provision.includes('PRIVATE_FILE'),'provisioning CLI must not export private-key storage');
ok(mt4py.includes('class Mt4Adapter'),'MT4 disposable worker adapter missing');
ok(mt4py.includes('shutil.copytree'),'MT4 adapter must use disposable terminal slot copy');
ok(mt4py.includes('"/portable"'),'MT4 adapter portable terminal launch missing');
ok(mt4py.includes('ExpertsTrades=false'),'MT4 startup must explicitly disable trading');
ok(mt4py.includes('TradeJournalExport_MT4.ex4'),'MT4 adapter must require compiled exporter');
ok(mt4py.includes('_overwrite_and_unlink'),'MT4 secret startup config cleanup missing');
ok(mt4py.includes('history_all_confirmed'),'MT4 history coverage attestation gate missing');
ok(mt4py.includes('MT4_ACCOUNT_HISTORY_ALL_NOT_CONFIRMED'),'MT4 history coverage fail-closed error missing');
ok(main.includes('TJ_MT4_HISTORY_ALL_CONFIRMED'),'MT4 history attestation environment wiring missing');
ok(serviceConfig.includes('"mt4_history_all_confirmed": "TJ_MT4_HISTORY_ALL_CONFIRMED"'),'MT4 history attestation service config missing');
ok(installer.includes('[switch]$Mt4AllHistoryConfirmed'),'MT4 installer history attestation switch missing');
ok(mt4mql.includes('CursorFile = "tj_since_ms.txt"'),'MT4 exporter sync cursor missing');
ok(mt4mql.includes('ReadSinceMs()'),'MT4 exporter cursor reader missing');
ok(main.includes('TJ_MT4_GOLDEN_DIR') && main.includes('TJ_MT4_WORK_ROOT'),'MT4 worker environment wiring missing');

for(const [name,src] of [
  ['broker-key',brokerKey],['broker-connect',brokerConnect],['broker-disconnect',brokerDisconnect]
]){
  ok(src.includes('requireApprovedUser(req)'),name+': approved-user auth gate missing');
}
ok(brokerConnect.includes('ciphertext_base64') && !brokerConnect.toLowerCase().includes('investor_password'),'broker-connect must accept ciphertext, not plaintext password');

for(const [name,src] of [
  ['collector-next-job',collectorNext],['collector-report',collectorReport],['collector-ingest',collectorIngest]
]){
  ok(src.includes('requireCollector(req)'),name+': collector-token auth gate missing');
  ok(!src.includes('console.log('),name+': must not log collector secrets');
}

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
ok(mt4mql.includes('#property version   "0.12"'),'MT4 exporter version must reflect SL evidence hardening');
ok(mt4mql.includes('closed_by_sl'),'MT4 exporter: SL evidence missing');
ok(mt4mql.includes('sl_proximity'),'MT4 exporter: SL proximity diagnostic missing');
ok(!mt4mql.includes('close_px <= sl + tol) closed_by_sl'),'MT4 exporter must not infer LOSS from BUY close-price proximity');
ok(!mt4mql.includes('close_px >= sl - tol) closed_by_sl'),'MT4 exporter must not infer LOSS from SELL close-price proximity');
ok(manualMt4.includes('#property version   "1.18"'),'manual MT4 connector v1.18 missing');
ok(manualMt4.includes('sl_proximity'),'manual MT4 connector proximity diagnostic missing');
ok(!manualMt4.includes('close_px <= sl + tol) closed_by_sl'),'manual MT4 connector must not infer LOSS from BUY close-price proximity');
ok(!manualMt4.includes('close_px >= sl - tol) closed_by_sl'),'manual MT4 connector must not infer LOSS from SELL close-price proximity');
ok(!/\bOrderSend\s*\(|\bOrderModify\s*\(|\bOrderClose\s*\(|\bOrderDelete\s*\(/.test(mt4mql),'MT4 exporter contains a trading operation');

console.log('Collector contract regression passed.');
