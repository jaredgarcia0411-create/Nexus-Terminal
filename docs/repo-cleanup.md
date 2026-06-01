# Repo Cleanup Audit

Date: 2026-05-21 | Updated: 2026-05-31

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

## Remaining Sprint Plan (set 2026-05-30, updated 2026-06-01)

Sprints 6–15 closed the rate-limiting, slim-trades-payload, Research-TLDR-claim, agent-lease-recovery, dead-code purge, provider-client consolidation, scanner cost/telemetry, Dashboard MDR retirement, Daily Review tag centralization, and test-coverage/lazy-loading findings (see Completed). **No cleanup sprints remain.**

- **Legacy DB column drop — CLOSED, won't do (decided 2026-06-01).** Reviewed the full surface (`schema.ts`, `toTrade()` fallback, 5 write paths, 2 test assertions, a hand-edited backfill+drop migration). Decision: keep `pnl`/`executions`. The columns are inert and cheap (a few bytes/row + two ternaries per read); the only "win" was deleting ~12 lines of well-commented code. Against that, `DROP COLUMN` on the production trading DB is irreversible and carries real data-loss risk for any old row where `net_pnl=0` but `pnl` holds the true value (the exact case the fallback guards). Not worth a destructive migration for a cosmetic gain. Note: the code can't be simplified without altering the columns — `pnl` is `notNull()` with no default, so any insert that stops writing it breaks. All-or-nothing, and we chose nothing.

**Not scheduled — fold into feature/bug work when next touching those areas** (audit explicitly defers these): the 6 frontend simplifications (Management prop surface, Journal/Trades duplicate controls, daily/weekly review-sheet template lifecycle, backtesting sample-set loading, chart session shading, Research Report polling) and the "Low-Priority Route Pattern Extraction" finding.

---

## Open Findings

### Legacy DB Column Drop — CLOSED (won't do, 2026-06-01)

#### Remove Redundant Legacy DB Columns

Evidence:
- `pnl` duplicates `netPnl`, `executions` duplicates `executionCount` in [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts).
- Comment says "transitional legacy retained for one release cycle" — that cycle has passed.
- `toTrade()` runs fallback logic on every trade read to reconcile the two sources.

Decision (2026-06-01): **Won't do — keep the columns.** A destructive, irreversible `DROP COLUMN` on the live trading DB isn't justified by removing ~12 lines of inert, well-commented code. The fallback exists precisely because some old rows may hold the real value in `pnl`/`executions`; dropping without a perfect backfill risks permanent data loss. The columns cost a few bytes/row and two ternaries per read — negligible. See "Remaining Sprint Plan" above for the full cost/benefit.

### Deferred — Route Pattern Extraction

#### Low-Priority Route Pattern Extraction

Evidence:
- Daily and weekly review routes have the same list/upsert shape with different date fields: [app/api/daily-reviews/route.ts](/home/jared/Nexus-Terminal/app/api/daily-reviews/route.ts:8), [app/api/weekly-reviews/route.ts](/home/jared/Nexus-Terminal/app/api/weekly-reviews/route.ts:8).
- Tags and watchlist theses share a small option-list CRUD shape, except tags also delete `trade_tags`: [app/api/tags/route.ts](/home/jared/Nexus-Terminal/app/api/tags/route.ts:8), [app/api/watchlist-theses/route.ts](/home/jared/Nexus-Terminal/app/api/watchlist-theses/route.ts:8).

Recommendation:
Do not abstract these immediately. If another review or option-list route is added, extract focused route helpers for authenticated list/upsert/delete patterns. User-visible behavior should remain unchanged.

### Deferred — Frontend Simplification Targets

Fold each into feature/bug work the next time the area is touched. Expected user-visible change for all: none.

- **Management trade prop surface** — `app/page.tsx` forwards a broad `useTrades()` surface into `ManagementTab`, which repartitions it into Journal/Trades/Performance/Career P/L/Archive/Playbook. Group props by purpose or push wiring down a level. [app/page.tsx](/home/jared/Nexus-Terminal/app/page.tsx:207), [components/trading/ManagementTab.tsx](/home/jared/Nexus-Terminal/components/trading/ManagementTab.tsx:28).
- **Journal/Trades duplicate controls** — both render similar search/risk/tag controls with different layouts. Extract a shared control with compact and full variants. [components/trading/JournalTab.tsx](/home/jared/Nexus-Terminal/components/trading/JournalTab.tsx:152), [components/trading/TradesTab.tsx](/home/jared/Nexus-Terminal/components/trading/TradesTab.tsx:68).
- **Daily/weekly review-sheet template lifecycle** — both sheets duplicate template/review row types, load/auto-print/save/reset, field move/remove, and chart pagination. Extract a review-template hook plus shared template editor and replay-chart-list components. [components/trading/DailyReportSheet.tsx](/home/jared/Nexus-Terminal/components/trading/DailyReportSheet.tsx:36), [components/trading/WeeklyReviewSheet.tsx](/home/jared/Nexus-Terminal/components/trading/WeeklyReviewSheet.tsx:52).
- **Backtesting sample-set loading** — `useBacktestManager()` loads sample sets, but `BacktestingSidebar` redeclares the types and refetches list + detail separately. Share loaders or lift the list into `BacktestingTab`. [hooks/use-backtest-manager.ts](/home/jared/Nexus-Terminal/hooks/use-backtest-manager.ts:92), [components/trading/BacktestingSidebar.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx:130).
- **Chart session shading reimplemented three times** — Research, live candlestick, and backtest charts each wire their own `buildSessionShadeRects` + scheduling. Extract a shared session-shading hook/helper. [components/trading/ResearchChart.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchChart.tsx:101), [components/trading/CandlestickChart.tsx](/home/jared/Nexus-Terminal/components/trading/CandlestickChart.tsx:232), [components/trading/BacktestChart.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestChart.tsx:395).
- **Research Report cache readiness uses polling** — `ResearchTickerView` prefetches the report then polls the module-level cache every 500ms for the Add-to-Watchlist button. Expose readiness via a small hook or have `prefetchResearchReport()` report the generated id directly. [components/trading/ResearchReportPanel.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchReportPanel.tsx:61), [components/trading/ResearchTickerView.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTickerView.tsx:153).

---

## Completed

Condensed; see git history / `HANDOFF.md` for full per-sprint detail.

- **Sprint 6 — Rate limiting on expensive endpoints** (2026-05-29, commit 644dc24). DB-backed UTC clock-hour per-user counter (`rate_limits` + `lib/rate-limit.ts`) returning 429 with `Retry-After`/`X-RateLimit-*`. Caps: research-report 20/hr, askedgar/tldr 30/hr.
- **Sprint 7 — Unbounded GET /api/trades + missing GET test** (2026-05-29, commit 757cd32). Slimmed payload by dropping the `tradeExecutions` join (executions lazy-load via `/api/trades/[id]`); added GET route tests. Pagination deliberately deferred (analytics run client-side off the full array).
- **Sprint 8 — Research TLDR paid-work claim + unified telemetry** (2026-05-29, commit 458a0a9). Per-ticker in-progress claim against double cold-cache spend; TLDR generation now logs usage/duration through the LLM telemetry path. Output unchanged.
- **Sprint 9 — Agent job lease recovery** (2026-05-30, commit c8ffd89). `recoverExpiredJobs()` requeues/fails expired `processing` jobs before each worker claim; lease fencing intact. Closed the only open security/reliability finding.
- **Sprint 10 — Dead-code purge + type-cast docs + audit coverage** (2026-05-30). Removed the dead MDR eligibility endpoint/helper/test and generic agent-report list/detail routes/tests; documented the three accepted `as unknown as` limitations in place; extended `workflow:audit` to cover `HANDOFF.md`/`ARCHITECTURE.md` invariants.
- **Sprint 11 — Provider client consolidation** (2026-05-30, commit dc5bcd2). New `scanTradingView()` owns the TradingView scan request (gainers/mdr-candidates/price-context route through it); `lib/massive-market.ts` gained the aggregate-bars client and `/api/market-data` delegates to it; deleted the three dead raw scanner `GET` handlers. Scanner output unchanged (regression tests stayed green).
- **Sprint 12 — Scanner cost & telemetry** (2026-05-31). Added structured AskEdgar fan-out logs and moved the dashboard scanner aggregate cache into a short-lived `askedgar_cache` row. MDR threshold caching was explicitly dropped because Dashboard MDR scans were being retired.
- **Sprint 13 — Dashboard MDR scan retirement** (2026-05-31). Removed the Dashboard MDR UI, aggregate-route MDR fields, live/recent candidate routes, Vercel cron schedule, and Massive MDR evaluator exports. Left `mdr_triggers` schema/data in place for the later explicit migration.
- **Sprint 14 — Daily Review Tag Centralization** (2026-05-31). Made trade tags the shared Watchlist/Daily Trades tagging model, added tag rename/merge management, and removed watchlist-thesis UI usage while keeping the legacy route/table.
- **Sprint 15 — Test Coverage + Backtesting Lazy Loading** (2026-05-31). Added focused coverage for `TradesTab`, `TradeDetailSheet`, `ResearchTickerView`, Playbook route CRUD/ownership/validation, and Playbook UI smoke flows. Lazy-loaded the whole `BacktestingTab` at the `app/page.tsx` Charts-tab boundary only. Plain `npm run build` route output improved `/` from `388 kB` / `559 kB First Load JS` to `355 kB` / `526 kB First Load JS`.

---

## LOC Reduction Deep Research

I ran the deep-research pass with 3 parallel subagents and did not edit files.

**Bottom line:** frameworks are absolutely used to reduce code, but reliably only when they replace repeated plumbing. They do not erase domain logic. In Nexus, the target should be "less duplicated lifecycle/fetch/form/route boilerplate," not raw LOC.

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
- Actual redundancy worth acting on (provider-client items now closed by Sprint 11):
  - Daily/weekly review sheets duplicate template lifecycle around [DailyReportSheet](/home/jared/Nexus-Terminal/components/trading/DailyReportSheet.tsx:49) and [WeeklyReviewSheet](/home/jared/Nexus-Terminal/components/trading/WeeklyReviewSheet.tsx:65).
  - Backtesting sample-set loading repeats between [use-backtest-manager](/home/jared/Nexus-Terminal/hooks/use-backtest-manager.ts:89) and [BacktestingSidebar](/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx:130).

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
Do not run a "reduce LOC" rewrite. Run focused cleanup passes:

1. Delete confirmed dead surfaces. (Sprints 10–11 removed the confirmed sets.)
2. Consolidate provider clients: TradingView and Massive. (Done in Sprint 11.)
3. Extract shared review-template lifecycle for daily/weekly sheets.
4. Pilot TanStack Query in one fetch-heavy area before adopting it broadly.

No validation commands were run because this was read-only research.
