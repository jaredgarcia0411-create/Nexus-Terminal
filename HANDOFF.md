# Nexus Terminal — HANDOFF.md

> Updated: 2026-05-04
> Purpose: active execution spec plus compact recent context. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

> Generated: 2026-05-04 | Agent: Claude (`nexus-handoff`)
> Status: IMPLEMENTED — code validated; authenticated browser smoke pending.

# Build Spec — UI Refinements (Performance, Journal, Trades, Backtesting, Archive, Trade Details)

## Codex Constraints (read first)

- **Pure UI/UX work.** No schema, no API, no migrations.
- **Order of work:** Steps are independent — execute in numerical order for predictable diffs, but any order works.
- **Validate after every batch:** `npm run lint && npx tsc --noEmit`. Fix breakage before moving on. `npm test` at the end.
- **Visual verification:** Several steps note "verify in browser." Start the dev server and confirm the UI before reporting done.
- **No new ESLint disables.** Refactor instead of suppressing.
- **Do not introduce new abstractions.** Match existing Tailwind class patterns and component conventions.

---

## Step 1 — Performance Tab cleanup

**File:** `components/trading/PerformanceTab.tsx`
**Action:** MODIFY

Goal: drop the subtitle text, and put the Net/Gross toggle and the $/R toggle on the same row.

Instructions:

1. Delete line 90 entirely:
   ```tsx
   <p className="text-sm text-zinc-400">Detailed breakdowns of performance metrics.</p>
   ```
2. The Net/Gross toggle currently lives at lines 94–105 inside the header row. The $/R toggle currently lives at lines 126–141 inside the filter row (separate flex row that also contains the Tag Filter at lines 109–125).
3. Move the $/R toggle group (the entire `<div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">…</div>` at lines 126–141) up beside the Net/Gross toggle. Wrap the two toggles in a single flex container:
   ```tsx
   <div className="flex items-center gap-2">
     {/* existing Net/Gross toggle */}
     {/* moved $/R toggle */}
   </div>
   ```
4. Leave the Tag Filter (the rest of lines 109–125) where it sits — only the $/R toggle moves.
5. Trim any now-empty wrapper `<div>` left behind from the old filter row.

**Acceptance criteria:**
- [ ] "Detailed breakdowns of performance metrics." is gone.
- [ ] Net/Gross toggle and $/R toggle render side-by-side in the header.
- [ ] Tag Filter still renders in its own row beneath the header.
- [ ] All three buttons remain clickable; toggle state still updates the cards below.

---

## Step 2 — Trading Journal calendar font + zero-color fix

**File:** `components/trading/TradingCalendar.tsx`
**Action:** MODIFY

Goal: bump every per-cell font size up one step, and fix the green-when-zero R value bug on both daily cells and weekly totals.

Instructions:

1. Line 155 (day number `<span>`):
   ```tsx
   // before
   <span className={`${isMobile ? 'text-[9px]' : 'text-[10px]'} font-mono ${isToday ? 'text-emerald-500 font-bold' : 'text-zinc-500'}`}>
   // after
   <span className={`${isMobile ? 'text-[10px]' : 'text-[11px]'} font-mono ${isToday ? 'text-emerald-500 font-bold' : 'text-zinc-500'}`}>
   ```
2. Line 161 (daily PnL):
   ```tsx
   // before
   <div className={`${isMobile ? 'text-[12px]' : 'text-[13px]'} font-bold ${getPnLColor(stats.pnl)}`}>
   // after
   <div className={`${isMobile ? 'text-[13px]' : 'text-[14px]'} font-bold ${getPnLColor(stats.pnl)}`}>
   ```
3. Line 164 (daily R) — bump font AND fix zero-color in one shot:
   ```tsx
   // before
   <div className={`${isMobile ? 'text-[10px]' : 'text-[11px]'} font-medium opacity-60 ${stats.r >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
   // after
   <div className={`${isMobile ? 'text-[11px]' : 'text-[12px]'} font-medium opacity-60 ${stats.r > 0 ? 'text-emerald-400' : stats.r < 0 ? 'text-rose-400' : 'text-white'}`}>
   ```
4. Line 191 (weekly R total) — bump font AND fix zero-color:
   ```tsx
   // before
   <div className={`text-[11px] font-medium opacity-70 ${week.weeklyR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
   // after
   <div className={`text-[12px] font-medium opacity-70 ${week.weeklyR > 0 ? 'text-emerald-400' : week.weeklyR < 0 ? 'text-rose-400' : 'text-white'}`}>
   ```

**Why the color fix:** Old code used `>= 0` which classified zero as positive (green). New code uses strict `> 0` for green, strict `< 0` for red, and `text-white` for the exact-zero case (no trades).

**Acceptance criteria:**
- [ ] Calendar day numbers, daily PnL, and daily R are visibly larger by one step.
- [ ] Weekly R total is one step larger.
- [ ] A week with zero trades shows `+0.00R` in white (not green) for the weekly total.
- [ ] A day with zero trades (or `r === 0`) shows `0.00R` in white in the daily cell.
- [ ] A week with positive R shows green; negative shows red — unchanged.

---

## Step 3 — Trades Management header restructure

**File:** `components/trading/TradesTab.tsx`
**Action:** MODIFY

Goal: drop the subtitle, drop the green badge, and rearrange so search sits where the subtitle was, and "Add Tag" sits next to the Tag Filters dropdown.

Instructions:

1. Delete line 72 (`<p className="text-sm text-zinc-400">Filter, tag, and manage all imported trades.</p>`).
2. The existing header flex container at lines 70–83 wraps the subtitle (now deleted) and the search box (lines 73–82). After the deletion the search box should render in the slot the subtitle vacated — verify the wrapper doesn't need restructuring (if `flex flex-wrap items-center justify-between gap-3` only has the search box left, it's fine).
3. Delete the green badge block at lines 85–88:
   ```tsx
   <div className="flex shrink-0 items-center gap-2 rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-500">
     <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
     {filteredTrades.length} TRADES LOGGED
   </div>
   ```
4. The bulk-action section at lines 100–137 contains three pairs (Risk input + button, Auto Risk input + button, Add Tag input + button). The Add Tag pair is at lines 125–136. Cut that entire `<div className="flex items-center gap-2">…</div>` block.
5. The Tag Filters section at lines 139–147 currently looks like:
   ```tsx
   <div className="space-y-4">
     <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Tag Filters</h3>
     <TagFilterDropdown … />
   </div>
   ```
   Restructure so the dropdown and the Add Tag pair sit side-by-side under the heading:
   ```tsx
   <div className="space-y-4">
     <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Tag Filters</h3>
     <div className="flex flex-wrap items-center gap-3">
       <TagFilterDropdown … />
       <div className="flex items-center gap-2">
         <input
           type="text"
           placeholder="Add tag to selected"
           value={bulkTagInput}
           onChange={(e) => onBulkTagInputChange(e.target.value)}
           className="w-full md:w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
         />
         <Button onClick={onBulkAddTag} className="bg-emerald-500 hover:bg-emerald-400">
           Add Tag
         </Button>
       </div>
     </div>
   </div>
   ```
6. Preserve the Risk and Auto-Risk button rows in the bulk-action section — only the Add Tag pair moves.

**Acceptance criteria:**
- [ ] "Filter, tag, and manage all imported trades." is gone; search input renders where the subtitle was.
- [ ] Green "X TRADES LOGGED" badge is gone.
- [ ] "Add Tag" input + button sit beside the Tag Filters dropdown under the "Tag Filters" heading.
- [ ] Risk and Auto-Risk pairs are unchanged.
- [ ] Adding a tag still works (functionality unchanged).

---

## Step 4a — Backtest Manager subtitle removal

**File:** `components/trading/BacktestManagerView.tsx`
**Action:** MODIFY

Instructions:

1. Delete line 141:
   ```tsx
   <p className="text-sm text-zinc-500">Named backtests, shared sample sets, and review stats.</p>
   ```
2. Leave the `<h2>Backtest Manager</h2>` and its parent `<div>` wrapper at lines 138–142 intact. The `<h2>` will automatically take the slot the `<p>` vacated.
3. If the header strip looks top-heavy after the deletion (likely fine since `py-3` is only 12px), no change needed. If Codex visually verifies and finds it cramped, reduce wrapper `py-3` to `py-2` at line 138.

**Acceptance criteria:**
- [ ] "Named backtests, shared sample sets, and review stats." is gone.
- [ ] "Backtest Manager" still renders as the section title.
- [ ] No vertical jump in the layout that breaks the surrounding cards.

---

## Step 4b — Backtest chart toolbar (ticker, reorder, VWAP, OHLCV, new button)

**File:** `components/trading/BacktestChart.tsx`
**Action:** MODIFY

This step has 5 sub-changes. They all live in the same file.

### 4b.1 — Remove the ticker overlay

Delete lines 916–918:
```tsx
<div className="mr-1 flex min-w-0 items-baseline gap-2">
  <span className="font-mono text-xs font-semibold text-zinc-100">{ticker}</span>
</div>
```

### 4b.2 — Reorder series-type before indicators

Currently the toolbar JSX order (after the ticker is removed) is:
- Timeframe prev button (lines 920–931)
- Timeframe dropdown (lines 932–947)
- Timeframe next button (lines 948–959)
- Indicators dropdown (lines 961–987) — `<Layers>` icon
- Series-type dropdown (lines 989–1012) — `<ChartCandlestick>` icon

Swap the indicators block (lines 961–987) and the series-type block (lines 989–1012) so the final JSX order becomes:
1. Timeframe prev
2. Timeframe dropdown
3. Timeframe next
4. **Series-type dropdown** (moved up)
5. **Indicators dropdown** (moved down)

### 4b.3 — VWAP color → light green

Line 587 currently:
```tsx
addLineOverlay(chart, sortedCandles, values, '#f472b6');
```
Change to:
```tsx
addLineOverlay(chart, sortedCandles, values, '#86efac');
```
(`#86efac` is Tailwind `green-300` — light green that visually distinguishes from the existing `#22c55e` EMA9 green.)

### 4b.4 — Reorder OHLCV → HLOCV with fixed widths

Replace lines 1014–1022:

```tsx
// before
{hoverOhlc ? (
  <div className="ml-2 flex items-center gap-2 font-mono text-xs tabular-nums text-zinc-300">
    <span><span className="text-zinc-500">O</span> {hoverOhlc.o.toFixed(2)}</span>
    <span><span className="text-zinc-500">H</span> {hoverOhlc.h.toFixed(2)}</span>
    <span><span className="text-zinc-500">L</span> {hoverOhlc.l.toFixed(2)}</span>
    <span><span className="text-zinc-500">C</span> {hoverOhlc.c.toFixed(2)}</span>
    <span><span className="text-zinc-500">V</span> {formatHoverVolume(hoverOhlc.v)}</span>
  </div>
) : null}

// after
{hoverOhlc ? (
  <div className="ml-2 flex items-center gap-3 font-mono text-xs tabular-nums text-zinc-300">
    <span className="inline-flex items-baseline gap-1"><span className="text-zinc-500">H</span><span className="inline-block w-[5ch] text-right">{hoverOhlc.h.toFixed(2)}</span></span>
    <span className="inline-flex items-baseline gap-1"><span className="text-zinc-500">L</span><span className="inline-block w-[5ch] text-right">{hoverOhlc.l.toFixed(2)}</span></span>
    <span className="inline-flex items-baseline gap-1"><span className="text-zinc-500">O</span><span className="inline-block w-[5ch] text-right">{hoverOhlc.o.toFixed(2)}</span></span>
    <span className="inline-flex items-baseline gap-1"><span className="text-zinc-500">C</span><span className="inline-block w-[5ch] text-right">{hoverOhlc.c.toFixed(2)}</span></span>
    <span className="inline-flex items-baseline gap-1"><span className="text-zinc-500">V</span><span className="inline-block w-[6ch] text-right">{formatHoverVolume(hoverOhlc.v)}</span></span>
  </div>
) : null}
```

The `inline-block w-[5ch] text-right` on each value gives it a fixed 5-character slot (enough for `000.00`) so the row stops jiggling when the price bounces between (say) 9.50 and 10.50. Volume gets `w-[6ch]` since formatted vol can be `1.2M` → `12.3M`.

### 4b.5 — Add new "show all charts" toggle button

The button lives between the DrawingToolbar (closes ~line 1033) and the expand/collapse button (~line 1034) inside the `<div className="ml-auto flex items-center gap-0.5">` wrapper (line 1024).

1. Add `LayoutGrid` to the existing `lucide-react` named import at the top of the file. If the import already includes `Maximize2, Minimize2, Layers, ChartCandlestick, ChevronLeft, ChevronRight`, just append `LayoutGrid`.
2. Extend the component's prop type. Find the prop interface for `BacktestChart` (typically near the top of the file). Add:
   ```ts
   gridLayout?: 'stacked' | 'grid2x2';
   onToggleGridLayout?: () => void;
   ```
3. Destructure both props from the function signature alongside `isExpanded`/`onToggleExpanded`.
4. Insert this JSX immediately after the DrawingToolbar block (~after line 1033) and immediately before the expand/collapse `<Button>` (~before line 1034):
   ```tsx
   {onToggleGridLayout ? (
     <Button
       variant="ghost"
       size="icon"
       onClick={onToggleGridLayout}
       className={`h-7 w-7 hover:text-white ${gridLayout === 'grid2x2' ? 'text-emerald-400' : 'text-zinc-400'}`}
       title={gridLayout === 'grid2x2' ? 'Switch to stacked layout' : 'Switch to 2x2 grid layout'}
     >
       <LayoutGrid className="h-3.5 w-3.5" />
     </Button>
   ) : null}
   ```
   Match the styling/sizing of the existing expand button so the three icon buttons are visually consistent.

**Acceptance criteria for Step 4b:**
- [ ] No ticker symbol renders in the chart's top-left.
- [ ] Toolbar order from left → right: timeframe prev, timeframe dropdown, timeframe next, series-type, indicators, (then OHLCV on the right side, then drawings, new grid button, expand).
- [ ] VWAP renders in light green (`#86efac`).
- [ ] Hover OHLCV row reads `H L O C V` left-to-right, with each value sitting in a fixed-width slot (verify the row doesn't shift when hovering different bars with different price magnitudes).
- [ ] New `LayoutGrid` button appears between drawings dropdown and expand button on every chart.
- [ ] Tooltip changes between "Switch to stacked layout" / "Switch to 2x2 grid layout" depending on current mode.
- [ ] Button color is emerald when `grid2x2` is active, zinc otherwise.

---

## Step 4c — Outer toolbar background removal

**File:** `components/trading/BacktestingTab.tsx`
**Action:** MODIFY

Goal: strip the box around the toolbar that contains the ticker searchbar / date selector / date toggle / trade button. Keep only a top divider.

Instructions:

1. Line 260 currently:
   ```tsx
   <div className="grid h-10 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border border-white/10 bg-[#121214] px-3">
   ```
   Change to:
   ```tsx
   <div className="grid h-10 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-white/10 px-1">
   ```
   Changes:
   - `border` → `border-b` (only bottom edge remains as a divider)
   - Removed `bg-[#121214]` (no fill)
   - `px-3` → `px-1` (shifts content left so the leading edge aligns with the chart's left edge)
2. Open the dev server, navigate to a backtest, and verify the ticker/date selector's left edge aligns with the chart's left edge. If misaligned, tweak between `px-0` and `px-2` until aligned. Document the final value in the commit message if you deviated from `px-1`.

**Acceptance criteria:**
- [ ] No background fill behind the ticker searchbar / date selector / date toggle / trade button row.
- [ ] A single horizontal line (border-bottom) separates the toolbar from the content below.
- [ ] The leading edge of the ticker/date area visually aligns with the leading edge of the chart panel.
- [ ] Back arrow + ticker/date area remain visually separated by the `gap-2` grid spacing — no extra divider needed between them.

---

## Step 4d — 2x2 grid layout mode wiring

**File:** `components/trading/BacktestChartGrid.tsx`
**Action:** MODIFY

Goal: introduce a third layout mode (`grid2x2`) alongside the existing stacked + single-expanded modes. Toggle it via the new `LayoutGrid` button on each chart's toolbar (added in Step 4b.5). Preserve the chosen layout when entering and exiting single-expanded mode.

Instructions:

1. At the top of the component (alongside the existing `useState` for `expandedSlotId`), add:
   ```ts
   const [gridLayout, setGridLayout] = useState<'stacked' | 'grid2x2'>('stacked');
   ```
2. Add a memoized toggle handler (or inline arrow — matches existing patterns in the file):
   ```ts
   const toggleGridLayout = () => {
     setGridLayout((prev) => (prev === 'stacked' ? 'grid2x2' : 'stacked'));
   };
   ```
3. Pass the new props to each `BacktestChart` (around lines 290–311). Add inside the existing prop list:
   ```tsx
   gridLayout={gridLayout}
   onToggleGridLayout={toggleGridLayout}
   ```
4. Update the parent container at line 284. Replace:
   ```tsx
   <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
   ```
   With a layout that branches on both `expandedSlotId` and `gridLayout`:
   ```tsx
   <div
     className={
       expandedSlotId
         ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden'
         : gridLayout === 'grid2x2'
           ? 'grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 overflow-hidden'
           : 'scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1'
     }
   >
   ```
   Notes:
   - `flex-1` + `min-h-0` ensure the 2x2 grid uses the same total panel height as the stacked layout — each cell becomes 1/4 of the area instead of full-width-stacked.
   - `overflow-hidden` (instead of `overflow-y-auto`) on the grid mode prevents scrollbars when each cell is a fixed quarter-height.
5. `DEFAULT_CELLS` order at lines 68–73 is already `primary (5m), secondary (15m), hourly (1h), daily (1D)`. With `grid-cols-2 grid-rows-2`, CSS grid fills row-by-row left-to-right, producing exactly: 5m top-left, 15m top-right, 1h bottom-left, daily bottom-right. **No change to `DEFAULT_CELLS` needed.**
6. `expandedSlotId` overrides `gridLayout` (the conditional above checks `expandedSlotId` first). Exiting single-expanded mode (toggling `expandedSlotId` back to null) automatically returns to whatever `gridLayout` was set to — preserving the user's chosen layout.
7. Verify the lightweight-charts instances resize cleanly when toggling between modes. If a chart appears stuck at its old size after a toggle, the chart's own resize observer should catch it (charts already use `ResizeObserver` per `ChartDrawings.tsx` Step C3). If not, that's a separate bug — flag it but don't fix here.

**Acceptance criteria:**
- [ ] On a fresh load, all 4 charts render in a vertical stack (default).
- [ ] Clicking the new `LayoutGrid` button on any chart switches all 4 charts into a 2x2 grid: 5m top-left, 15m top-right, 1h bottom-left, daily bottom-right.
- [ ] Clicking the same button again returns to the stacked layout.
- [ ] In 2x2 mode, the total chart panel height is the same as in stacked mode (no extra vertical space consumed).
- [ ] Clicking a single chart's expand button (Maximize2) in 2x2 mode still works; exiting expand returns to 2x2 (not stacked).
- [ ] Same flow from stacked mode: enter expand, exit expand, returns to stacked.
- [ ] No console errors on layout toggles.

---

## Step 5 — Archive Tab subtitle removal

**File:** `components/trading/ArchiveTab.tsx`
**Action:** MODIFY

Instructions:

1. Delete line 169:
   ```tsx
   <p className="text-base text-zinc-400">Past daily and weekly reviews.</p>
   ```
2. The Daily/Weekly/All `<Select>` (lines 171–180) and date inputs (lines 182–196) already share the same `flex flex-wrap items-center gap-4` container. Once the subtitle is removed they automatically slide up into the slot. No further restructuring needed.

**Acceptance criteria:**
- [ ] "Past daily and weekly reviews." is gone.
- [ ] Daily/Weekly/All toggle and date selector render in the slot the subtitle vacated.
- [ ] Date filtering still works.

---

## Step 6 — Trade Details popout restructure

**File:** `components/trading/TradeDetailSheet.tsx`
**Action:** MODIFY

This is the largest structural change in the spec — replaces the tab-based layout with a single scrollable view.

### 6.1 — Header font size bump

Line 123 currently:
```tsx
<SheetTitle>Trade Details</SheetTitle>
```
Change to:
```tsx
<SheetTitle className="text-xl">Trade Details</SheetTitle>
```

### 6.2 — Remove border on ticker title block

Line 128 currently:
```tsx
<div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3">
```
Change to:
```tsx
<div className="flex items-center justify-between p-3">
```

### 6.3 — Kill the tabs, stack all sections vertically with `<h3>` headings

Currently the file uses a `Tabs` component with `TabsList` (the four tab triggers) and conditional rendering blocks gated on `activeTab === 'overview' | 'chart' | 'executions' | 'notes'`.

Restructure to render all four sections unconditionally in a single scrollable container, each preceded by an `<h3>` heading. The shared heading style is:
```tsx
<h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mt-6">…</h3>
```

Specifically:

1. Remove the `Tabs`, `TabsList`, `TabsTrigger` imports (and any `TabsContent` usage). Keep any other shadcn imports.
2. Remove the `activeTab` `useState` and its setter — no longer needed.
3. Remove the `<Tabs value={activeTab} onValueChange={…}>` wrapper and the `<TabsList>` block entirely.
4. Wrap the four sections in a single scrollable `<div className="flex-1 overflow-y-auto px-1 pb-6">` (or whatever wrapper makes sense given the existing `Sheet` body — match what's already there for the inner container).
5. Replace each `{activeTab === '...' ? (…) : null}` block with the section's content directly, prefixed by an `<h3>`. Section order: **Overview → Chart → Executions → Notes**.

   Skeleton:
   ```tsx
   <div className="space-y-2">
     <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mt-6">Overview</h3>
     {/* overview content from current activeTab === 'overview' block */}
   </div>

   <div className="space-y-2">
     <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mt-6">Chart</h3>
     {/* chart content from current activeTab === 'chart' block */}
   </div>

   <div className="space-y-2">
     <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mt-6">Executions</h3>
     {/* executions content from current activeTab === 'executions' block */}
   </div>

   <div className="space-y-2">
     <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mt-6">Notes</h3>
     {/* notes content from current activeTab === 'notes' block */}
   </div>
   ```
6. The first `<h3>` ("Overview") may not need `mt-6` since it's the first thing in the scrollable area — feel free to drop `mt-6` from just the first heading for visual balance.

### 6.4 — Remove borders on overview cards

Line 161 currently:
```tsx
<div key={label} className="rounded-lg border border-white/10 bg-white/5 p-3">
```
Change to:
```tsx
<div key={label} className="p-2">
```

### 6.5 — Remove border on chart wrapper, keep padding

Line 172 currently:
```tsx
<div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
```
Change to:
```tsx
<div className="space-y-3 p-3">
```

### 6.6 — Remove borders on executions table, add padding

Line 213 currently:
```tsx
<div className="overflow-x-auto rounded-lg border border-white/10 bg-white/5">
```
Change to:
```tsx
<div className="overflow-x-auto p-3">
```

Also strip the inner table borders:
- `<thead className="border-b border-white/10 text-zinc-500">` (~line 215) → `<thead className="text-zinc-500">`
- `<tr key={execution.id} className="border-b border-white/5 last:border-b-0">` (~line 227) → `<tr key={execution.id}>`

### 6.7 — Wrap notes textarea container with padding

Line 254 currently:
```tsx
<div className="space-y-3">
```
Change to:
```tsx
<div className="space-y-3 p-3">
```

**Acceptance criteria for Step 6:**
- [ ] "Trade Details" header text is one size larger (`text-xl`).
- [ ] No tabs at the top of the popout — all four sections render in one scrollable view.
- [ ] Each section is preceded by an uppercase, tracked `<h3>` reading "Overview" / "Chart" / "Executions" / "Notes".
- [ ] No card-style borders wrap the ticker title, overview metric cards, chart, executions table, or notes textarea.
- [ ] Chart, executions table, and notes textarea each have visible breathing room (padding) inside the popout instead of being flush against the edges.
- [ ] All four sections render their existing content with no functional regression (notes save still works, executions table still scrolls horizontally on overflow, chart timeframe selector still works, overview values still render).
- [ ] Scrolling the popout reveals all four sections in order.

---

## Files Changed Summary

| File | Action | Lines (rough) | Risk |
|---|---|---|---|
| `components/trading/PerformanceTab.tsx` | MODIFY | +3 / -2 | LOW — class shuffle |
| `components/trading/TradingCalendar.tsx` | MODIFY | +4 / -4 | LOW — class tweaks |
| `components/trading/TradesTab.tsx` | MODIFY | +12 / -16 | LOW — JSX shuffle |
| `components/trading/BacktestManagerView.tsx` | MODIFY | 0 / -1 | LOW — line delete |
| `components/trading/BacktestChart.tsx` | MODIFY | +25 / -10 | MED — toolbar reorder + new prop + OHLCV restructure |
| `components/trading/BacktestingTab.tsx` | MODIFY | +1 / -1 | LOW — class swap |
| `components/trading/BacktestChartGrid.tsx` | MODIFY | +12 / -2 | MED — new state + conditional layout |
| `components/trading/ArchiveTab.tsx` | MODIFY | 0 / -1 | LOW — line delete |
| `components/trading/TradeDetailSheet.tsx` | MODIFY | +30 / -40 | MED — tabs → stacked sections |

---

## Verification Steps

After all steps:

```
npm run lint
npx tsc --noEmit
npm test
```

All three must exit 0.

Then manual browser verification:
- Performance tab: Net/Gross + $/R toggles render side-by-side; subtitle gone.
- Trading Journal: calendar text visibly larger; weeks with no trades show `+0.00R` in white.
- Trades Management: subtitle gone; search where subtitle was; green badge gone; Add Tag beside Tag Filters dropdown.
- Backtest Manager: subtitle under "Backtest Manager" title gone.
- Backtest Chart: ticker overlay gone; toolbar reordered (series-type before indicators); VWAP light green; OHLCV reads HLOCV with no jiggle on hover; new `LayoutGrid` button between drawings and expand.
- Backtest outer toolbar: no background fill, single bottom divider, ticker/date area aligned with chart left edge.
- Backtest 2x2 toggle: stacked → 2x2 → stacked roundtrip works; 2x2 fits same total height; expand-from-2x2 returns to 2x2; expand-from-stacked returns to stacked.
- Archive: subtitle gone; daily/weekly/date selector slid up.
- Trade Details popout: title `text-xl`; no tabs; sections stacked with `<h3>` headings; no card borders; chart/executions/notes have padding.

If anything visual is off, tweak Tailwind values inline (matches the file's existing patterns) and document the tweak in the commit message.

---

## Open Assumptions (Codex must verify before writing code)

1. **`Tabs`/`TabsList` removal in `TradeDetailSheet.tsx`** — verify no other component imports state from this file or relies on the tab navigation. The `activeTab` state appears local; nothing should leak.
2. **`BacktestChart` prop addition** — search the repo for other call sites that instantiate `BacktestChart` directly. If any exist outside `BacktestChartGrid.tsx`, they don't need to pass `gridLayout`/`onToggleGridLayout` (both are optional `?`), so the new button just won't render there.
3. **`TradesTab.tsx` heading restructure** — confirm `bulkTagInput`, `onBulkTagInputChange`, and `onBulkAddTag` are passed via props to `TradesTab` and accessible from the relocated JSX. They are accessible inside the same component, so no re-plumbing.
4. **2x2 cell sizing** — if a chart's internal lightweight-charts canvas doesn't shrink correctly when entering 2x2 mode (cells are smaller than the original stacked rows), the chart's own ResizeObserver should kick in. If it doesn't, that's a pre-existing chart resize bug — flag it but don't fix in this spec.
5. **Outer toolbar `px-1`** — verify visually that the leading edge of the ticker/date area aligns with the chart's leading edge. Tweak between `px-0` and `px-2` if needed.

---

## Commit Message

```
UI refinements: Performance, Journal, Trades, Backtesting, Archive, Trade Details
```

---

## Recent Completed Context

- 2026-05-04: Backtesting UI refinements (`00c32f8`).
- 2026-05-03: Phase C shipped (`82cbb55`) — drawing persistence, dispose race, scoping, stop line, volume indicator.
- 2026-05-03: Phase B shipped (`88a4da4`) — drawings + indicators persist with reviews; text drawing tool added.
- 2026-05-03: Phase A shipped (`6513e40`) — review save flow, stop display, dropdown sync, chart expand persisted.
- 2026-05-03: Backtest review auto-load context fix (`8467959`).
- 2026-05-01: Backtest Manager landing page shipped — schema, API, manager + stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- MDR setup entry-trigger columns remain deferred; `PM Price Needed`, `Opening Gap Needed`, and `Intraday Price Needed` still render placeholders.
- **Backtest Manager — `broke_premarket_high` filter deferred** (decision 5 in 2026-05-01 planning). Data not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
