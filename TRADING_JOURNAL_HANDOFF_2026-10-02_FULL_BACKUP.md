# Trading Journal — Full Handoff Backup — 2026-10-02

## Purpose
This is a continuity backup for a new ChatGPT chat after the previous chat reached its maximum length.

This project is **TRADING JOURNAL ONLY**.
It is **NOT ASTRA / EURUSD CR Shadow**.
Never mix their code, DB state, files, checkpoints, prompts, strategy state, or runtime decisions.

## New-chat bootstrap
1. Fetch the latest `main` of `Andrey244/Andrey244.github.io`.
2. Read `PROJECT_HANDOFF.md`.
3. Read `AGENTS.md`.
4. Read this file.
5. For any Supabase task, first read `skills://plugins/supabase/supabase/skill.md`.
6. Compare latest main to this checkpoint and continue from the newer state.
7. Never reapply already-merged patches.
8. Before every material patch, create a NEW rollback branch from fresh current main.
9. After material changes require fresh Smoke + CodeQL SUCCESS; user-visible changes also require Pages SUCCESS.
10. Never claim browser/backend completion unless current source + current CI/backend/live state prove it.
11. Keep tool batches small and progress checkpoints concise because the prior chat repeatedly hit response/chat limits.

## Exact checkpoint before handoff documentation
Runtime/code checkpoint:
- main: `3d9e251eee859030201949b5720a2df0b652c980`
- latest material commit: `Record account archive and delete lifecycle`
- rollback branch for latest material pass: `rollback/pre-account-lifecycle-actions-2026-10-02`

CI / deploy at this checkpoint:
- Smoke #286 — SUCCESS — run `36991355528`
- CodeQL #129 — SUCCESS — run `36989213326`
- Pages #280 — SUCCESS — run `36989212719`
- an earlier Smoke #285 also passed on the same current line of work.

Always fetch fresh main in the new chat; documentation-only commits may exist after the code checkpoint above.

## Latest completed feature: Account lifecycle
User found that disconnecting a broker account did not remove it from Insights because Insights was discovering accounts from historical `raw_events`.

The implementation now separates three actions:

### Disconnect
- connection-only;
- removes/disables direct broker sync and encrypted Investor Password;
- **never deletes journal history**.

### Archive
- sets `account_settings.enabled=false`;
- keeps all historical data;
- account remains manageable in Accounts;
- removes that account from:
  - Insights account selector;
  - All accounts analytics;
  - Trades;
  - Calendar;
  - Equity;
  - Data Health;
  - active raw-event/statistics scope.

### Restore
- sets the same exact `source + account + server` account back to `enabled=true`;
- returns it to analytics.

### Delete data
- available only for an archived account;
- uses custom danger confirmation;
- permanent destructive operation;
- refused while the matching direct broker connection is active;
- refused while a matching manual connector heartbeat is fresh (<10 min);
- deletes only the exact account identity `source + account + server`;
- deletes matching raw events and stable/legacy trade notes;
- removes account_settings and connector_status;
- **daily_reviews are intentionally preserved** because they are day-level and may cover multiple accounts;
- disconnected broker_connections history is intentionally preserved.

Frontend architecture:
- full management list: `accountCatalog`;
- active analytics list: `detectedAccounts`;
- active analytics raw events: `activeRawEvents`;
- Save preserves archive state instead of forcing `enabled=true`.

Backend:
- production migration is applied:
  - version `20261002091621`
  - name `account_lifecycle_delete_service`
- service RPC:
  - `public.account_delete_data_service(...)`
  - SECURITY DEFINER;
  - exact approved-user/account checks;
  - EXECUTE revoked from PUBLIC / anon / authenticated;
  - EXECUTE granted only to service_role.
- production Edge Function:
  - `account-data-delete`
  - ACTIVE
  - version 1
  - verify_jwt=false because checked-in runtime auth validates the user with `requireApprovedUser`, matching the existing Direct Collector browser functions.
- no client DELETE grant was added to `raw_events`.

Current PWA shell:
- cache: `tj-shell-v16`
- asset version: `20261002-account-lifecycle-1`

## Immediate next check — DO THIS FIRST
The account lifecycle code/backend/CI are complete, but **the user's authenticated browser has not yet live-verified this new feature after deploy**.

Use the user's existing test account visible in the prior screenshot:
- label: `test test`
- MT4 account: `252031119`
- server: `Alpari-Pro.ECN-Demo`
- it had 4 raw events in the screenshot.

First browser validation:
1. Hard refresh once if needed.
2. Accounts page should show Archive for active accounts.
3. Archive `test test`.
4. Verify:
   - it remains in Accounts and is visibly Archived;
   - Restore appears;
   - Delete data appears;
   - it disappears from Insights account selector;
   - it disappears from All accounts statistics/Trades/Calendar/Equity/Data Health.
5. Do **NOT** automatically press Delete data on the user's behalf just because it exists.
6. If the user explicitly wants the test history removed, let the user trigger Delete data and then verify:
   - exact account raw_events are gone;
   - matching trade_notes are gone;
   - account_settings/connector_status are gone;
   - other account data is untouched;
   - shared daily_reviews remain.

If the user only wants the account hidden, Archive is enough.

## Recent fixes immediately before account lifecycle

### MT4 Calendar ↔ Trades date mismatch
Bug:
- Calendar used MT4 broker-day via `utcDayKey`;
- Trades used browser-local `toLocaleString()`;
- late MT4 closes could display as next calendar date in Tashkent.

Fix:
- MT4 trade display uses source-aware UTC-shaped broker wall-clock time;
- Calendar, Trades, trade modal, Equity tooltip now agree on the MT4 trade date;
- direct-collector heartbeat/system timestamps remain normal UI-local timestamps.
- shell at that stage: `tj-shell-v15`.

This should still be live-checked if the user has not already confirmed it:
- trades closed on broker date Sep 28 must display Sep 28 in both Calendar and Trades.

### Equity tooltip / chart
User clarified the problem was tooltip excess whitespace, not chart height.
Current intent:
- tooltip auto-width based on rendered SVG text via `getComputedTextLength()`;
- clamp 150–260px;
- no large empty right tail;
- Equity chart restored to:
  - desktop 270px;
  - tablet 230px;
  - mobile 200px.

### Full UI/UX audit
A prior full audit used:
- Emil Kowalski Design Engineering skill;
- UI/UX Pro Max skill / quick reference.

Important completed UI hardening:
- focus-visible;
- reduced motion;
- semantic navigation;
- modal focus trap / Escape / restore;
- keyboard paths for calendar/trades/Equity;
- mobile safe areas;
- dynamic `dvh`;
- tablet Trades overflow handling;
- tabular numerals;
- RU/EN dynamic aria labels;
- PWA mutable assets network-first so stale service-worker shell cannot pin old app.js/styles.css.

## TinyFish constraint
User explicitly said:
- if TinyFish stops working without limits, do not use it;
- do not show/open the TinyFish window in future because it lags badly and clutters the UI.

Therefore:
- do not use TinyFish by default in the new chat;
- prefer source/CI checks plus the user's screenshots for live authenticated UI verification;
- do not claim browser verification if it was not actually performed.

## Trading Journal invariants — preserve
Do not change these unless the user explicitly changes product requirements:
- grouping version `2.3`;
- explicit TG precedence;
- strict source + account + server isolation;
- MT4 overlap-lifetime grouping;
- MT5 exposure grouping;
- stable Logical Trade IDs and legacy-ID compatibility;
- MT4 broker-day via `utcDayKey`;
- Strategy Outcome is **not P&L-derived**;
- explicit SL evidence controls automatic loss classification;
- tri-state Worked / SL / Other;
- Ghost exclusion semantics;
- Ghost trades remain stored but excluded from counted stats;
- current accounts are USD-only;
- do NOT add multi-currency now;
- do NOT do a large backend/raw-events scaling rewrite now;
- preserve RLS and Owner/Admin/Member boundaries;
- no MFA/password-policy redesign now;
- preserve all Direct Collector security/integrity gates;
- never provision fake collector nodes;
- never ask the user to send Investor Password in chat.

## Collector / terminal state
- MT4 connector current repo version: v1.20.
- User replaced live MT4 connectors with v1.20.
- Earlier Supabase log pressure was mostly old v1.17 connector traffic.
- Server-side code cannot prevent Supabase from logging requests already sent by old clients.
- If still relevant, remeasure edge-log request counts over a comparable interval after v1.20, but this is not a blocker for the account-lifecycle task.
- Windows collector was tested on the user's PC first because it is faster/easier to debug.
- Final intended location is VPS.
- Do not modify another person's terminal without the user's control/permission.

## Direct Collector / Investor Password boundaries
- read-only architecture;
- Investor Password must never be requested in chat;
- browser encrypts before sending;
- no secret in localStorage;
- encrypted credential is removed on Disconnect;
- Collector supports MT4/MT5 path;
- manual connector remains fallback.

## Supabase security state relevant to new work
Current advisor scan on 2026-10-02 did not flag the new account-delete function.

Pre-existing advisor findings still exist and are not part of the account lifecycle change:
- INFO: RLS enabled/no policies on collector_private tables, intentional private-service boundary;
- WARN: several pre-existing SECURITY DEFINER functions are executable by anon/authenticated by design/current architecture;
- WARN: leaked-password protection disabled — user explicitly does not want password-policy/MFA work now;
- INFO: some unused indexes.

Do not "fix" these automatically as part of unrelated work.

## Working protocol
Before material changes:
- fetch fresh main;
- read PROJECT_HANDOFF.md + AGENTS.md;
- if Supabase involved, read Supabase skill;
- create a new rollback branch;
- sanity check current source, do not reapply merged work;
- smallest coherent patch;
- update regression/smoke tests.

After material changes:
- Smoke SUCCESS required;
- CodeQL SUCCESS required;
- Pages SUCCESS for user-visible changes;
- backend changes require actual backend verification;
- browser claims require actual browser/user-screen evidence.

## User style / workflow constraints
- concise progress checkpoints;
- direct/objective;
- do not make the user repeat already-provided information;
- do not restart the project from scratch;
- explain exactly what the user needs to click/run only when their action is actually required;
- keep this ChatGPT project separate from ASTRA market analysis;
- user prefers testing collector/runtime on PC before final VPS deployment.

## What not to redo
Do not redo:
- v1.20 connector upgrade;
- Equity stale-service-worker cache fix;
- tooltip auto-width fix;
- Equity restored height;
- MT4 Calendar/Trades date sync;
- full first UI/UX hardening pass;
- Account Archive/Restore/Delete backend/frontend implementation;
unless current source proves a regression.

## Source of truth order
1. fresh GitHub `main`;
2. production Supabase current state;
3. current CI / Pages state;
4. `PROJECT_HANDOFF.md`;
5. `AGENTS.md`;
6. this backup;
7. older chat summaries.

If this backup conflicts with newer main/backend state, use the newer verified state.
