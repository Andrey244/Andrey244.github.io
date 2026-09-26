# Trading Journal Collector

Owned Windows collector for direct read-only Investor Password connections. Both MT4 and MT5 are v1 requirements.

Source of truth:
- `docs/INVESTOR_COLLECTOR_V1.md`

## Implemented foundation

- RSA-3072 / OAEP-SHA256 collector key store.
- Current-user Windows DPAPI protection.
- Dedicated high-entropy collector token; only its SHA-256 hash is registered server-side.
- Per-service virtual Windows identity: `NT SERVICE\\TradingJournalCollector`.
- Split ProgramData ACLs: runtime/config read-only to the service; identity/state/MT4 work directories writable.
- Strict non-secret service config allowlist.
- Production Supabase control plane and authenticated Edge Functions.
- Exact SYNC cursor, attempt fencing and strict lease-expiry fencing.
- Fresh-heartbeat requirement before the frontend accepts Investor Password entry.
- MT5 read-only probe/history sync, non-portable default, explicit `DEAL_REASON_SL`, and initial-boundary position-history repair.
- MT4 disposable `/portable` worker slot, short-lived startup config, All-History fail-closed gate and exporter v0.12.
- Manual MT4 Connector v1.18 with explicit SL evidence separated from price-proximity diagnostics.
- Windows CI validates pinned MetaTrader5/pywin32 imports, PowerShell parsing and real DPAPI round-trip.
- Direct-connect frontend is implemented but stays fail-closed until a real primary collector heartbeat is fresh.

Never put real broker credentials in tests, fixtures, examples, GitHub Actions or repository files.

## Windows baseline

- Windows x64
- Python 3.12 x64
- MetaTrader5==5.0.6180
- pywin32==312
- installed MT5 terminal
- broker-compatible MT4 golden terminal directory when MT4 is enabled
- BitLocker-protected volume for MT4 disposable worker state

Tests from repository root:

```
PYTHONPATH=collector/src python -m unittest discover -s collector/tests -v
node scripts/collector-regression.mjs
```

## MT4 requirements

The golden terminal must contain:
- broker-compatible `terminal.exe`;
- compiled `MQL4/Scripts/TradeJournalExport_MT4.ex4`;
- Account History explicitly set to **All History** and validated.

The collector cannot programmatically force MT4 Account History to All History. Therefore history sync is fail-closed unless `mt4_history_all_confirmed` / installer `-Mt4AllHistoryConfirmed` is explicitly set after operator validation.

MT4 direct sync also requires the disposable work volume to be fully BitLocker protected. The installer fails closed when this cannot be verified.

## Provisioning a real collector node

Install the service first under its final service identity. First service startup creates the DPAPI-bound identity and writes only the non-secret bundle:

`%ProgramData%\\TradingJournalCollector\\state\\registration.json`

The bundle contains:
- collector name;
- RSA public key and key id;
- SHA-256 collector-token hash;
- primary-node intent.

It never contains the plaintext collector token or private key.

Register that bundle through the service-role-only operator path. Do not create a fake node to unlock the frontend.

## Windows service installation

From elevated PowerShell, use PowerShell's backtick for multiline continuation, or run the command on one line:

```powershell
collector\windows\install-service.ps1 `
  -SupabaseUrl "https://<project>.supabase.co" `
  -PublishableKey "sb_publishable_..."
```

For MT4, also provide `-Mt4GoldenDir` and only add `-Mt4AllHistoryConfirmed` after Account History = All History has been manually verified.

The installer:
- uses `NT SERVICE\\TradingJournalCollector`;
- never accepts Investor Passwords, Supabase service/secret keys or a reusable Windows account password;
- keeps config read-only to the service;
- keeps mutable identity/state/work data in dedicated ACL-restricted directories.

## Still pending — real terminal acceptance

- provision the owned Windows/VPS host;
- register the real collector node;
- validate MT5 terminal startup/login/history under the service identity;
- compile the MT4 exporter in the target broker MetaEditor;
- validate MT4 login and All-History behavior;
- run correct/wrong Investor Password, wrong server, master-password rejection, historical coverage, retry/idempotency, reconnect and disconnect tests for both platforms.

No code-only CI result substitutes for this live broker-terminal acceptance.
