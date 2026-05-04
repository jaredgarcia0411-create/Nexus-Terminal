# Nexus Terminal — HANDOFF.md

> Updated: 2026-05-03
> Purpose: active execution spec plus compact recent context. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

> Generated: 2026-05-03 | Agent: Claude (`nexus-handoff`)
> Status: PHASE C COMPLETE — implemented and validated locally; manual smoke pending.

# Build Spec — Phase C — Backtest review fixes (drawing persistence, scoping, dispose race, volume)

## Codex Constraints (read first)

- **Order of work:** Steps are independent enough that any order works, but follow numerical order — earlier steps reference helpers/types added in later steps where called out.
- **No db migrations.** Phase C is pure code. Do NOT generate or run migrations.
- **Never use `db:push`.** (Repo composite-PK false-positive corrupts migration history.)
- **Don't change risk math in `reduceActions()`.** Phase A established `position.lastSetStop`; this spec only consumes it on the chart side.
- **Don't widen `IndicatorKey` casually.** Step C5 adds exactly one new entry (`'VOLUME'`). Update **every** validator and default list that references the union — there are three sites and missing one will cause silent dropping on load.
- **Validate after every step batch:** `npm run lint && npx tsc --noEmit && npm test`. Fix breakage before moving on.
- **No new ESLint disables.** If a fix needs a comment, prefer refactoring over suppression.

---

## Step C1 — Stop drawings being wiped on review hydration (Defect 1, root cause)

**File:** `hooks/use-chart-drawings.ts`
**Action:** MODIFY

**Bug:** `BacktestChartGrid` instantiates `useChartDrawings(scope, ..., { persist: false })` and hydrates drawings via `replaceAllDrawings(...)` in a `useEffect`. The hook itself runs a `syncSymbol` effect (lines 404-410) that always dispatches `{ type: 'syncSymbol', drawings: loadDrawingsForSymbol(symbol, persist) }`. When `persist=false`, `loadDrawingsForSymbol` returns `[]` (line 207-208), so the dispatch unconditionally wipes drawings to `[]`.

In production this is harmless because the grid's hydration effect runs right after and queues `replaceAllDrawings(loaded)`; React batches both dispatches and the last one wins. **In React 18 StrictMode dev**, effects run setup → cleanup → setup. On the second setup pass:
- `syncSymbol` dispatches `[]` again.
- The grid's hydration effect's ref-guard short-circuits because `hydratedChartStateRef.current === loadedChartState`, so `replaceAllDrawings` does NOT re-fire.

Net result in dev: drawings end at `[]`. The user sees an empty chart on every review load.

**Fix:** Skip the dispatch when `persist === false`. The grid is the only caller with `persist: false` and it manages drawings externally via `replaceAllDrawings`. The hook should not stomp on its writes.

Instructions:

1. Locate the `useEffect` at lines 404-410:
   ```ts
   useEffect(() => {
     skipNextStorageSaveRef.current = true;
     dispatch({
       type: 'syncSymbol',
       drawings: loadDrawingsForSymbol(symbol, persist),
     });
   }, [persist, symbol]);
   ```
2. Add an early return when `persist` is `false`. The `skipNextStorageSaveRef` flip stays inside the guard since the persistence effect at lines 412-424 already short-circuits when `!persist`:
   ```ts
   useEffect(() => {
     if (!persist) return;
     skipNextStorageSaveRef.current = true;
     dispatch({
       type: 'syncSymbol',
       drawings: loadDrawingsForSymbol(symbol, persist),
     });
   }, [persist, symbol]);
   ```
3. Do **not** change `loadDrawingsForSymbol`, the reducer, or the initial reducer state. The initial state already calls `loadDrawingsForSymbol(symbol, persist)` which returns `[]` when `persist=false` — that's still correct for the first render before hydration runs.

**Acceptance criteria:**
- [ ] Loading a saved review (with drawings) renders those drawings on the chart.
- [ ] Reloading the page and re-opening the same review still renders the drawings.
- [ ] Switching tickers in active mode (persist=true elsewhere in the app) still loads the per-symbol drawings from `localStorage` — i.e., the existing `persist=true` behavior is unchanged.
- [ ] No new `npm test` regressions.

---

## Step C2 — Closed-position chart stop line uses `lastSetStop` (Defect 5)

**File:** `components/trading/BacktestingTab.tsx`
**Action:** MODIFY

**Bug:** Phase A step A3 fixed the STOP **text** in `BacktestSimPanel` to fall back to `position.lastSetStop` when the position is closed. The chart's amber dashed price line, however, is driven by the `currentStop` prop on `BacktestChartGrid`, which still receives raw `position.stop`. For a fully-closed reviewed trade `position.stop` is `null` (by design — risk math), so the chart line vanishes even though the panel text shows the retained value.

Instructions:

1. Locate the `<BacktestChartGrid>` JSX in `BacktestingTab.tsx` (currently line 343-356). Find the `currentStop` prop at line 351:
   ```tsx
   currentStop={sessionState.position.stop}
   ```
2. Replace with the same fallback the sim panel uses:
   ```tsx
   currentStop={sessionState.position.stop ?? sessionState.position.lastSetStop}
   ```
3. Do not modify `BacktestChartGrid` or `BacktestChart`. The prop type is already `currentStop: number | null` and existing rendering treats it as the stop level to draw — semantics don't change.

**Acceptance criteria:**
- [ ] Loading a fully-closed reviewed trade that had a stop displays the amber dashed `STOP @ $X` line on the chart at the last-set stop level.
- [ ] An open position's stop line behavior is unchanged.
- [ ] A trade with no stop ever set still renders no line (nullish chain returns `null`).

---

## Step C3 — `ChartDrawings` survives chart disposal without throwing (Defect 4)

**File:** `components/trading/ChartDrawings.tsx`
**Action:** MODIFY

**Bug:** The reported runtime error `Object is disposed` originates in `lightweight-charts`' `TimeAxisWidget._internal_setSizes`. Stack trace shows `DevicePixelContentBoxBinding` (resize) and `ChartWidget._private__drawImpl`. Root cause: `ChartDrawings` registers two callbacks that can fire after the parent `BacktestChart` has called `chart.remove()`:

1. `ResizeObserver` (lines 641-664) — calls `renderDrawings()` synchronously on container resize. Browser-queued, not React-bound.
2. `requestAnimationFrame(renderDrawings)` (lines 666-681, inside `subscribeVisibleLogicalRangeChange` / `subscribeVisibleTimeRangeChange` handlers) — RAFs survive disposal.

`renderDrawings` checks `if (!canvas || !chart) return`, but `chart` is a prop — it only flips to `null` after React re-renders post-cleanup, which is too late.

**Fix:** Add a `disposedRef` that the cleanup of each subscription effect sets to `true`, and gate `renderDrawings` on it.

Instructions:

1. Near the top of the component (after the existing `useState`/`useRef` declarations around lines 188-197), add:
   ```ts
   const disposedRef = useRef(false);
   ```
2. Update `renderDrawings` (currently lines 570-589). Add the disposed check as the first guard:
   ```ts
   const renderDrawings = useCallback(() => {
     if (disposedRef.current) return;
     const canvas = overlayRef.current;
     if (!canvas || !chart) return;
     // ...rest unchanged
   }, [drawings, tempDrawing, chart, renderDrawing, selectedDrawingId]);
   ```
3. In the resize effect at lines 641-664, add a cleanup that flips the ref. Replace the existing cleanup-only `return () => resizeObserver.disconnect();` with:
   ```ts
   return () => {
     disposedRef.current = true;
     resizeObserver.disconnect();
   };
   ```
   Important: this effect runs on every `chart`/`renderDrawings` change. We need `disposedRef.current` to flip back to `false` on the **next** mount of this effect so a re-mounted chart can render. Add the reset at the top of the effect setup, before constructing the `ResizeObserver`:
   ```ts
   useEffect(() => {
     if (!chart || !overlayRef.current) return;
     disposedRef.current = false;
     // ...existing setup
   ```
4. The visible-range subscription effect at lines 666-681 also schedules a `requestAnimationFrame(renderDrawings)`. Track and cancel the pending RAF in the cleanup so it doesn't fire on a disposed chart:
   ```ts
   useEffect(() => {
     if (!chart) return;

     let rafId: number | null = null;
     const handleVisibleRangeChange = () => {
       if (rafId !== null) cancelAnimationFrame(rafId);
       rafId = requestAnimationFrame(() => {
         rafId = null;
         renderDrawings();
       });
     };

     chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
     chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);

     return () => {
       if (rafId !== null) cancelAnimationFrame(rafId);
       chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
       chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
     };
   }, [chart, renderDrawings]);
   ```
5. Do not modify any other effect. The price-line cleanup effect (lines 592-626) already calls `currentSeries.removePriceLine` — that's fine because `currentSeries` is captured in the closure before disposal.

**Acceptance criteria:**
- [ ] Switching between active and review mode several times in a row does not throw `Object is disposed` in the browser console.
- [ ] Resizing the window during a tab transition does not throw.
- [ ] Drawings still re-render correctly when the visible time range changes (zoom, scroll, candle data load).

---

## Step C4 — Reset `latestChartState` when leaving review mode (B10.6 missed)

**File:** `components/trading/BacktestingTab.tsx`
**Action:** MODIFY

**Bug:** Phase B step B10.6 specified a `useEffect` to reset `latestChartState` when `sessionState.session?.id` or `sessionState.isReadOnly` changes. The effect was never added. Without it, drawings from a previous review can leak into the next save: user loads Review A → drawings hydrate into `latestChartState` via the grid's broadcast effect → user clears → starts a new active session and saves before drawing anything → POST body still contains Review A's drawings.

The grid's remount on `chartGridKey` change does broadcast a fresh `{ drawings: [], indicators: defaults }` shortly after, but there's a window where the parent's `latestChartState` is stale. Better to reset explicitly on the source-of-truth state transition.

Instructions:

1. In `BacktestingTab.tsx`, after the existing `useState` declarations (around line 58-62), add a new effect. Place it after the `useBacktestSession` call (after line 128) so it can read `sessionState`:
   ```ts
   useEffect(() => {
     if (sessionState.isReadOnly) return;
     setLatestChartState({ drawings: [], indicators: {} });
   }, [sessionState.session?.id, sessionState.isReadOnly]);
   ```
2. Import `useEffect` if not already imported. Confirm at the top of the file — currently the import line is `import { useCallback, useState, type FormEvent } from 'react';` (line 3). Update to:
   ```ts
   import { useCallback, useEffect, useState, type FormEvent } from 'react';
   ```
3. Do NOT include `setLatestChartState` in the dep array — `useState`'s setter is stable and ESLint exempts it.

**Acceptance criteria:**
- [ ] Save Review A with drawings → Clear → start new session (no drawings) → Save Review B → Review B's `chartState.drawings` in DB is `[]` (not Review A's drawings).
- [ ] Loading any review still hydrates correctly (effect short-circuits when `isReadOnly`).
- [ ] No infinite render loops (verify by opening browser devtools React profiler if available, or by inspection: deps are `[session?.id, isReadOnly]` — both change finitely on user action).

---

## Step C5 — Add `VOLUME` indicator and make it a default (Defect 3)

**File:** `components/trading/BacktestChart.tsx`
**Action:** MODIFY

**File:** `components/trading/BacktestChartGrid.tsx`
**Action:** MODIFY

Volume is rendered as a histogram in a separate pane below the price chart, scaled independently. Follow the existing RSI/ATR pane pattern (`chart.addPane()` → `pane.addSeries(LineSeries, ...)`) but use `HistogramSeries`.

### C5.1 — Add `'VOLUME'` to `IndicatorKey` and `INDICATOR_OPTIONS`

In `components/trading/BacktestChart.tsx`:

1. Extend the `IndicatorKey` union (currently lines 61-72) to include `'VOLUME'`. Place it after `'VWAP'`:
   ```ts
   export type IndicatorKey =
     | 'SMA20'
     | 'SMA50'
     | 'SMA200'
     | 'EMA9'
     | 'EMA20'
     | 'EMA21'
     | 'EMA50'
     | 'VWAP'
     | 'VOLUME'
     | 'BB'
     | 'RSI'
     | 'ATR';
   ```
2. Extend `INDICATOR_OPTIONS` (currently lines 122-134) with the new entry:
   ```ts
   { key: 'VWAP', label: 'VWAP' },
   { key: 'VOLUME', label: 'Volume' },
   { key: 'BB', label: 'Bollinger' },
   ```

### C5.2 — Import `HistogramSeries`

In `components/trading/BacktestChart.tsx`, locate the `lightweight-charts` import block (around lines 4-24). Add `HistogramSeries` to the named imports. If the import already includes `LineSeries, BarSeries, ...`, just append `HistogramSeries` to the same import statement. The file uses `lightweight-charts ^5.1.0`, so the v5 series-type-as-argument pattern applies (`chart.addSeries(HistogramSeries, { ... })` — same as how `LineSeries`/`BarSeries` are already used).

### C5.3 — Render the volume histogram

In `components/trading/BacktestChart.tsx`, the indicator-rendering block runs around lines 540-600 (inside the same `useEffect` that creates the chart, after `baseSeries.setData(...)` and before the early-return / cleanup). After the `BB` block (line 562-566) and before the `RSI` block (line 568), add:

```ts
if (indicators.has('VOLUME') && sortedCandles.length > 0) {
  const volumePane = chart.addPane();
  volumePane.setHeight(72);
  volumePane.setStretchFactor(0.22);
  const volumeSeries = volumePane.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceLineVisible: false,
  });
  volumeSeries.setData(sortedCandles.map((candle) => ({
    time: toTime(candle.datetime),
    value: candle.volume,
    color: candle.close >= candle.open ? 'rgba(255, 255, 255, 0.45)' : 'rgba(59, 130, 246, 0.55)',
  })));
}
```

Color logic mirrors the candle UP/DOWN palette (white for up, blue for down) at reduced alpha so it doesn't dominate. `setStretchFactor(0.22)` keeps the price chart dominant — RSI uses `0.24` and ATR uses `0.20` by reference.

### C5.4 — Add `'VOLUME'` to `KNOWN_INDICATORS` validator

In `components/trading/BacktestChartGrid.tsx`, the `KNOWN_INDICATORS` constant at lines 14-26 is used by `isIndicatorKey()` to filter saved indicator keys on hydration. **Missing this update will silently drop saved `'VOLUME'` entries on load.**

Add `'VOLUME'` to the array. Place it adjacent to `'VWAP'` for readability:

```ts
const KNOWN_INDICATORS: readonly IndicatorKey[] = [
  'SMA20',
  'SMA50',
  'SMA200',
  'EMA9',
  'EMA20',
  'EMA21',
  'EMA50',
  'VWAP',
  'VOLUME',
  'BB',
  'RSI',
  'ATR',
];
```

### C5.5 — Make `VOLUME` a default for intraday timeframes

In `components/trading/BacktestChartGrid.tsx`, locate `getDefaultIndicators` at lines 83-87:

```ts
function getDefaultIndicators(timeframe: BacktestTimeframeKey): IndicatorKey[] {
  if (timeframe === '1D') return ['SMA50', 'SMA200'];
  if (timeframe === '1h') return ['EMA20', 'EMA50'];
  return ['VWAP'];
}
```

Update to include `VOLUME`:

```ts
function getDefaultIndicators(timeframe: BacktestTimeframeKey): IndicatorKey[] {
  if (timeframe === '1D') return ['SMA50', 'SMA200', 'VOLUME'];
  if (timeframe === '1h') return ['EMA20', 'EMA50', 'VOLUME'];
  return ['VWAP', 'VOLUME'];
}
```

**Acceptance criteria:**
- [ ] On a fresh active session at any intraday timeframe, the chart shows a volume histogram pane below the price.
- [ ] Toggling `Volume` off in the indicator dropdown removes the pane; toggling on adds it back.
- [ ] Saving a review with Volume enabled, reloading, and re-opening shows Volume still on.
- [ ] Saving a review with Volume disabled shows it disabled on reload (validates `KNOWN_INDICATORS` accepts the key both ways).
- [ ] Up bars render in white (UP_COLOR), down bars in blue (DOWN_COLOR), at reduced alpha.
- [ ] `npx tsc --noEmit` passes — `IndicatorKey` is exhaustive.

---

## Step C6 — Reviews are visible across launch contexts (Defect 2)

**File:** `app/api/backtest/sessions/route.ts`
**Action:** MODIFY

**Bug:** The GET handler filters by `backtestId` strictly: `backtestId ? eq(backtestId, X) : isNull(backtestId)`. A review saved as **uncategorized** (backtestId=null) is invisible when the user later launches a **named** backtest on the same ticker+date, and vice versa. Reviews "disappear" from the LOAD REVIEW dropdown depending on which entry point the user took.

**Fix:** Drop the `backtestId` filter from the SQL `where` for the reviews query, so all REVIEWED rows for that ticker+date are returned. Tighten the in-memory filter for the ACTIVE row to match the requested `backtestId` exactly (preserving the existing per-user / per-context active session semantics).

Instructions:

1. Locate the GET handler `where` clause at lines 33-41:
   ```ts
   const rows = await db
     .select()
     .from(backtestSessions)
     .where(and(
       eq(backtestSessions.ticker, ticker),
       eq(backtestSessions.date, date),
       backtestId ? eq(backtestSessions.backtestId, backtestId) : isNull(backtestSessions.backtestId),
     ))
     .orderBy(desc(backtestSessions.reviewedAt), desc(backtestSessions.createdAt));
   ```
2. Remove the conditional `backtestId` predicate from the SQL `and(...)`:
   ```ts
   const rows = await db
     .select()
     .from(backtestSessions)
     .where(and(
       eq(backtestSessions.ticker, ticker),
       eq(backtestSessions.date, date),
     ))
     .orderBy(desc(backtestSessions.reviewedAt), desc(backtestSessions.createdAt));
   ```
3. Update the response builder at lines 47-50 to apply `backtestId` matching to the ACTIVE-session lookup only. Reviews are returned unfiltered:
   ```ts
   return Response.json({
     session: rows.find((row) =>
       row.status === 'ACTIVE'
       && row.userId === authState.user.id
       && (row.backtestId ?? null) === (backtestId ?? null)
     ) ?? null,
     reviews: rows.filter((row) => row.status === 'REVIEWED'),
   });
   ```
4. The unused `isNull` import can stay — `drizzle-orm` import already includes it and removing it is unrelated churn. (If `npm run lint` flags it as unused, drop it from the import — but don't add a disable comment.)
5. The POST handler is unchanged. Active session creation is still scoped per-user.

**Acceptance criteria:**
- [ ] Save a review under named backtest "X". Go back to manager, click Launch Charts on backtest "X" → review appears in the LOAD REVIEW dropdown.
- [ ] Save a review uncategorized. Go back to manager, click Launch Charts uncategorized → review appears.
- [ ] Save a review under named backtest "X". Go back to manager, click Launch Charts on a DIFFERENT named backtest "Y" with the same ticker+date → "X"'s review now appears in Y's dropdown too. (This is the new behavior. Document if the user wants stricter scoping later.)
- [ ] Active session per-user, per-context behavior unchanged: starting work in named backtest "X" does not surface as an active session under uncategorized launch.
- [ ] `__tests__/backtest-sessions-route.test.ts` either still passes or is updated to reflect the new shape. If the test asserts on review filtering by backtestId, update it.

---

## Phase C end requirements

Run from `/home/jared/Nexus-Terminal`:

```
npm run lint
npx tsc --noEmit
npm test
```

All three must exit 0.

Then commit with this message:

```
Fix backtest review drawing persistence, dispose race, scoping, stop line, and add volume indicator
```

Print this manual smoke checklist for the user (do not run a browser yourself):

```
Phase C manual smoke test:
  [x] Save a review with drawings + VWAP. Clear. Reload page. Open the review from the manager.
      → Drawings should render. VWAP and Volume both visible.
  [x] Open a fully-closed reviewed trade. Stop line should render at the lastSetStop level.
  [x] Save uncategorized review. From manager, Launch Charts on a named backtest with the same ticker/date.
      → Uncategorized review appears in the LOAD REVIEW dropdown.
  [ ] Toggle between active session and a saved review several times. No "Object is disposed" errors in the browser console.
  [x] Save Review A with drawings → Clear → start a fresh session with no drawings → Save Review B.
      → Review B's chartState in DB has drawings: [].
  [x] On any intraday chart, toggle Volume off → off. Toggle on → on. Save review. Reload. State persists.
```

---

## Files Changed Summary

| File | Action | Lines (rough) | Risk |
|---|---|---|---|
| `hooks/use-chart-drawings.ts` | MODIFY | +1 / 0 | LOW — additive guard |
| `components/trading/BacktestingTab.tsx` | MODIFY | +6 / -1 | LOW — fallback + reset effect |
| `components/trading/ChartDrawings.tsx` | MODIFY | +12 / -2 | LOW — disposed-ref + RAF cancel |
| `components/trading/BacktestChart.tsx` | MODIFY | +18 / -1 | LOW — new indicator entry + histogram render |
| `components/trading/BacktestChartGrid.tsx` | MODIFY | +3 / -1 | LOW — KNOWN_INDICATORS + default list |
| `app/api/backtest/sessions/route.ts` | MODIFY | +3 / -2 | LOW — filter relax |
| `__tests__/backtest-sessions-route.test.ts` | MODIFY (if needed) | TBD | LOW — adjust assertions |

---

## Verification Steps

After all 6 steps:

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- Commit + print the manual smoke checklist above.

---

## Open Assumptions (Codex must verify before writing code)

1. **`HistogramSeries` is exported from `lightweight-charts ^5.1.0`.** Verify by checking `node_modules/lightweight-charts/dist/typings.d.ts` or by re-using the existing series-type-as-argument pattern (`chart.addSeries(LineSeries, ...)`). If for some reason `HistogramSeries` isn't named, fall back to whatever the v5 type lookup yields — the docs are the authority.
2. **`pane.setStretchFactor()` exists on the v5 `IPaneApi`.** The RSI block at line 571 already calls it, so this is verified.
3. **`__tests__/backtest-sessions-route.test.ts`** may assert on the SQL-shape filtering. Run `npm test` after Step C6 and update assertions if they break. Do NOT relax the test logic itself — preserve the active-session scoping check, only adjust the review-list expectations.
4. **`BacktestSessionReviewBody` type for `chartState`** is unaffected by C5 — `IndicatorKey` is a client-side TS-only concept; the server stores indicators as `string[]` per slot in the jsonb column, and `KNOWN_INDICATORS` filters at hydration time.
5. **`disposedRef` reset on re-mount.** React's StrictMode in dev runs the effect setup → cleanup → setup. The reset-to-`false` at the top of the resize-effect setup must happen on EVERY setup pass, not just the first. Verify by adding a transient `console.log('drawings effect setup', disposedRef.current)` while testing — should log `false` consistently. Remove the log before commit.

---

## Recent Completed Context

- 2026-05-03: Phase B shipped (`88a4da4`) — drawings + indicators persist with reviews; text drawing tool added.
- 2026-05-03: Phase A shipped (`6513e40`) — review save flow, stop display, dropdown sync, chart expand persisted.
- 2026-05-03: Backtest review auto-load context fix (`8467959`).
- 2026-05-03: Per-user backtest session scoping + auto-load on Launch Chart (`a04ac6a`) — introduced the strict `backtestId` filter that Step C6 relaxes.
- 2026-05-03: Scanner summary cache extended to 24h (`4ceb43b`).
- 2026-05-01: Backtest Manager landing page shipped — schema, API, manager + stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- MDR setup entry-trigger columns remain deferred; `PM Price Needed`, `Opening Gap Needed`, and `Intraday Price Needed` still render placeholders.
- **Backtest Manager — `broke_premarket_high` filter deferred** (decision 5 in 2026-05-01 planning). Data not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
- **Phase C C6 widens review visibility** so reviews from any launch context appear together. If the user later wants per-context scoping (e.g., "only show this named backtest's reviews"), add a UI-level filter in the dropdown rather than re-tightening the API.
