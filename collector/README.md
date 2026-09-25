# Trading Journal Collector

Foundation for the owned Windows collector used by direct Investor Password connections.

Source of truth:
- docs/INVESTOR_COLLECTOR_V1.md

Current repository foundation:
- common secret-safe models;
- RSA-3072 / OAEP-SHA256 collector key store;
- Windows current-user DPAPI secret protector (dedicated service-account scope);
- protected collector auth token with SHA-256 database hash;
- adapter interface;
- MT5 read-only probe with fake-module testability;
- MT4 startup config renderer;
- one-shot read-only MT4 history exporter source;
- Python unit tests;
- static regression rules forbidding trade APIs;
- production Supabase control-plane schema and service-only RPCs;
- broker/collector Edge Functions with explicit auth gates;
- Python collector HTTP worker loop;
- MT5 deal-history normalization with explicit Stop Loss reason propagation.

Not implemented yet:
- Windows service installer / ACL provisioning;
- registration of a real collector node on the owned Windows/VPS host;
- live Windows MT5 terminal end-to-end validation;
- real MetaEditor compilation + live Windows validation of the implemented MT4 disposable-slot launcher;
- direct-connect frontend.

Never put real broker credentials in tests, fixtures, examples, GitHub Actions or repository files.

Windows baseline:
- Python 3.12 x64;
- MetaTrader5 dependency pinned in pyproject.toml;
- MT5 terminal;
- broker-compatible MT4 terminal directories.

Tests from repository root:

PYTHONPATH=collector/src python -m unittest discover -s collector/tests -v
node scripts/collector-regression.mjs

Linux CI validates platform-independent contracts and fake MT5 behavior. Actual terminal integration must later run on an owned Windows runner/VPS.


## MT4 disposable worker requirements

To enable MT4 on the Windows collector, configure:
- `TJ_MT4_GOLDEN_DIR`: writable-copy source containing broker-compatible `terminal.exe`;
- compiled `MQL4/Scripts/TradeJournalExport_MT4.ex4` inside that golden directory;
- `TJ_MT4_WORK_ROOT`: ACL-restricted, encrypted-volume directory for disposable slots;
- optional `TJ_MT4_BOOTSTRAP_SYMBOL` (default EURUSD), which must exist at that broker.

The collector never compiles an MQ4 silently. A missing EX4 fails closed. Real compilation/login/history coverage must be verified on the owned Windows host before MT4 direct-connect is released.


## Windows CI boundary

GitHub Actions includes a Windows runner that:
- installs the collector with the pinned MT5 extra;
- verifies MetaTrader5 package version 5.0.6180 imports on Python 3.12;
- performs a real Windows current-user DPAPI protect/unprotect integration test, including entropy mismatch fail-closed behavior.

This validates OS crypto/package compatibility only. It does not substitute for a real broker MT4/MT5 terminal runtime on the owned collector host.


## Provision a real collector node

Run this only on the owned Windows machine under the same dedicated Windows account that will run the collector:

```powershell
$env:TJ_IDENTITY_DIR = "D:\TradingJournal\identity"
$env:TJ_COLLECTOR_NAME = "collector-01"
trading-journal-collector-provision --output collector-registration.json
```

The output file contains only:
- collector name;
- RSA public key and key id;
- SHA-256 hash of the collector auth token;
- primary-node intent.

It does **not** contain the collector token or private key. The registration bundle is then enrolled through the service-role-only operator path; the plaintext collector token never leaves DPAPI-protected storage on the collector host.


## Windows service installation

Production service support:
- pinned `pywin32==312`;
- default service identity: `NT AUTHORITY\LocalService`;
- config is an explicit non-secret allowlist;
- collector token stays DPAPI-protected in the identity store;
- first service start writes `registration.json` with public key, key id and collector-token SHA-256 hash only;
- ProgramData ACL inheritance is removed and limited to SYSTEM, Administrators and LocalService.

From elevated PowerShell:

```powershell
collector\windows\install-service.ps1 \
  -SupabaseUrl "https://<project>.supabase.co" \
  -PublishableKey "sb_publishable_..."
```

The installer never accepts Investor Passwords, Supabase service/secret keys or a reusable Windows account password.
