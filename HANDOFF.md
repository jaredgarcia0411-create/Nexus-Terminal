# Nexus Terminal — Handoff Document

**Generated:** 2026-03-04 (updated 2026-03-04)
**Current Branch:** `main`
**Latest Commits:**
- `62f6086` — Refresh handoff document to reflect current post-hardening state
- `1b1189e` — Document residual risks and next steps in CODEX prompt
- `c1e0316` — Harden tenant auth boundaries and align Discord/backtest contracts

---

## Current Status

The codebase is in a stable state after the hardening sprint. All prior implementation workstreams (login page, page.tsx refactor, backtesting tab, bug fixes, DB migration to Neon/Drizzle, security hardening) are **complete**. A full UI/UX audit was performed on 2026-03-03 and its findings have been incorporated into the revised `CODEX_PROMPT.md`.

### Validation Snapshot

- `npm run lint` (pass)
- `npm test` (pass, 5 files / 28 tests)
- `npx tsc --noEmit` (pass)

---

## Hardening Outcomes (Completed)

1. **Tenant-safe trade ownership**
- `trades` now uses composite primary key `(user_id, id)`.
- `trade_tags` is user-scoped and references `(user_id, trade_id)` with cascade delete.
- Trade/tag read/write paths were updated to enforce `user_id` ownership.

2. **Schwab OAuth CSRF protection**
- Added generated OAuth `state` value with secure cookie binding.
- Callback validates and clears state; invalid/replayed state is rejected.
- Added unit tests for state helper behavior.

3. **Discord contract reconciliation**
- Added service-auth bridge for bot-to-app calls using bearer secret + Discord identity headers.
- Added missing schema tables and migration:
  - `discord_user_links`
  - `price_alerts`
- Aligned payload/response contract for alert creation (`targetPrice`, backward-compatible with `price`).

4. **Backtest contract reconciliation and access control**
- Discord bot backtest command now fetches market data, submits candles, and polls using `?jobId=`.
- App proxy and bot contract are aligned.
- Backtest gateway now enforces per-job ownership via `x-user-id`.

---

## Key Files Updated Recently

- Auth/service:
  - `lib/service-auth.ts`
  - `lib/schwab-oauth-state.ts`
  - `app/api/auth/schwab/url/route.ts`
  - `app/api/auth/schwab/callback/route.ts`
- Trade ownership + tags:
  - `lib/db/schema.ts`
  - `app/api/trades/route.ts`
  - `app/api/trades/[id]/route.ts`
  - `app/api/trades/bulk/route.ts`
  - `app/api/trades/import/route.ts`
  - `app/api/tags/route.ts`
  - `lib/server-db-utils.ts`
- Discord/backtest integration:
  - `app/api/discord/alerts/route.ts`
  - `app/api/discord/link/route.ts`
  - `services/discord-bot/src/utils.ts`
  - `services/discord-bot/src/commands/{alert,backtest,journal,pnl,stats,sync}.ts`
  - `app/api/backtest/route.ts`
  - `services/backtest-gateway/src/index.ts`
- Migrations/tests:
  - `drizzle/0000_bright_ultimo.sql`
  - `drizzle/0001_goofy_dreadnoughts.sql`
  - `__tests__/schema-tenant-isolation.test.ts`
  - `__tests__/schwab-oauth-state.test.ts`

---

## Residual Risks and Remaining Work

1. **Discord onboarding gap (medium)**
- Bot calls require an existing `discord_user_links` mapping.
- There is no bot-side self-serve linking command yet (only session route support exists).

2. **Service auth blast radius (low)**
- Service auth relies on a shared `TRADE_WEBHOOK_SECRET` plus Discord identity headers.
- If the secret leaks, linked-user impersonation is possible on service-enabled routes.

3. **Webhook delivery is still a stub**
- `/api/webhooks/trade-event` validates input but does not forward events to Discord/notification infrastructure.

4. **Price alert evaluation loop not implemented**
- Alert creation/storage works, but no background evaluator exists to trigger alerts on live price conditions.

5. **Backtest worker capability gap**
- Python worker currently implements `sma-crossover` only.
- `mean-reversion` and `breakout` strategy execution parity is still pending.

6. **Service package build verification gap in this environment**
- `services/backtest-gateway` and `services/discord-bot` builds were not fully validated locally due to missing service dependencies in this workspace.

---

## Architecture Snapshot

| Layer | Stack |
|---|---|
| Framework | Next.js 15 (App Router) |
| Frontend | React 19, shadcn/ui, motion/react |
| Auth | NextAuth v5 + Google OAuth |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Broker | Charles Schwab OAuth + market/sync endpoints |
| Services | Redis, backtest-gateway (Express + BullMQ), backtest-worker (Python), Discord bot |

---

## Environment Variables (Core)

- `DATABASE_URL`
- `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `ALLOWED_EMAILS`
- `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_API_BASE_URL`, `SCHWAB_OAUTH_BASE_URL`
- `TRADE_WEBHOOK_SECRET`
- `BACKTEST_GATEWAY_URL`
- `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `NEXUS_API_BASE_URL`

---

## What's Changing Next (per CODEX_PROMPT.md)

The revised `CODEX_PROMPT.md` archives workstreams 1-6 as completed and defines three new active workstreams:

### Workstream 7: UI/UX Hardening (20 changes, frontend-only)

A UI/UX audit surfaced 18 issues (4 critical, 8 warning, 8 suggestion). Key changes:

**Critical fixes:**
- Add confirmation dialog before bulk-deleting trades (Toolbar)
- Fix TradeDetailSheet losing existing notes on open (initializes to blank instead of `trade.notes`)
- Make Sidebar responsive — bottom nav on mobile using the existing `useIsMobile()` hook
- Make Toolbar responsive — prevent overflow on narrow viewports

**Accessibility:**
- Add `aria-label` to all icon-only sidebar buttons
- Add visible focus rings (`focus:ring-2`) to all raw inputs/selects (WCAG 2.1 SC 1.4.11)
- Bundle Google SVG locally (remove external CDN dependency on login page)
- Add `MotionConfig reducedMotion="user"` to respect `prefers-reduced-motion`

**Polish:**
- Remove non-discoverable sign-out from avatar click (keep sidebar dropdown)
- Replace raw `<select>` with shadcn `Select` in BacktestingTab and BrokerSyncTab
- Memoize dashboard stats (inline `.reduce()` in JSX)
- Fix TradeTable empty state colspan (off by 1)
- Add ARIA attributes to import loading overlay
- Make TradingCalendar and backtesting strategy grid responsive
- Remove `any` types from PerformanceCharts tooltip formatters
- Use `ResizeObserver` instead of `window.resize` in CandlestickChart
- Disable unused context files upload area with "Coming soon" badge
- Add empty state for broker accounts select
- Replace raw buttons with shadcn `Button` in DashboardTab, Toolbar, FilterTab

**Files touched:** 16 modified, 1 created (`public/google.svg`). No database changes.

### Workstream 8: Service Layer Completions

Addresses the residual risks listed below:
1. Discord `/link` onboarding command (new slash command)
2. Webhook event forwarding (implement the stub in `trade-event/route.ts`)
3. Price alert evaluation background process
4. Backtest worker strategy parity (`mean-reversion`, `breakout`)

### Workstream 9: Hardened Service Auth

- Replace shared-secret bearer tokens with short-lived signed JWTs
- Create `docs/SECRET_ROTATION.md` playbook

### Implementation Order

1. UI/UX critical fixes (7.1-7.4)
2. UI/UX accessibility (7.5-7.8)
3. UI/UX polish (7.9-7.20)
4. Service layer completions (workstream 8)
5. Hardened service auth (workstream 9)

---

## Residual Risks and Remaining Work (carried forward)
