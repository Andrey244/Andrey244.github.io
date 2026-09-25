# Trading Journal — Direct Investor Connection / Collector v1

Status: implementation baseline.

## Product contract

The direct connection product supports both MetaTrader 4 and MetaTrader 5 from v1.

User-facing flow:

Platform + Login + Investor Password + Server -> Connect

The internal adapters may differ, but v1 is not complete until both MT4 and MT5 pass the acceptance tests in this document. The current Reader/Connector remains a fallback while the direct collector is built.

## Security invariants

1. The collector is read-only by code and credential.
2. If a terminal reports that account trading is allowed, the credential is rejected.
3. Collector source must not contain order placement, modification or close operations.
4. MT4 startup configuration sets ExpertsTrades=false.
5. Broker credentials are never stored in frontend localStorage/sessionStorage, Git, browser logs, analytics, or public Supabase tables.
6. Investor Password is treated as a secret.
7. Server is mandatory and remains part of account identity.
8. Existing journal RLS/user isolation stays in force.
9. Existing grouping, broker-day and Strategy Outcome rules are unchanged.
10. The collector never receives a user's existing journal ingest token.

## MT5 adapter

MetaQuotes provides an official Python integration that can initialize/launch a terminal, connect with login/password/server, use portable mode, read account information and read history.

Reviewed Windows collector baseline:

MetaTrader5==5.0.6180

PyPI published this release on 2026-09-05 and provides a CPython 3.12 Windows x86-64 wheel.

Read-only probe:
- initialize/login succeeds;
- terminal reports connected;
- returned login matches;
- returned server matches;
- account_info().trade_allowed must be false.

MetaQuotes documents that ACCOUNT_TRADE_ALLOWED=false may also mean an archived/read-only account or a broker-side restriction. Therefore the collector records READ_ONLY_RESTRICTED, not "investor password cryptographically proven". A true value is enough to reject the credential as write-capable.

The MT5 adapter must never call order_send, order_check, or any order placement/modification API.

Official references:
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5login_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py
- https://www.mql5.com/en/docs/runtime/tradepermission

## MT4 adapter

MT4 has no equivalent official Python history/login API, so the owned collector uses disposable terminal worker slots.

MetaQuotes documents:
- Investor mode is read-only;
- ACCOUNT_TRADE_ALLOWED is false in investor mode, although other restrictions can also make it false;
- startup config accepts Login, Password and Server;
- startup config can launch a script;
- ExpertsTrades=false disables MQL trading;
- simultaneous terminals require separate directories;
- /portable keeps data in the terminal directory when it is a writable non-system directory.

Worker flow:

clean golden terminal
-> clone isolated worker slot
-> create short-lived startup config
-> launch terminal.exe startup.ini /portable
-> run TradeJournalExport_MT4 one-shot script
-> produce history JSONL + status JSON
-> Python collector reads/normalizes
-> terminate terminal
-> destroy complete worker slot

Startup settings:
- EnableDDE=false
- EnableNews=false
- ExpertsEnable=true
- ExpertsDllImport=false
- ExpertsExpImport=false
- ExpertsTrades=false

The MQL4 exporter contains no OrderSend, OrderModify, OrderClose or OrderDelete calls.

Official references:
- https://docs.mql4.com/runtime/tradepermission
- https://www.metatrader4.com/en/trading-platform/help/service/start_conf_file
- https://www.metatrader4.com/en/trading-platform/help/userguide/start_comm
- https://www.metatrader4.com/en/trading-platform/help/setup/setup_server

### MT4 credential caveat

The official MT4 startup mechanism requires the password in a startup configuration file. Automated MT4 login therefore cannot truthfully guarantee that plaintext never touches disk.

v1 mitigation:
- dedicated non-admin Windows service account;
- isolated worker directory;
- ACL-restricted temporary config path;
- encrypted Windows volume at rest;
- delete startup config immediately after launch;
- destroy the complete worker slot after the job;
- never reuse a worker slot containing prior account state.

If zero-disk plaintext becomes a hard requirement, the standard MT4 terminal startup mechanism is insufficient and a different broker/API integration is required.

## Control plane

GitHub Pages frontend
-> authenticated Supabase Edge Functions
-> public.broker_connections (metadata only, user RLS)
-> collector_private tables (not browser-exposed)
-> Windows Collector
-> MT4 adapter / MT5 adapter
-> normalized events
-> collector ingest endpoint
-> existing public.raw_events
-> existing Logical Trade engine

No direct-account code bypasses Logical Trade grouping.

## Credential encryption

Collector owns an RSA key pair:
- RSA 3072;
- OAEP;
- SHA-256;
- private key protected on the Windows collector with DPAPI under a dedicated service account;
- public key identified by key_id.

Browser flow:
1. User enters Investor Password.
2. Browser fetches collector public key.
3. Web Crypto encrypts UTF-8 password in memory using RSA-OAEP/SHA-256.
4. Password input is cleared.
5. Only ciphertext, key_id, platform, login and server go to the backend.
6. Plaintext is never written to browser storage.

Backend stores metadata in a user RLS table and ciphertext in a private schema. It never needs the collector private key.

Collector leases a job, receives ciphertext, decrypts locally, uses the credential only for the adapter call and clears mutable buffers where practical. Python/terminal internals may copy immutable strings, so perfect RAM zeroization is not claimed.

## Frontend security prerequisite

Do not ship the Investor Password form yet; backend/collector phases are still incomplete.

Frontend script hardening completed before credential-entry work:
- Supabase JS is pinned to 2.117.1 at an exact CDN path;
- the application JavaScript was moved from an inline script to /app.js;
- CSP script-src permits only self plus that exact Supabase SDK path;
- script-src-attr is none;
- CI rejects a return to floating @2 or inline JavaScript.

Remaining credential-entry rules:
1. do not add analytics/session-replay code to the secret-entry surface;
2. keep the password out of browser storage and logs;
3. encrypt with Web Crypto before backend submission;
4. clear the password field immediately after encryption.

Client-side encryption protects transport/storage, not an already-compromised same-origin script.

## Database model — production foundation created

Production migrations:
- `20260925191441 investor_collector_control_plane_v1`
- `20260925191514 investor_collector_job_fk_indexes_v1`

The tables below now exist. Direct browser writes are intentionally not enabled: authenticated users have SELECT-only access to their own `public.broker_connections` rows; private collector tables have deny-all RLS and no API-role grants.



### public.broker_connections

No broker password or ciphertext.

Implemented columns:
- id uuid primary key
- user_id uuid not null
- platform MT4/MT5
- login text not null
- server text not null
- display_name text null
- state text not null
- collector_key_id text not null
- last_sync_at timestamptz null
- last_error_code text null
- last_error_at timestamptz null
- enabled boolean default true
- created_at / updated_at

Unique identity: user_id + platform + login + server.

RLS: users only access their own rows. Owner/Admin access management does not grant access to another user's broker connection.

### collector_private.broker_credentials

Not exposed to browser roles:
- connection_id
- key_id
- algorithm = RSA-OAEP-SHA256
- ciphertext bytea
- created_at
- rotated_at

### collector_private.collector_nodes

- id
- name
- key_id
- public_key_pem
- auth_token_hash
- enabled
- last_seen

### collector_private.collector_jobs

- id
- connection_id
- job_type
- status
- attempt
- scheduled_at
- lease_until
- leased_by
- created_at

The collector_private schema must not be added to exposed Data API schemas.

## Proposed Edge Functions

broker-key:
- user-authenticated;
- returns current key_id/public key/algorithm.

broker-connect:
- user-authenticated;
- accepts platform/login/server/ciphertext/key_id;
- creates or updates connection;
- queues validation.

broker-disconnect:
- user-authenticated;
- disables connection;
- cancels jobs;
- deletes encrypted credential.

collector-next-job:
- collector-authenticated;
- atomically leases one job;
- returns metadata + encrypted credential.

collector-ingest:
- collector-authenticated;
- resolves connection_id to user_id server-side;
- validates/canonicalizes payload;
- writes through the existing raw event semantics;
- collector cannot choose arbitrary user_id.

collector-report:
- collector-authenticated;
- updates connected/degraded/error, adapter version, last sync and error code.

Prefer a dedicated collector secret/token at the Edge Function boundary. Do not place a Supabase service/secret key on the Windows worker if the Edge Function can keep it server-side.

## Normalized event contract

Direct collector feeds the same semantics already consumed by the journal.

Identity:
- source
- account
- server
- event_id

Common fields:
- order_id
- position_id
- event_time_ms
- symbol
- side
- entry_type
- volume
- price
- profit
- commission
- swap
- fee
- magic
- comment
- status

MT4 also preserves:
- open_time_ms
- close_time_ms
- open_price
- close_price
- stop_loss
- take_profit
- closed_by_sl

MT4 broker-day semantics remain unchanged. Do not convert MT4 timestamps to Asia/Tashkent browser time before journal processing.

Backend canonical dedupe remains authoritative. Collector uses a small overlap window when resyncing history.

## Scheduler/isolation

v1 uses a job pool, not one permanent terminal per user.

Rules:
- only one leased job per connection;
- account identity includes platform + login + server;
- configurable sync cadence;
- bounded exponential backoff;
- history overlap on retry;
- one failed account does not block others;
- hard worker timeouts;
- disposable MT4 worker directories;
- MT5 terminal shutdown after job;
- logs contain connection UUID/non-secret metadata only.

## Read-only defense in depth

MT5:
- user supplies Investor Password;
- terminal connected;
- account login/server match;
- trade_allowed == false;
- no trade APIs in source.

MT4:
- user supplies Investor Password;
- terminal connected;
- account login/server match;
- ACCOUNT_TRADE_ALLOWED == false;
- ExpertsTrades=false;
- exporter has no trading functions;
- disposable profile.

If a master password is entered and trading is allowed, fail closed and ask for Investor Password.

## Delivery phases

Phase 0 — repository foundation:
- architecture;
- common Python contracts;
- MT5 read-only probe;
- MT4 startup config + one-shot exporter baseline;
- regression checks prohibiting trade APIs.

Phase 1 — secure collector identity (repository foundation complete):
- RSA-3072 key generation with OAEP/MGF1 SHA-256;
- OS-protector key store and current-user Windows DPAPI implementation;
- protected collector auth token + SHA-256 registration hash;
- exact cryptography dependency pin and Linux CI contract tests;
- still pending: real Windows service installer/ACL setup and Windows DPAPI runtime integration test.

Phase 2 — Supabase control plane (complete):
- public metadata table with RLS;
- private collector schema with deny-all browser/API-role grants;
- service-only RPC layer for connect/disconnect, collector auth, job lease/report and event ingest;
- six Edge Functions with explicit user-JWT or collector-token authentication;
- collector ingest canonicalizes user/platform/account/server server-side;
- production negative-auth Smoke coverage.

Phase 3 — MT5 end-to-end:
- history normalization;
- ingest;
- retry/reconnect.

Phase 4 — MT4 end-to-end:
- isolated terminal launcher;
- compile/runtime validate exporter;
- normalization;
- cleanup.

Phase 5 — frontend direct-connect UX:
Only after both adapters are operational and frontend credential-entry prerequisites are satisfied.

Phase 6 — multi-account hardening:
- fairness;
- worker pool;
- key rotation;
- secret deletion;
- operational diagnostics.

The architecture is dual-platform from day one even though implementation work is staged.

## v1 acceptance tests

Both MT4 and MT5 must pass:
1. Investor Password + correct server connects.
2. Wrong password fails without persistent plaintext.
3. Wrong server fails.
4. Write-capable/master credential is rejected.
5. Account/server mismatch is rejected.
6. No collector path can place/modify/close a trade.
7. History imports correctly.
8. Repeated sync stays idempotent through backend dedupe.
9. Restart/reconnect does not duplicate Logical Trades.
10. Disconnect removes encrypted credential.
11. User A cannot access User B connection/data.
12. Admin/Owner access management does not grant another user's trading data.
13. MT4 broker-day semantics remain unchanged.
14. SL outcome remains based on explicit broker evidence.
15. Existing Reader/Connector still works.
16. Fresh Smoke succeeds after production changes.

## Non-goals

- trade execution;
- copy trading;
- SL/TP modification;
- broker account management;
- master-password support;
- plaintext broker-password storage in Supabase;
- one permanent terminal per user;
- weakening current RLS/ingest controls.
