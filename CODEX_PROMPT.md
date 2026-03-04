# Nexus Terminal — Current Implementation State

## Overview

Nexus Terminal is a Next.js 15 trading journal platform with:

- Neon/PostgreSQL + Drizzle ORM
- NextAuth v5 authentication
- CSV import + broker parser pipeline
- Schwab market data/sync integrations
- Discord/service-token integrations

As of **March 4, 2026**, the v2 implementation plan has been executed in code (schema, parser pipeline, APIs, hooks, analytics engine, and UI/reporting updates).

## What Is Implemented (v2)

1. Data model and schema expansion
- `Trade` model now supports execution-level records and analytics fields:
  - `grossPnl`, `netPnl`, `entryTime`, `exitTime`
  - `mfe`, `mae`, `bestExitPnl`, `exitEfficiency`
  - `rawExecutions`, `executionCount`
- Added `trade_executions` table and transitional compatibility fields in `trades`.
- Added migration/backfill artifacts (`drizzle/0005_*`, `drizzle/backfill-v2.sql`).

2. Parser and import pipeline upgrades
- Added DAS Trader parser (`lib/parsers/das-trader.ts`) and parser registry wiring.
- Updated parser interfaces for build context + row normalization context.
- Improved CSV matching flow:
  - chronological matching
  - deterministic ambiguity handling
  - same-time/same-price fill consolidation
  - preservation of raw execution detail on assembled trades

3. API and hook updates
- `trades` import/create/detail routes now support execution-level persistence and retrieval.
- `useTrades` now supports:
  - lazy detail fetch for execution-heavy payloads
  - batch MFE/MAE compute after import
  - single-trade and bulk MFE/MAE recalculation
- Added `useCandleData` with cache keying + typed error mapping (401/404/429).

4. Charting and analytics
- Trade detail chart now renders execution markers from `rawExecutions`.
- Time window handling is normalized to `America/New_York` for candle requests and MFE/MAE filtering.
- Added MFE/MAE engine (`lib/mfe-mae.ts`) with:
  - direction-aware formulas
  - epoch-based in-window filtering
  - `exitEfficiency` clamping
  - null handling for unavailable coverage

5. UI/reporting updates
- Trade detail sheet redesigned with tabs:
  - Overview, Chart, Executions, Notes
- Journal updated to day-card layout with expandable grouped trades.
- Dashboard and performance views include new KPI/reporting panels:
  - MFE/MAE/exit-efficiency metrics
  - Win vs Loss Days
  - Drawdown panel
  - Tag Breakdown

6. Security hardening delivered with v2 rollout
- Execution row IDs are now user-scoped during persistence to avoid cross-tenant ID collisions.
- Added server-side per-user pacing for `/api/schwab/market-data` to reduce request spam bypass from client/UI loops.

## Validation Baseline (2026-03-04)

- `npm run lint` passed
- `npx tsc --noEmit` passed
- `npm test` passed (**16 files, 83 tests**)
- `npm run build` passed
- Runtime smoke checks (unauthenticated):
  - `/`, `/login`, `/discord/link` -> `200`
  - `/api/health` -> `200`
  - protected API routes -> `401` (expected without auth)

## Remaining Follow-ups

1. Manual authenticated UI sanity pass
- Browser-driven pass still needed for signed-in flows:
  - dashboard
  - reports/performance
  - journal day cards
  - trade detail tabs + recalc actions

2. Local host trust config for auth in alternate local ports
- Local runtime checks showed `UntrustedHost` warnings when host trust env config did not match served port.

## References

- v2 source plan: `implementation-plan-v2.md`
- guided execution log: `implementation-plan-v2-guided.md`
- rollout SQL: `drizzle/0005_natural_morg.sql`
- backfill SQL: `drizzle/backfill-v2.sql`
