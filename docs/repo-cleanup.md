# Repo Cleanup Audit

Date: 2026-05-21 | Updated: 2026-05-25

Current-state audit for making the codebase simpler and more efficient without removing features or reducing reliability. Updated 2026-05-25 with findings from a parallel four-agent health audit (Claude/Codex utilization, monetization, engineering principles, codebase health).

## Recommended Review Order

1. Fix security and reliability issues that can affect production behavior.
2. Fix data-integrity and error-handling gaps that affect user experience.
3. Reduce paid or noisy external work by adding durable claims, telemetry, and shared integration clients.
4. Decide which public/backend-only route surfaces are intentionally supported, then delete or document the rest.
5. Remove low-risk dependency and script dead weight.
6. Add missing tests around newer feature surfaces before larger cleanup.
7. Make workflow/docs guidance match live code so future cleanup work starts from correct instructions.
8. Do frontend and oversized-module simplifications only when touching those areas for feature or bug work.
9. Tighten TypeScript safety and remove legacy schema columns.

## Immediate Security And Reliability

### Expired Agent Job Leases Are Not Recovered

Evidence:
- Queue claims only `status = 'queued'` jobs: [lib/agents/queue.ts](/home/jared/Nexus-Terminal/lib/agents/queue.ts:73).
- Processing updates are fenced by worker lock, lease version, `status = 'processing'`, and unexpired `lock_expires_at`: [lib/agents/queue.ts](/home/jared/Nexus-Terminal/lib/agents/queue.ts:53).
- Service chat exposes `processing` status while waiting: [app/api/agents/service/chat/route.ts](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts:171).
- Discord bot polling eventually times out if no terminal state arrives: [services/discord-bot/index.ts](/home/jared/Nexus-Terminal/services/discord-bot/index.ts:305).

Recommendation:
Add a lease recovery path that requeues expired `processing` jobs when attempts remain, or marks them failed after max attempts. Keep the lease fencing; the cleanup is about making stale leases recoverable without manual DB intervention.

## Data Integrity And Error Handling (added 2026-05-25)

### Rate Limiting On Expensive Endpoints

Evidence:
- `POST /api/research-report` can make 14+ external API calls plus an LLM call per invocation: [app/api/research-report/route.ts](/home/jared/Nexus-Terminal/app/api/research-report/route.ts).
- The route has a per-ticker in-progress claim that prevents duplicate concurrent generations for the same ticker, but nothing prevents a user from generating reports for 100 different tickers in quick succession.
- `POST /api/askedgar/tldr` has no per-user throttle either.
- AskEdgar bills per-KB of response. A useEffect bug or curious user can run up unbounded cost.

Recommendation:
Add a simple DB-backed counter per user per hour for LLM-triggering endpoints. No Redis required — a `rate_limits` table with `(user_id, endpoint, window_start, count)` is sufficient. Return 429 when exceeded.

### Unbounded GET /api/trades Query

Evidence:
- `GET /api/trades` fetches ALL trades for a user with no LIMIT: [app/api/trades/route.ts](/home/jared/Nexus-Terminal/app/api/trades/route.ts).
- At 500 trades this is fine. At 10,000 trades after 2 years of daily trading, this becomes a slow query with a massive payload.

Recommendation:
Add cursor-based pagination. Drizzle supports `.limit(n).offset(m)` directly. The UI currently loads all trades at once, so the frontend needs a corresponding fetch-more pattern (or load the most recent 500 and fetch older on demand).

## TypeScript Safety (added 2026-05-25)

### Type Assertions Hiding Real Type Problems

Evidence:
- `lib/market-pulse/capture.ts` lines 101 and 117: Drizzle builder chains cast via `as unknown as { ... }`.
- `app/api/research-report/route.ts` line 168: `db as unknown as Parameters<typeof recordLlmAttempt>[0]`.

Recommendation:
Investigate each `as unknown as` and either properly type the function signatures or document as an accepted Drizzle typing limitation.

### Remove Redundant Legacy DB Columns

Evidence:
- `pnl` duplicates `netPnl`, `executions` duplicates `executionCount` in [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts).
- Comment says "transitional legacy retained for one release cycle" — that cycle has passed.
- `toTrade()` runs fallback logic on every trade read to reconcile the two sources.

Recommendation:
Write a migration that drops the legacy columns (`pnl`, `executions`) and remove the fallback logic in `toTrade()`. This simplifies every trade read path.

## Naming And Dependencies (added 2026-05-25)

### Add Lazy Dynamic Imports For BacktestingTab

Evidence:
- `BacktestingTab.tsx` imports 8+ heavy sub-components plus `motion` and `react-hotkeys-hook` eagerly.
- If the Charts tab is rarely the first tab visited, this is dead weight in the initial bundle.

Recommendation:
Wrap heavy sub-components with `next/dynamic`. Only worth doing after running `ANALYZE=true npm run build` to confirm bundle impact.

## Test Coverage Gaps (added 2026-05-25)

### Missing GET Test For Trades Route

Evidence:
- `__tests__/trades-route.test.ts` only tests POST, not GET.
- GET is the most-called route in the app (every page load). The multi-query coordination (Promise.all of trades + executions + tags) is untested.

Recommendation:
Add at least one happy-path test and one auth-rejection test for the GET handler.

### Missing Component-Level Tests For Complex UI

Evidence:
- `TradesTab`, `TradeDetailSheet`, `ResearchTickerView` have no dedicated test files.
- These components involve money-related operations (closing trades, recording P&L).

Recommendation:
Add 3-5 focused component tests for the highest-value user interactions in these components.

## Cost And External-Call Efficiency

### Research TLDR Needs A Paid-Work Claim And Unified Telemetry

Evidence:
- Research TLDR auto-posts from the UI: [components/trading/ResearchTldr.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTldr.tsx:34).
- The route delegates to `getCachedResearchTldr()`: [app/api/askedgar/tldr/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/tldr/route.ts:23).
- On cache miss, `getCachedResearchTldr()` reads cache, calls Ask Edgar data, runs the LLM, then upserts after generation: [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:171), [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:190), [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:197).
- The cache unique key protects final storage but not the expensive generation window: [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts:150).
- TLDR uses the standalone LLM client, whose result has no token usage or duration fields: [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:7), [lib/llm-client.ts](/home/jared/Nexus-Terminal/lib/llm-client.ts:42).
- Agent LLM calls already return usage and duration for telemetry: [lib/agents/llm-client.ts](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts:214).

Recommendation:
Give TLDR generation the same shape as Research Report generation: a DB-backed per-ticker in-progress claim, retry/stale cleanup, and usage records in the existing LLM telemetry path. User-facing output should remain the same; duplicate cold-cache spend should drop.

### Ask Edgar Needs Endpoint-Level Durable Telemetry

Evidence:
- The split adapter is now in place: [lib/askedgar/endpoints.ts](/home/jared/Nexus-Terminal/lib/askedgar/endpoints.ts:280), [lib/askedgar/fanout.ts](/home/jared/Nexus-Terminal/lib/askedgar/fanout.ts:90), [lib/askedgar/cache.ts](/home/jared/Nexus-Terminal/lib/askedgar/cache.ts:356).
- Fan-out logs requested count, successful count, cost, and duration only to stdout: [lib/askedgar/fanout.ts](/home/jared/Nexus-Terminal/lib/askedgar/fanout.ts:125).
- Cache metadata is still row-level by `(cache_type, ticker)`: [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts:143).
- The registry contains a broad `snapshot` scope plus narrower scanner and agent scopes: [lib/askedgar/endpoints.ts](/home/jared/Nexus-Terminal/lib/askedgar/endpoints.ts:301).

Recommendation:
Persist per-endpoint telemetry with caller surface, scope, ticker, endpoint, cache hit/miss, duration, failure kind, and `usage.cost_microdollars`. Use that evidence before changing endpoint TTLs or splitting Research snapshot loading. This does not change UI output; it makes cost decisions measurable.

### Dashboard Scanner Cache Is Only Per Warm Instance

Evidence:
- Dashboard now uses one aggregate endpoint: [components/trading/DashboardScannerTable.tsx](/home/jared/Nexus-Terminal/components/trading/DashboardScannerTable.tsx:299).
- The aggregate route fans out to TradingView gainers, MDR live candidates, and recent MDR rows: [app/api/dashboard/scanner-state/route.ts](/home/jared/Nexus-Terminal/app/api/dashboard/scanner-state/route.ts:51).
- It caches for 8 seconds in a module-level `Map`: [app/api/dashboard/scanner-state/route.ts](/home/jared/Nexus-Terminal/app/api/dashboard/scanner-state/route.ts:33).
- Vercel module memory is not durable across cold starts or instances.

Recommendation:
Keep the aggregate endpoint contract, but move short-lived coalescing to a DB row or external cache if scanner traffic or upstream noise becomes a problem. This preserves the Dashboard response shape while making caching real across instances.

### MDR Threshold Enrichment Is Recomputed Per Request

Evidence:
- Recent MDR rows load active triggers from `mdr_triggers`: [app/api/scanner/mdr-recent/route.ts](/home/jared/Nexus-Terminal/app/api/scanner/mdr-recent/route.ts:77).
- Each row then calls `evaluateLatestD2MdrTrigger()` in chunks: [app/api/scanner/mdr-recent/route.ts](/home/jared/Nexus-Terminal/app/api/scanner/mdr-recent/route.ts:48).
- Dashboard aggregate calls that helper on each cache miss: [app/api/dashboard/scanner-state/route.ts](/home/jared/Nexus-Terminal/app/api/dashboard/scanner-state/route.ts:54).

Recommendation:
Persist or cache MDR thresholds per `(ticker, trigger_date)`. The UI should show the same values; repeat dashboard requests should avoid recomputing the same historical thresholds.

### TradingView Scanner Calls Should Share One Client

Evidence:
- A shared client already owns TradingView headers, session cookie use, price-context columns, and scanner request handling: [lib/tradingview-client.ts](/home/jared/Nexus-Terminal/lib/tradingview-client.ts:16), [lib/tradingview-client.ts](/home/jared/Nexus-Terminal/lib/tradingview-client.ts:42).
- Gainers repeats TradingView columns and fetch wrapper: [app/api/tradingview/gainers/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts:15), [app/api/tradingview/gainers/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts:206).
- MDR candidates repeats the same endpoint/header pattern: [app/api/tradingview/mdr-candidates/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/mdr-candidates/route.ts:8), [app/api/tradingview/mdr-candidates/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/mdr-candidates/route.ts:111).

Recommendation:
Move the generic scan request, header/session handling, response typing, and TradingView error mapping into `lib/tradingview-client.ts`. Keep route-specific columns and normalization near each route or move them into scanner-specific helpers. User-visible scanner output should not change.

### Massive Market Data Has Two Client Paths

Evidence:
- `/api/market-data` reads `MASSIVE_API_KEY` and hardcodes an aggregate URL directly: [app/api/market-data/route.ts](/home/jared/Nexus-Terminal/app/api/market-data/route.ts:68), [app/api/market-data/route.ts](/home/jared/Nexus-Terminal/app/api/market-data/route.ts:99).
- `lib/massive-market.ts` also has the shared Massive client helper and base URL: [lib/massive-market.ts](/home/jared/Nexus-Terminal/lib/massive-market.ts:3), [lib/massive-market.ts](/home/jared/Nexus-Terminal/lib/massive-market.ts:149).
- `services/.env.example` documents `MASSIVE_API_BASE_URL`, but current code does not read it.

Recommendation:
Consolidate aggregate/candle requests into `lib/massive-market.ts` and either implement or remove the `MASSIVE_API_BASE_URL` knob. Chart data should remain identical; provider configuration and future retry/rate-limit behavior become one place.

## Route And Product-Surface Cleanup

### Remove Or Document Raw Scanner Routes

Evidence:
- Dashboard fetches only `/api/dashboard/scanner-state`: [components/trading/DashboardScannerTable.tsx](/home/jared/Nexus-Terminal/components/trading/DashboardScannerTable.tsx:299).
- Tests assert Dashboard no longer fetches `/api/tradingview/gainers`, `/api/tradingview/mdr-candidates`, or `/api/scanner/mdr-recent` directly: [__tests__/dashboard-scanner-table.test.tsx](/home/jared/Nexus-Terminal/__tests__/dashboard-scanner-table.test.tsx:222).
- The aggregate route imports helper functions directly from those public route modules: [app/api/dashboard/scanner-state/route.ts](/home/jared/Nexus-Terminal/app/api/dashboard/scanner-state/route.ts:1).
- The scanner plan already calls for deleting or repurposing raw TradingView routes after audit: [docs/scanner-build.md](/home/jared/Nexus-Terminal/docs/scanner-build.md:214).

Recommendation:
Move helper code out of route modules into `lib/` or `app/api/dashboard/_shared`-style modules, then either delete the raw public route handlers or explicitly document them as supported debug/API surfaces. No Dashboard behavior should change if the aggregate JSON contract is preserved.

### `/api/scanner/mdr-eligibility` Appears Deletion-Ready

Evidence:
- The route only wraps `computeMdrEligibility()`: [app/api/scanner/mdr-eligibility/route.ts](/home/jared/Nexus-Terminal/app/api/scanner/mdr-eligibility/route.ts:19), [app/api/scanner/mdr-eligibility/route.ts](/home/jared/Nexus-Terminal/app/api/scanner/mdr-eligibility/route.ts:38).
- `rg` finds `computeMdrEligibility()` only in this route and its route test: [lib/massive-market.ts](/home/jared/Nexus-Terminal/lib/massive-market.ts:348), [__tests__/scanner-mdr-eligibility-route.test.ts](/home/jared/Nexus-Terminal/__tests__/scanner-mdr-eligibility-route.test.ts:35).
- Dashboard tests assert the UI does not call the route: [__tests__/dashboard-scanner-table.test.tsx](/home/jared/Nexus-Terminal/__tests__/dashboard-scanner-table.test.tsx:226).

Recommendation:
Remove the route, its route test, and `computeMdrEligibility()` in a focused cleanup PR unless an external/manual consumer is confirmed. Expected user-visible change: none for the current app.

### Agent Report List/Detail Routes Look Backend-Only

Evidence:
- `/api/agents/reports` and `/api/agents/reports/[id]` are protected readers: [app/api/agents/reports/route.ts](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts:26), [app/api/agents/reports/[id]/route.ts](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts:7).
- Current Dashboard panels use report-type-specific latest routes instead.
- Repo search found no current product consumer for `/api/agents/reports`.

Recommendation:
Decide whether a generic agent-report UI is planned. If not, remove these routes and tests after checking external/manual consumers. If yes, keep them and document their intended consumer.

### Low-Priority Route Pattern Extraction

Evidence:
- Daily and weekly review routes have the same list/upsert shape with different date fields: [app/api/daily-reviews/route.ts](/home/jared/Nexus-Terminal/app/api/daily-reviews/route.ts:8), [app/api/weekly-reviews/route.ts](/home/jared/Nexus-Terminal/app/api/weekly-reviews/route.ts:8).
- Tags and watchlist theses share a small option-list CRUD shape, except tags also delete `trade_tags`: [app/api/tags/route.ts](/home/jared/Nexus-Terminal/app/api/tags/route.ts:8), [app/api/watchlist-theses/route.ts](/home/jared/Nexus-Terminal/app/api/watchlist-theses/route.ts:8).

Recommendation:
Do not abstract these immediately. If another review or option-list route is added, extract focused route helpers for authenticated list/upsert/delete patterns. User-visible behavior should remain unchanged.

## Frontend Simplification Targets

### Management Trade Prop Surface

Evidence:
- `app/page.tsx` destructures the broad `useTrades()` surface and forwards many props into Management: [app/page.tsx](/home/jared/Nexus-Terminal/app/page.tsx:61), [app/page.tsx](/home/jared/Nexus-Terminal/app/page.tsx:207).
- `ManagementTab` declares the same broad contract and repartitions it into Journal, Trades, Performance, Career P/L, Archive, and Playbook: [components/trading/ManagementTab.tsx](/home/jared/Nexus-Terminal/components/trading/ManagementTab.tsx:28).

Recommendation:
When Management is next touched, group props by purpose (`tradeFilters`, `tradeSelection`, `tradeBulkActions`, `tradePersistence`) or move more management-only wiring one level down. Expected user-visible change: none; fewer add-a-prop edits across parent and child components.

### Journal And Trades Duplicate Controls

Evidence:
- Journal renders search/risk/tag controls and selected-trade actions: [components/trading/JournalTab.tsx](/home/jared/Nexus-Terminal/components/trading/JournalTab.tsx:152).
- Trades renders similar search, risk, and tag controls with different layout: [components/trading/TradesTab.tsx](/home/jared/Nexus-Terminal/components/trading/TradesTab.tsx:68).

Recommendation:
Extract a shared trade action/search control with compact and full variants when either tab is next edited. Expected user-visible change: same controls; less markup drift between Journal and Trades.

### Daily And Weekly Review Sheets Duplicate Template Lifecycle

Evidence:
- Both sheets define template/review row types, clone fields, load template + review data, auto-print, save review, reset/save template, move/remove fields, and chart pagination: [components/trading/DailyReportSheet.tsx](/home/jared/Nexus-Terminal/components/trading/DailyReportSheet.tsx:36), [components/trading/WeeklyReviewSheet.tsx](/home/jared/Nexus-Terminal/components/trading/WeeklyReviewSheet.tsx:52).
- Matching open/load flows live at [components/trading/DailyReportSheet.tsx](/home/jared/Nexus-Terminal/components/trading/DailyReportSheet.tsx:85) and [components/trading/WeeklyReviewSheet.tsx](/home/jared/Nexus-Terminal/components/trading/WeeklyReviewSheet.tsx:146).

Recommendation:
Extract a review-template hook plus shared template editor and replay-chart-list components. Leave daily/weekly aggregation and weekly watchlist composition local. Expected user-visible change: none; parity fixes become smaller.

### Backtesting Sample-Set Loading Is Split Across Client Paths

Evidence:
- `useBacktestManager()` loads backtests and sample sets together: [hooks/use-backtest-manager.ts](/home/jared/Nexus-Terminal/hooks/use-backtest-manager.ts:92).
- `BacktestingSidebar` redeclares sample-set response types, fetches the list again, and fetches detail rows separately: [components/trading/BacktestingSidebar.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx:47), [components/trading/BacktestingSidebar.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx:130), [components/trading/BacktestingSidebar.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx:211).

Recommendation:
Share sample-set list/detail loaders or lift the list into `BacktestingTab` when the chart/sidebar flow is next touched. Expected user-visible change: fewer duplicate requests and less stale-list risk.

### Chart Session Shading Is Reimplemented Three Times

Evidence:
- Session shade rect state and `buildSessionShadeRects` wiring appears in Research, live candlestick, and backtest charts: [components/trading/ResearchChart.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchChart.tsx:101), [components/trading/CandlestickChart.tsx](/home/jared/Nexus-Terminal/components/trading/CandlestickChart.tsx:232), [components/trading/BacktestChart.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestChart.tsx:395).
- Each component has its own scheduling/recalculation path: [components/trading/ResearchChart.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchChart.tsx:141), [components/trading/CandlestickChart.tsx](/home/jared/Nexus-Terminal/components/trading/CandlestickChart.tsx:317), [components/trading/BacktestChart.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestChart.tsx:666).

Recommendation:
Extract a shared session-shading hook/helper around chart API, candles, viewport width, and intraday enablement. Expected user-visible change: same shading visuals.

### Research Report Cache Readiness Uses Polling

Evidence:
- `ResearchReportPanel` owns module-level `reportCache`, `getCachedReportId()`, and `prefetchResearchReport()`: [components/trading/ResearchReportPanel.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchReportPanel.tsx:61).
- `ResearchTickerView` prefetches the report, then the Add-to-Watchlist button polls the cache every 500ms: [components/trading/ResearchTickerView.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTickerView.tsx:82), [components/trading/ResearchTickerView.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTickerView.tsx:153).

Recommendation:
Expose report readiness through a small hook or have `prefetchResearchReport()` return/report the generated id directly to the button state. Expected user-visible change: same or faster Add button enablement, no timer polling.

## Dead Weight And Tests

### Add Playbook Coverage Before More Management Cleanup

Evidence:
- Playbook API exposes GET/POST/PATCH/DELETE: [app/api/playbook/route.ts](/home/jared/Nexus-Terminal/app/api/playbook/route.ts:10).
- Playbook UI drives list/load/create/save/delete flows: [components/trading/PlaybookTab.tsx](/home/jared/Nexus-Terminal/components/trading/PlaybookTab.tsx:56).
- `rg -n "playbook|Playbook|/api/playbook" __tests__` currently returns no test coverage.

Recommendation:
Add focused route tests for auth, validation, ownership, CRUD, and one UI smoke test for create/save/delete wiring before larger Management cleanup. This reduces regression risk without changing features.

## Docs And Workflow Drift

### `workflow:audit` Is A Narrow Smoke Check, Not The Full Skill Audit

Evidence:
- The workflow-audit skill lists `HANDOFF.md` and architecture claims as audit targets: [codex-skills/nexus-workflow-audit/SKILL.md](/home/jared/Nexus-Terminal/codex-skills/nexus-workflow-audit/SKILL.md:15), [codex-skills/nexus-workflow-audit/SKILL.md](/home/jared/Nexus-Terminal/codex-skills/nexus-workflow-audit/SKILL.md:26).
- The script checks selected strings in `AGENTS.md`, `README.md`, `docs/VALIDATION_MATRIX.md`, Vercel ops skill, and skill files, but does not read `HANDOFF.md` or `docs/ARCHITECTURE.md`: [scripts/workflow-audit.mjs](/home/jared/Nexus-Terminal/scripts/workflow-audit.mjs:19), [scripts/workflow-audit.mjs](/home/jared/Nexus-Terminal/scripts/workflow-audit.mjs:35), [scripts/workflow-audit.mjs](/home/jared/Nexus-Terminal/scripts/workflow-audit.mjs:41).
- `npm run workflow:audit` passes in the current tree.

Recommendation:
Either extend `scripts/workflow-audit.mjs` to cover the key handoff/architecture invariants, or document it as a narrow smoke check. The command is still useful, but it should not imply the full skill checklist ran.

---

## LOC Reduction Deep Research

I ran the deep-research pass with 3 parallel subagents and did not edit files.

**Bottom line:** frameworks are absolutely used to reduce code, but reliably only when they replace repeated plumbing. They do not erase domain logic. In Nexus, the target should be “less duplicated lifecycle/fetch/form/route boilerplate,” not raw LOC.

**Current LOC**
- `587` tracked files.
- `227,366` tracked lines total.
- `drizzle/`: `123,195` lines, mostly generated `drizzle/meta/*.json`.
- Excluding `package-lock.json` and `drizzle/meta`: `91,559` lines.
- Maintained TS/JS source across `app/`, `components/`, `hooks/`, `lib/`, `services/`, `scripts/`, `middleware.ts`: `48,028` lines.
- Tests: `21,218` lines.
- API routes: `6,805` lines.
- `components/trading`: `17,484` lines.
- `lib/agents`: `8,250` lines.

**Where The Real Bloat Is**
- Generated Drizzle metadata is the raw LOC monster. It is not product complexity.
- `.opencode/` and `.claude/` are tracked workflow/tooling weight. AGENTS says ignore them unless explicitly aligning tools, but they do inflate repo size.
- Repeated API route shells are real but mostly healthy convention: `requireUser`, `getDb`, `ensureUser`, `parseAndValidate`.
- Actual redundancy worth acting on:
  - TradingView scan fetch/header logic repeats in [gainers route](/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts:1) and [MDR candidates route](/home/jared/Nexus-Terminal/app/api/tradingview/mdr-candidates/route.ts:1) despite `lib/tradingview-client.ts`.
  - Massive API logic is split between [market-data route](/home/jared/Nexus-Terminal/app/api/market-data/route.ts:68) and [lib/massive-market.ts](/home/jared/Nexus-Terminal/lib/massive-market.ts:149).
  - Daily/weekly review sheets duplicate template lifecycle around [DailyReportSheet](/home/jared/Nexus-Terminal/components/trading/DailyReportSheet.tsx:49) and [WeeklyReviewSheet](/home/jared/Nexus-Terminal/components/trading/WeeklyReviewSheet.tsx:65).
  - Backtesting sample-set loading repeats between [use-backtest-manager](/home/jared/Nexus-Terminal/hooks/use-backtest-manager.ts:89) and [BacktestingSidebar](/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx:130).
  - `/api/scanner/mdr-eligibility`, its test, and `computeMdrEligibility()` look deletion-ready after external-consumer confirmation.

**Framework Fit**
- **TanStack Query** is the best candidate if you want reliable LOC reduction. Its docs explicitly target caching, deduping, stale state, background updates, pagination, mutations, and optimistic updates. This maps well to Nexus fetch-heavy hooks and polling/cache code. Source: [TanStack Query overview](https://tanstack.com/query/docs/docs).
- **React 19 / Next forms with Server Actions** can reduce form mutation state using `useActionState`, `useFormStatus`, and server-side validation. Good for internal explicit-save CRUD forms, not agent/service/cron/public API contracts. Sources: [React `useActionState`](https://react.dev/reference/react/useActionState), [Next forms guide](https://nextjs.org/docs/guides/building-forms).
- **React Hook Form + Zod** is already installed and barely used. Good for complex dialogs/sheets, not tiny forms.
- **TanStack Table/Virtual** can reduce table state logic, but not JSX. TanStack Table is headless, so markup and styling remain yours. Sources: [TanStack Table intro](https://tanstack.com/table/v7/docs/overview), [TanStack Virtual docs](https://tanstack.com/virtual/latest/docs).
- **shadcn/Radix** reduces accessibility and interaction code, but shadcn copies code into the repo, so raw LOC can rise while bespoke code falls.
- **Drizzle/Zod/Auth.js** are already doing the right kind of framework work here. Do not migrate auth or ORM just to reduce lines. Source: [Drizzle overview](https://orm.drizzle.team/docs/overview), [Auth.js](https://authjs.dev/).

**What I Would Not Cut**
- AskEdgar/agent blueprint verbosity in `lib/agents/blueprints/*`: that is domain contract, prompt behavior, and source-faithful parsing.
- AE endpoint-swap tests: they encode expensive external data contracts.
- Chart teardown/guard code in the big chart components: risky to compress for aesthetics.
- Broad route factories: small helpers are fine, but hiding auth/ownership/validation can make route behavior harder to audit.

**Recommendation**
Do not run a “reduce LOC” rewrite. Run 4 focused cleanup passes:

1. Delete confirmed dead surfaces: start with `/api/scanner/mdr-eligibility`.
2. Consolidate provider clients: TradingView and Massive.
3. Extract shared review-template lifecycle for daily/weekly sheets.
4. Pilot TanStack Query in one fetch-heavy area before adopting it broadly.

No validation commands were run because this was read-only research.
