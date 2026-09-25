# Trading Journal — Project Handoff / New Chat Bootstrap

> Purpose: this file is the canonical continuity document for future chats. Read it before changing the project so prior decisions, strategy logic, security assumptions, and known pitfalls are not re-litigated or accidentally broken.

## 0. Fast bootstrap for a new chat

If the user opens a new chat, use this exact starting instruction:

> Continue the Trading Journal project from `Andrey244/Andrey244.github.io`. First read `PROJECT_HANDOFF.md` and `AGENTS.md`, then fetch the current `main` branch before making any changes. Do not re-derive existing strategy logic from guesses. Preserve current security, grouping, UI, and broker-day rules. Create a rollback branch before material changes, run regression/smoke checks, and only claim success after the new smoke run and Pages deploy succeed.

## 1. Current repository state

- Repo: `Andrey244/Andrey244.github.io`
- Current main commit at time of this handoff: `ab318988223ead597a3f4950f5ab98e518b7630b`
- Static frontend: single-page `index.html` on GitHub Pages.
- Supabase project: `ylriyjxcefovzwzinpqd`
- Current grouping version: `2.3`
- Current MT4 connector: `v1.17`
- PWA files exist: `manifest.webmanifest`, `service-worker.js`, `app-icon.svg`.
- Smoke workflow: `.github/workflows/smoke.yml`
- Regression script: `scripts/grouping-regression.mjs`
- Smoke script: `scripts/smoke.mjs`

Before every code change, fetch current `main` and verify there is exactly one HTML document. There was a prior incident where `index.html` became concatenated multiple times.

## 2. Product goal

Private cloud/web trading journal inspired by Lucid Trading but customized for this strategy.

Core principle:
- Broker orders/events are not automatically “trades”.
- Multiple entries, scale-ins, and exits can belong to one **Logical Trade**.
- Analytics, calendar, Equity Curve, reviews, and exports operate on Logical Trades.

The user strongly prefers:
- clean, sparse, professional trading-dashboard UI;
- minimal useless controls;
- consistent Auto Layout / typography / spacing;
- direct, objective feedback;
- no visual redesign churn without a reason.

## 3. UI source of truth

### Visual baseline
**Insights** and **Trades** are the strongest/current baseline pages. Other pages should visually match them.

### Global UI rules
- Maintain one typography system across Insights, Trades, Accounts, Connection, Access, auth/recovery, modals, and mobile.
- Control height baseline: `--control-h: 42px`.
- Use consistent 4/8-ish spacing rhythm.
- Semantic colors:
  - profit/success = green;
  - loss/danger = red;
  - BUY = blue;
  - SELL = red.
- Equity Curve line remains green.
- Equity tooltip: word **Equity** stays white; only the balance changes:
  - rising balance = green;
  - falling balance = red.
- Do not add filters/controls when only one choice exists.
- Account/source/side/result/ghost filters are contextual and should disappear when there is no meaningful choice.
- Mobile bottom nav: Insights / Trades / Review / More.

### UI skills that must be consulted
See `AGENTS.md`. For future UI work:
1. Emil Kowalski skills: `emilkowalski/skills`, especially `skills/emil-design-eng/SKILL.md`.
2. UI/UX Pro Max: `nextlevelbuilder/ui-ux-pro-max-skill`, especially its main `SKILL.md` and `references/quick-reference.md`.
3. Use Playwright when browser automation is available.

Important known UI audit observations already identified:
- No global `:focus-visible` system exists yet.
- `prefers-reduced-motion` handling is missing.
- Many text styles are below 12px; compact data labels may be intentional, but body/help text should not drift into tiny sizes.
- There are many raw hex values and some inline styles instead of fully semantic design tokens.
- Desktop tabs are clickable `div` elements rather than semantic buttons/links, so keyboard accessibility is weak.
- Trade rows are clickable `tr` elements without built-in keyboard semantics.
- Calendar day cards rely on click handlers attached to div-like cards; keyboard path should be audited.
- Buttons currently have hover feedback but no consistent `:active` press feedback.
These are audit findings, not automatic permission to redesign the app. Fix incrementally and preserve the current look.

## 4. Authentication / roles / access

### Roles
- `owner`
- `admin`
- `member`

Owner:
- full control;
- can assign Admin/Member;
- can manage admins/members;
- owner role cannot be changed by others.

Admin:
- can Approve / Decline / Revoke ordinary Members;
- cannot promote users;
- cannot manage Owner;
- cannot manage other Admins;
- does **not** gain access to another user's trading data.

Member:
- normal personal journal access.

### Auth UX
- Login/registration and password recovery have been visually normalized to the main UI system.
- Password fields have show/hide controls.
- Recovery flow signs out after successful reset and returns user to normal login.
- Same-password recovery error is translated into a useful message.

### Supabase security
- RLS is relied on as the real boundary, not frontend hiding.
- Anonymous trading-table access is blocked.
- Trading data is user-isolated.
- Ingest token is validated server-side.
- Backend canonicalizes dedupe keys and does not trust client-provided dedupe keys.
- Batch ingest validates events and skips malformed events instead of poisoning the whole batch.
- Least-privilege grants were applied.
- Leaked-password protection is unavailable on current Supabase Free plan; this is known and accepted for now.
- User explicitly said not to add MFA/password-policy changes for now.

## 5. MT4 / MT5 connection architecture

### Current production path
Current working path:
`MT4/MT5 terminal → Connector/Reader → Supabase → Journal`

MT4 current connector:
- `downloads/TradeJournalConnector_MT4_v1.17.mq4`
- generic mirror: `downloads/TradeJournalConnector_MT4.mq4`
- read-only;
- no AutoTrading permission required for journal sync;
- uses Supabase WebRequest;
- sends connector status.

### v1.17 SL metadata
v1.17 sends extra data for reliable stop detection:
- stop loss;
- take profit;
- `closed_by_sl`;
- broker comment checks such as `[sl]` / stop-loss text.
It also uses a versioned state key to trigger a one-time recent-history rescan so old events can be enriched without creating duplicates.

### Future “Investor Password” direction
Desired future UX:
`Platform + Login + Investor Password + Server → Connect`

Preferred architecture:
- Keep current Reader as fallback.
- Build an owned Windows/VPS Collector.
- MT5: one collector terminal can cycle through accounts using official MetaTrader5 Python + `mt5.login()`; Python still requires an installed MT5 terminal process.
- MT4: no equivalent official Python API; likely one collector terminal that is restarted/reconfigured per account and auto-runs our Reader.
- Do not create one permanent terminal per user unless scale/latency later requires it.
- Never store broker credentials in frontend/localStorage.
- Investor password is still a secret even though read-only.

This direct-account project is **not implemented yet**.

## 6. Logical Trade grouping

### General
- Explicit `TG:` tag wins when present.
- Grouping is isolated by account identity including **source + account + server**.
- Server must remain part of grouping to avoid collisions between brokers using the same account number.

### MT4
Without explicit TG:
- same accountKey + symbol + side + strategy/magic only group while order lifetimes genuinely overlap;
- once the exposure/campaign is flat, a later re-entry is a new Logical Trade even if it happens immediately.

### MT5
- exposure-based grouping;
- server-isolated;
- explicit TG grouping supported.

Do not loosen grouping just to make visually convenient results.

## 7. Broker-day / Trading Calendar rule

A prior bug split one MT4 trading day across two calendar dates because the frontend converted close times into `Asia/Tashkent`.

Current rule:
- MT4 calendar/period/day analytics use the encoded **broker calendar day** path (`utcDayKey` in current implementation), not Tashkent conversion.
- Do not reintroduce browser/local timezone conversion for MT4 day grouping.
- MT5/local semantics should be reviewed separately if changed.

This rule affects:
- Trading Calendar;
- period filters;
- Daily Review;
- symbol-day counts;
- Equity period calculation.

## 8. Strategy Win Rate / Stop Loss semantics — CRITICAL

This is a custom strategy rule and must not be guessed from P&L.

### Actual strategy meaning
- The strategy has up to 6 actual entry/averaging orders.
- If the basket recovers after the 6th entry, this is **Worked / WIN**.
- If the basket is closed by actual Stop Loss after the 6th entry, this is **SL / LOSS**.
- There is **not necessarily a literal 7th broker order**. Earlier code incorrectly fabricated a “7th order”; that was fixed.

### Current correct journal rule
- `Orders` always displays the **real broker order count**.
- **Negative P&L does NOT mean SL.**
- **Explicit broker SL evidence means LOSS.**
- `strategyOutcome(t)` should depend on `stopLossHit`, not on money P&L or a fake seventh broker order.
- If a trade has 6 actual orders and explicit SL evidence, UI should show the real `6` plus separate `SL`/Result state, not fake `7`.

This Strategy Outcome drives:
- Win Rate;
- Wins/Losses;
- Streak;
- Trading Calendar WR;
- Symbols WR;
- Daily Review;
- Trades Win/Loss filters;
- mistake analytics WR.

Financial metrics remain independent:
- P&L;
- Equity;
- Profit Factor;
- Avg Win / Avg Loss;
- Drawdown.
These use actual money values.

Do not ever restore:
- “P&L < 0 ⇒ SL”
- “6 orders + negative ⇒ synthetic 7th”
Those were explicitly identified as wrong.

## 9. Ghost Trades

`trade_notes` supports:
- `excluded_from_stats`
- `exclusion_reason`

Ghost Trade behavior:
- remains visible in history;
- muted/GHOST indication;
- excluded from strategy analytics, P&L analytics, WR, DD, Equity, calendar, symbols, weekdays, etc.
- broker balance may still include the real broker loss; the journal reconciles this separately.

Bulk Ghost exists.

## 10. Equity Curve semantics

Equity is real account balance based:
- `account_settings.starting_balance`
- current owner main demo starting balance = 10000.
- For a selected period:
  `period start equity = starting balance + all counted P&L before period start`
  then apply period trades.
- For All Accounts, configured starting balances are summed.
- Ghost trades are excluded from strategy Equity.

Tooltip:
- exact point info;
- date/time;
- trade number;
- symbol + side;
- trade P&L;
- “Equity” label white;
- balance green if higher than previous point, red if lower.

User declined:
- drawdown overlay;
- peak marker;
- timezone redesign.
Do not add these unless asked again.

## 11. Trading Calendar

Current calendar was intentionally polished and user liked it:
- day cards;
- subtle positive/negative states;
- current-day border;
- weekly total on desktop;
- monthly P&L/trades/WR summary;
- Daily Review marker;
- click day → Daily Review.

Preserve this visual direction unless the user asks for a redesign.

## 12. Accounts / Connection / Access / Auth

These pages historically drifted away from Insights/Trades typography. They were later normalized.

Rule for future changes:
- Insights/Trades remain the baseline.
- Never create a page-specific oversized heading scale or random control heights.
- Use consistent columns and pixel alignment.
- Access desktop layout follows structured columns User / Role / Access / Action.
- Owner/Admin/Member controls must align vertically and horizontally.
- Auth/recovery pages use the same visual language and 42px controls.

## 13. Export / diagnostics

Trades export modal supports:
- Logical Trades CSV
- Raw MT Events CSV
- Trade Reviews CSV
- Daily Reviews CSV
- Full Backup JSON

Connection has Data Health diagnostics including:
- Raw ↔ Logical
- eligible events
- unassigned
- duplicate assignment
- grouping version/rule

## 14. Security workflow

For future security work:
- use Strix when available, only against this owned/authorized project;
- combine adversarial testing with Supabase RLS/grant verification;
- validate findings instead of blindly accepting scanner output;
- never weaken integrity gates just to restore availability.

Prior hardening fixed:
- backend trust in client dedupe key;
- batch poisoning by malformed events;
- server-less grouping collisions;
- non-deterministic pagination;
- broad grants;
- anonymous function/table exposure.

## 15. External skills / tools policy

See `AGENTS.md`.

Requested by user:
1. `emilkowalski/skills` — use for all UI/interaction review.
2. `nextlevelbuilder/ui-ux-pro-max-skill` — use for UI/UX/design-system/accessibility review.
3. `vercel-labs/skills` — use when a relevant specialized skill materially helps.
4. `microsoft/playwright` — use for browser regression/interaction QA when runtime is available.
5. `usestrix/strix` — use for authorized security attack simulation and remediation when available.
6. `upstash/context7` — use current docs for fast-changing libraries/frameworks.

Context7 is available as a ChatGPT plugin suggestion but requires explicit user connection/installation before use.

## 16. Change protocol — DO NOT SKIP

For material UI, auth, grouping, connector, security, strategy, or data changes:

1. Fetch latest `main`.
2. Create a rollback branch first.
3. Verify `index.html` sanity before editing:
   - one `<!doctype html>`;
   - one `</html>`;
   - no duplicate IDs;
   - inline JS parses.
4. Make the smallest coherent patch.
5. Update/add regression tests for the exact bug/decision.
6. Run/check GitHub Actions.
7. Do not say “fixed/tested” until a fresh Smoke run is SUCCESS.
8. For user-visible changes, verify Pages deployment SUCCESS.
9. Preserve prior decisions unless the user explicitly changes them.

## 17. Known user preferences for collaboration

- Russian is preferred for discussion.
- Direct, objective, no filler.
- If the assistant can technically perform a repo/Supabase action with available tools, do it instead of asking the user to paste code.
- Point out errors directly.
- Avoid unnecessary praise.
- UI changes should follow Figma/Auto Layout thinking.
- The user wants rollback available when experimenting with visuals.

## 18. Current completed work and pending work

### A. UI audit + first hardening pass — COMPLETED
A full prioritized audit was completed against:
- Emil Kowalski Skills (`emil-design-eng` + relevant `mobile-native` guidance);
- UI/UX Pro Max (`SKILL.md`, `quick-reference.md`, `pro-rules.md`).

The first critical interaction/accessibility hardening pass was committed in:
- `5b3d97e231d3e99e5fd78a3765b13468f012fca1` — `Harden UI accessibility and interaction semantics`
- rollback branch: `rollback/ui-a11y-pre-2026-09-25`

Implemented without redesigning Insights/Trades:
- semantic desktop nav buttons;
- keyboard path for calendar days and trade opening;
- global `:focus-visible`;
- modal dialog semantics, Escape, focus trap, focus restore;
- form labels / accessible names;
- `prefers-reduced-motion`;
- touch/hover capability handling and press feedback;
- coarse-pointer target/input improvements;
- safe-area/mobile viewport fixes;
- Equity Curve keyboard inspection;
- live status regions;
- duplicate-submit protection for login/signup.

Remaining P2 cleanup is intentionally not urgent:
- gradual raw-hex → semantic token cleanup;
- inline-style cleanup;
- optional URL/deep-link SPA navigation.

### B. Browser QA — PENDING RUNTIME
Playwright was requested. Full real browser regression audit remains pending until a suitable Playwright/browser runtime is actually available. Do not claim browser-verified QA from static inspection or Smoke alone.

### C. Security — PARTIALLY COMPLETED / STRIX PENDING
A native Supabase security/RLS audit was run after the UI work.

Fixed production schema issue:
- legacy `app_members_role_check` allowed only `owner/member` and silently conflicted with the newer `owner/admin/member` constraint;
- migration `remove_legacy_app_members_role_check` removed only the stale constraint;
- the remaining role constraint correctly permits `owner/admin/member`.

Performance/RLS hardening:
- migration `optimize_rls_initplans_and_access_blocks_fk`;
- all 19 Supabase `auth_rls_initplan` warnings were removed by preserving policy semantics while using init-plan-safe `(select auth.uid())` / helper calls;
- added `access_blocks_created_by_idx` for the FK.

Current Supabase security-advisor warnings that are intentionally not auto-"fixed":
- `ingest_mt_events` and `report_connector_status` are anonymous SECURITY DEFINER RPCs by design because MT connectors authenticate with the private ingest token; their function bodies validate/hash the token and constrain payloads;
- `signup_wait_seconds` must be callable before login and reads only the temporary signup block;
- authenticated admin/member SECURITY DEFINER RPCs have explicit role grants and internal authorization checks;
- leaked-password protection is currently disabled in Supabase Auth and should be enabled in project Auth settings when available/desired.

A full Strix adversarial scan is still pending until its runtime/CLI is actually available.

### D. Direct Investor Password collector — FOUNDATION IMPLEMENTED / END-TO-END PENDING
Source of truth: docs/INVESTOR_COLLECTOR_V1.md.

Product contract:
- v1 supports both MT4 and MT5;
- one UX: Platform + Login + Investor Password + Server;
- v1 is not complete until both adapters pass acceptance tests;
- current Reader/Connector remains a fallback.

Repository foundation:
- common collector models and redacted in-memory credential lease;
- MT5 read-only connection probe;
- MT4 disposable-worker startup config with ExpertsTrades=false;
- one-shot read-only MT4 history exporter source;
- regression checks that forbid trade APIs;
- Python unit tests in GitHub Actions.

Frontend credential-entry prerequisite completed:
- Supabase JS pinned to exact 2.117.1 UMD path;
- main application JavaScript externalized to /app.js;
- CSP blocks inline script/inline script attributes and pins the allowed SDK source;
- CI enforces these constraints.
The direct Investor Password form is still not enabled until collector/control-plane phases are ready.

Production control-plane DB foundation completed:
- migration `20260925191441 investor_collector_control_plane_v1`;
- migration `20260925191514 investor_collector_job_fk_indexes_v1`;
- `public.broker_connections` stores metadata only; authenticated users receive SELECT-only access to their own approved-user rows;
- `collector_private.broker_credentials`, `collector_nodes`, and `collector_jobs` are RLS-enabled deny-all tables with no anon/authenticated/service_role table grants;
- private schema USAGE is revoked from browser/backend API roles;
- browser Smoke checks reject anonymous broker metadata access and private-schema Data API exposure.

Collector identity foundation completed in repository:
- RSA-3072 key generation and OAEP/MGF1 SHA-256 decrypt contract;
- private key persisted only through an OS-protector abstraction;
- Windows implementation uses current-user DPAPI (not machine-wide DPAPI), intended for a dedicated collector service account;
- collector auth token is persisted protected locally and only SHA-256 hash is intended for database registration;
- `cryptography==50.0.1` is pinned and CI tests RSA round-trip, key stability, token rotation and protected-at-rest test behavior.

Service API / Edge Function control plane completed:
- migration `20260925195214 investor_collector_service_rpc_v1`;
- service-only SECURITY DEFINER RPCs are executable by `service_role` only, not anon/authenticated;
- `broker-key`, `broker-connect`, `broker-disconnect` validate Supabase user JWTs and approved membership inside the function;
- `collector-next-job`, `collector-report`, `collector-ingest` use a dedicated high-entropy collector token whose SHA-256 hash is matched server-side;
- Windows collector never receives a Supabase service/secret key;
- collector ingest resolves user/account/platform/server server-side from the leased connection and canonicalizes event identity before writing `raw_events`;
- production Smoke verifies service RPC denial, broker unauthenticated denial and invalid collector-token denial.

Sync cursor hardening completed:
- migration `20260925200130 investor_collector_sync_cursor_v1`;
- VALIDATE no longer advances `last_sync_at`;
- lease responses include `last_sync_at`;
- first SYNC can import the initial history window; later SYNC jobs use an overlap cursor.

Python worker + MT5 history foundation completed in repository:
- collector HTTP client uses only publishable API key + dedicated collector token, never Supabase secret/service-role;
- worker decrypts RSA ciphertext locally, clears mutable credential buffers, dispatches jobs and batches ingest;
- default initial history window is 730 days, configurable; incremental overlap defaults to 120 seconds;
- MT5 `history_deals_get` normalizer emits BUY/SELL deal events and skips non-trade balance/commission deal types for v1;
- `DEAL_REASON_SL` is mapped to explicit `closed_by_sl`; frontend MT5 grouping now consumes explicit SL evidence and still never infers SL from negative P&L.

Still pending:
- real Windows service installer / directory ACL provisioning and runtime DPAPI integration test;
- registration of a real collector node generated on the owned Windows/VPS host;
- live MT5 terminal end-to-end test against the owned Windows collector;
- MT4 disposable-slot launcher implemented in repository: cloned terminal slot, short-lived startup config, /portable launch, cursor file, account/server/read-only validation and guaranteed cleanup;
- MT4 exporter v0.11 reads an exact since-ms cursor and reports terminal history total;
- Windows GitHub Actions now performs a real current-user DPAPI round-trip and installs/imports pinned MetaTrader5 5.0.6180;
- still pending specifically for MT4: compile the MQ4 to EX4 with the target/broker MetaEditor and validate real terminal login/history behavior on owned Windows;
- MT4 Windows launcher/compile/runtime validation;
- frontend direct-connect form;
- production Windows integration tests.
---

When a new chat begins, **do not ask the user to re-explain these rules**. Read this file first and continue from current repo state.
