# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-28
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Recent ships: AskEdgar Sprint 2 (`historical-float-pro` from XBRL companyfacts) shipped in `cbde6ee`, migration `0024_acoustic_jocasta.sql` applied via `npm run db:migrate`. AskEdgar Sprint 3 (8-K parsing trio: reverse-splits, split-status, offerings) is paused while Backtesting Tab ships.

## Active Spec — Backtesting Tab (Charts → Backtesting Makeover)

Replace the single-chart `Charts` tab with a 4-chart `Backtesting` tab driven by the team's `system_tickers` list, with a built-in trade simulator that auto-sizes shares from a dollar-risk amount.

Decisions already locked (do NOT re-litigate):
- Persist sim trades in two new tables; isolated from real `trades`. (No schema change to `trades`.)
- Trade actions: `LONG`, `LONG_ADD`, `SELL`, `SHORT`, `SHORT_ADD`, `COVER`. Contextually disabled by current sim position.
- Drawing tools kept: trendline, horizontal, rectangle. **Fibonacci is removed entirely**.
- Per-chart timeframe + per-chart indicators (compact dropdowns, not the mockup's button row).
- One ACTIVE session per `(userId, ticker, date)`; auto-saved. SAVE REVIEW snapshots it as REVIEWED with optional label.
- R$ defaults from existing `nexus-default-risk` localStorage; per-session override stored on the session row.
- Daily-day highlight via translucent canvas band (same pattern as pre/post-market shading in `ChartsTab.tsx:498`).
- Click-to-place entry: chart click auto-fills entry price; user types stop in popup, presses Place or Cancel.
- Auto stop-out is **not** in scope — manual exits only for v1. Logged in Follow-Up Notes below.
- Route key renamed `'charts'` → `'backtesting'`. URL `?tab=charts` will break (acceptable).

Run `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit` after each phase. Migration uses `npm run db:migrate`, **never** `db:push`.

---

### Phase 1 — Schema, API surface, tab rename, Fibonacci removal

**Step 1.1 — Add backtest tables to `lib/db/schema.ts`** (append after `systemTickers`, ~line 457):

```ts
export const backtestSessions = pgTable('backtest_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  date: date('date').notNull(),
  status: text('status', { enum: ['ACTIVE', 'REVIEWED'] }).notNull().default('ACTIVE'),
  riskDollars: doublePrecision('risk_dollars').notNull(),
  label: text('label'),
  notes: text('notes'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('backtest_sessions_user_ticker_date_idx').on(t.userId, t.ticker, t.date),
  index('backtest_sessions_user_status_idx').on(t.userId, t.status),
]);

export const backtestActions = pgTable('backtest_actions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  actionType: text('action_type', {
    enum: ['LONG', 'LONG_ADD', 'SELL', 'SHORT', 'SHORT_ADD', 'COVER'],
  }).notNull(),
  price: doublePrecision('price').notNull(),
  shares: doublePrecision('shares').notNull(),
  stopPrice: doublePrecision('stop_price'),
  barTime: text('bar_time').notNull(),
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  foreignKey({
    columns: [t.userId, t.sessionId],
    foreignColumns: [backtestSessions.userId, backtestSessions.id],
  }).onDelete('cascade'),
  index('backtest_actions_user_session_seq_idx').on(t.userId, t.sessionId, t.sequence),
]);
```

**Step 1.2 — Generate + apply migration:**
1. `npm run db:generate` — produces `drizzle/0025_*.sql`.
2. Inspect the SQL. Confirm two `CREATE TABLE`, the FK, and three indexes. No drops, no other tables touched.
3. `npm run db:migrate` to apply to Neon.
4. Commit the generated migration file.

**Step 1.3 — Validation schema** at `lib/validations/backtest.ts` (new file). Use Zod v4. Export:
- `backtestSessionUpsertSchema` — `{ ticker: string(1..20), date: string ISO YYYY-MM-DD, riskDollars: number positive }`
- `backtestActionCreateSchema` — `{ sessionId: string, actionType: enum(6), price: number positive, shares: number positive, stopPrice: number positive | null, barTime: string }`
- `backtestSessionReviewSchema` — `{ sessionId: string, label?: string, notes?: string }`

Use `parseAndValidate()` from `lib/api-route-utils.ts` and `z.flattenError()` (Zod v4) — see `AGENTS.md:73`.

**Step 1.4 — API routes** (all `requireUser()` + `ensureUser()` pattern, see `app/api/saved-tickers/route.ts` for reference):

1. `app/api/system-tickers/route.ts` (GET) — read-only list of `system_tickers` ordered by `date DESC, ticker ASC`. Optional query params: `?q=` (ticker substring filter), `?from=YYYY-MM-DD`, `?to=YYYY-MM-DD`. Returns `{ rows: { id, ticker, date, grade, setupType, day1GapPct }[] }`. The full row is not needed in the sidebar.

2. `app/api/backtest/sessions/route.ts`:
   - `GET` — query params `?ticker=&date=`. Returns the ACTIVE session (or null) plus REVIEWED sessions for that pair.
   - `POST` — upsert ACTIVE session for `(userId, ticker, date)`. Body: `backtestSessionUpsertSchema`. Insert if no ACTIVE row exists; otherwise update `riskDollars` + `updatedAt`. Returns `{ session }`.

3. `app/api/backtest/sessions/[id]/route.ts`:
   - `GET` — returns session + actions ordered by sequence asc.
   - `PATCH` — body `{ riskDollars?, notes?, label? }`. Update fields.
   - `DELETE` — cascade-deletes its actions.

4. `app/api/backtest/sessions/[id]/review/route.ts` (POST) — sets `status='REVIEWED'`, `reviewedAt=now()`, optional `label`, `notes`. Body: `backtestSessionReviewSchema`. After review, the next `POST /api/backtest/sessions` for the same `(ticker, date)` will create a fresh ACTIVE session.

5. `app/api/backtest/sessions/[id]/clear/route.ts` (POST) — deletes all `backtestActions` for the session but keeps the session row + `riskDollars`. Returns `{ cleared: true }`.

6. `app/api/backtest/actions/route.ts` (POST) — appends an action. Body: `backtestActionCreateSchema`. Server computes `sequence = max(sequence) + 1` for that session. Returns `{ action }`.

7. `app/api/backtest/actions/[id]/route.ts` (DELETE) — undo last action. Confirm caller owns it via `userId`.

**Step 1.5 — Rename tab key `'charts'` → `'backtesting'`** in:
- `app/page.tsx:16` (import, becomes `BacktestingTab from '@/components/trading/BacktestingTab'`)
- `app/page.tsx:25` (`VALID_TABS`)
- `app/page.tsx:32` (`TAB_TITLES`, label `'Backtesting'`)
- `app/page.tsx:191` (the special-padding conditional — change `'charts'` to `'backtesting'`)
- `app/page.tsx:290` (the render branch)
- `components/trading/Sidebar.tsx:10` (`TabKey` union)
- `components/trading/Sidebar.tsx:49` (nav entry — title `'Backtesting'`, keep `ChartCandlestick` icon)
- `hooks/use-global-shortcuts.ts:6` (`TAB_KEYS`)
- `components/trading/CommandPalette.tsx:26` (label `'Backtesting'`, keep shortcut `'5'`)

**Step 1.6 — Remove Fibonacci tool**:
- Delete `components/trading/plugins/FibonacciPrimitive.ts`
- Delete `components/trading/FibonacciSettings.tsx`
- In `hooks/use-chart-drawings.ts`: remove the `'fibonacci'` member from the drawing kind union, drop the fibonacci storage path. If the file is only used by the legacy `ChartsTab.tsx` (being deleted in Phase 2), the hook may itself be deleted in Phase 2 — verify with grep before removing.
- In `components/trading/DrawingToolbar.tsx:19`: remove the fibonacci button entry. Toolbar should now have 3 tools + 3 line-width selectors.
- In `components/trading/ChartDrawings.tsx`: remove the fibonacci import (line 10), the canvas render block (lines 426–437), and the settings dialog block (lines 559–580 and 720–734).
- Grep `rg -i 'fibonacci|fib' --type ts --type tsx` to confirm no stragglers outside test fixtures or git history.

**Step 1.7 — Old test cleanup**:
- `__tests__/charts-tab.test.ts` — delete. (BacktestingTab gets its own tests in Phase 3.)
- `__tests__/chart-timeframes.test.ts` — keep; it covers `lib/chart-timeframes.ts` which the new tab still uses.

**Phase 1 validation:** `npm run lint && npx tsc --noEmit && npm test && npm run workflow:audit`. Commit Phase 1 with message `Backtesting Phase 1 — schema, APIs, tab rename, fibonacci removal`.

---

### Phase 2 — BacktestingTab shell (4-chart grid + ticker sidebar, no simulator yet)

**Step 2.1 — Delete `components/trading/ChartsTab.tsx`** after extracting reusable bits. Reusable pieces — keep them in their current homes (`lib/indicators.ts`, `lib/chart-timeframes.ts`, `hooks/use-candle-data.ts`, drawing primitives). Anything single-chart-specific in `ChartsTab.tsx` (compare-symbol, time-range buttons, screenshot button, magnet/grid toggles) goes away with the file.

**Step 2.2 — Create `components/trading/BacktestingTab.tsx`** as the new tab root. Layout:

```
grid-cols-[minmax(0,1fr)_280px]  // main + right sidebar
├─ main
│  ├─ Toolbar row: ticker label, date label, Trade dropdown (placeholder in Phase 2), Clear button
│  └─ ChartGrid (2x2)
└─ BacktestingSidebar (ticker+date list)
```

Props: `{}` (no props from `app/page.tsx`; hooks fetch what's needed).

Top-level state (in `BacktestingTab`):
- `selected: { ticker: string, date: string } | null`
- `riskDollars: number` (initialized from `localStorage.getItem('nexus-default-risk')` or fallback `100`)

**Step 2.3 — `components/trading/BacktestingSidebar.tsx`** (new):

- Fetches `/api/system-tickers` once (SWR pattern via `useEffect` + state, mirror `hooks/use-saved-tickers.ts` style — keep it a local hook in the component file unless reused elsewhere).
- UI: text input filter (substring on ticker), sort toggle (DATE ↑/↓, default DESC), scrollable list of rows.
- Each row: ticker (bold), date (`yyyy-mm-dd`), grade badge if present, gap% if present.
- Row click: `onSelect({ ticker, date })`.
- Active row visually marked (background tint matching existing sidebar selection style).
- Width fixed at 280px. Match shadcn input + button styling already in repo.

**Step 2.4 — `components/trading/BacktestChartGrid.tsx`** (new):
- Receives `{ ticker, date }` props. Returns null with placeholder message ("Pick a ticker on the right") if either missing.
- Renders four `BacktestChart` cells in a CSS grid `grid-cols-2 grid-rows-2`. Each cell `min-h-[300px]`.
- Default timeframes (constant in this file): `['5m', '15m', '1h', '1D']`.
- Each cell receives: `{ ticker, anchorDate, defaultTimeframe }` plus an `onAnchorChange(newDate)` callback (only fired by the 1D chart when user clicks a daily bar).
- Anchor change callback bubbles to `BacktestingTab` and updates `selected.date`, which re-renders all four cells with the new anchor.

**Step 2.5 — `components/trading/BacktestChart.tsx`** (new — the reusable chart cell):
- Props: `{ ticker, anchorDate, defaultTimeframe, defaultIndicators?, onAnchorChange? }`
- Internal state: `timeframe` (default from prop), `indicators` (Set<IndicatorKey>, default per Step 2.6), `seriesType` (default `'candles'`).
- Uses `useCandleData` (`hooks/use-candle-data.ts`) with parameters derived from `anchorDate` + `timeframe`. Lookback windows (in this file as a constant map):
  - `5m` → 2 trading days back from anchor through end-of-anchor day post-market
  - `15m` → 5 trading days back
  - `1h` → 20 trading days back
  - `1D` → 1 calendar year back from anchor
- Mirror `ChartsTab.tsx` pattern for `createChart()`, series creation, indicator overlays, drawing tools — but scope drawings per-cell (each cell's drawings live in cell-local state; not persisted across switches unless trivial).
- Cell header: compact dropdown for timeframe (1m, 2m, 3m, 5m, 10m, 15m, 30m, 1h, 4h, 1D, 1W, 1M — pull from `lib/chart-timeframes.ts`), compact dropdown for indicators (multi-select checkbox menu), compact line-tool toolbar (3 buttons + line-width).
- Drop the screenshot button, magnet toggle, grid toggle, compare feature.

**Step 2.6 — Default indicators per cell** (constants in `BacktestChartGrid.tsx`):
- 5m and 15m: `['EMA9', 'EMA20', 'VWAP']`
- 1h: `['EMA20', 'EMA50']`
- 1D: `['SMA50', 'SMA200']`

`lib/indicators.ts` already implements SMA20, EMA21, VWAP, BB, RSI, ATR, MACD. **It does not implement EMA9/EMA20/EMA50/SMA50/SMA200**. Extend `lib/indicators.ts`:
- Generalize the existing EMA helper so it accepts an arbitrary period; add named exports `ema9`, `ema20`, `ema50` (thin wrappers around a `ema(period)(data)` core).
- Add `sma50`, `sma200` (thin wrappers around the existing SMA core).
- Indicator key union becomes: `'SMA20' | 'SMA50' | 'SMA200' | 'EMA9' | 'EMA20' | 'EMA21' | 'EMA50' | 'VWAP' | 'BB' | 'RSI' | 'ATR'`.

**Step 2.7 — Daily-day highlight (the blue band)** in the 1D `BacktestChart`:
- Reuse the canvas-overlay pattern from `ChartsTab.tsx:498-555` (pre/post-market shading).
- Compute the x-pixel range for the bar matching `anchorDate`. Draw a translucent blue rect (e.g. `rgba(56, 139, 253, 0.18)`) spanning the chart height for that bar's width.
- Update on chart resize and on `anchorDate` change.

**Step 2.8 — Daily-bar click-to-anchor:**
- Subscribe to lightweight-charts `subscribeClick` on the 1D cell only.
- Convert click time to YYYY-MM-DD (NY session). Call `onAnchorChange(newDate)`.
- Skip if the click resolves to the same date as the current anchor.

**Step 2.9 — Prior daily close line** on every sub-1D cell:
- After bars load, look up the close of the most recent daily bar with `date < anchorDate`. Use the existing `/api/market-data` endpoint with `frequencyType=daily` and a small lookback (10 days) — keep this fetch in the cell, or in a shared hook `hooks/use-prior-close.ts` if you want to reuse.
- Render as a horizontal price line (`series.createPriceLine({ price, color: '#888', lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'PDC' })`).
- Refresh when `anchorDate` changes.

**Phase 2 validation:** `npm run lint && npx tsc --noEmit && npm test && npm run workflow:audit`. Manually verify: pick a row → 4 charts populate; click a daily bar → all 4 re-anchor; change a cell's timeframe → only that cell re-fetches; intraday cells show PDC line; daily cell shows blue band on anchor day. Commit as `Backtesting Phase 2 — sidebar + 4-chart grid`.

---

### Phase 3 — Trade simulator

**Step 3.1 — Sim state hook** `hooks/use-backtest-session.ts` (new):
- Inputs: `{ ticker, date, riskDollars }`.
- Loads ACTIVE session via `GET /api/backtest/sessions?ticker=&date=`. If none, lazily creates one on first action (don't `POST` until needed — avoids blank rows).
- Exposes:
  - `session: { id, riskDollars, ... } | null`
  - `actions: BacktestAction[]` (sorted by sequence)
  - `position: SimPosition` (derived; see Step 3.3)
  - `reviews: BacktestSession[]` (REVIEWED list for the pair)
  - `placeAction(input)`, `undoLast()`, `clear()`, `updateRisk(r)`, `saveReview(label, notes)`, `loadReview(reviewId)` (read-only restore).
- All mutations call API + optimistically update local state.
- Keep all logic here so `BacktestingTab` stays a thin orchestrator (matches `app/page.tsx` orchestration rule in `AGENTS.md:55`).

**Step 3.2 — R math** in `lib/backtest-math.ts` (new pure-functions module):

```ts
export type SimDirection = 'LONG' | 'SHORT' | 'FLAT';
export interface SimPosition {
  direction: SimDirection;
  totalShares: number;     // open shares
  avgEntry: number | null; // null when flat
  stop: number | null;
  realizedPnl: number;     // closed-leg P&L
  lastExitPrice: number | null;
  initialRiskDollars: number;
  closedShares: number;
  totalSharesEverOpened: number; // for "pk" peak shares display
}

// Replays an ordered action list to derive the current position.
export function reduceActions(actions: BacktestAction[], riskDollars: number): SimPosition;

// Given the existing position, a desired NEW stop, and the click price for the add,
// returns the share quantity such that total open risk == riskDollars.
// For LONG: shares = (R - existingShares * (avgEntry - newStop)) / (clickPrice - newStop)
// For SHORT: shares = (R - existingShares * (newStop - avgEntry)) / (newStop - clickPrice)
// Throws if signs are wrong (e.g. LONG with stop above click price).
export function sizeForAdd(
  position: SimPosition,
  newStopPrice: number,
  clickPrice: number,
): { shares: number; resultingAvgEntry: number; resultingTotalRisk: number };

// Sizing for a brand-new position (FLAT → LONG/SHORT): shares = R / |entry - stop|.
export function sizeForOpen(
  riskDollars: number,
  entryPrice: number,
  stopPrice: number,
  direction: 'LONG' | 'SHORT',
): { shares: number };
```

Round shares to whole integers (floor). The "rounding leftover" is acceptable — actual risk may be slightly under R$. Keep math in this file so it can be unit-tested without UI.

**Step 3.3 — Replay reducer** (`reduceActions` in `lib/backtest-math.ts`):
- Initialize position to FLAT.
- For each action in sequence:
  - `LONG` / `SHORT`: only valid from FLAT. Sets direction, totalShares, avgEntry, stop.
  - `LONG_ADD`: only valid in LONG. Recompute `avgEntry = (existingShares*existingAvg + addShares*addPrice) / (existingShares + addShares)`. Update stop to action's `stopPrice`. Update totalShares.
  - `SHORT_ADD`: mirror.
  - `SELL`: subtract shares (partial allowed), realize `(price - avgEntry) * sold` into `realizedPnl`, `lastExitPrice = price`. If shares hit 0 → FLAT.
  - `COVER`: mirror. Realize `(avgEntry - price) * covered`.
- Reject impossible actions in API validation (e.g. `SELL` when flat) so the reducer can't see them.

**Step 3.4 — Trade dropdown + place-order modal:**

Components:
- `components/trading/BacktestTradeMenu.tsx` — header dropdown above the grid. Button labels: `LONG`, `LONG ADD`, `SELL`, `SHORT`, `SHORT ADD`, `COVER`. Each button's enabled state from `position.direction`:
  - FLAT → enable LONG, SHORT only
  - LONG → enable LONG ADD, SELL only
  - SHORT → enable SHORT ADD, COVER only
- After click, the tab enters `armedAction: ActionType` mode; charts show a hint banner ("Click chart to place {action} entry — ESC to cancel").

- `components/trading/BacktestPlaceOrderDialog.tsx` — a `Dialog` (use existing shadcn Dialog) opened after the user clicks a chart bar in armed mode. The dialog shows:
  - Action type (read-only label)
  - Entry price (read-only, auto-filled from click)
  - For LONG/SHORT (open): single Stop input. % size selector defaults to 100; preview shows computed shares + total risk.
  - For LONG_ADD/SHORT_ADD: New Stop input. Preview shows computed add shares (via `sizeForAdd`), resulting avgEntry, resulting total risk (always == R$ if math is right).
  - For SELL/COVER: % size selector (10/25/33/50/75/100). Preview shows shares closed + realized P&L preview.
  - `Place` and `Cancel` buttons. ESC = cancel.
- On Place: hook calls `placeAction()`, dialog closes, banner clears.

**Step 3.5 — Chart click handler integration:**
- In `BacktestChart.tsx`, when `armedAction` is set (passed down via context or prop), `subscribeClick` handler reads price-at-click via `series.coordinateToPrice()` and bar time, then calls a parent `onArmedClick({ price, barTime })`.
- Parent (`BacktestingTab`) opens the place-order dialog with the click data.
- Click outside chart while armed → no-op. ESC key → clear armed state.

**Step 3.6 — Right-side stats panel** `components/trading/BacktestSimPanel.tsx` (new):
- Sits inside the right sidebar **above** the ticker list — sidebar becomes two stacked panels.
- Displays:
  - R$ input (number, on blur calls `updateRisk()`; persists to session and writes-through to `localStorage('nexus-default-risk')`)
  - AVG ENTRY, SHARES, STOP, RISK ($ + R-multiple), AVG EXIT, LAST EXIT, SIM PNL ($ + R), POS VALUE, STATUS (`FLAT` / `OPEN LONG` / `OPEN SHORT` / `CLOSED`).
  - Action ledger: scrollable list of placed actions (timestamp · type · shares @ price · stop), with an "Undo last" button.
  - `Clear` button → confirm dialog ("Remove all simulation executions for {ticker} {date}? R$ setting kept.") → calls `/api/backtest/sessions/[id]/clear`.
  - `SAVE REVIEW` button (disabled when ledger is empty) → opens a small dialog asking for optional label + notes, then `POST /api/backtest/sessions/[id]/review`. After save, hook clears local state and the next action creates a new ACTIVE session.
  - `LOAD REVIEW` dropdown listing this `(ticker, date)`'s REVIEWED sessions by `reviewedAt DESC`. Selecting one loads it in **read-only mode** — show a banner "Viewing review — click + to start a new session". (Read-only is enforced by hiding the trade dropdown; no schema flag needed.)
- All numeric values formatted via existing `formatCurrency` / `formatR` from `lib/trading-utils.ts`.

**Step 3.7 — Tests** in `__tests__/`:
- `backtest-math.test.ts` — unit-test `sizeForOpen`, `sizeForAdd`, `reduceActions`. Cover: open long, add to long lowering stop maintains R, partial sell, full sell → FLAT, mirror cases for short, invalid action sequencing throws.
- `backtest-sessions-route.test.ts` — happy path: create active session, append actions, review, list reviews. Mock DB via existing pattern.
- `backtesting-tab.test.ts` — render the tab with mocked `useCandleData`, `use-backtest-session`. Verify: empty state when no selection, trade dropdown disabled until ticker chosen, action buttons enable correctly per position state.

**Phase 3 validation:** all four commands. Manually exercise: arm LONG → click 5m bar → enter stop → Place; verify shares calc against `R / |entry-stop|`; arm LONG_ADD with a different stop → confirm total risk in panel still equals R$; partial SELL; SAVE REVIEW; LOAD REVIEW shows read-only; CLEAR wipes actions but preserves R$. Commit as `Backtesting Phase 3 — trade simulator`.

---

## Validation Snapshot

- Backtesting Phase 1 (`2026-04-28`, pending review/commit): `npm run db:generate` produced `drizzle/0025_blue_joseph.sql`; `npm run db:migrate` applied it to Neon; `npm run lint`, `npx tsc --noEmit`, `npm test` (454/454), and `npm run workflow:audit` passed.

Last validation (before Backtesting work): `npm run lint`, `npx tsc --noEmit`, `npm test` (458/458 in isolation, one pre-existing flaky `sec-client.test.ts` timing assertion under full-suite load), `npm run db:migrate` (`0024_acoustic_jocasta.sql` applied to Neon) — all on AskEdgar Sprint 2 ship `cbde6ee` (2026-04-27).

## Follow-Up Notes

- **Auto stop-out (deferred from Backtesting v1, 2026-04-28).** When intraday bar prints through a stop, simulator should auto-execute SELL/COVER at the stop price. Schema already supports it (just append a synthetic action with `actionType=SELL|COVER` and the stop as price). UI: a settings toggle "Auto stop-out on bar break" defaulting OFF for parity with the v1 manual model. Add when user requests.
- **Backtest analytics roll-up (idea, 2026-04-28).** REVIEWED sessions are a corpus of practiced setups — could surface aggregate stats (win-rate by setupType, avg R per `system_tickers.primaryAgenda`). Out of scope for v1.
- **Financial commentary missing in agent output (logged 2026-04-27).** GLND research report from Sprint 1 smoke run claimed "no financial commentary available." Agents should surface source commentary verbatim then add analysis on top — not replace with summary. Investigate which AskEdgar/SEC field feeds this. Track separately from AskEdgar Sprint 3.
- **AskEdgar paid API key swapped (2026-04-27).** Test key expired. `https://eapi.askedgar.io` remains the correct base URL. Only swap `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles` and Sprint 2 dropped `historical-float-pro` from AskEdgar fan-out. Daily spend at ~10 unique tickers/day should sit well below post-trim ~$5–$10/day estimate. Measure with `[askedgar-fanout]` log's `costUsd` token over coming reports.
- **News-formatter UX trade.** Filing feeds default to `${formType} filing` labels via fallback in `lib/agents/news-formatter.ts:198`. AI headlines deferred to buildout-doc Phase 8 (`docs/ae-buildout.md:396`).
- **AskEdgar Sprint 3 — paused.** When Backtesting ships, resume reverse-splits → split-status → offerings sequencing per `docs/ae-buildout.md:58`. Pre-Sprint-3 prep: confirm `lib/sec/submissions.ts` surfaces 8-K accession numbers + primary doc URLs; decide whether to store extracted events in new `sec_split_events` table or keep them inside existing raw cache pattern with parser-version key.
