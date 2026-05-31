# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-31
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-14, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Recent Completed Context

- **Sprint 12 - Scanner Cost & Telemetry:** added structured AskEdgar fan-out logs and moved Dashboard scanner aggregate cache from module memory into `askedgar_cache`.
- **Sprint 13 - Dashboard MDR Scan Retirement:** removed Dashboard MDR UI/routes/cron/evaluator exports while intentionally leaving `mdr_triggers` schema/data for a later migration.
- **Sprint 14 - Daily Review Tag Centralization:** made trade tags the shared Watchlist/Daily Trades tagging model, added tag rename/merge management, and removed watchlist-thesis UI usage while keeping the legacy route/table.

---

## Sprint 15 - Cleanup: Test Coverage + Backtesting Lazy Loading

> Generated: 2026-05-31 | Agent: Codex (`$nexus-handoff`)
> Status: READY - final decisions reviewed 2026-05-31

### Objective

Close the next `docs/repo-cleanup.md` sprint by adding focused coverage around high-risk UI/API behavior and reducing eager Charts-tab code load without changing user-visible behavior.

This sprint should stay low-risk:

- Add component-level tests for trading UI flows that currently rely on integration/manual confidence, including `ResearchTickerView`.
- Add Playbook API and UI smoke coverage before any larger Management cleanup.
- Add lazy loading around the Backtesting/Charts surface only after a plain `npm run build` size baseline check.

Do **not** include the legacy DB column-drop migration in this sprint. That remains the final isolated cleanup sprint.

### Final Decisions

- Do **not** add `@next/bundle-analyzer` in Sprint 15. This is a cleanup sprint, not a performance-tooling sprint.
- Use plain `npm run build` before and after the lazy-loading change as the build-size baseline. Record the relevant Next route/client JS output in the execution notes.
- Lazy-load only the whole `BacktestingTab` from `app/page.tsx`. Do not add dynamic imports inside `components/trading/BacktestingTab.tsx` in this sprint.
- Keep `ResearchTickerView` coverage in scope.

### Current State Verified

- `docs/repo-cleanup.md`
  - Lists two remaining cleanup sprints: this low-risk test/small-cleanup sprint, then an isolated legacy DB column-drop migration.
  - The open testing finding still mentions `TradesTab`, `TradeDetailSheet`, and `ResearchTickerView`.
  - The sprint bundle currently names `TradesTab`/`TradeDetailSheet`, Playbook coverage, and Backtesting lazy imports.
- `__tests__/`
  - No dedicated `TradesTab` test file exists.
  - No dedicated `TradeDetailSheet` test file exists.
  - No dedicated `ResearchTickerView` test file exists.
  - `rg -n "playbook|Playbook|/api/playbook" __tests__` returns no Playbook coverage.
  - Existing component-test patterns are available in `__tests__/weekly-trades-panel.test.tsx`, `__tests__/watchlist-editor.test.tsx`, `__tests__/backtesting-tab.test.tsx`, and `__tests__/research-tab.test.tsx`.
- `components/trading/TradesTab.tsx`
  - Renders search, position/tag filters, bulk risk/tag controls, `TradeTable`, and `ManageTagsDialog`.
  - Receives all behavior through props; it does not fetch directly.
- `components/trading/TradeDetailSheet.tsx`
  - Renders overview stats, close-position controls for open trades, chart/candles, executions, and note saving.
  - Calls `onSaveNotes(trade.id, notes)` with toast error handling.
  - Calls `onCloseTrade(trade.id, exitPrice, exitTime)` only after validating positive price and non-empty exit time.
  - Uses `useCandleData()` and `CandlestickChart`, which should be mocked in focused tests.
- `app/api/playbook/route.ts`
  - Exposes `GET`, `POST`, `PATCH`, and `DELETE`.
  - Uses `requireUser()`, `getDb()`, `dbUnavailable()`, `ensureUser()`, `parseAndValidate()`, and ownership filters on `playbookStrategies.userId`.
  - `PATCH`/`DELETE` require an `id` query param and return `404` when the strategy is not owned/found.
- `lib/validations/playbook.ts`
  - `createStrategySchema` requires `name` and `sections`; caps `name` at 200, `description` at 1000, `tag` at 100.
  - `updateStrategySchema` makes all fields optional but keeps the same caps.
- `components/trading/PlaybookTab.tsx`
  - Loads `/api/playbook` and `/api/report-templates?type=playbook` on mount.
  - Supports create, local edit, save, delete, template edit, template reset, tag selection, recent tagged trades, and stats.
  - Uses `toast` for load/save/delete errors and confirmations.
- `app/page.tsx`
  - Statically imports `BacktestingTab` and renders it only when `activeTab === 'charts'`.
- `components/trading/BacktestingTab.tsx`
  - Statically imports `BacktestChartGrid`, `BacktestManagerView`, `BacktestPlaceOrderDialog`, `BacktestSimPanel`, `BacktestStatsView`, `BacktestTradeMenu`, and `BacktestingSidebar`.
  - Starts on the chart workspace and keeps the right panel collapsed by default unless `localStorage["nexus.charts.rightCollapsed"] === "false"`.
  - Already has focused tests in `__tests__/backtesting-tab.test.tsx`; mocks may need adjustment if imports become dynamic.
- `package.json`
  - Has `build: "next build"`.
  - Does not include `@next/bundle-analyzer`.
- `next.config.ts`
  - Does not currently read `process.env.ANALYZE`.

### Required Changes

#### 1. Add focused `TradesTab` component coverage

**File:** `__tests__/trades-tab.test.tsx` - **CREATE**

Cover the highest-value prop wiring without re-testing `TradeTable` internals:

- Mock `motion/react` to render a plain `div`.
- Mock `TradeTable` with a lightweight component that exposes buttons to call:
  - `onToggleSelect`
  - `onSelectAll`
  - `onAddTag`
  - `onRemoveTag`
  - `onDeleteGlobalTag`
  - `onTradeClick`
  - `onMergeTrades`
- Mock `ManageTagsDialog` enough to verify it opens and receives `globalTags`, `onRenameTag`, and `onDeleteTag`.
- Assert:
  - Search input calls `onSearchQueryChange`.
  - Risk/default-risk/tag bulk inputs call their change handlers.
  - Apply Risk, Set Auto Risk, and Add Tag buttons call their handlers.
  - Tag filter dropdown can be mocked or verified through its props; do not depend on Radix internals.
  - `TradeTable` receives `readOnly={false}`, `globalTags`, `positionFilter`, and `onPositionFilterChange`.

Keep this as interaction coverage for `TradesTab` orchestration only.

#### 2. Add focused `TradeDetailSheet` component coverage

**File:** `__tests__/trade-detail-sheet.test.tsx` - **CREATE**

Mock heavy/chart boundaries:

- Mock `useCandleData()` to return no candles by default.
- Mock `CandlestickChart` to render a simple marker.
- Mock Radix/shadcn sheet/select only if the existing primitives make assertions brittle in jsdom.

Assert:

- Closed trade renders overview values, net P/L, executions, and notes section.
- Editing notes and clicking Save calls `onSaveNotes(trade.id, updatedNotes)` and shows the normal success path.
- Open trade with `onCloseTrade` renders close-position controls.
- Invalid close price shows validation feedback and does not call `onCloseTrade`.
- Missing exit time shows validation feedback and does not call `onCloseTrade`.
- Valid close input calls `onCloseTrade(trade.id, exitPrice, exitTime.trim())`.

Do not test candlestick rendering; only verify the chart boundary receives the mocked state cleanly.

#### 3. Add Playbook route coverage

**File:** `__tests__/playbook-route.test.ts` - **CREATE**

Follow the DB/auth mocking style in `__tests__/daily-reviews-route.test.ts` and `__tests__/report-templates-route.test.ts`.

Cover:

- `GET` returns strategies for the authenticated user, sorted through the route's `orderBy` chain.
- `GET` returns `401` when `requireUser()` returns an error.
- `GET` returns `503` when `getDb()` returns null.
- `POST` validates input and inserts `{ id, userId, name, description, tag, sections }`.
- `POST` returns the standard `Validation failed` shape for invalid input.
- `PATCH` returns `400` when `id` is missing.
- `PATCH` updates only owned strategy rows and returns the updated row.
- `PATCH` returns `404` when no owned row is returned.
- `DELETE` returns `400` when `id` is missing.
- `DELETE` deletes only owned strategy rows and returns `{ success: true, id }`.
- `DELETE` returns `404` when no owned row is returned.

Use flexible assertions for Drizzle condition objects; assert call counts and returned payloads rather than stringifying SQL expressions.

#### 4. Add Playbook UI smoke coverage

**File:** `__tests__/playbook-tab.test.tsx` - **CREATE**

Mock browser/API boundaries:

- Mock `motion/react`.
- Mock `sonner` toast methods.
- Stub `global.fetch` for:
  - initial `/api/playbook`
  - initial `/api/report-templates?type=playbook`
  - `POST /api/playbook`
  - `PATCH /api/playbook?id=...`
  - `DELETE /api/playbook?id=...`
  - `PUT /api/report-templates`
- Stub `window.confirm` for delete tests.

Cover one smoke flow each:

- Initial load renders existing strategies and selects the first one.
- Create button posts a new strategy and selects it.
- Editing name/description/tag/section then clicking Save patches the selected strategy.
- Delete confirms, calls DELETE, removes the selected strategy, and selects the next one or empty state.
- Template editor can add a section and save the playbook template.

Keep this smoke-level. Avoid testing every field reorder/reset branch unless failures emerge while implementing.

#### 5. Run a Backtesting build-size baseline before lazy-loading

**Files:** no file changes required for the baseline.

Before changing imports:

- Run `npm run build`.
- Record the relevant route/client bundle output in the execution notes.
- Do not set up or install bundle analyzer tooling. If the plain build output is not detailed enough to prove the change helped, record that limitation and continue with the tab-boundary split because the code path is clearly not needed outside the Charts tab.

#### 6. Add Backtesting lazy loading at the tab boundary

**File:** `app/page.tsx` - **MODIFY**

- Import `dynamic` from `next/dynamic`.
- Replace the static `BacktestingTab` import with:

```ts
const BacktestingTab = dynamic(() => import('@/components/trading/BacktestingTab'), {
  ssr: false,
  loading: () => <div className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] items-center justify-center text-sm text-muted-foreground">Loading charts...</div>,
});
```

- Keep the `activeTab === 'charts'` rendering contract and `TabErrorBoundary` unchanged.
- Do not add dynamic imports inside `components/trading/BacktestingTab.tsx`.
- Preserve current default chart workspace, right-panel collapse behavior, localStorage keys, keyboard shortcuts, and all button labels/ARIA names used by `__tests__/backtesting-tab.test.tsx`.

After implementation:

- Run `npm run build` again.
- Record before/after output in the execution notes.
- If the lazy split makes tests brittle or creates a poor loading state, fix the boundary test/mocking or revert this step and leave a note in `docs/repo-cleanup.md` instead of carrying a no-benefit abstraction.

#### 7. Add focused `ResearchTickerView` coverage

**File:** `__tests__/research-ticker-view.test.tsx` - **CREATE**

Mock:

- `ResearchChart`
- `ResearchCompanyHeader`
- `ResearchReportSections`
- `ResearchSubNav` enough to switch tabs
- `ResearchReportPanel` exports `getCachedReportId` and `prefetchResearchReport`
- `sonner` toast
- `global.fetch`

Cover:

- Successful snapshot fetch renders company/header/report boundaries.
- 429 response shows the rate-limit status message and clears data.
- 503 response shows the unavailable status message and clears data.
- Other non-OK response shows the error message.
- Add-to-watchlist button is disabled until `getCachedReportId(ticker)` returns an id.
- Clicking Add to Watchlist posts to `/api/daily-reviews/append-watchlist` and handles duplicate vs added toast.

This test touches timer/polling behavior; use fake timers and keep assertions focused.

### Acceptance Criteria

- No production behavior changes except lazy-loaded chunk timing for the Charts/Backtesting surface.
- `TradesTab` has focused component coverage for control wiring and `TradeTable` prop forwarding.
- `TradeDetailSheet` has focused component coverage for notes and close-position flows.
- Playbook route has auth, DB unavailable, validation, ownership, CRUD, and not-found coverage.
- Playbook UI has smoke coverage for load/create/save/delete/template-save wiring.
- Backtesting lazy loading is implemented only at the `app/page.tsx` tab boundary, based on a recorded plain-build baseline, and preserves existing tests/user labels.
- `ResearchTickerView` has focused coverage for snapshot states and add-to-watchlist readiness.
- `docs/repo-cleanup.md` remains accurate after the sprint: completed Sprint 15 items move to Completed, and only the legacy DB column-drop migration remains scheduled.

### Search Checks

Before execution:

- `rg -n "playbook|Playbook|/api/playbook" __tests__` should show no existing Playbook coverage.
- `rg --files __tests__ | rg "(trades-tab|trade-detail-sheet|research-ticker-view|playbook)"` should show only files that already exist by then.
- `rg -n "from '@/components/trading/BacktestingTab'|next/dynamic|dynamic\\(" app components/trading` should confirm the current lazy-loading state.

After execution:

- `rg -n "playbook|Playbook|/api/playbook" __tests__` should include the new route/UI tests.
- `rg --files __tests__ | rg "(trades-tab|trade-detail-sheet|playbook)"` should include the new focused tests.
- `rg --files __tests__ | rg "research-ticker-view"` should find it.

### Testing Requirements

Run from repo root:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run workflow:audit` after updating `HANDOFF.md` and `docs/repo-cleanup.md`
5. `npm run build` before and after the lazy-loading change, with relevant route/client JS output recorded in the execution notes

`npm run typecheck:services` is not required unless execution unexpectedly touches `services/`.

### Security / Cost Notes

- Playbook route tests must preserve `requireUser()` and user-owned `playbookStrategies.userId` filtering.
- No auth, secrets, env files, schema, migrations, or external paid APIs should be changed in Sprint 15.
- `TradeDetailSheet` tests should not call real market-data/candle APIs; mock `useCandleData()`.
- `ResearchTickerView` tests must mock AskEdgar snapshot fetches and report prefetch/cache helpers.

### Order Of Operations

1. Add tests first for `TradesTab`, `TradeDetailSheet`, `ResearchTickerView`, Playbook route, and Playbook UI.
2. Run the focused new tests and fix test-only mocking issues.
3. Run `npm run build` and record the relevant route/client JS output.
4. Implement the `app/page.tsx` tab-boundary lazy import for `BacktestingTab`.
5. Rerun `__tests__/backtesting-tab.test.tsx` and `npm run build`; record before/after output.
6. Update `docs/repo-cleanup.md` to move completed Sprint 15 items into Completed and leave only the isolated migration sprint scheduled.
7. Run full validation.
8. Compact `HANDOFF.md` to a short completed summary after implementation/validation, leaving Sprint 16 as the next active cleanup context.

### Complexity Estimate

Medium. Most work is test scaffolding and careful mocking. The only production-code change should be the `app/page.tsx` tab-boundary lazy import for `BacktestingTab`; no bundle analyzer or deeper Backtesting subview splitting belongs in this sprint.

---

## Sprint 16 - Cleanup: Legacy DB Column Drop

> Status: NOT STARTED - isolated final cleanup sprint

Keep this migration sprint separate for a clean revert path.

Current verified migration target:

- `lib/db/schema.ts` still defines legacy `trades.pnl` and `trades.executions`.
- `lib/server-db-utils.ts` still has `toTrade()` fallback logic:
  - `row.netPnl === 0 && row.pnl !== 0 ? row.pnl : row.netPnl`
  - `row.executionCount === 1 && row.executions !== 1 ? row.executions : row.executionCount`
- Trade write paths still populate legacy columns in routes such as:
  - `app/api/trades/route.ts`
  - `app/api/trades/[id]/route.ts`
  - `app/api/trades/import/route.ts`
  - `app/api/trades/import-raw/route.ts`
  - `app/api/trades/merge/route.ts`
  - `app/api/trades/cover/route.ts`

Do not start Sprint 16 until Sprint 15 is complete and committed.

---

## Implementation Style

Write the simplest correct code that satisfies the active spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless the spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries: user input, external APIs, and DB reads of untrusted JSON.
- No comments unless the why is non-obvious.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
