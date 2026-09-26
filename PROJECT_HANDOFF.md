# Trading Journal — Project Handoff / New Chat Bootstrap

> Purpose: this file is the canonical continuity document for future chats. Read it before changing the project so prior decisions, strategy logic, security assumptions, and known pitfalls are not re-litigated or accidentally broken.

## 0. Fast bootstrap for a new chat

If the user opens a new chat, use this exact starting instruction:

> Continue the Trading Journal project from `Andrey244/Andrey244.github.io`. First read `PROJECT_HANDOFF.md` and `AGENTS.md`, then fetch the current `main` branch before making any changes. Do not re-derive existing strategy logic from guesses. Preserve current security, grouping, UI, and broker-day rules. Create a rollback branch before material changes, run regression/smoke checks, and only claim success after the new smoke run and Pages deploy succeed.

## 1. Current repository state

- Repo: `Andrey244/Andrey244.github.io`
- Current main must always be fetched before work; do not trust a pinned HEAD in this document.
- Static frontend: single-page `index.html` on GitHub Pages.
- Supabase project: `ylriyjxcefovzwzinpqd`
- Current grouping version: `2.3`
- Current MT4 connector: `v1.18`
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

Current UI audit status:
- global `:focus-visible` exists;
- `prefers-reduced-motion` handling exists;
- desktop navigation uses semantic buttons and managed `aria-current`;
- modal Escape/focus-trap/focus-restore behavior is implemented;
- calendar days and trade opening have keyboard paths;
- buttons have disabled/active states and hover is gated to fine pointers;
- coarse-pointer input/target sizing and safe-area/mobile handling are implemented;
- TinyFish live-browser regression on the deployed unauthenticated auth surface passed on 2026-09-26 after the self-hosted SDK/CSP hardening.

Remaining P2 UI debt, not release blockers:
- many raw hex values;
- some inline styles;
- some sub-12px labels/help text that should be reviewed gradually;
- optional URL/deep-link SPA cleanup.
Preserve the current visual direction; do not re-run the first accessibility pass as if it were missing.

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
- Leaked-password protection is currently disabled in Supabase Auth; do not change it automatically because the user explicitly does not want password-policy/MFA changes now.
- User explicitly said not to add MFA/password-policy changes for now.

## 5. MT4 / MT5 connection architecture

### Current production path
Current working path:
`MT4/MT5 terminal → Connector/Reader → Supabase → Journal`

MT4 current connector:
- `downloads/TradeJournalConnector_MT4_v1.18.mq4`
- generic mirror: `downloads/TradeJournalConnector_MT4.mq4`
- read-only;
- no AutoTrading permission required for journal sync;
- uses Supabase WebRequest;
- sends connector status.

### v1.18 SL metadata
v1.18 preserves:
- stop loss;
- take profit;
- explicit `closed_by_sl` from broker close/comment evidence;
- `sl_proximity` as diagnostic only.
Price proximity must never be promoted back into Strategy Outcome LOSS evidence.

### Direct Investor Password connection
Target UX:
`Platform + Login + Investor Password + Server → Connect`

Current architecture:
- current Reader/Connector remains the fallback path;
- owned Windows/VPS Collector supports both MT4 and MT5 adapters;
- MT5 uses the official MetaTrader5 Python integration and installed terminal;
- MT4 uses a disposable isolated terminal slot, short-lived startup config and read-only exporter;
- no permanent terminal per user;
- broker credentials never go to localStorage or public Supabase tables;
- Investor Password remains a secret even though read-only.

Implementation status:
- backend control plane, encrypted credential storage, service-only RPCs and Edge Functions are deployed;
- Python worker, MT5 history sync, MT4 disposable worker and Windows service installer exist in the repository;
- direct-connect UI exists but is fail-closed until `broker-key` reports a real registered primary collector;
- real owned Windows/VPS provisioning plus live MT4/MT5 terminal validation is still pending.

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

### B. Browser QA — LIVE UNAUDITED-AUTH PASS COMPLETED
TinyFish live-browser regression was run against the deployed GitHub Pages site on 2026-09-26 after CSP/self-hosted SDK hardening:
- page loaded without visible JS/CSP/resource failures;
- login/signup controls remained responsive;
- no duplicate/overlapping UI was observed;
- the run discovered a stale MT4 v1.17 download link, which was fixed to v1.18 and guarded by Smoke.

This is not a substitute for the future authenticated direct-collector acceptance test with a real collector/terminal. Playwright-specific coverage is still optional if that runtime becomes available.

### C. Security — NATIVE AUDIT + HARDENING COMPLETED / CODEX SECURITY TOOL RUNTIME NOT EXPORTED
Completed and verified:
- all public trading tables remain RLS-isolated by user;
- admin/member role boundaries remain intact;
- stale `app_members_role_check` was removed;
- 19 RLS init-plan warnings were eliminated;
- collector private tables remain deny-all to browser/API roles;
- collector service RPCs remain service-role-only;
- collector jobs now use exact sync cursors, attempt fencing and strict non-expired lease enforcement;
- manual Connector ingest and direct Collector ingest now share one private canonical event-validation/dedupe helper (`20260926125551 unify_manual_and_collector_ingest_v1`);
- primary collector readiness requires a fresh heartbeat (<2 minutes);
- the legacy public `journal` Edge Function was retired to an explicit HTTP 410 tombstone;
- frontend Supabase JS 2.117.1 is vendored locally after SHA-256 verification and CSP `script-src` is self-only;
- all 23 production migrations are synchronized into the repository for disaster recovery.

Supabase Advisor still reports intentional warnings for:
- token-authenticated anonymous connector RPCs `ingest_mt_events` / `report_connector_status`;
- pre-login `signup_wait_seconds`;
- authenticated SECURITY DEFINER helper/admin RPCs with internal authorization;
- leaked-password protection disabled (do not change automatically; user explicitly does not want auth-policy changes now).

Codex Security is installed/enabled in ChatGPT, but its scanner actions are not exported as callable tools in this chat session. Do not claim a Codex Security scan was run unless an actual scanner result exists.

Independent CodeQL security-extended scanning is enabled for Python and JavaScript/TypeScript and fails CI on unexpected findings. One exact reviewed exception is allowed: `py/clear-text-storage-sensitive-data` in the MT4 adapter, because the official MT4 startup mechanism requires the Investor Password in a short-lived config file. The exception is scoped by rule+path and retains BitLocker, service-account ACL, disposable-slot, overwrite/unlink and full-slot cleanup mitigations.

### D. Direct Investor Password collector — HARDENED FOUNDATION IMPLEMENTED / REAL WINDOWS TERMINAL ACCEPTANCE PENDING
Source of truth: `docs/INVESTOR_COLLECTOR_V1.md`.

Implemented:
- dual-platform MT4 + MT5 product contract;
- fail-closed direct-connect UI with RSA-OAEP/SHA-256 browser encryption;
- self-hosted verified Supabase JS 2.117.1, self-only script CSP and PWA cache coverage;
- production Supabase control plane, private encrypted credential storage, collector-node/job tables, six collector/broker Edge Functions and service-only RPCs;
- full production migration history mirrored in `supabase/migrations/`;
- RSA-3072 collector identity, current-user DPAPI protection and non-secret registration bundle;
- Windows service installer using per-service virtual account `NT SERVICE\\TradingJournalCollector`, not shared LocalService;
- ProgramData root is read/execute for the service; mutable identity/state/MT4 work directories have separate write ACLs;
- MT4 install path requires verifiable BitLocker protection for the disposable work volume;
- MT4 sync fails closed unless All History was explicitly operator-confirmed;
- MT4 exporter v0.12 and manual connector v1.18 separate explicit `closed_by_sl` evidence from price-proximity diagnostics;
- MT5 defaults to non-portable mode and repairs initial-window exit boundaries using `history_deals_get(position=...)`; it fails closed if prior entry history cannot be recovered;
- SYNC cursor advances to the exact collected `sync_until_ms`, never report time;
- ingest/report require the current job `attempt` and an unexpired lease; ingest holds a job row lock while canonical ingest runs;
- collector public key is exposed only when the primary node has a fresh heartbeat;
- legacy `journal` Edge Function is a 410 tombstone;
- current manual MT4 Connector download/status is v1.18.

Windows/VPS preflight is implemented at `collector/windows/preflight.ps1` and is mandatory from the installer. It fails closed on Windows/admin/Python/network/terminal/MT4 EX4/All-History/BitLocker prerequisites before runtime state is created.

Still pending before real Investor Password production use:
- run the preflight and install/provision the collector on the owned Windows/VPS host;
- register the real `registration.json` node;
- install/validate real MT5 terminal under the Windows service identity;
- compile `TradeJournalExport_MT4.mq4` to EX4 in the target broker MetaEditor;
- explicitly set/validate MT4 Account History = All History and only then install with `-Mt4AllHistoryConfirmed`;
- run the complete MT4 and MT5 acceptance matrix: correct/wrong password, wrong server, master-password rejection, account/server mismatch, historical import coverage, retry/idempotency, reconnect, disconnect credential deletion and multi-account isolation.

Do not provision a fake node just to enable the UI. The current fail-closed state is intentional until a real primary collector is online.


---

When a new chat begins, **do not ask the user to re-explain these rules**. Read this file first and continue from current repo state.
