# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-07
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

## Active Execution Spec

### UI Cleanup Pass — Trading Journal + Backtesting

> Generated: 2026-05-07 | Author: planning conversation (scope locked by user)
> Status: IMPLEMENTED - code validation and follow-up polish passed 2026-05-07; manual browser smoke pending user review
> Executor: Codex

#### Goal

Tighten readability and consistency across the Trading Journal and Backtesting tabs:
- Bigger fonts in dense surfaces (calendar, trade detail, chart headers)
- Remove redundant UI (calendar collapse, duplicate Notes label, replay-row checkboxes, "R$ setting kept" copy)
- Add 2 stats and reflow the backtest review grid to 4×2 with a centered max-width container
- Gate backtest creation on an explicit sample-set selection (System Sheet stays a valid choice)

#### Phase order

Phase 1 fully before Phase 2. Within Phase 2, do **2B before 2A** so TypeScript stays clean while the consumer is updated. All other Phase 2 items are independent.

---

#### Phase 1A — Calendar font bump

- **File:** `components/trading/TradingCalendar.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Line 110 (month header span): change `text-sm` → `text-base`.
  2. Line 155 (day-number text): change isMobile branch `text-[10px]` → `text-[11px]`, desktop branch `text-[11px]` → `text-[12px]`.
  3. Line 161 (daily PnL text): change isMobile `text-[13px]` → `text-[14px]`, desktop `text-[14px]` → `text-[15px]`.
  4. Line 164 (R value text): change isMobile `text-[11px]` → `text-[12px]`, desktop `text-[12px]` → `text-[13px]`.
- **Acceptance:**
  - [x] Calendar text on Journal tab renders one step larger at every callout above
  - [x] Mobile and desktop branches both bumped
  - [x] No other classes touched in this file

---

#### Phase 1B — Remove calendar collapse, single-line header

- **File:** `components/trading/JournalTab.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Delete the `calendarOpen` state declaration and its setter (~lines 75–86), including any `useEffect` / handlers that persist it to `localStorage` under the key `nexus.journal.calendarOpen`.
  2. Add a one-time cleanup of the stale key. Inside an existing `useEffect(() => { ... }, [])` mount block (or a new one if none exists), call:
     ```ts
     if (typeof window !== 'undefined') {
       window.localStorage.removeItem('nexus.journal.calendarOpen');
     }
     ```
  3. Delete the toggle wrapper around the calendar (~lines 195–210): the `<span>Trading Calendar</span>` label, the `ChevronDown` indicator, the click handler that flips `calendarOpen`, and the `{calendarOpen ? <TradingCalendar ... /> : null}` conditional.
  4. Always render `<TradingCalendar ... />` in that location. Pass `embedded={false}` (or remove `embedded` if its default is already `false`) so the component renders its own internal title + month + chevrons row. The result should be: a single horizontal line containing "Trading Calendar" on the left and the month name + nav chevrons on the right, sitting above the day grid.
  5. Remove `ChevronDown` from the `lucide-react` import on line 6 if it has no other uses in this file. Verify `ChevronRight` is still imported (it is used at ~line 235 for the day-row expand indicator).
- **Acceptance:**
  - [x] No `calendarOpen` state, setter, persistence, or chevron toggle remain in `JournalTab.tsx`
  - [x] Calendar is always rendered (no collapse interaction)
  - [x] Calendar's internal header shows "Trading Calendar" left, month + chevrons right, on one row
  - [x] `nexus.journal.calendarOpen` localStorage key is removed on first mount after deploy
  - [x] Unused imports cleaned up

---

#### Phase 1C — Trade Details popout polish

- **File:** `components/trading/TradeDetailSheet.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Section titles at lines 142, 157, 198, 241: change `text-zinc-400` → `text-white`, `text-sm` → `text-base`. Keep the `font-semibold uppercase tracking-wider` classes.
  2. Bump every small text class in this file by +1 step (do not modify other files):
     - `text-[10px]` → `text-[11px]`
     - `text-[11px]` → `text-[12px]`
     - `text-xs` → `text-sm`
  3. Inside the Notes section (around line 241–244), delete the `<Label htmlFor="trade-notes">Notes</Label>` line. Keep the `<h3>Notes</h3>` heading and the `<Textarea>` underneath.
  4. Add dividers between sections. The Chart, Executions, and Notes section `<h3>` elements currently use `mt-6`. For each of those three:
     - Drop the `mt-6` class from the `<h3>`.
     - Insert immediately before that section's container: `<div className="my-6 border-t border-white/10" />`.
     - Do **not** add a divider above the Overview section (it is the first section).
- **Acceptance:**
  - [x] All four section titles render in white at the new bumped size
  - [x] No `text-[10px]`, `text-[11px]`, or `text-xs` classes remain in this file
  - [x] Single "Notes" heading appears above the textarea (no duplicate label)
  - [x] Horizontal dividers separate Overview→Chart, Chart→Executions, Executions→Notes
  - [x] No divider above Overview

---

#### Phase 1D — Trade Replay: remove checkboxes only in journal context

**Why a new prop:** `readOnly` on `TradeTable` also disables row click-through, hover state, and tag editing. Trade replay should keep all of those — only the checkboxes need to disappear.

- **File:** `components/trading/TradeTable.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Add to the props interface (~line 21): `hideSelection?: boolean;`
  2. Destructure with default in the component signature (~line 35): `hideSelection = false,`
  3. Update the two checkbox-cell guards:
     - Line ~50: `{!readOnly ? (` → `{!readOnly && !hideSelection ? (`
     - Line ~88: `{!readOnly ? (` → `{!readOnly && !hideSelection ? (`
  4. Update the empty-state colspan at line ~201: `readOnly ? 10 : 11` → `(readOnly || hideSelection) ? 10 : 11`
  5. Do **not** modify any other guards in this file (lines 81, 82, 85, 116, 127 stay tied to `readOnly` only — they govern click/hover/tag-edit behavior we want to preserve).

- **File:** `components/trading/JournalTab.tsx`
- **Action:** MODIFY
- **Steps:**
  1. At the `<TradeTable ... />` invocation inside the journal-day rendering (~line 291), add the prop `hideSelection`. Do **not** modify any other `<TradeTable />` consumer in the codebase (Trade Management must keep checkboxes).

- **Acceptance:**
  - [x] Trade rows in the Journal day expansions render with no checkbox column (header or body)
  - [x] Trade rows still navigate to the trade detail popout on click
  - [x] Tag editing (add/remove tag) still works on journal trade rows
  - [x] Trade Management tab still shows checkboxes (regression check)

---

#### Phase 2B — Extend stats computation

- **File:** `lib/backtest-stats.ts`
- **Action:** MODIFY
- **Steps:**
  1. Add to the `AggregateStats` type (lines 31–39):
     ```ts
     totalReturnR: number | null;
     avgHoldMinutes: number | null;
     ```
  2. Inside `computeAggregateStats()` (lines 123–181), reuse the existing per-session iteration:
     - For `totalReturnR`: maintain a running sum and a contributing-session counter. For each session, if `session.riskDollars > 0`, add `session.realizedPnl / session.riskDollars` to the sum and increment the counter. After the loop, set `totalReturnR` to the sum if the counter > 0, else `null`.
     - For `avgHoldMinutes`: maintain a running sum and counter for non-null `holdMinutes` values across reviewed sessions. After the loop, set `avgHoldMinutes` to `sum / counter` if counter > 0, else `null`.
  3. Return both fields in the result object.
  4. Run `npx tsc --noEmit` mid-phase to confirm no consumer breaks. `hooks/use-backtest-stats.ts` is the main consumer and just passes the object through, so no change expected there.
- **Acceptance:**
  - [x] `AggregateStats` includes `totalReturnR` and `avgHoldMinutes`
  - [x] Both compute via the existing single iteration over sessions (no extra pass)
  - [x] `tsc --noEmit` passes after this phase before Phase 2A starts

---

#### Phase 2A — Stats view: 4×2 grid, centered max-width, 2 new boxes

- **File:** `components/trading/BacktestStatsView.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Add two local format helpers above the component definition (no separate util file):
     ```ts
     function formatTotalReturnR(value: number | null): string {
       if (value == null || !Number.isFinite(value)) return '--';
       const sign = value > 0 ? '+' : '';
       return `${sign}${value.toFixed(2)}R`;
     }
     function formatHoldTime(mins: number | null): string {
       if (mins == null || !Number.isFinite(mins) || mins <= 0) return '--';
       if (mins < 60) return `${Math.round(mins)}m`;
       const h = Math.floor(mins / 60);
       const m = Math.round(mins % 60);
       return `${h}h ${m}m`;
     }
     ```
  2. Inside the `<section>` body (lines ~135–158), wrap all the children that currently sit directly under `<section>` (after the header bar) in a centered scroll container:
     ```tsx
     <div className="flex-1 overflow-auto">
       <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4">
         {/* existing children: stats grid, chart, filter chips, sessions table */}
       </div>
     </div>
     ```
     Move the existing children inside the inner `<div>`. Do not change any of their internal padding/margins except what step 3 specifies. The header bar (back arrow, title, subtitle) stays full-width above the new wrapper.
  3. Stats grid (lines 160–174): change container className from `grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6` → `grid gap-3 sm:grid-cols-2 lg:grid-cols-4` (drop the `p-4` since the wrapper supplies padding).
  4. Update the stats array to 8 entries in this exact order:
     ```ts
     [
       ['Total Return', formatCurrency(aggregateStats.totalReturn)],
       ['Total Return (R)', formatTotalReturnR(aggregateStats.totalReturnR)],
       ['Avg R', formatMetricNumber(aggregateStats.expectancyR)],
       ['Win Rate', formatWinRate(aggregateStats.winRate)],
       ['Profit Factor', formatMetricNumber(aggregateStats.profitFactor)],
       ['Max Drawdown', formatCurrency(aggregateStats.maxDrawdown)],
       ['Avg Hold Time', formatHoldTime(aggregateStats.avgHoldMinutes)],
       ['Total Trades', String(aggregateStats.totalTrades)],
     ]
     ```
- **Acceptance:**
  - [x] Backtest review surface is centered with max-width 1400px and adapts to viewport like other dashboard pages
  - [x] Stats render as a 4×2 grid on lg+ (2 cols on sm, 1 col on mobile)
  - [x] All 8 boxes appear in the order specified
  - [x] Total Return (R) displays as `+12.50R` / `-3.20R` / `--`
  - [x] Avg Hold Time displays as `42m` (<60min) or `1h 23m` (≥60min) or `--`

---

#### Phase 2C — Drop "R$ setting kept" wording

- **File:** `components/trading/BacktestSimPanel.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Line 357 (inside the non-readOnly branch of the `DialogDescription`): change
     ```
     `Remove all simulation executions for ${ticker ?? '-'} ${date ?? '-'}? R$ setting kept.`
     ```
     to
     ```
     `Remove all simulation executions for ${ticker ?? '-'} ${date ?? '-'}?`
     ```
- **Acceptance:**
  - [x] Clear-simulation dialog no longer shows " R$ setting kept." trailing copy
  - [x] The read-only branch of the description (`Exit this saved review view? ...`) is unchanged

---

#### Phase 2D — Sample-set delete → trash icon

- **File:** `components/trading/BacktestManagerView.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Add `Trash2` to the existing `lucide-react` import at the top of the file.
  2. Replace the Delete button block (lines 345–354) with:
     ```tsx
     <Button
       type="button"
       variant="ghost"
       size="icon-xs"
       onClick={() => void handleDeleteSampleSet(sampleSet.id, sampleSet.name)}
       aria-label={`Delete ${sampleSet.name}`}
       title="Delete"
       className="shrink-0 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
     >
       <Trash2 className="size-4" />
     </Button>
     ```
     Use `size-4` on the `Trash2` (not `h-4 w-4`) — the `icon-xs` button variant has a CSS selector that auto-shrinks SVGs without `size-*` classes, and `size-4` opts out of that.
- **Acceptance:**
  - [x] Owner-visible delete control on each sample set is now a Trash2 icon button
  - [x] Hover/focus states still surface the rose accent color
  - [x] `aria-label` and `title` are present (accessibility / tooltip)

---

#### Phase 2E — Require sample set on Create

**Sentinel-based gating:** "System Sheet" must remain a valid choice, but the user must actively pick something (System Sheet or a real sample set). We use `null` to mean "not picked yet" and `''` to mean "System Sheet picked".

- **File:** `components/trading/NewBacktestDialog.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Change the `sampleSetId` state initial value from `''` to `null`. Type the state as `string | null`:
     ```ts
     const [sampleSetId, setSampleSetId] = useState<string | null>(null);
     ```
  2. Update the Select component:
     - `value` prop: `value={sampleSetId === null ? '' : (sampleSetId === '' ? NONE_SAMPLE_SET : sampleSetId)}`
       - When `null`, pass `''` so no item is selected and the placeholder shows.
       - When `''` (System Sheet picked), pass the existing `NONE_SAMPLE_SET` sentinel so that item is highlighted.
       - When a real id, pass it through unchanged.
     - `onValueChange`: `(value) => setSampleSetId(value === NONE_SAMPLE_SET ? '' : value)`
       - Picking System Sheet sets state to `''` (a real choice).
       - Picking any sample set sets state to its id.
     - `<SelectValue placeholder="Select a sample set..." />` — replace the existing `placeholder="System Sheet"` so the placeholder no longer implies a default selection.
  3. In `handleSubmit` (lines 55–77), after the existing name check, add:
     ```ts
     if (sampleSetId === null) {
       setError('Select Sample Set to Create Backtest');
       return;
     }
     ```
  4. In the `onSubmit({...})` call, change `sampleSetId: sampleSetId || undefined` to `sampleSetId: sampleSetId === '' ? undefined : sampleSetId`. This preserves the existing wire behavior where System Sheet sends `undefined` while a real id is passed through.
  5. If there is an existing dialog reset effect (clearing name/description on close), add `setSampleSetId(null)` to it. If no such effect exists, do not add one.
  6. Do **not** add any pre-emptive copy. The existing `{error ? <p className="text-sm text-rose-400">{error}</p> : null}` only renders after a failed submit, which is the desired behavior.
- **Acceptance:**
  - [x] Dialog opens with no sample-set option selected (placeholder visible)
  - [x] Clicking Create with no selection shows "Select Sample Set to Create Backtest" inline
  - [x] Picking "System Sheet" + Create succeeds and sends `sampleSetId: undefined` to onSubmit (existing behavior)
  - [x] Picking any real sample set + Create succeeds and sends its id
  - [x] No validation copy is visible before the user clicks Create

---

#### Phase 2F — Chart text +1

- **File:** `components/trading/BacktestingSidebar.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Line ~383 (ticker span): `text-sm` → `text-base`.
  2. Line ~384 (date span): `text-[11px]` → `text-xs`.

- **File:** `components/trading/BacktestingTab.tsx`
- **Action:** MODIFY
- **Steps:**
  1. Line ~245 (ticker span): `text-sm` → `text-base`.
  2. Line ~246 (date span): `text-xs` → `text-sm`.

- **Acceptance:**
  - [x] Sample-list rows in the charts sidebar render ticker and date one step larger
  - [x] Chart top-header ticker and date render one step larger
  - [x] No other text in those files is changed

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `components/trading/TradingCalendar.tsx` | Tailwind size bumps (4 lines) | Low |
| `components/trading/JournalTab.tsx` | Remove collapse state + toggle, restructure calendar header, pass `hideSelection`, cleanup imports | Med |
| `components/trading/TradeDetailSheet.tsx` | Section titles white + bigger; +1 all small text; drop dup Notes label; add 3 dividers | Low |
| `components/trading/TradeTable.tsx` | New `hideSelection` prop, guard the two checkbox cells + colspan | Low |
| `components/trading/BacktestStatsView.tsx` | Add 2 format helpers, wrap children in centered max-width container, 4-col grid, 8-entry stats array | Med |
| `lib/backtest-stats.ts` | Extend `AggregateStats` type + compute `totalReturnR` and `avgHoldMinutes` | Low |
| `components/trading/BacktestSimPanel.tsx` | Drop trailing "R$ setting kept." copy (1 line) | Low |
| `components/trading/BacktestManagerView.tsx` | Replace text Delete button with `Trash2` icon button | Low |
| `components/trading/NewBacktestDialog.tsx` | Sentinel-based sample-set gating, placeholder, error path | Med |
| `components/trading/BacktestingSidebar.tsx` | Two Tailwind size bumps | Low |
| `components/trading/BacktestingTab.tsx` | Two Tailwind size bumps | Low |

#### Verification

Code validation completed from repo root on 2026-05-07:
- `npm run lint` - passed after Phase 1 and after Phase 2
- `npx tsc --noEmit` - passed after Phase 1, after Phase 2B, and after Phase 2
- `npm test` - passed after Phase 1 and after Phase 2 (84 files / 612 tests)
- `npm run typecheck:services` - not run; no `services/` files were touched

Follow-up UI polish validation completed from repo root on 2026-05-07:
- `npx vitest run __tests__/backtest-manager-view.test.tsx` - passed (6 tests)
- `npm run lint` - passed
- `npx tsc --noEmit` - passed
- `npm test` - passed (84 files / 612 tests)
- `npm run workflow:audit` - passed
- `git diff --check` - passed
- `npm run typecheck:services` - not run; no `services/` files were touched

Run from repo root after each phase, and again at the end:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run typecheck:services` only if any `services/` files were touched (none expected)

Manual smoke (cannot be auto-verified — flag in completion report):
- Journal tab: calendar always visible; outer calendar border and gray background removed so the calendar expands into that space; calendar title is white; bigger fonts on calendar cells, trade detail popout, chart headers; trade detail has white section titles, dividers, no duplicate "Notes" label; trade replay rows have no checkboxes but click-through and tag editing still work.
- Trade Management tab: checkboxes still present (regression).
- Backtesting: review surface is centered max-width with 4×2 stats grid including Total Return (R) and Avg Hold Time; clear-review dialog has no "R$ setting kept" wording; sample-set and saved-test delete actions use matching bordered trash icons at the Edit button height; named System Sheet backtests display "System Sheet" instead of "No sample set"; "+ New Backtest" with no selection shows the new error only after clicking Create; charts sidebar dates and chart-header ticker/date are one step larger.
- Confirm `nexus.journal.calendarOpen` is no longer in localStorage after first Journal mount.

#### Out of scope

- Any logic changes outside the listed lines
- Refactoring `TradeTable` beyond adding the `hideSelection` prop
- Restyling other dashboard pages to match the new max-width pattern
- Persisting the new sample-set-required behavior elsewhere — only the New Backtest dialog needs it
- Tests for the two new format helpers (small enough to skip)

---

## Recently Completed Summary

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
