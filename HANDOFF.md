# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-12
> Purpose: Market Pulse enablement status and owner-run production runbook. Older implementation detail lives in git history and `specs/`.

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

### Market Pulse v1.1: Backfill, Cron, and First Report Enablement

> Generated: 2026-05-12
> Status: IMPLEMENTED — code changes and required local validation passed 2026-05-12. Production backfill/first-report runbook remains pending for owner-run validation because production curl commands and secrets were intentionally not used.
> Validation baseline from v1: `npm run db:generate`, `npm run db:migrate`, targeted Market Pulse/scanner tests, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit` passed before commit `bc7edc9`.
> v1.1 validation: `npx vitest run __tests__/market-pulse-eod-route.test.ts`, `npx vitest run __tests__/agent-market-pulse-route.test.ts`, `npx vitest run __tests__/market-pulse-panel.test.tsx`, `npx vitest run __tests__/dashboard-scanner-state-route.test.ts __tests__/dashboard-scanner-table.test.tsx`, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit` passed.

#### Objective

Make Market Strength testable end-to-end by tightening latest-report selection, making backfill safe and observable, adding the production cron, and documenting the exact operator flow to populate `market_pulse_daily_bars`, `market_pulse_daily_stats`, queued `agent_jobs`, and final `agent_reports`.

#### Baseline Verified Before v1.1

- `components/trading/MarketPulsePanel.tsx` fetches `GET /api/agents/market-pulse/latest` and renders "Market pulse not available yet." when that route returns `{ pulse: null }`.
- Before v1.1, `app/api/agents/market-pulse/latest/route.ts` already read `agent_reports` for `userId = 'system-agent-user'`, `agentId = 'orchestrator'`, and `reportType = 'market-pulse'`, but ordered by `agentReports.createdAt` instead of `reportJson->>'tradingDate'`.
- `app/api/cron/market-pulse-eod/route.ts` captures grouped Massive bars through `captureMarketPulseForDate(db, tradeDate)`, upserts stats, and enqueues one `agent_jobs` row for `orchestrator/market-pulse` when no report/job already exists for that `tradingDate`.
- `lib/market-pulse/capture.ts` writes `market_pulse_daily_bars` and `market_pulse_daily_stats`. It is idempotent by `(trade_date, ticker)` for bars and `trade_date` for stats.
- `lib/agents/blueprints/orchestrator-market-pulse.ts` loads stored stats/bars, calls the background LLM, and persists a `market-pulse` report through `writeAndDeliverReport()`. Missing Discord webhook may mark delivery as failed, but the report row is still the site source of truth.
- `lib/agents/config.ts` includes `orchestrator` capability `market-pulse`; `services/agent-entrypoint.ts` starts an orchestrator worker for queued jobs when the external agent service is running with `AGENT_ID=orchestrator`.
- Before v1.1, `vercel.json` scheduled only `/api/cron/agent-retention` and `/api/cron/mdr-sweep`; v1.1 adds `/api/cron/market-pulse-eod`.
- Existing route tests are `__tests__/market-pulse-eod-route.test.ts` and `__tests__/agent-market-pulse-route.test.ts`.

#### Decisions and Risk Assessment

- **Latest route ordering:** Use `reportJson->>'tradingDate' DESC, createdAt DESC` for the site latest route. This is the right product behavior because historical backfills can generate reports after newer trading dates. Risk is low: `tradingDate` is generated as `YYYY-MM-DD`, so lexical descending order matches date order. Mitigation: keep `createdAt DESC` as a tie-breaker and add a route test with an older report created later.
- **Backfill data volume:** Backfill uses Massive grouped daily aggregates, one external request per evaluated calendar date. Risk is medium: 90 trading days requires several requests and can hit provider/Vercel time limits if done in one call. Mitigation: cap at 30 trading days per request, walk extra calendar days to skip weekends/holidays, and run chunks.
- **LLM/report cost:** Generating a report for every historical day is unnecessary and can burn budget. Risk is medium. Mitigation: add an explicit `enqueue=0` mode for stats-only backfills; generate a single first report for the latest completed trading day after backfill completes.
- **Cron timing:** Running EOD too early can capture incomplete data. Risk is low/medium. Mitigation: schedule after market close at `30 22 * * 1-5` UTC as initially planned; default route captures yesterday in America/New_York.
- **Worker dependency:** The cron route only enqueues jobs; the external orchestrator worker must process them. Risk is medium operationally. Mitigation: verify `agent_jobs` transitions from `queued`/`processing` to `completed` and `agent_reports` receives the row before judging the UI.
- **Discord delivery:** `market-pulse` has no webhook mapping. Risk is low for site readback because persistence happens before delivery status matters. Mitigation: latest route must continue returning reports with `status = 'delivery_failed'` as readable content.

#### Required Code Changes

1. **Fix latest report selection**
   - Modify `app/api/agents/market-pulse/latest/route.ts`.
   - Import `sql` from `drizzle-orm`.
   - Change `.orderBy(desc(agentReports.createdAt))` to order by the report trading date first:
     - `desc(sql<string>\`${agentReports.reportJson}->>'tradingDate'\`)`
     - then `desc(agentReports.createdAt)`
   - Keep the route read-only: no job enqueue, no Massive call, no TradingView call, no LLM call.
   - Update `__tests__/agent-market-pulse-route.test.ts` to prove an older `createdAt` row with a newer `tradingDate` is selected over an older trading date generated later. Mock shape may need to support multiple rows or assert the `orderBy` arguments.

2. **Make backfill safe for stats-only population**
   - Modify `app/api/cron/market-pulse-eod/route.ts`.
   - Add query param `enqueue=0|1`.
   - Default behavior should remain `enqueue=1` for no-param and single-`date` calls so scheduled EOD still captures and queues a report.
   - For operator backfills, support `enqueue=0` so the route only populates bars/stats and does not create LLM jobs for every historical date.
   - Add response fields:
     - `jobsEnqueuedDates: string[]`
     - `skippedDates: string[]`
     - `existingReportDates: string[]`
     - `existingJobDates: string[]`
   - Split `enqueueMarketPulseJobIfNeeded()` so it can return a reason, not just boolean. The route should distinguish "enqueued", "existing report", and "existing job" for observability.
   - Update `__tests__/market-pulse-eod-route.test.ts` for `enqueue=0`, response date arrays, and existing job/report reasons.

3. **Make `days=N` mean trading days, not calendar dates**
   - Modify `getDatesToEvaluate()` / `collectCalendarDates()` in `app/api/cron/market-pulse-eod/route.ts`.
   - Current code evaluates exactly `N` calendar days. Change the loop so the route attempts enough calendar dates to capture up to `N` trading days, with a safety max such as `days * 2 + 10`.
   - Preserve the hard cap of 30 trading days per request.
   - Count non-trading days in `skippedNonTradingDays` and `skippedDates`, but do not let skipped dates consume the requested trading-day quota.
   - Keep exact `date=YYYY-MM-DD` behavior unchanged: one evaluated date, skipped if Massive returns empty.
   - Add/adjust tests so a weekend/holiday skip does not prevent the route from reaching the requested trading-day count when later dates are available.

4. **Add the production cron**
   - Modify `vercel.json`.
   - Add:
     ```json
     {
       "path": "/api/cron/market-pulse-eod",
       "schedule": "30 22 * * 1-5"
     }
     ```
   - Keep it separate from `/api/cron/mdr-sweep`.
   - Do not modify `.env`, `.env.local`, or secret files.

5. **Update handoff status after implementation**
   - Modify `HANDOFF.md` after code validation.
   - Mark this v1.1 spec completed only after code-level validation passes and the operator runbook below has either been executed or explicitly left pending for owner-run production validation.

#### Operator Backfill and First-Report Runbook

Use production URL and the real `CRON_SECRET` outside the repo. Do not write secrets into files or chat logs.

1. Confirm deployment/runtime prerequisites:
   - Migration `0034_fixed_ulik.sql` has been applied in the target DB.
   - Vercel app env has `DATABASE_URL`, `CRON_SECRET`, and `MASSIVE_API_KEY`.
   - The orchestrator service/container is rebuilt on a commit containing `orchestrator-market-pulse.ts`, has `BACKGROUND_LLM_*` configured, and is polling `agent_jobs`.

2. Backfill stats only:
   - As of 2026-05-12, the latest completed regular session should normally be `2026-05-11`.
   - Run 30-trading-day chunks with `enqueue=0`.
   - Example shape:
     ```bash
     curl -s -H "Authorization: Bearer $CRON_SECRET" \
       "$NEXUS_URL/api/cron/market-pulse-eod?from=2026-05-11&days=30&enqueue=0"
     ```
   - Repeat with older `from` anchors until at least 30 stored trading days exist for Rolling 30. Use enough chunks for 90 stored trading days if the 90-day overview should be visible.

3. Verify bars/stats populated:
   ```sql
   select count(distinct trade_date), min(trade_date), max(trade_date)
   from market_pulse_daily_bars;

   select trade_date, ticker_count, rolling_30_json, overview_90_json
   from market_pulse_daily_stats
   order by trade_date desc
   limit 5;
   ```

4. Generate the first visible report:
   - Re-run the latest completed trading date with enqueue enabled:
     ```bash
     curl -s -H "Authorization: Bearer $CRON_SECRET" \
       "$NEXUS_URL/api/cron/market-pulse-eod?date=2026-05-11&enqueue=1"
     ```
   - This idempotently refreshes bars/stats for that date and enqueues one `orchestrator/market-pulse` job if no job/report already exists.

5. Verify job and report rows:
   ```sql
   select id, status, input, error_message, created_at, completed_at
   from agent_jobs
   where agent_id = 'orchestrator' and job_type = 'market-pulse'
   order by created_at desc
   limit 20;

   select created_at, report_json->>'tradingDate' as trading_date, status, delivery_error
   from agent_reports
   where user_id = 'system-agent-user'
     and agent_id = 'orchestrator'
     and report_type = 'market-pulse'
   order by report_json->>'tradingDate' desc, created_at desc
   limit 10;
   ```

6. Verify site/API readback:
   - `GET /api/agents/market-pulse/latest` should return `{ pulse: { ... } }`, not `{ pulse: null }`.
   - Dashboard `Market Strength` should render the report. It is acceptable for `deliveryError` to mention missing Discord delivery if the report content is present.

#### Answers to the Population Questions

- `market_pulse_daily_bars` and `market_pulse_daily_stats` are populated by authenticated calls to `GET /api/cron/market-pulse-eod`; do not backfill these by direct SQL inserts.
- `agent_jobs` is populated by the same cron route when `enqueue=1` and stats were upserted for the date.
- `agent_reports` is populated only after the external orchestrator worker processes the queued `market-pulse` job and the `save-market-pulse-report` blueprint step calls `writeAndDeliverReport()`.
- The site panel cannot show data from bars/stats alone; it requires an `agent_reports` row for `system-agent-user/orchestrator/market-pulse`.

#### Acceptance Criteria

- Latest Market Strength API selects the newest `reportJson.tradingDate`, not merely the newest `agent_reports.created_at`.
- Multi-day backfill can run with `enqueue=0` and populate bars/stats without creating historical LLM jobs.
- `days=N` backfill captures up to `N` trading days, skipping weekends/holidays without counting them against the quota.
- `vercel.json` includes a scheduled `/api/cron/market-pulse-eod` entry.
- One explicit latest-date enqueue creates or reuses exactly one `orchestrator/market-pulse` job for that trading date.
- Once the worker completes that job, `/api/agents/market-pulse/latest` returns a non-null report and the Dashboard panel renders it.
- Existing dashboard scanner routes/components remain unchanged.

#### Validation Required

Run in this order:

1. `npx vitest run __tests__/market-pulse-eod-route.test.ts`
2. `npx vitest run __tests__/agent-market-pulse-route.test.ts`
3. `npx vitest run __tests__/market-pulse-panel.test.tsx`
4. `npx vitest run __tests__/dashboard-scanner-state-route.test.ts __tests__/dashboard-scanner-table.test.tsx`
5. `npm run lint`
6. `npx tsc --noEmit`
7. `npm test`
8. `npm run workflow:audit`

`npm run typecheck:services` is not required unless implementation touches `services/`.

#### Complexity Estimate

Medium. The schema and core report implementation already exist; remaining work is route behavior, cron wiring, tests, and a production runbook. The main risk is operational sequencing, not local TypeScript complexity.

## Open Follow-Ups

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred.
