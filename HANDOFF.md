# Nexus Terminal — Handoff Document

**Generated:** 2026-03-04  
**Current Branch:** `main`  
**Latest Commits:**
- `1b1189e` — Document residual risks and next steps in CODEX prompt
- `c1e0316` — Harden tenant auth boundaries and align Discord/backtest contracts

---

## Current Status

The codebase is in a stable state after the hardening sprint. The highest-risk auth/authz findings from the 2026-03-03 review were addressed and validated.

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

## Suggested Next Sprint

1. Add Discord `/link` flow (one-time code or signed challenge) to create `discord_user_links` safely.
2. Harden service auth (short-lived signed tokens and explicit secret rotation process).
3. Implement alert evaluation worker/cron and notification delivery path.
4. Complete worker strategy support beyond `sma-crossover`.
