# Nexus Terminal — Handoff

**Generated:** 2026-03-04  
**Branch:** `main`  
**Latest Commit:** `a68c30e` (`API routes, UI updates, CSV parser fixes, & trade logging fixes`)

## Current State

The v2 implementation plan was applied to the codebase and shipped to `main`, including:

1. Expanded trade domain model + schema
- New analytics/execution fields on trades (`grossPnl`, `netPnl`, `entryTime`, `exitTime`, `mfe`, `mae`, `bestExitPnl`, `exitEfficiency`, `executionCount`, `rawExecutions`)
- New `trade_executions` table
- Transitional compatibility support for legacy aliases/columns

2. Parser/import pipeline updates
- New DAS Trader parser with context-aware side resolution
- Parser registry/type updates to support contextual normalization
- FIFO matching and execution consolidation improvements in CSV pipeline

3. API + hook changes
- Trade import/create/detail routes now persist/return raw executions
- `useTrades` supports:
  - lazy trade detail fetch
  - post-import MFE/MAE batch compute
  - single and bulk recalculation actions
- Added `useCandleData` with cache and typed status handling

4. Analytics + charting
- Added `lib/mfe-mae.ts`
- New deterministic MFE/MAE tests (`__tests__/mfe-mae.test.ts`)
- NY-timezone normalized candle windows for chart and analytics filtering
- Trade detail chart execution markers wired from execution payloads

5. UI/reporting refresh
- Trade detail 4-tab layout: Overview / Chart / Executions / Notes
- Journal day-card grouping with expandable trade tables
- Dashboard KPI additions (MFE/MAE/Exit Efficiency)
- Reports additions in performance charts:
  - Win vs Loss Days
  - Drawdown panel
  - Tag Breakdown

6. Security hardening completed
- User-scoped execution row IDs at write time to prevent cross-tenant ID collisions.
- Server-side request pacing for `/api/schwab/market-data` (per-user throttling) to prevent UI/client spam bypass.

## Validation Snapshot

All checks passed on 2026-03-04:

- `npm run lint`
- `npx tsc --noEmit`
- `npm test` (**16 files, 83 tests**)
- `npm run build`

Runtime smoke checks on built app:

- `GET /`, `GET /login`, `GET /discord/link` -> `200`
- `GET /api/health` -> `200`
- Protected routes (`/api/trades`, `/api/schwab/market-data`) -> `401` while unauthenticated (expected)

## Known Follow-ups

1. Manual signed-in UI sanity pass is still required
- Needs browser auth session to verify end-to-end interaction quality for:
  - dashboard panels
  - performance/report charts
  - journal day-card interactions
  - detail sheet tab and recalc flows

2. Local host trust config
- Local runtime checks showed NextAuth `UntrustedHost` warnings when running on non-default local port without matching trust config.

## Key Files Added/Changed in Latest Rollout

- `lib/mfe-mae.ts`
- `hooks/use-candle-data.ts`
- `lib/parsers/das-trader.ts`
- `lib/csv-parser.ts`
- `hooks/use-trades.ts`
- `app/api/trades/route.ts`
- `app/api/trades/import/route.ts`
- `app/api/trades/[id]/route.ts`
- `app/api/schwab/market-data/route.ts`
- `app/api/schwab/sync/route.ts`
- `components/trading/TradeDetailSheet.tsx`
- `components/trading/CandlestickChart.tsx`
- `components/trading/JournalTab.tsx`
- `components/trading/DashboardTab.tsx`
- `components/trading/PerformanceCharts.tsx`
- `__tests__/mfe-mae.test.ts`
- `__tests__/das-trader-parser.test.ts`
- `__tests__/candlestick-chart-lifecycle.test.ts`
- `drizzle/0005_natural_morg.sql`
- `drizzle/backfill-v2.sql`
