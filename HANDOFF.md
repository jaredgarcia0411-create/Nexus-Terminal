# Nexus Terminal — HANDOFF.md

> Updated: 2026-05-03
> Purpose: active execution spec plus compact recent context. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

> Generated: 2026-05-03 | Agent: Claude (`nexus-handoff`)
> Status: PHASE A COMPLETE — validated locally; Phase B pending. Codex MUST stop and commit between phases.

# Build Spec — Backtesting Tab Improvements

## Codex Constraints (read first)

- **STOP between phases.** After Phase A passes validation and is committed, Codex MUST end the run. The user will compact the session and re-invoke for Phase B. Do NOT continue from Phase A into Phase B in the same run.
- **Migration command:** Phase B uses `npm run db:migrate` only. NEVER `db:push` (this repo's composite primary keys produce false positives in `db:push` and corrupt the migration history).
- **Read-only mode applies to all loaded reviews** (own reviews + coworkers' reviews). To modify, the user deletes the review and starts a new session.
- **Text drawing styling is fixed.** 14px font, white (`#ffffff`), no color picker, no font-size selector.
- **Don't change risk math in `reduceActions()`.** The stop-display fix adds a new field; it must not alter `position.stop` semantics for risk calculations.
- **Local-storage validation.** When reading the chart-expand slot id from `localStorage`, validate against the known slot list before applying.
- **Order of work:** Within each phase, follow steps in numerical order. Earlier steps may be referenced by later steps.

---

## Phase A — UI fixes, no schema (Issues 1, 2, 5)

### Step A1 — Stop price retains value after position closes

**File:** `lib/backtest-math.ts`
**Action:** MODIFY

Bug: `reduceActions()` clears `position.stop` to `null` when `totalShares` reaches `0` (lines 192-196 for SELL, lines 210-214 for COVER). When viewing a fully-closed reviewed trade, the stop disappears in the UI even though it was set during the trade.

Fix: add a new field `lastSetStop` on `SimPosition` that tracks the most recently set stop and is **never cleared**. The existing `stop` field keeps its semantics (only set on an open position). `BacktestSimPanel` will display `position.stop ?? position.lastSetStop` in step A3.

Instructions:

1. In the `SimPosition` interface (currently lines 5-15), add a new field after `stop`:
   ```ts
   lastSetStop: number | null;
   ```
2. In `createEmptyPosition()` (lines 17-29), add `lastSetStop: null,` to the returned object.
3. In `reduceActions()` for the four cases that assign `position.stop = action.stopPrice` (`LONG`, `SHORT`, `LONG_ADD`, `SHORT_ADD`), also assign `position.lastSetStop = action.stopPrice` immediately after the existing `position.stop = action.stopPrice` line.
4. Do **not** modify the SELL / COVER cases. `position.stop` should still be cleared on close; `position.lastSetStop` simply retains the prior value because it was last written by a LONG / SHORT / *_ADD case.

**Acceptance criteria:**
- [ ] `SimPosition` type exports the new `lastSetStop: number | null` field.
- [ ] After `LONG @ 100, SELL all`, `reduceActions(...)` returns `{ stop: null, lastSetStop: 95 }` (or whatever stop was set during entry).
- [ ] After `LONG @ 100, LONG_ADD @ 102 with new stop 96, SELL all`, `lastSetStop === 96`.
- [ ] `position.stop` for an open position equals the most recent stop (existing behavior unchanged).

---

### Step A2 — Unit test for `lastSetStop`

**File:** `__tests__/backtest-math.test.ts`
**Action:** MODIFY

Add a focused test that asserts `lastSetStop` retains the most recent stop after the position closes.

Instructions:

1. Read the existing file to learn the test framework and helper conventions used (likely `describe` / `it` from Vitest, building `BacktestAction` objects inline).
2. Append a new `describe('lastSetStop on closed positions', ...)` block near the bottom of the file. Include three tests:
   - **Closed long retains the entry stop.** Build actions: `LONG` at `price=100, stop=95`, then `SELL` all. Assert `reduceActions(actions, 100).lastSetStop === 95` and `reduceActions(actions, 100).stop === null`.
   - **Closed long retains the most recent add stop.** Build actions: `LONG` at `100/95`, `LONG_ADD` at `102/97`, `SELL` all. Assert `lastSetStop === 97`.
   - **Open long has both `stop` and `lastSetStop` equal.** `LONG` at `100/95`, no exit. Assert `stop === lastSetStop && stop === 95`.
3. If the existing tests use a helper like `makeAction({ ... })`, reuse it. Otherwise, construct `BacktestAction` objects directly with all required fields (`id`, `userId`, `sessionId`, `actionType`, `price`, `shares`, `stopPrice`, `barTime`, `sequence`, `createdAt`).

**Acceptance criteria:**
- [ ] `npx vitest run __tests__/backtest-math.test.ts` passes including the new tests.
- [ ] No existing tests break.

---

### Step A3 — `BacktestSimPanel` displays the retained stop

**File:** `components/trading/BacktestSimPanel.tsx`
**Action:** MODIFY

Wire the new `lastSetStop` field into the STOP display.

Instructions:

1. Locate the STOP cell at lines ~224-227:
   ```tsx
   <div>
     <div className="text-zinc-500">STOP</div>
     <div className="font-mono tabular-nums text-zinc-100">{position.stop != null ? formatCurrency(position.stop) : '-'}</div>
   </div>
   ```
2. Replace the inner expression with `position.stop ?? position.lastSetStop`:
   ```tsx
   <div className="font-mono tabular-nums text-zinc-100">
     {(() => {
       const displayStop = position.stop ?? position.lastSetStop;
       return displayStop != null ? formatCurrency(displayStop) : '-';
     })()}
   </div>
   ```
   (Or pull out a `const displayStop = position.stop ?? position.lastSetStop;` above the JSX and use it.)
3. **Do not** change the `currentOpenRisk` calculation at lines 140-142. It uses `position.stop` for risk-on-an-open-position semantics; that's correct — closed positions should still show `RISK: -`.

**Acceptance criteria:**
- [ ] Loading a reviewed CLOSED long that had a stop of 95 displays `STOP: $95.00`.
- [ ] An open position still displays its current `stop`.
- [ ] A position that never set a stop (impossible in practice but defensive) shows `-`.
- [ ] The `RISK` field still shows `-` for closed positions (unchanged).

---

### Step A4 — Save Review keeps the saved review loaded

**File:** `hooks/use-backtest-session.ts`
**Action:** MODIFY

Bug: `saveReview()` (lines 362-395) optimistically clears `activeSession` and `activeActions` (lines 371-372), then on success only adds the new review to the `reviews[]` array (line 384). The chart goes blank instead of staying populated as the just-saved (now read-only) review.

Fix: in the success path, set `reviewMode` to point at the saved session, using the captured `previousActions` so the ledger renders without a refetch. The existing `isCurrentReviewMode` derivation (lines 77-80) will pick this up automatically because the saved session retains the same `ticker`, `date`, and `backtestId`.

Instructions:

1. Inside `saveReview()`, the success branch currently reads:
   ```ts
   setReviews([payload.session, ...previousReviews]);
   ```
2. Add immediately after that line:
   ```ts
   setReviewMode({
     session: payload.session,
     actions: previousActions,
   });
   ```
3. Do **not** modify the catch branch — it already restores `activeSession`, `activeActions`, and `reviews`. `reviewMode` was not changed in the try-block before this addition, so no rollback is needed for it on failure (it stays whatever it was).

**Acceptance criteria:**
- [ ] After clicking SAVE REVIEW with a valid label, the chart immediately shows the read-only "Viewing review" banner (from `BacktestSimPanel` lines 171-190).
- [ ] The ledger still shows the executions instead of going blank.
- [ ] `isReadOnly` is `true` after save, so drawing tools and the trade menu are disabled (existing `BacktestTradeMenu` rendering at `BacktestingTab.tsx:311-318` already gates on `!isReadOnly`).
- [ ] If the save POST fails, the previous active session and actions are restored (existing behavior preserved).

---

### Step A5 — `LOAD REVIEW` dropdown reflects the loaded review

**File:** `components/trading/BacktestSimPanel.tsx`
**Action:** MODIFY

Bug: when entering review mode via auto-load (or after step A4's auto-load post-save), the chart shows the review correctly but the LOAD REVIEW dropdown still displays the placeholder "LOAD REVIEW" because the panel's local `selectedReviewId` state (line 124) is `null`.

Fix: derive the displayed review id from `session.id` whenever `isReadOnly` is true, falling back to the local `selectedReviewId` state for any transition cases.

Instructions:

1. At line 136, where `selectedReview` is currently computed:
   ```ts
   const selectedReview = selectedReviewId
     ? visibleReviews.find((review) => review.id === selectedReviewId) ?? null
     : null;
   ```
   Replace with a derivation that prefers the loaded review when in read-only mode:
   ```ts
   const effectiveSelectedReviewId = isReadOnly && session ? session.id : selectedReviewId;
   const selectedReview = effectiveSelectedReviewId
     ? visibleReviews.find((review) => review.id === effectiveSelectedReviewId) ?? null
     : null;
   ```
2. The dropdown JSX at lines 311-322 reads `selectedReview` to show its label, so no other change is needed there.
3. The `setSelectedReviewId(null)` call inside the Clear dialog (line 366) already exits the local selection; combined with `clear()` exiting reviewMode (`startNewSession` is implicit through `setReviewMode(null)` at hook line 276), the dropdown will fall back to the placeholder. No change needed.
4. Do **not** add a `useEffect` to sync `selectedReviewId` to `session.id` — keep the derivation pure to avoid render loops.

**Acceptance criteria:**
- [ ] Auto-load: clicking "Open" on a saved review from the manager opens the chart, and the LOAD REVIEW dropdown shows the saved review's label (not the placeholder).
- [ ] After save (step A4): the dropdown shows the just-saved review's label.
- [ ] Clicking another review in the dropdown still calls `onLoadReview(review.id)` and updates the displayed selection (existing handler at lines 326-332 unchanged).
- [ ] Exiting review mode via Clear (or starting a new session) returns the dropdown to "LOAD REVIEW" placeholder.

---

### Step A6 — Chart-expand state persists in localStorage

**File:** `components/trading/BacktestChartGrid.tsx`
**Action:** MODIFY

Bug: `expandedSlotId` lives in `gridState` (lines 68-73) and is reset whenever `gridState.scope !== drawingScope` (lines 74-81), which happens on every ticker/date change. The component also fully unmounts on tab switch.

Fix: persist a single user-level expand preference in `localStorage` under key `nexus-backtest-expand-slot`. Read on init; write on toggle. Validate against the known slot ids.

Instructions:

1. At the top of the file (after the imports), add the storage key constant and a slot-id validator. Use the existing `ChartSlotId` type for safety:
   ```ts
   const EXPAND_STORAGE_KEY = 'nexus-backtest-expand-slot';
   const KNOWN_SLOT_IDS: readonly ChartSlotId[] = ['primary', 'secondary', 'hourly', 'daily'];

   function readPersistedExpandedSlot(): ChartSlotId | null {
     if (typeof window === 'undefined') return null;
     try {
       const stored = window.localStorage.getItem(EXPAND_STORAGE_KEY);
       if (!stored) return null;
       return (KNOWN_SLOT_IDS as readonly string[]).includes(stored)
         ? (stored as ChartSlotId)
         : null;
     } catch {
       return null;
     }
   }

   function writePersistedExpandedSlot(slotId: ChartSlotId | null): void {
     if (typeof window === 'undefined') return;
     try {
       if (slotId === null) {
         window.localStorage.removeItem(EXPAND_STORAGE_KEY);
       } else {
         window.localStorage.setItem(EXPAND_STORAGE_KEY, slotId);
       }
     } catch {
       // Ignore storage errors.
     }
   }
   ```
2. In the initial `useState` for `gridState` (line 68), replace `expandedSlotId: null` with `expandedSlotId: readPersistedExpandedSlot()`.
3. In `currentGridState` fallback (lines 74-81), replace `expandedSlotId: null` with `expandedSlotId: readPersistedExpandedSlot()` so a ticker change re-reads the persisted preference rather than collapsing.
4. In `toggleExpandedSlot()` (lines 92-97), compute the new value, persist it, then update state:
   ```ts
   const toggleExpandedSlot = (slotId: ChartSlotId) => {
     const nextExpanded = currentGridState.expandedSlotId === slotId ? null : slotId;
     writePersistedExpandedSlot(nextExpanded);
     setGridState({
       ...currentGridState,
       expandedSlotId: nextExpanded,
     });
   };
   ```
5. Do **not** include the expand state in any per-review save path. It's a user-level preference, not per-review chart state. (Phase B will save drawings + indicators per review; expand stays in localStorage.)

**Acceptance criteria:**
- [ ] Expand a slot, switch ticker — the chart still renders only the expanded slot.
- [ ] Expand a slot, switch to another tab and back — still expanded.
- [ ] Expand a slot, full page reload — still expanded.
- [ ] Toggle off an expanded slot, reload — defaults to grid view (no slot expanded).
- [ ] If `localStorage` somehow contains an unknown value (e.g. `'foobar'`), it's ignored and the grid renders normally.

---

### Phase A end requirements

Run from `/home/jared/Nexus-Terminal`:

```
npm run lint
npx tsc --noEmit
npm test
```

All three must exit 0. (Skip `npm run typecheck:services` — no `services/` files touched. Skip `npm run workflow:audit` — no workflow assets touched.)

Then commit with this message:

```
Fix backtest review save flow, stop display, dropdown sync, and persist chart expand
```

After the commit, **STOP THE RUN.** Print this exact line to the conversation:

```
✋ STOP — Phase A complete. User will compact and continue with Phase B.
```

Do not continue to Phase B in the same Codex run.

---

---

## Phase B — Persistence + new text tool (Issues 3, 4)

### Step B1 — Schema migration: add `chart_state` jsonb column

**File:** `lib/db/schema.ts`
**Action:** MODIFY

Add a single `jsonb` column to `backtestSessions` to hold drawings and per-slot indicators.

Instructions:

1. Confirm `jsonb` is already imported at line 1 — it is.
2. In the `backtestSessions` table definition (lines 501-519), add a `chartState` field after `backtestId`:
   ```ts
   chartState: jsonb('chart_state').default({}).notNull(),
   ```
   Do not type-narrow with `$type<>()` here — keep the schema column untyped at the DB layer. The Zod validation at the API layer (step B3) and the client-side type (step B5) provide runtime + compile-time safety.
3. Do not add new indexes on this column.

**Acceptance criteria:**
- [ ] `npm run db:generate` produces a new migration file under `drizzle/` (next number after `0027_*`).
- [ ] The generated SQL adds `"chart_state" jsonb DEFAULT '{}' NOT NULL` to `backtest_sessions`.
- [ ] No other schema changes are generated.

---

### Step B2 — Apply the migration

**File:** none (CLI command)
**Action:** RUN

Run from `/home/jared/Nexus-Terminal`:

```
npm run db:migrate
```

This invokes the safe migrate wrapper at `scripts/db-migrate-safe.mjs` (per `package.json` line 16). **Never use `db:push`** — the user's preference: `db:push` has a false-positive on this repo's composite PKs and corrupts the migration history.

**Acceptance criteria:**
- [ ] `npm run db:migrate` exits 0.
- [ ] Existing `backtest_sessions` rows now have `chart_state = '{}'` (default backfill, no manual SQL needed).
- [ ] No errors about composite PKs or missing tables.

---

### Step B3 — Extend Zod validation for review POST

**File:** `lib/validations/backtest.ts`
**Action:** MODIFY

Extend `backtestSessionReviewSchema` so the review POST body can include `chartState`. Define a strict-but-tolerant shape: drawings as an array of `unknown` (validated downstream by `normalizeDrawings()`), indicators as a record of slot id → string[].

Instructions:

1. Add a `chartStateSchema` declaration above `backtestSessionReviewSchema`:
   ```ts
   export const chartStateSchema = z.object({
     drawings: z.array(z.unknown()).optional(),
     indicators: z.record(z.string(), z.array(z.string())).optional(),
   }).strict();

   export type ChartStateBody = z.infer<typeof chartStateSchema>;
   ```
2. Extend `backtestSessionReviewSchema` (currently lines 27-31) with an optional `chartState` field:
   ```ts
   export const backtestSessionReviewSchema = z.object({
     sessionId: z.string().trim().min(1, 'sessionId is required'),
     label: z.string().trim().optional(),
     notes: z.string().trim().optional(),
     chartState: chartStateSchema.optional(),
   });
   ```
3. The `BacktestSessionReviewBody` exported type (line 33) updates automatically via `z.infer<>`.

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` succeeds.
- [ ] Posting `{ sessionId, label, notes }` without `chartState` still validates (backwards compatible).
- [ ] Posting `{ sessionId, chartState: { drawings: [...], indicators: { primary: ['VWAP'] } } }` validates.
- [ ] Posting `{ chartState: { extraField: 1 } }` fails validation (`.strict()`).

---

### Step B4 — Persist `chartState` in the review POST handler

**File:** `app/api/backtest/sessions/[id]/review/route.ts`
**Action:** MODIFY

Instructions:

1. The handler currently updates `status`, `reviewedAt`, `label`, `notes`, `updatedAt` (lines 28-42). Add `chartState` to the `set()` payload, defaulting to `{}` when the body omits it (so existing callers that don't send the field still produce a valid row):
   ```ts
   const [session] = await db
     .update(backtestSessions)
     .set({
       status: 'REVIEWED',
       reviewedAt: now,
       label: body.label?.trim() || null,
       notes: body.notes?.trim() || null,
       chartState: body.chartState ?? {},
       updatedAt: now,
     })
     .where(...)
     .returning();
   ```
2. The GET handler at `app/api/backtest/sessions/[id]/route.ts` returns the full session row via `db.select().from(backtestSessions)`, so `chartState` is included automatically — no change needed there.

**Acceptance criteria:**
- [ ] `POST /api/backtest/sessions/{id}/review` with a `chartState` body persists the JSON.
- [ ] `GET /api/backtest/sessions/{id}` returns the session including `chartState`.
- [ ] Existing tests at `__tests__/backtest-sessions-route.test.ts` still pass (update if they assert on `set()` shape).

---

### Step B5 — Extend client types for `chartState`

**File:** `lib/types.ts`
**Action:** MODIFY

Instructions:

1. Add a new exported type (above `BacktestSession`, near line 86) describing the on-the-wire shape:
   ```ts
   export interface BacktestChartState {
     drawings?: unknown[];
     indicators?: Record<string, string[]>;
   }
   ```
   Use `unknown[]` for drawings — the `Drawing` discriminated-union type lives in `hooks/use-chart-drawings.ts` and importing it into `lib/types.ts` would create a cycle. Components that consume drawings will run them through `normalizeDrawings()` (already exported from the hook) which validates and returns a typed `Drawing[]`.
2. Add `chartState: BacktestChartState | null;` as a field on `BacktestSession` (currently lines 86-99). Place it after `notes`. Allow null because legacy rows may have `null` (though step B1's `.default({}).notNull()` should prevent that going forward; defensive type is fine).

**Acceptance criteria:**
- [ ] `BacktestSession` type now includes `chartState: BacktestChartState | null`.
- [ ] Existing imports of `BacktestSession` compile.
- [ ] `npx tsc --noEmit` passes.

---

### Step B6 — Track per-slot indicators in `BacktestChartGrid`

**File:** `components/trading/BacktestChartGrid.tsx`
**Action:** MODIFY

The indicator state currently lives entirely inside each `BacktestChart` instance (line 358 of that file). For Phase B we need the grid to know each slot's current indicators so it can pass them to the save flow.

Instructions:

1. Add `indicatorsBySlot` to the `ChartGridState` type (around line 17-22):
   ```ts
   type ChartGridState = {
     scope: string;
     activeDrawingTool: DrawingTool;
     expandedSlotId: ChartSlotId | null;
     timeframesBySlot: Record<ChartSlotId, BacktestTimeframeKey>;
     indicatorsBySlot: Record<ChartSlotId, IndicatorKey[]>;
   };
   ```
2. Add a helper `getDefaultIndicatorsBySlot()` near the existing `getDefaultSlotTimeframes()`:
   ```ts
   function getDefaultIndicatorsBySlot(
     timeframesBySlot: Record<ChartSlotId, BacktestTimeframeKey>,
   ): Record<ChartSlotId, IndicatorKey[]> {
     return {
       primary: getDefaultIndicators(timeframesBySlot.primary),
       secondary: getDefaultIndicators(timeframesBySlot.secondary),
       hourly: getDefaultIndicators(timeframesBySlot.hourly),
       daily: getDefaultIndicators(timeframesBySlot.daily),
     };
   }
   ```
3. Initialize `indicatorsBySlot` in the initial `useState` (line 68) and in the `currentGridState` fallback (lines 74-81). When `loadedChartState` (added in step B7) is present, hydrate indicators from it.
4. Add a handler to update one slot's indicators when `BacktestChart` reports a change:
   ```ts
   const setSlotIndicators = (slotId: ChartSlotId, next: IndicatorKey[]) => {
     setGridState({
       ...currentGridState,
       indicatorsBySlot: {
         ...currentGridState.indicatorsBySlot,
         [slotId]: next,
       },
     });
   };
   ```
5. In `setSlotTimeframe()` (lines 99-108), reset that slot's indicators to the new timeframe's defaults whenever the timeframe changes:
   ```ts
   const setSlotTimeframe = (slotId: ChartSlotId, timeframe: BacktestTimeframeKey) => {
     setGridState({
       ...currentGridState,
       activeDrawingTool: BACKTEST_FRAME_CONFIG[timeframe].intraday ? currentGridState.activeDrawingTool : null,
       timeframesBySlot: {
         ...currentGridState.timeframesBySlot,
         [slotId]: timeframe,
       },
       indicatorsBySlot: {
         ...currentGridState.indicatorsBySlot,
         [slotId]: getDefaultIndicators(timeframe),
       },
     });
   };
   ```
6. Pass two new props down to each `BacktestChart` instance in the loop (line 130):
   - `defaultIndicators={currentGridState.indicatorsBySlot[cell.id]}` — replaces the existing `getDefaultIndicators(timeframe)` call.
   - `onIndicatorsChange={(next) => setSlotIndicators(cell.id, next)}` — wired in step B7.
7. Add `isReadOnly: boolean` to `BacktestChartGridProps` (around line 46-55) and thread it into each `BacktestChart` (step B7 wires the consumer side). The grid itself doesn't gate on it; it just forwards.
8. Add `loadedChartState: BacktestChartState | null` and `onChartStateChange: (state: BacktestChartState) => void` props to `BacktestChartGridProps`. The first is used to hydrate drawings + indicators when entering reviewMode; the second is called whenever drawings or indicators change so the parent can capture them for save.
9. When `loadedChartState` is non-null and differs from the previous render (use a ref + effect to detect transition), seed the drawings via `drawingsController.clearAllDrawings()` followed by re-importing the loaded drawings. `useChartDrawings` does not currently expose a `setDrawings` action — add one in step B8.
10. Whenever the drawings array or `indicatorsBySlot` changes, call `onChartStateChange({ drawings, indicators: indicatorsBySlot })` so the parent has the latest snapshot. Use a `useEffect` keyed on those values.

**Acceptance criteria:**
- [ ] Toggling an indicator in any slot updates `indicatorsBySlot` in the grid state and propagates via `onChartStateChange`.
- [ ] Changing a slot's timeframe resets that slot's indicators to the new timeframe's defaults.
- [ ] When `loadedChartState` is provided, drawings and indicators hydrate from it (step B8 + B9 wire the actual rendering).
- [ ] When `isReadOnly` is true, the grid passes that down to `BacktestChart` (consumed in step B9).

---

### Step B7 — `BacktestChart` reports indicator changes and respects `isReadOnly`

**File:** `components/trading/BacktestChart.tsx`
**Action:** MODIFY

Instructions:

1. In `BacktestChartProps` (around line 95-115), add:
   ```ts
   onIndicatorsChange?: (indicators: IndicatorKey[]) => void;
   isReadOnly?: boolean;
   ```
2. Destructure both in the function signature (around line 340-357).
3. Add a `useEffect` after the existing indicator declaration (after line 358) that fires whenever `indicators` changes:
   ```ts
   useEffect(() => {
     onIndicatorsChange?.(Array.from(indicators));
   }, [indicators, onIndicatorsChange]);
   ```
4. When `isReadOnly` is true:
   - `toggleIndicator` (lines 423-429) should short-circuit: `if (isReadOnly) return;` at the top.
   - The indicator dropdown trigger (line 893-898) should pass `disabled={isReadOnly}` and visually grey out (use Tailwind `disabled:opacity-40 disabled:cursor-not-allowed` on the button — match the existing pattern from `BacktestSimPanel.tsx`).
   - The series-type dropdown trigger (line 914-918) should also pass `disabled={isReadOnly}`. Series type does not persist with the review (it's purely a viewing preference), but locking it during review prevents user confusion that they're modifying anything.
5. The `DrawingToolbar` instance (lines 942-947) needs a `disabled` prop. Add it in step B8.
6. The `ChartDrawings` instance (lines 1003-1010) needs `isReadOnly` so chart clicks don't spawn drawings. Add it in step B9.

**Acceptance criteria:**
- [ ] Toggling any indicator emits an `onIndicatorsChange` callback with the new full set.
- [ ] When `isReadOnly` is true, indicator and series-type dropdowns are disabled.
- [ ] Clicking the (disabled) indicator trigger does nothing.

---

### Step B8 — `DrawingToolbar` gains `disabled` + add `text` tool entry

**File:** `components/trading/DrawingToolbar.tsx`
**Action:** MODIFY

**File:** `hooks/use-chart-drawings.ts`
**Action:** MODIFY (add the text drawing type, validator, and an external setter)

Instructions for `hooks/use-chart-drawings.ts`:

1. Extend the `DrawingTool` union (line 7):
   ```ts
   export type DrawingTool = 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci' | 'text' | null;
   ```
2. Add a `TextDrawing` interface after `FibonacciDrawing` (after line 43). **No `color`, no `lineWidth`, no `fontSize`** — those are fixed at render time:
   ```ts
   export interface TextDrawing {
     id: string;
     type: 'text';
     position: DrawingPoint;
     text: string;
   }
   ```
3. Update the `Drawing` union (line 45) to include `TextDrawing`:
   ```ts
   export type Drawing = TrendLineDrawing | HorizontalLineDrawing | RectangleDrawing | FibonacciDrawing | TextDrawing;
   ```
4. Update `normalizeDrawings()` (lines 83-175) to recognize `'text'`. Important: text drawings do **not** carry `color` or `lineWidth`, so the existing guard at lines 92-100 (which rejects items missing `color` or `lineWidth`) must be relaxed for the text case. Restructure as follows:
   ```ts
   for (const item of loaded) {
     if (!item || typeof item !== 'object') continue;

     const drawing = item as Record<string, unknown>;
     const id = typeof drawing.id === 'string' ? drawing.id : null;
     if (!id) continue;

     // Text drawings have a different field set.
     if (drawing.type === 'text') {
       if (
         !isDrawingPoint(drawing.position)
         || typeof drawing.text !== 'string'
         || drawing.text.length === 0
       ) {
         continue;
       }
       normalized.push({
         id,
         type: 'text',
         position: drawing.position,
         text: drawing.text,
       });
       continue;
     }

     // All other drawings require color + lineWidth.
     const color = typeof drawing.color === 'string' ? drawing.color : null;
     const lineWidth = typeof drawing.lineWidth === 'number' && Number.isFinite(drawing.lineWidth)
       ? drawing.lineWidth
       : null;
     if (!color || lineWidth === null) continue;

     switch (drawing.type) {
       // ...existing horizontal/trendline/rectangle/fibonacci cases unchanged
     }
   }
   ```
5. Add a new `createTextDrawing()` action / reducer entry. Since text drawings don't go through the existing temp-drawing/click-and-drag flow, expose a new top-level callback `addTextDrawing(point: DrawingPoint, text: string)` from the hook. Implementation:
   ```ts
   type DrawingAction =
     | ...existing actions...
     | { type: 'addCompletedDrawing'; drawing: Drawing };

   // In drawingReducer:
   case 'addCompletedDrawing':
     return {
       ...state,
       drawings: [...state.drawings, action.drawing],
       tempDrawing: null,
       isDrawing: false,
     };

   // In useChartDrawings, add:
   const addTextDrawing = useCallback((point: DrawingPoint, text: string) => {
     const trimmed = text.trim();
     if (!trimmed) return;
     dispatch({
       type: 'addCompletedDrawing',
       drawing: {
         id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
         type: 'text',
         position: point,
         text: trimmed,
       },
     });
   }, []);

   const updateTextDrawing = useCallback((id: string, text: string) => {
     const trimmed = text.trim();
     if (!trimmed) return;
     dispatch({
       type: 'updateTextDrawing',
       id,
       text: trimmed,
     });
   }, []);
   ```
   And the matching reducer case for `updateTextDrawing`:
   ```ts
   case 'updateTextDrawing':
     return {
       ...state,
       drawings: state.drawings.map((drawing) =>
         drawing.id === action.id && drawing.type === 'text'
           ? { ...drawing, text: action.text }
           : drawing,
       ),
     };
   ```
6. Add a `replaceAllDrawings` action used by the grid hydration in step B6:
   ```ts
   type DrawingAction =
     | ...existing...
     | { type: 'replaceAllDrawings'; drawings: Drawing[] };

   case 'replaceAllDrawings':
     return {
       drawings: action.drawings,
       tempDrawing: null,
       isDrawing: false,
     };

   const replaceAllDrawings = useCallback((next: Drawing[]) => {
     dispatch({ type: 'replaceAllDrawings', drawings: next });
   }, []);
   ```
7. Add `addTextDrawing`, `updateTextDrawing`, and `replaceAllDrawings` to the hook's return object (lines 418-436).

Instructions for `components/trading/DrawingToolbar.tsx`:

1. Add a `disabled?: boolean` prop to `DrawingToolbarProps` (lines 15-20) and destructure it. When `disabled`, render the trigger button with `disabled={true}` and the existing greyed-out classes.
2. Extend the `tools` array (lines 22-27) with the text tool. Use the `Type` icon from `lucide-react`:
   ```ts
   import { ChevronDown, Minus, Square, Trash2, TrendingUp, Type } from 'lucide-react';

   const tools: Array<{ id: DrawingTool; icon: React.ReactNode; label: string }> = [
     { id: 'trendline', icon: <TrendingUp className="h-4 w-4" />, label: 'Trend Line' },
     { id: 'horizontal', icon: <Minus className="h-4 w-4" />, label: 'Horizontal Line' },
     { id: 'rectangle', icon: <Square className="h-4 w-4" />, label: 'Rectangle' },
     { id: 'fibonacci', icon: <span className="text-[10px] font-bold leading-none">Fib</span>, label: 'Fibonacci Retracement' },
     { id: 'text', icon: <Type className="h-4 w-4" />, label: 'Text' },
   ];
   ```
3. In `BacktestChart.tsx`, pass `disabled={isReadOnly}` to the `DrawingToolbar` instance (line 942).

**Acceptance criteria:**
- [ ] `Drawing` union now includes `TextDrawing`.
- [ ] `normalizeDrawings()` accepts `{ id, type: 'text', position: { time, price }, text: '...' }` and rejects empty / non-string `text`.
- [ ] Hook exposes `addTextDrawing`, `updateTextDrawing`, and `replaceAllDrawings`.
- [ ] `DrawingToolbar` shows a "Text" entry with the `Type` icon.
- [ ] When `disabled`, the toolbar trigger is non-interactive.

---

### Step B9 — `ChartDrawings` renders + edits text drawings; respects `isReadOnly`

**File:** `components/trading/ChartDrawings.tsx`
**Action:** MODIFY

Instructions:

1. Add `isReadOnly?: boolean` to `ChartDrawingsProps` (lines 146-160) and destructure (default `false`).
2. Update the import from `@/hooks/use-chart-drawings` to also pull `addTextDrawing`, `updateTextDrawing`, and the `TextDrawing` type:
   ```ts
   import {
     useChartDrawings,
     type ChartDrawingsController,
     type Drawing,
     type DrawingTool,
     type TrendLineDrawing,
     type RectangleDrawing,
     type FibonacciDrawing,
     type TextDrawing,
   } from '@/hooks/use-chart-drawings';
   ```
   And from the controller destructuring (lines 183-194), add `addTextDrawing` and `updateTextDrawing`.
3. **Block all edit interactions when `isReadOnly`:**
   - The `subscribeClick` handler (lines 260-334): wrap the entire body in `if (isReadOnly) return;`. This prevents starting drawings, completing drawings, selecting drawings, and dragging endpoints when in read-only mode.
   - The keyboard shortcuts effect (lines 621-661): wrap with `if (isReadOnly) return;` so Delete/Backspace/Escape don't alter drawings.
   - The double-click handler (lines 663-697): wrap with `if (isReadOnly) return;`.
4. **Render text drawings on the canvas.** In `renderDrawing()` (lines 384-467), add a `case 'text':` that draws the text with `ctx.fillText`:
   ```ts
   case 'text': {
     const x = timeToCoordinate(drawing.position.time);
     const y = priceToCoordinate(drawing.position.price);
     if (x === null || y === null) break;
     ctx.save();
     ctx.font = '14px ui-sans-serif, system-ui, -apple-system, sans-serif';
     ctx.fillStyle = '#ffffff';
     ctx.textBaseline = 'middle';
     ctx.fillText(drawing.text, x, y);
     ctx.restore();
     break;
   }
   ```
5. **Hit detection for text.** In `isPointNearDrawing()` (lines 14-84), add a `case 'text':` that returns true if the click is within ~12px of the rendered text origin:
   ```ts
   case 'text': {
     const x1 = timeToCoordinate(drawing.position.time);
     const y1 = priceToCoordinate(drawing.position.price);
     if (x1 === null || y1 === null) return false;
     // Approximate text width: 8px per character at 14px font.
     const approxWidth = drawing.text.length * 8;
     return x >= x1 - HIT_TOLERANCE
       && x <= x1 + approxWidth + HIT_TOLERANCE
       && Math.abs(y - y1) < HIT_TOLERANCE;
   }
   ```
6. **Endpoint hit detection** at `isPointNearEndpoint()` (lines 112-144): text drawings don't have endpoints. Add an early return for text:
   ```ts
   if (drawing.type === 'horizontal' || drawing.type === 'text') {
     return { isNear: false, which: null };
   }
   ```
7. **Inline editor for text.** Add a piece of component state for an in-progress text edit:
   ```ts
   const [textEditState, setTextEditState] = useState<{
     mode: 'create' | 'edit';
     id?: string;
     point: { x: number; y: number };
     value: string;
   } | null>(null);
   ```
8. In the `subscribeClick` handler, when `activeTool === 'text'` is the active tool (and not `isReadOnly`):
   - If clicking on existing text and not `isReadOnly`: open the editor in 'edit' mode at the click coordinate with the existing text. Do NOT call `addTextDrawing`.
   - Otherwise (not on existing text): open the editor in 'create' mode at the click coordinate with empty value.
   - Do not call the existing `startDrawing` flow for text — text uses the inline editor instead.
9. When clicking on an existing text drawing while NO tool is active and not `isReadOnly`, allow opening the editor in 'edit' mode (so users can edit text without re-selecting the tool). Add this branch to the existing "click on existing drawing" block (around lines 299-316):
   ```ts
   if (drawing.type === 'text') {
     setTextEditState({
       mode: 'edit',
       id: drawing.id,
       point: { x, y },
       value: drawing.text,
     });
     return;
   }
   ```
10. **Render the inline editor as a positioned input.** Below the existing canvas overlay (around line 707), conditionally render:
    ```tsx
    {textEditState ? (
      <input
        type="text"
        autoFocus
        value={textEditState.value}
        onChange={(event) => setTextEditState((current) => current ? { ...current, value: event.target.value } : current)}
        onBlur={() => commitTextEdit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitTextEdit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setTextEditState(null);
          }
        }}
        className="absolute z-30 rounded border border-white/20 bg-[#121214] px-1 text-[14px] text-white outline-none"
        style={{ left: textEditState.point.x, top: textEditState.point.y - 10 }}
      />
    ) : null}
    ```
    Where `commitTextEdit()` is:
    ```ts
    const commitTextEdit = useCallback(() => {
      if (!textEditState) return;
      const trimmed = textEditState.value.trim();
      if (textEditState.mode === 'create') {
        // Convert the click x/y back to time/price for storage.
        const time = coordinateToTime(textEditState.point.x);
        const price = coordinateToPrice(textEditState.point.y);
        if (trimmed && time !== null && price !== null) {
          addTextDrawing({ time, price }, trimmed);
        }
      } else if (textEditState.mode === 'edit' && textEditState.id) {
        if (trimmed) {
          updateTextDrawing(textEditState.id, trimmed);
        }
      }
      setTextEditState(null);
      onToolChange?.(null); // exit text tool after place
    }, [textEditState, addTextDrawing, updateTextDrawing, coordinateToTime, coordinateToPrice, onToolChange]);
    ```
11. **Don't capture clicks for editor positioning.** The editor is positioned in the canvas wrapper (which is `position: relative`); the existing `chartWrapRef` in `BacktestChart.tsx` is the relative ancestor. Verify the input renders correctly; if not, wrap the input in a div anchored to `chartWrapRef`.

**Acceptance criteria:**
- [ ] With the Text tool active, clicking the chart spawns an inline input at that point.
- [ ] Typing then pressing Enter (or blurring) creates a text drawing at the click's time/price.
- [ ] Typing then pressing Escape cancels (no drawing created).
- [ ] Clicking an existing text drawing (no tool active) opens the editor with current text; Enter / blur saves.
- [ ] Text drawings render as 14px white labels at their stored time/price.
- [ ] When `isReadOnly` is true: cannot create new text, cannot edit existing text, cannot delete text drawings, cannot drag endpoints, cannot use Delete/Backspace shortcuts.

---

### Step B10 — Save chartState on review save

**File:** `components/trading/BacktestingTab.tsx`
**Action:** MODIFY

**File:** `hooks/use-backtest-session.ts`
**Action:** MODIFY

The hook's `saveReview()` needs to accept `chartState` and forward it. The tab needs to capture the latest chart state from `BacktestChartGrid` (via `onChartStateChange`) and pass it on save.

Instructions for `hooks/use-backtest-session.ts`:

1. Update the `saveReview` signature (line 362):
   ```ts
   const saveReview = useCallback(async (
     label?: string,
     notes?: string,
     chartState?: BacktestChartState,
   ) => { ... });
   ```
2. Import `BacktestChartState` from `@/lib/types`.
3. Include `chartState` in the POST body (line 378):
   ```ts
   body: JSON.stringify({ sessionId: activeSession.id, label, notes, chartState: chartState ?? {} }),
   ```
4. The success path from step A4 already sets `reviewMode` to `payload.session` — `payload.session` now includes `chartState` (because the API returns the full row), so when the user goes back into the saved review later, hydration works automatically.

Instructions for `components/trading/BacktestingTab.tsx`:

1. Add state for the latest captured chart state:
   ```ts
   const [latestChartState, setLatestChartState] = useState<BacktestChartState>({ drawings: [], indicators: {} });
   ```
2. Pass `onChartStateChange={setLatestChartState}` to `BacktestChartGrid` (around line 339).
3. Pass `loadedChartState={sessionState.session?.chartState ?? null}` to `BacktestChartGrid`. When `sessionState.isReadOnly` is true (review loaded), this hydrates drawings + indicators from the saved row. When false (active session), the grid keeps its current in-memory state.
4. Pass `isReadOnly={sessionState.isReadOnly}` to `BacktestChartGrid`.
5. In the `BacktestSimPanel` `onSaveReview` prop (line 377), forward the chart state. Currently `onSaveReview={sessionState.saveReview}`; change to:
   ```ts
   onSaveReview={(label, notes) => sessionState.saveReview(label, notes, latestChartState)}
   ```
   `BacktestSimPanel`'s `BacktestSimPanelProps` already types `onSaveReview` as `(label?: string, notes?: string) => Promise<void> | void` — that signature stays unchanged; the tab is the one composing the chart state in.
6. When `sessionState.session?.id` changes (or `isReadOnly` flips), reset `latestChartState` so the next active session starts blank:
   ```ts
   useEffect(() => {
     if (sessionState.isReadOnly) return;
     setLatestChartState({ drawings: [], indicators: {} });
   }, [sessionState.session?.id, sessionState.isReadOnly]);
   ```
   Confirm this doesn't fire on every render (the dependency on `session?.id` is stable across renders for the same session).

**Acceptance criteria:**
- [ ] Saving a review POSTs `chartState: { drawings, indicators }` capturing the user's drawings and per-slot indicators.
- [ ] Loading that review later hydrates the same drawings + indicators in the chart.
- [ ] An active (non-review) session always starts with blank drawings and default-by-timeframe indicators.
- [ ] Coworker's review loads with the coworker's saved drawings + indicators (cross-user portability).

---

### Step B11 — Read-only enforcement plumbing in the grid

**File:** `components/trading/BacktestChartGrid.tsx`
**Action:** MODIFY (continuation of step B6)

Instructions:

1. Pass `isReadOnly` from props down to each `BacktestChart` instance (line 130) as a new prop.
2. The grid-level `setActiveDrawingTool` (lines 85-90) should short-circuit when `isReadOnly`: `if (isReadOnly) return;`. This prevents the toolbar from arming a tool even if the disabled state is bypassed.
3. The `drawingsController` returned by `useChartDrawings` is passed into `BacktestChart`, which forwards to `ChartDrawings`. Step B9 already gates ChartDrawings on `isReadOnly`. Pass `isReadOnly` through the chain explicitly so each layer can enforce it.

**Acceptance criteria:**
- [ ] Loading a review disables the drawing toolbar, indicator dropdown, and series-type dropdown.
- [ ] Loading a review prevents click-to-draw on the chart.
- [ ] Loading a review prevents Delete/Backspace from removing existing drawings.

---

### Phase B end requirements

Run from `/home/jared/Nexus-Terminal`:

```
npm run db:migrate
npm run lint
npx tsc --noEmit
npm test
```

All four must exit 0.

Codex must print a manual-test checklist at the end of the run (do not actually run a browser, just print the checklist for the user to follow):

```
Phase B manual smoke test (run in browser):
  [ ] Create an active session on a ticker. Add 2 drawings (e.g. trendline + horizontal). Toggle VWAP on the 5m slot. Save Review.
  [ ] Reload the page. From the manager's Uncategorized row, "Open" the just-saved review.
      → Drawings should hydrate. VWAP should be on the 5m slot. Toolbar disabled.
  [ ] Clear the review (or start a new session). Drawings should clear, indicators should reset to per-timeframe defaults.
  [ ] With the Text tool active, click a chart bar; type "test"; press Enter. Save Review. Reload + open. Text should persist.
  [ ] With no tool active, click an existing text drawing. Editor opens. Type new text. Press Enter. Re-save (or treat as fresh review).
      → Note: editing inside a loaded read-only review is blocked by isReadOnly. To edit, exit the review and start fresh.
  [ ] On a named backtest path: save review. Have coworker (or simulate by switching user context if test infra allows) load it. Drawings + indicators visible, all controls disabled.
```

Then commit with this message:

```
Persist drawings and indicators with backtest reviews and add text drawing tool
```

---

## Files Changed Summary

### Phase A

| File | Action | Lines added/removed (rough) | Risk |
|---|---|---|---|
| `lib/backtest-math.ts` | MODIFY | +5 / 0 | LOW — additive, no behavior change for existing fields |
| `__tests__/backtest-math.test.ts` | MODIFY | +30 / 0 | LOW — pure test additions |
| `components/trading/BacktestSimPanel.tsx` | MODIFY | +5 / -2 | LOW — display-only |
| `hooks/use-backtest-session.ts` | MODIFY | +4 / 0 | LOW — adds reviewMode set on save success |
| `components/trading/BacktestChartGrid.tsx` | MODIFY | +30 / -2 | LOW — localStorage, no schema |

### Phase B

| File | Action | Lines added/removed (rough) | Risk |
|---|---|---|---|
| `lib/db/schema.ts` | MODIFY | +1 / 0 | LOW — new column, default `{}` |
| `drizzle/0028_*.sql` | CREATE (auto-generated) | ~3 lines | LOW — additive migration |
| `lib/validations/backtest.ts` | MODIFY | +8 / 0 | LOW — Zod additions |
| `app/api/backtest/sessions/[id]/review/route.ts` | MODIFY | +1 / 0 | LOW — set new column |
| `lib/types.ts` | MODIFY | +5 / 0 | LOW — type additions |
| `hooks/use-chart-drawings.ts` | MODIFY | +60 / -10 | MEDIUM — new TextDrawing case + new actions |
| `components/trading/DrawingToolbar.tsx` | MODIFY | +5 / -1 | LOW — new tool entry, disabled prop |
| `components/trading/ChartDrawings.tsx` | MODIFY | +80 / 0 | MEDIUM — text rendering, edit overlay, isReadOnly gating |
| `components/trading/BacktestChart.tsx` | MODIFY | +20 / -2 | LOW — props pass-through, disabled gates |
| `components/trading/BacktestChartGrid.tsx` | MODIFY | +50 / -5 | MEDIUM — new state shape, hydration, callbacks |
| `components/trading/BacktestingTab.tsx` | MODIFY | +15 / -1 | LOW — wire chartState capture + save |
| `hooks/use-backtest-session.ts` | MODIFY | +5 / -2 | LOW — saveReview accepts chartState |

---

## Verification Steps

After Phase A:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- Commit + STOP.

After Phase B:
- `npm run db:migrate`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- Commit + print manual-test checklist.

---

## Open Assumptions (Codex must verify before writing code)

1. **`Type` icon from lucide-react** is available in the existing version. Verify by checking `package.json` for `lucide-react` and noting the version, or by confirming a sibling import already pulls a similarly-named icon. If `Type` is not available, substitute `TextCursor` or render a literal `<span className="text-[10px] font-bold leading-none">T</span>` like the Fibonacci entry does.
2. **`coordinateToTime`/`coordinateToPrice` reverse lookups** for placing a text drawing at a click point: `ChartDrawings.tsx` already has `coordinateToPrice` (lines 232-238) and `coordinateToTime` (lines 240-251). Both can return null at the chart edges; gate the create path on non-null values.
3. **`scripts/db-migrate-safe.mjs`** executes the equivalent of `drizzle-kit migrate`. Confirm the migration generated by step B1 is auto-discovered (it should be — check the script if a manual step is needed).
4. **Existing review-route tests** at `__tests__/backtest-sessions-route.test.ts` may assert exact `set()` payload shapes. After step B4, update any test that asserts the payload to include `chartState`.
5. **`@/lib/types` cycle risk**: importing `Drawing` from `hooks/use-chart-drawings.ts` into `lib/types.ts` could create a cycle. The plan deliberately uses `unknown[]` for `BacktestChartState.drawings` to avoid this. If a cycle still occurs, move `BacktestChartState` to its own file `lib/types/backtest-chart-state.ts`.

---

## Recent Completed Context

- 2026-05-03: Backtest review auto-load context fix shipped (`8467959`).
- 2026-05-03: Per-user backtest session scoping + auto-load on Launch Chart (`a04ac6a`).
- 2026-05-03: Scanner summary cache extended to 24h (`4ceb43b`).
- 2026-05-03: Backtest manager polish — Edit/Delete moved to bottom action row (`457eecb`), default System Sheet wiring (`6421670`).
- 2026-05-01: Backtest Manager landing page shipped — schema, API, manager + stats views, view-mode wiring across BacktestingTab/Sidebar/SimPanel.
- 2026-05-01: Backtesting timeframe/day controls + VWAP NY-session reset shipped.
- 2026-05-01: Dashboard intraday latches + Backtesting chart/review controls shipped — Day 1 + MDR rows persist for the ET day, drawings shared across intraday charts, per-chart expansion, saved-review delete affordance.
- 2026-04-30: MDR eligibility route and Dashboard Potential MDR filtering shipped.
- 2026-04-28: Backtesting tab shipped with schema/API/UI, simulator action validation, review save/load, and a four-chart grid.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- MDR setup entry-trigger columns remain deferred; `PM Price Needed`, `Opening Gap Needed`, and `Intraday Price Needed` still render placeholders.
- **Backtest Manager — `broke_premarket_high` filter deferred** (decision 5 in 2026-05-01 planning). Data not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
