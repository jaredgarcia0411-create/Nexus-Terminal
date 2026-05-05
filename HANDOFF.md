# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-05
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

## Active Execution Spec

None. The Dashboard scanner completion spec has been implemented, validated, visually reviewed, and condensed into the summary below.

## Recently Completed Summary

- 2026-05-05: Dashboard scanner completion implemented and visually validated. User reviewed the updated Dashboard scanner and confirmed the result looks materially better.
  - `Gainers Scan - Day 1 Setup` now qualifies rows with separate PM/AH TradingView scans, merges by ticker, filters on best PM/AH move >= 40%, and requires combined AH+PM volume >= 2M before rows reach the dashboard.
  - Dashboard Day 1 rows now display `AH+PM Vol`, use route-derived `dayOneMark`, `dayOneMovePercent`, and `extendedHoursVolume`, and use latch key `nexus-dashboard-day1-latched-v2` to flush stale rows from older criteria.
  - `Potential MDR Setup` now runs live candidates through the full structural `d2_mdr` helper before returning rows, and recent DB-backed MDR rows are threshold-enriched server-side.
  - `lib/massive-market.ts` now exposes shared MDR daily-series evaluation and ATR-based threshold helpers for `PM Price Needed`, `Opening Gap Needed`, and `Intraday Price Needed`.
  - `DashboardScannerTable` now renders MDR threshold values as prices/percentages when available and keeps dashes only for null threshold data.
  - Regression coverage added/updated in `__tests__/tradingview-gainers-route.test.ts`, `__tests__/dashboard-scanner-table.test.tsx`, `__tests__/massive-market.test.ts`, and `__tests__/tradingview-mdr-candidates-route.test.ts`.
  - Validation passed: targeted scanner/helper tests (4 files / 21 tests), `npm run lint`, `npx tsc --noEmit`, `npm test` (84 files / 612 tests), and `npm run workflow:audit`.
- 2026-05-05: MDR Scanner Expansion shipped in commits `cc19243`, `2a9e6b9`, and `a9a02de`. It split Day 1 and MDR feeds, added `mdr_triggers`, nightly `/api/cron/mdr-sweep`, `/api/scanner/mdr-recent`, a `from=` backfill parameter, and dashboard merging of live/recent MDR rows.
- 2026-05-04: Backtesting UI refinements plus grid layout and sample-set sidebar (`b03fa38`, `82bfa46`, `10e1071`, `82cca14`, `36a410b`).
- 2026-05-03: Backtesting chart drawing/indicator persistence and review save-flow fixes (`82cbb55`, `88a4da4`, `6513e40`).
- 2026-05-01: Backtest Manager landing page shipped: schema, API, manager, stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred. Data is not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
