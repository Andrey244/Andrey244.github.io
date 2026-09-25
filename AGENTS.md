# Trading Journal — Agent Workflow

This project uses external agent skills/tools as mandatory guidance for future work.

## UI / UX changes and audits

Before designing, reviewing, or modifying the interface, consult the latest default-branch instructions from both:

1. Emil Kowalski Skills
   - https://github.com/emilkowalski/skills
   - Primary skill: skills/emil-design-eng/SKILL.md
   - Use its review format and interaction/animation principles.

2. UI/UX Pro Max
   - https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
   - Primary skill: .claude/skills/ui-ux-pro-max/SKILL.md
   - For audits also read references/quick-reference.md.
   - Preserve a coherent design system across Insights, Trades, Accounts, Connection, Access, auth/recovery, modals, calendar, and mobile navigation.

UI priorities for this journal:
- Insights and Trades are the current visual baseline.
- Maintain consistent typography, control heights, spacing rhythm, alignment, and density across all pages.
- Prefer clean/dense professional trading-dashboard UI over decorative UI.
- Do not add controls when there is no meaningful choice.
- Preserve semantic colors: profit/success green, loss/danger red, BUY blue, SELL red.
- Avoid visual churn; make targeted changes unless a redesign is explicitly requested.

## Browser / interaction QA

Use Playwright when browser automation is available:
- https://github.com/microsoft/playwright
- Relevant skill: packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md

Regression coverage should include desktop and mobile layouts, auth/recovery, navigation, modals, filters, calendar, Equity Curve interactions, and keyboard/focus behavior.

## Security

For adversarial security review, use Strix when its CLI/runtime is available and only against this owned/authorized project:
- https://github.com/usestrix/strix

Treat findings as evidence to validate, not as automatic proof. Preserve current Supabase RLS and least-privilege controls unless a change is explicitly justified and tested.

## Current library/framework documentation

Prefer current documentation through Context7 when connected:
- https://github.com/upstash/context7
- Skill: plugins/codex/context7/skills/context7-mcp/SKILL.md

Use it for Supabase, Playwright, browser APIs, and other evolving libraries instead of relying on stale API knowledge.

## Additional skills

Use a relevant skill from Vercel Labs when it materially fits the task:
- https://github.com/vercel-labs/skills

Do not load or apply unrelated skills just because they exist.

## Change safety

Before material UI, data, security, grouping, connector, or auth changes:
1. Create a rollback branch.
2. Make the smallest coherent change.
3. Run static checks and existing regression/smoke tests.
4. Verify a fresh GitHub Actions smoke run succeeds.
5. Verify Pages deployment succeeds for user-visible changes.
6. Do not claim success before those checks pass.

Do not expose passwords, ingest tokens, broker credentials, service-role keys, or other secrets.
