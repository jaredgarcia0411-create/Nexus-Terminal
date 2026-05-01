# Nexus Terminal — HANDOFF.md

> Updated: 2026-05-01
> Purpose: active execution spec plus compact recent context. Older implementation detail lives in git history and `specs/`.

## Recently Completed Spec

## Build Spec — Dashboard Intraday Latches + Backtesting Chart/Review Controls

> Generated: 2026-05-01 | Agent: Codex (`nexus-handoff`)
> Status: IMPLEMENTED — validated 2026-05-01.

### Objective

Make Dashboard scanner rows stable for the whole trading day once they appear, then tighten the Backtesting tab chart controls and saved-review workflow:

- Keep Day 1 Gainers names visible after they first appear for the current ET day.
- Keep Potential MDR Setup names visible after they first qualify for the current ET day.
- Consolidate Backtesting drawing tools into a dropdown, share user drawings across the 5M, 15M, and 1H charts, and keep drawings off the daily chart.
- Add per-chart expansion so one chart can fill the chart section, with left/right controls for adding or removing forward trading days from the visible data range.
- Let Clear exit a saved-review view, and replace the saved-review `+ New` button with a red delete icon that removes the saved review.

### Implementation Result

- Phase 1 shipped browser-local ET-day latches for Day 1 Gainers and Potential MDR Setup rows in `components/trading/DashboardScannerTable.tsx`.
- Phase 2 shipped a shared intraday drawing controller, single drawing-tools dropdown, no daily drawing overlay, per-chart expansion, and forward-session range controls across the Backtesting charts.
- Phase 3 shipped saved-review Clear behavior and destructive review deletion through the existing user-scoped `DELETE /api/backtest/sessions/:id` route.
- Added focused coverage in `__tests__/dashboard-scanner-table.test.tsx`, `__tests__/backtest-chart-grid.test.tsx`, `__tests__/time-utils.test.ts`, `__tests__/backtesting-tab.test.tsx`, and `__tests__/backtest-sessions-route.test.ts`.
- Updated stale `__tests__/tradingview-gainers-route.test.ts` expectations for the route's existing nullable premarket fields.

### Validation Snapshot

- `npm run lint` — pass.
- `npx tsc --noEmit` — pass.
- `npm test` — pass, 73 files / 536 tests.
- `npm run workflow:audit` — pass.
- `npm run typecheck:services` — not required; no `services/` files changed.

### Pre-Implementation State Verified

- `components/trading/DashboardScannerTable.tsx`
  - Polls `/api/tradingview/gainers` every 10 seconds and replaces `gainers` with the latest payload.
  - Day 1 table renders from `gainers.filter((g) => g.marketCap != null && g.marketCap < 300_000_000)`, so names can disappear when the TradingView payload changes.
  - Potential MDR already has ET-day `mdrLatched` state and `mdrData`, but it still renders by filtering the current `gainers` array, so an already-qualified ticker disappears if it drops out of the current feed.
  - Scanner summaries currently fetch only for tickers in the current `gainers` array.
- `components/trading/BacktestChartGrid.tsx`
  - Renders four default cells: `5m`, `15m`, `1h`, and `1D`.
  - Passes `onAnchorChange` only to the `1D` chart, so daily chart clicks change the anchor date.
- `components/trading/BacktestChart.tsx`
  - Owns local drawing state per chart via `activeDrawingTool`, `ChartDrawings`, and `DrawingToolbar`.
  - Uses `drawingScope = ${ticker}:${anchorDate}:${timeframe}`, so drawings are timeframe-specific today.
  - `persistDrawings={false}` means drawings do not survive chart teardown.
  - The fixed chart shell height is `h-[440px]`.
- `components/trading/DrawingToolbar.tsx`
  - Renders separate icon buttons for trendline, horizontal, rectangle, and fibonacci tools.
- `components/trading/ChartDrawings.tsx` and `hooks/use-chart-drawings.ts`
  - `ChartDrawings` owns its own `useChartDrawings(...)` hook instance.
  - The hook already has the drawing reducer and operations needed for a shared controller, but they are not exposed as a reusable controller prop.
- `hooks/use-backtest-session.ts`
  - Read-only review mode is represented by `reviewMode`.
  - `clear()` returns immediately when `reviewMode` is set, so the Clear button cannot clear a saved-review view.
  - `startNewSession()` exits review mode, but it is wired to a `+ New` button instead of Clear.
  - There is no hook method for deleting a saved review.
- `components/trading/BacktestSimPanel.tsx`
  - Saved review banner shows `Viewing review` and a `Plus` icon button labeled `New`.
  - Clear and Save Review are disabled when `isReadOnly` is true.
- `app/api/backtest/sessions/[id]/route.ts`
  - Already exposes `DELETE`, guarded by `requireUser()`, and deletes the user-owned session row; `backtest_actions` cascade by FK.

### Assumptions To Confirm In Review

1. Dashboard latches should be browser-local and reset at the ET date boundary. This spec uses `localStorage` so rows survive tab refresh during the same day, without adding DB schema.
2. Dashboard retained rows keep updating when the ticker appears in new gainers payloads. If a ticker no longer appears, its last known row values remain visible.
3. Expanded-chart arrows mean: right adds one forward trading day to the chart data range; left removes one added forward trading day down to zero. They do not move the anchor date backward.
4. Deleting a Backtesting review permanently deletes the saved `REVIEWED` backtest session and its actions. Clear only exits the review view and does not delete data.

### Required Changes

#### Phase 1 — Dashboard ET-Day Row Latches

**Files:**

- Modify `components/trading/DashboardScannerTable.tsx`
- Create `__tests__/dashboard-scanner-table.test.tsx`

**Implementation notes:**

1. Add a small client-only latch helper inside `DashboardScannerTable.tsx` or as local pure helpers in the same file:
   - `DASHBOARD_DAY1_LATCH_STORAGE_KEY = 'nexus-dashboard-day1-latched'`
   - `DASHBOARD_MDR_LATCH_STORAGE_KEY = 'nexus-dashboard-mdr-latched'`
   - persisted shape should include `date`, `rowsByTicker`, and for MDR rows any eligibility data needed to preserve `priorClose`.
   - guard all `localStorage` reads/writes with `typeof window !== 'undefined'` and `try/catch`.
2. Replace direct Day 1 rendering from the current `gainers` list with an ET-day latched row map:
   - On every successful `fetchGainers`, merge current gainers that pass the existing Day 1 small-cap filter into `dayOneRowsByTicker`.
   - Keep existing latched rows for the same ET date even if they are absent from the latest payload.
   - Reset/prune the latched map when `todayInNewYork()` changes.
   - Render Day 1 rows from the latched map, sorted by the current row's mark/change descending using the same displayed fields.
3. Update scanner-summary fetching so it requests summaries for all visible Day 1 rows, including rows restored from localStorage that are not in the current feed.
4. Keep MDR eligibility requests driven only by fresh current gainers data, not by stale latched rows.
5. When an MDR response returns `eligible: true`, store both the ticker's ET-day latch and the latest row snapshot in an MDR row map.
6. On every successful `fetchGainers`, refresh any already-latched MDR row snapshot if that ticker appears again in the current payload.
7. Render Potential MDR from the ET-day MDR row map, not from `gainers.filter(...)`, preserving the existing PDC/mark/change calculations with `mdrData[ticker]?.priorClose` where available.

**Acceptance criteria:**

- A Day 1 ticker that appears once remains visible until the ET date changes, even if later `/api/tradingview/gainers` responses omit it.
- A Day 1 ticker's displayed values update when a later feed includes the same ticker.
- A Potential MDR ticker that qualifies once remains visible until the ET date changes, even if later feed responses omit it.
- Existing MDR eligibility calls are not made for localStorage-only stale rows.
- The empty states still render when no current-day rows are latched.
- Clicking retained rows still opens Research for that ticker.
- No server route, DB, or migration change is introduced for Dashboard latches.

**Focused tests:**

- `__tests__/dashboard-scanner-table.test.tsx`
  - Mock `fetch` to return a first gainers payload containing a Day 1 row, then a second payload omitting it; assert the row remains.
  - Mock a qualifying `/api/scanner/mdr-eligibility` response, then omit that ticker from the next gainers payload; assert the MDR row remains.
  - Assert an ET-date storage mismatch is pruned and does not render stale rows.

#### Phase 2 — Backtesting Drawing Dropdown, Shared Intraday Drawings, and Expanded Chart Range

**Files:**

- Modify `hooks/use-chart-drawings.ts`
- Modify `components/trading/ChartDrawings.tsx`
- Modify `components/trading/DrawingToolbar.tsx`
- Modify `components/trading/BacktestChart.tsx`
- Modify `components/trading/BacktestChartGrid.tsx`
- Modify `lib/time-utils.ts`
- Modify `__tests__/time-utils.test.ts`
- Create `__tests__/backtest-chart-grid.test.tsx`

**Implementation notes:**

1. In `hooks/use-chart-drawings.ts`, export a controller type for the existing hook return value:
   - `export type ChartDrawingsController = ReturnType<typeof useChartDrawings>;`
   - Keep existing default behavior intact for other chart surfaces.
2. In `ChartDrawings.tsx`, add an optional `controller?: ChartDrawingsController` prop.
   - If a controller is supplied, use its drawing state/actions instead of creating a local `useChartDrawings(...)` instance.
   - Preserve the current uncontrolled path for non-backtesting callers.
3. Convert `DrawingToolbar.tsx` from individual icon buttons into a dropdown trigger.
   - Keep the same tool IDs: `trendline`, `horizontal`, `rectangle`, `fibonacci`.
   - Add a clear-all item in the same dropdown when drawings exist.
   - Use familiar lucide icons where available and keep the `Fib` text fallback.
4. In `BacktestChartGrid.tsx`, create one shared intraday drawing controller:
   - `const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>(null)`
   - `const drawingsController = useChartDrawings(`${ticker}:${date}:intraday`, activeDrawingTool, '#ffffff', 1, { persist: false })`
   - Pass the controller and active-tool setter only to intraday charts (`5m`, `15m`, `1h`).
   - Pass `null` for the `1D` chart so drawings do not render on daily.
5. In `BacktestChart.tsx`, remove chart-local drawing state for backtesting charts and accept:
   - `drawingsController?: ChartDrawingsController | null`
   - `activeDrawingTool?: DrawingTool`
   - `onDrawingToolChange?: (tool: DrawingTool) => void`
   - `isExpanded?: boolean`
   - `onToggleExpanded?: () => void`
   - `extraSessionsForward?: number`
   - `onExtraSessionsForwardChange?: (next: number) => void`
6. Keep chart drawing interactions disabled on daily charts by rendering no `DrawingToolbar` and no `ChartDrawings` when `drawingsController` is null.
7. Add an expand/collapse icon button to every `BacktestChart` header.
   - In expanded mode, `BacktestChartGrid` renders only that chart and gives it the full chart-section height.
   - In normal mode, keep the current four-chart vertical stack.
8. Add left/right arrow buttons in the expanded chart header.
   - Right increments `extraSessionsForward` by 1.
   - Left decrements it by 1, minimum 0.
   - Display a compact `+N day` / `+N days` label when `extraSessionsForward > 0`.
9. In `lib/time-utils.ts`, export `getNextTradingSession(sortKey: string): string | null` using the same weekend-skipping logic style as `getPreviousTradingSession`.
10. Update `BacktestChart.tsx` market-option building:
    - Extend `buildMarketOptions(anchorDate, timeframe, extraSessionsForward = 0)`.
    - For intraday charts, keep the existing start key based on lookback sessions and set `endDate` to 20:00 ET on the anchor date plus `extraSessionsForward` trading sessions.
    - For daily charts, extend the daily `endDate` the same way so expanded daily can show future daily candles if available.
    - Reset `extraSessionsForward` when ticker/date changes or when a different chart is expanded.

**Acceptance criteria:**

- Drawing tools are presented through one dropdown control instead of four separate tool buttons.
- A drawing placed on the 5M chart appears on the 15M and 1H charts at the same time/price coordinates.
- A drawing placed on 15M or 1H appears on the other intraday charts.
- The daily chart has no drawing overlay and does not show user drawings.
- Clear drawings from the dropdown clears all shared intraday drawings.
- Expanding any chart hides the other chart cells and makes the selected chart fill the chart section.
- Collapsing returns to the default 5M/15M/1H/1D stack.
- Expanded right arrow adds one forward trading session to the data end range per click; left arrow removes one added session down to zero.
- Existing daily click-to-anchor behavior still works when the daily chart is not in drawing mode.

**Focused tests:**

- `__tests__/time-utils.test.ts`
  - Add `getNextTradingSession` coverage for normal weekdays and Friday-to-Monday behavior.
- `__tests__/backtest-chart-grid.test.tsx`
  - Mock `BacktestChart` and verify normal mode renders four cells.
  - Trigger expand on one mocked chart and verify only that timeframe remains rendered.
  - Verify intraday charts receive a drawing controller while `1D` receives `null`.
  - Verify right/left range controls change the forwarded `extraSessionsForward` prop.

#### Phase 3 — Backtesting Saved Review Clear/Delete Workflow

**Files:**

- Modify `hooks/use-backtest-session.ts`
- Modify `components/trading/BacktestSimPanel.tsx`
- Modify `components/trading/BacktestingTab.tsx`
- Modify `__tests__/backtesting-tab.test.tsx`
- Modify `__tests__/backtest-sessions-route.test.ts`

**Implementation notes:**

1. In `hooks/use-backtest-session.ts`, change `clear()` behavior:
   - If `reviewMode` is set, clear only the read-only review view by setting `reviewMode` to null and clearing errors. Do not call `/clear`.
   - If not in review mode, keep the existing active-session clear behavior.
2. Add `deleteReview(reviewId: string)` to `useBacktestSession`.
   - Optimistically remove the review from `reviews`.
   - If the deleted review is currently loaded in `reviewMode`, clear `reviewMode`.
   - Call `DELETE /api/backtest/sessions/${reviewId}`.
   - Roll back `reviews` and `reviewMode` on failure and surface `Could not delete review`.
3. In `BacktestSimPanel.tsx`:
   - Enable Clear when `isReadOnly && session` is true.
   - Use read-only dialog copy like `Clear review view?` and explain that the saved review will remain available.
   - Keep existing active-session clear copy for non-read-only sessions.
   - Replace the read-only banner `Plus` / `New` button with a red `Trash2` icon-only button with `aria-label="Delete review"` and title `Delete review`.
   - Add a delete-confirm dialog before calling `onDeleteReview(session.id)`.
4. In `BacktestingTab.tsx`, pass `sessionState.deleteReview` to `BacktestSimPanel`.
5. Keep `startNewSession()` available in the hook for internal use or future UI, but remove it from the saved-review banner UI.

**Acceptance criteria:**

- Loading a saved review still makes the panel read-only.
- Pressing Clear while viewing a saved review exits the saved-review view without deleting the review.
- Pressing the red delete icon prompts for confirmation and then deletes the saved review from the review dropdown.
- Deleting the currently loaded review exits read-only mode.
- Active-session Clear still deletes simulation actions through `/api/backtest/sessions/:id/clear`.
- Save Review behavior remains unchanged.
- There is no schema or migration change.

**Focused tests:**

- `__tests__/backtesting-tab.test.tsx`
  - Add mocked read-only session state and assert Clear is enabled.
  - Assert the old `New` button is absent in read-only mode.
  - Assert the delete review icon is present and calls the supplied hook method after confirmation.
- `__tests__/backtest-sessions-route.test.ts`
  - Import `DELETE` from `app/api/backtest/sessions/[id]/route.ts`.
  - Add coverage that a reviewed session can be deleted by its owner and no longer appears in `GET /api/backtest/sessions?ticker=...&date=...`.

### Order Of Operations

1. Implement Phase 1 Dashboard latches first, because it is isolated to one component and its tests.
2. Implement Phase 2 chart state/control refactor next, because it touches the broader Backtesting chart surface.
3. Implement Phase 3 review clear/delete last, because it changes Backtesting hook and panel contracts after chart prop changes settle.
4. Stop after all phases are implemented and validation passes; update this handoff status with the exact commands run.

### Validation Requirements

Run from repo root after implementation:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run workflow:audit
```

`npm run typecheck:services` is not required unless implementation unexpectedly touches `services/`.

### Manual Review Checklist

1. Dashboard: load a Day 1 row, simulate or wait for a later gainers response without it, and verify the row remains.
2. Dashboard: qualify an MDR row, simulate or wait for it to disappear from gainers, and verify the MDR row remains.
3. Backtesting: draw on 5M and verify the same drawing is visible on 15M and 1H, not daily.
4. Backtesting: expand each chart, verify only that chart fills the chart section, then collapse.
5. Backtesting: in expanded mode, click right twice and left once, verifying the visible data range grows then shrinks by one forward trading day.
6. Backtesting: load a saved review, click Clear, and verify the view clears without deleting the review.
7. Backtesting: load a saved review, click the red delete icon, confirm, and verify the review is removed.

### Security And Cost Notes

- Dashboard latches are client-side only and do not store secrets.
- Do not add new DB tables or migrations.
- Do not add new external API calls for retained Dashboard rows; only current gainers should drive MDR eligibility checks.
- Existing Backtesting routes remain user-scoped via `requireUser()` and `ensureUser()`.
- Market-data range expansion can increase Massive candle payload size. Keep `extraSessionsForward` user-driven and default to `0`.

### Complexity Estimate

**MEDIUM** — Dashboard latching is narrow, but shared chart drawings plus expanded range controls require careful prop/state refactoring across Backtesting chart components. Expected implementation time: 2-4 hours including tests and validation.

## Recent Completed Context

- 2026-04-30: MDR eligibility route and Dashboard Potential MDR filtering were implemented. The live component already has `mdrLatched` and `/api/scanner/mdr-eligibility`, but rendering still depends on the current gainers payload.
- 2026-04-28: Backtesting tab shipped with schema/API/UI, simulator action validation, review save/load, and a four-chart grid. Current chart cells are `5m`, `15m`, `1h`, and `1D`.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- MDR setup entry-trigger columns remain deferred; `PM Price Needed`, `Opening Gap Needed`, and `Intraday Price Needed` still render placeholders.
