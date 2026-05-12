# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-12
> Purpose: active Market Pulse v1 execution spec. Older implementation detail lives in git history and `specs/`.

## Cleanup Roadmap Status

Source artifact: `docs/repo-cleanup.md`.

1. **Step 1 complete:** retired Discord research import stack and unused Schwab dependency/spec removed. Agent Discord delivery remains intentionally live.
2. **Step 2 complete:** cost/reliability fixes shipped for research-report idempotency, site-report telemetry, AskEdgar Postgres runtime state, and dashboard scanner aggregate polling.
3. **Step 3 complete:** high-confidence dead code removed.
4. **Step 4 complete:** backend-only/dead API and schema surfaces removed.
5. **Step 5 complete:** repo docs and workflow audit drift cleaned; commit `bbf909f`.
6. **Step 6 complete:** Codex harness skill alignment reviewed repo skills, synced repo-maintained installed copies, and patched stale installed-only legacy skill guidance where needed.
7. **Step 7 parked:** broad refactors (`lib/askedgar.ts`, TradingView client extraction, client cache hook) should wait until feature work touches those areas.
8. **Step 8 pending:** consider `npm run typecheck` / `npm run validate` convenience scripts after skill sync is settled.

## Active Execution Spec

### Market Pulse v1: Site-First Market Strength

> Generated: 2026-05-12
> Status: IMPLEMENTED — Market Pulse v1 code, migration, tests, and site UI added 2026-05-12. Pending owner review/commit.
> Validation: `npm run db:generate`, `npm run db:migrate`, targeted Market Pulse/scanner tests, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit` passed.

#### Objective

Design and implement a site-first Market Pulse / Market Strength feature that captures whole-market EOD data, stores normalized daily market breadth rows, computes rolling 30-day statistics, includes a 90-day overview only after enough stored trading days exist, generates a structured market-strength report through the existing agent report framework, and exposes the latest report in Nexus Terminal without generating on page load.

#### Current State Verified

- `lib/massive-market.ts` already exports `fetchGroupedDailyAggregates(date): Promise<GroupedDailyBar[]>`, backed by Massive's `/v2/aggs/grouped/locale/us/market/stocks/{date}` endpoint. Returned fields are normalized to `ticker`, `open`, `high`, `low`, `close`, `volume`, `vwap`, and `timestamp`.
- `app/api/cron/mdr-sweep/route.ts` already uses grouped daily aggregates for a nightly persisted scanner sweep. It is scanner-specific and must not be reused as the Market Pulse storage or report path.
- Existing dashboard scanner UI/API is separate: `components/trading/DashboardScannerTable.tsx` reads `GET /api/dashboard/scanner-state`, and `app/api/dashboard/scanner-state/route.ts` aggregates TradingView gainers, MDR candidates, and recent MDR rows with an 8s in-memory TTL. Market Pulse v1 must leave this route and component behavior unchanged.
- TradingView single-ticker scanner logic is duplicated in two blueprint files today: `lib/agents/blueprints/small-cap-research.ts` exports `fetchTradingViewPriceContext()`, and `lib/agents/blueprints/swing-trader-research.ts` has a local `fetchTradingViewPriceContext()`. Both define the same `TRADINGVIEW_COLUMNS` shape and POST directly to `https://scanner.tradingview.com/america/scan`.
- Agent report persistence already exists in `agent_reports` (`lib/db/schema.ts`) and stores `reportType`, `reportJson`, `status`, `deliveryChannel`, and timestamps. `app/api/agents/macro-summary/latest/route.ts` demonstrates a site read endpoint that returns the latest system report without generation.
- The agent framework currently allows `AgentId = 'orchestrator' | 'small-cap-trader' | 'swing-trader'` and `JobType` values including `macro-summary`; adding a Market Pulse blueprint requires widening these unions and updating `lib/agents/config.ts`.
- `components/trading/DashboardTab.tsx` currently shows `Scanners` and `Macro Summary`, and owns the Macro Summary expand button/dialog. `components/trading/MacroSummaryPanel.tsx` uses the site report container style `rounded border border-white/10 bg-white/5` for loading, empty, error, and populated states. Market Pulse should match this site format.
- `docs/FUTURE-PLANS.md` already states that site-native agent output should read from `agent_reports.report_json` and not route through Discord. Keep that principle for Market Pulse.
- `docs/ae-buildout.md` lists `market-strength` as a later Nexus-native replacement target. V1 should build the data/report product locally rather than cloning an AskEdgar endpoint.

#### Scope Decisions

- Source of truth: Massive grouped daily aggregates are authoritative for whole-market EOD OHLCV/VWAP capture.
- TradingView: optional enrichment only. Use it only after the EOD capture works, and only for fields like `sector`, `industry`, `country`, `float`, or 30-day performance when useful. Do not make TradingView required for capture, rolling stats, or report generation.
- TradingView client extraction: create `lib/tradingview-client.ts` for reusable server-side TradingView scan requests and price-context normalization, then update both `small-cap-research.ts` and `swing-trader-research.ts` to consume it. Keep route-specific scanner APIs (`app/api/tradingview/gainers/route.ts`, `app/api/tradingview/mdr-candidates/route.ts`) unchanged unless a test proves a shared helper is needed there too.
- Dashboard scanners: no dependency on `/api/dashboard/scanner-state`, `DashboardScannerTable`, `tradingview/gainers`, `tradingview/mdr-candidates`, `scanner/mdr-recent`, or `mdr_triggers`.
- Reports: use the existing blueprint/report framework and `agent_reports`; Market Pulse must be site-first. Discord fan-out may fail or be absent without blocking site readback.
- Storage: persist normalized daily rows so 30-day and 90-day metrics can be recomputed from Postgres without repeated external calls.
- V1 exclusions: do not implement "new HOD after 11am" or "broke premarket high". Record them as Phase 2 follow-ups only.

#### Proposed Data Model

Create shared, non-user-scoped tables in `lib/db/schema.ts` and a generated Drizzle migration:

- `market_pulse_daily_bars`
  - Primary key: `(trade_date, ticker)`.
  - Columns: `tradeDate` (`date`), `ticker` (`text`), `open`, `high`, `low`, `close`, `volume`, `vwap`, `dollarVolume`, `sourceTimestamp`, optional enrichment fields (`sector`, `industry`, `country`, `floatShares`, `marketCap`, `perf30d`) stored nullable, `createdAt`, `updatedAt`.
  - Purpose: one normalized row per ticker per trading day from Massive grouped aggregates. Upsert on `(trade_date, ticker)` so EOD capture is idempotent.
- `market_pulse_daily_stats`
  - Primary key: `tradeDate`.
  - Columns: `tradeDate`, `tickerCount`, `advancers`, `decliners`, `unchanged`, `advancerPct`, `declinerPct`, `upVolume`, `downVolume`, `totalVolume`, `medianChangePct`, `avgChangePct`, `pctAbovePrevClose`, `pctAboveDollarVolumeFloor`, `newHigh30dCount`, `newLow30dCount`, `rolling30Json`, `overview90Json` nullable, `createdAt`, `updatedAt`.
  - Purpose: deterministic market-strength snapshot for one trading day. `overview90Json` remains `null` until at least 90 stored trading days are available.
- `agent_reports`
  - Reuse existing table for the final structured Market Pulse report.
  - Use `agentId = 'orchestrator'`, `reportType = 'market-pulse'`, `userId = 'system-agent-user'`, and `deliveryChannel` as currently defined by report storage. If Discord webhook is not configured for this report type, the row still must be readable by site APIs.

Do not store every raw Massive response blob unless needed for diagnostics; normalized bars plus deterministic stats are the durable recomputation source.

#### Report Contract

Add a `MarketPulseReport` type in `lib/agents/types.ts` with a compact, UI-ready shape:

- `tradingDate: string`
- `marketStrength: 'strong' | 'mixed' | 'weak'`
- `confidence: Confidence`
- `tldr: string[]`
- `summary: string`
- `breadth: { advancers: number; decliners: number; unchanged: number; advancerPct: number; upVolumePct: number | null }`
- `rolling30: { tradingDays: number; avgAdvancerPct: number | null; medianAdvancerPct: number | null; strongDays: number; weakDays: number; newHigh30dAvg: number | null; newLow30dAvg: number | null }`
- `overview90?: { tradingDays: number; trend: 'improving' | 'flat' | 'deteriorating'; strongestDate: string | null; weakestDate: string | null; note: string }`
- `leaders: Array<{ ticker: string; changePct: number; volume: number; dollarVolume: number; sector?: string | null }>`
- `laggards: Array<{ ticker: string; changePct: number; volume: number; dollarVolume: number; sector?: string | null }>`
- `sectorNotes: string[]`
- `riskFlags: string[]`
- `sourceIndex: Array<{ id: string; label: string; source: 'massive' | 'tradingview' | 'computed'; asOf: string }>`

The blueprint prompt must instruct the LLM to synthesize from deterministic stored metrics only. It must not claim intraday patterns excluded from v1.

#### Implementation Order

1. Schema and migrations
   - Modify `lib/db/schema.ts` to add `marketPulseDailyBars` and `marketPulseDailyStats`.
   - Run `npm run db:generate`.
   - Inspect the generated SQL for only the two new tables and intended indexes.
   - Do not run `npm run db:migrate` unless explicitly approved during implementation.

2. Deterministic market pulse library
   - Create `lib/market-pulse/types.ts` for DB/report helper types that are safe for server use.
   - Create `lib/market-pulse/capture.ts` to call `fetchGroupedDailyAggregates(date)`, normalize rows, compute `dollarVolume`, and upsert daily bars idempotently.
   - Create `lib/market-pulse/stats.ts` to compute one-day breadth and rolling stats from stored bars. It must:
     - Use stored bars only for rolling windows after capture.
     - Compute rolling 30-day metrics when enough prior stored trading days exist for useful comparisons.
     - Return `overview90: null` until at least 90 stored trading days exist.
     - Treat non-trading days as skipped, not failed, when grouped aggregates return an empty array.
   - Add small pure helpers for percent change, median, percentile/rank, and safe division. Keep them unit-testable.

3. Shared TradingView client extraction
   - Create `lib/tradingview-client.ts`.
   - Move the shared single-ticker scanner pieces out of `lib/agents/blueprints/small-cap-research.ts` and `lib/agents/blueprints/swing-trader-research.ts`: `TRADINGVIEW_COLUMNS`, the TradingView POST/header/session handling, row selection, nullable number parsing, and normalized price-context return shape.
   - Export a typed helper such as `fetchTradingViewPriceContext(ticker)` plus any supporting type needed by the two blueprint files.
   - Update both blueprint files to import the helper from `@/lib/tradingview-client` and remove their duplicated scanner constants/functions.
   - Preserve current behavior, including `TRADINGVIEW_SESSION_ID`, `cache: 'no-store'`, `TradingView scanner returned {status}` errors, and null returns for missing/non-numeric rows.
   - Add focused tests for the shared client and adjust existing blueprint tests only as needed for mocks/import paths.

4. Capture and backfill API
   - Create `app/api/cron/market-pulse-eod/route.ts`.
   - Auth: `requireCronSecret(request)`.
   - Runtime: `export const dynamic = 'force-dynamic'`, `export const maxDuration = 300`, `export const runtime = 'nodejs'`.
   - Query params:
     - `date=YYYY-MM-DD` captures exactly one date.
     - `from=YYYY-MM-DD&days=N` backfills up to `N` trading days walking backward or forward only as implemented; cap `N` at 30 per request.
     - Default with no params captures yesterday in America/New_York.
   - Response summary: evaluated dates, inserted/updated bar count, stats upserted count, skipped non-trading days, errors.
   - Add `vercel.json` cron only after approval; proposed schedule is `30 22 * * 1-5`, separate from `/api/cron/mdr-sweep`.

5. Agent blueprint and report persistence
   - Add `MarketPulseReport` to `lib/agents/types.ts`.
   - Widen `JobType` with `'market-pulse'`; keep `AgentId` unchanged and use `orchestrator`.
   - Create `lib/agents/blueprints/orchestrator-market-pulse.ts`.
   - Update `lib/agents/config.ts` so orchestrator supports `market-pulse`.
   - Blueprint steps:
     - Load latest completed `market_pulse_daily_stats` plus source bars/leaders/laggards.
     - Build deterministic payload and validate enough data exists for a report.
     - LLM synthesize structured `MarketPulseReport`.
     - Save to `agent_reports` with `reportType = 'market-pulse'`.
   - Prefer a site-first storage helper if `writeAndDeliverReport()` would turn missing Discord webhook into noisy delivery failures. If reusing `writeAndDeliverReport()`, tests must prove the row is persisted and readable even when Discord delivery is unavailable.

6. Report trigger path
   - The EOD cron route may enqueue an `agent_jobs` row for `orchestrator/market-pulse` after stats upsert, or a separate cron route may enqueue report generation.
   - Make generation idempotent per `tradingDate` by checking `agent_reports` for an existing `market-pulse` report for that date before enqueueing or saving.
   - Do not generate from the site GET endpoint or React page load.

7. Site read API
   - Create `app/api/agents/market-pulse/latest/route.ts`.
   - Pattern after `app/api/agents/macro-summary/latest/route.ts`.
   - Read latest `agent_reports` row where `userId = 'system-agent-user'`, `agentId = 'orchestrator'`, `reportType = 'market-pulse'`, and `status` is readable.
   - Return `{ pulse: null }` when missing.
   - Must not enqueue a job, call Massive, call TradingView, or invoke an LLM.

8. Site UI
   - Create `components/trading/MarketPulsePanel.tsx`.
   - Place it in `components/trading/DashboardTab.tsx` near `Macro Summary`, separate from `Scanners`.
   - Match the Macro Summary site format exactly: same section header treatment in `DashboardTab.tsx`, same expand icon button/dialog pattern using `Maximize2`, and the same panel shell styling (`rounded border border-white/10 bg-white/5`) for loading, empty, error, and populated states. Do not redesign the dashboard layout.
   - Read `GET /api/agents/market-pulse/latest`.
   - Use a module-level client cache like `MacroSummaryPanel` so tab changes do not refetch repeatedly.
   - Render:
     - compact strength/confidence/date header,
     - TLDR bullets,
     - one-day breadth,
     - rolling 30-day metrics,
     - 90-day overview only when present,
     - leaders/laggards summary.
   - Empty state: "Market pulse not available yet." Do not trigger generation.

9. Phase 2 follow-up notes
   - Add a short follow-up note to `docs/FUTURE-PLANS.md` or this handoff after implementation approval: "new HOD after 11am" and "broke premarket high" require intraday/premarket capture and are intentionally excluded from v1.

#### Backfill Strategy

- Initial implementation should support bounded backfill through `GET /api/cron/market-pulse-eod?from=YYYY-MM-DD&days=30`, authenticated by `CRON_SECRET`.
- Run backfills in chunks of 30 trading days or less to stay inside the 300s function cap.
- Each date must be idempotent: repeated calls upsert the same `(trade_date, ticker)` bars and one `market_pulse_daily_stats` row.
- If Massive returns no grouped results, record the date as skipped and do not create an empty stats row.
- 30-day metrics can appear after enough stored days exist for the selected calculation. 90-day overview must remain absent/null until at least 90 stored trading days exist.

#### Tests Required

- `__tests__/market-pulse-stats.test.ts`
  - percent change, breadth counts, medians/averages, rolling 30-day metrics, and 90-day gating.
- `__tests__/market-pulse-capture.test.ts`
  - grouped aggregate normalization, idempotent upsert behavior, empty grouped-results skip, and safe handling of invalid bars.
- `__tests__/tradingview-client.test.ts`
  - shared price-context helper sends the expected scan request/session header, normalizes numeric/string rows, returns `null` for missing/non-numeric rows, and preserves non-OK scanner errors.
- `__tests__/market-pulse-eod-route.test.ts`
  - cron auth, default/date/backfill params, one-day idempotent capture summary, non-trading skip, and capped `days`.
- `__tests__/agent-blueprints.test.ts`
  - orchestrator resolves and runs `market-pulse`, saves `reportType = 'market-pulse'`, validates `overview90` omission with insufficient history, and does not require Discord success for site persistence.
- `__tests__/agent-config.test.ts`
  - `orchestrator/market-pulse` resolves to the new blueprint.
- `__tests__/agent-market-pulse-route.test.ts`
  - latest site API returns `{ pulse: null }` when missing and latest persisted report when present, without generation side effects.
- `__tests__/market-pulse-panel.test.tsx` or extend an existing dashboard UI test
  - panel fetches latest report once, renders 30-day metrics, hides the 90-day overview when absent, matches Macro Summary border/background plus expand-button behavior, and does not call a generation endpoint.
- Regression: keep `__tests__/dashboard-scanner-state-route.test.ts` and `__tests__/dashboard-scanner-table.test.tsx` passing unchanged to prove existing dashboard scanners still work.

#### Validation Required

Run in this order during implementation:

1. `npm run db:generate` after schema changes, then inspect generated SQL.
2. Targeted tests:
   - `npx vitest run __tests__/market-pulse-stats.test.ts`
   - `npx vitest run __tests__/market-pulse-capture.test.ts`
   - `npx vitest run __tests__/tradingview-client.test.ts`
   - `npx vitest run __tests__/market-pulse-eod-route.test.ts`
   - `npx vitest run __tests__/agent-blueprints.test.ts __tests__/agent-config.test.ts`
   - `npx vitest run __tests__/agent-market-pulse-route.test.ts`
   - UI test file added/updated for `MarketPulsePanel`.
   - `npx vitest run __tests__/dashboard-scanner-state-route.test.ts __tests__/dashboard-scanner-table.test.tsx`
3. `npm run lint`
4. `npx tsc --noEmit`
5. `npm test`
6. `npm run workflow:audit` if `HANDOFF.md`, `AGENTS.md`, or repo-maintained skills are changed again.

`npm run typecheck:services` is not required unless implementation touches `services/`.

#### Security and Cost Notes

- Do not modify `.env`, `.env.local`, or secret files.
- Market Pulse cron routes must use `requireCronSecret(request)`.
- Site read routes should follow existing auth posture. If the Dashboard is already protected by page/session state, still avoid exposing generation or cron behavior through public unauthenticated endpoints.
- Massive calls happen only in capture/backfill cron paths, never in the site latest-report GET path.
- LLM generation happens only through the agent job/cron flow, never on React page load.
- Store source IDs/timestamps in the report so market-strength claims can be traced back to Massive/computed rows.

#### Acceptance Criteria

- EOD capture stores one trading day of broad market data idempotently in normalized DB rows.
- Rolling 30-day market metrics are computed from stored data, not repeated external calls.
- 90-day overview appears only when at least 90 stored trading days exist.
- Shared TradingView single-ticker scanner logic lives in `lib/tradingview-client.ts`, with `small-cap-research.ts` and `swing-trader-research.ts` both importing it instead of maintaining duplicated fetch/normalization logic.
- Latest Market Pulse report is readable by the site without triggering generation on page load.
- Market Pulse / Market Strength report UI matches Macro Summary's site format, including border/background treatment and an expand button/dialog from `DashboardTab.tsx`.
- Existing dashboard scanner endpoints and UI continue to work unchanged.
- V1 explicitly excludes "new HOD after 11am" and "broke premarket high" and leaves them for Phase 2.
- Validation includes lint, root type-check, targeted tests, scanner regression tests, and full suite because implementation touches shared schema/agent/report paths.

#### Complexity Estimate

High. This touches schema/migrations, cron capture, deterministic stats, agent blueprint/report contracts, and dashboard UI. Implement in the order above and stop after each major checkpoint if requested by the owner.

## Open Follow-Ups

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred.
