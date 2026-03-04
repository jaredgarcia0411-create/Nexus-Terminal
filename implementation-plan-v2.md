# Nexus Terminal — Implementation Plan v2

**Generated:** 2026-03-04  
**Target Agents:** Claude Code (nexus-architect) → Codex  
**Scope:** Schema migration + DAS Trader parser fix + candlestick charts + MFE/MAE + UI/UX  
**Broker CSV:** DAS Trader / Sterling  
**Market Data:** Schwab API (integrated)

---

## Current State Summary

### Working
- Schwab OAuth + token management with mutex, retry, audit logging (`lib/schwab.ts`)
- Schwab market-data endpoint returns OHLCV candles (`app/api/schwab/market-data/route.ts`)
- `lightweight-charts` (TradingView) renders in `CandlestickChart.tsx` with indicator overlays
- FIFO execution matcher in `csv-parser.ts` with column/side alias normalization
- Recharts performance analytics (equity curve, daily PnL, day-of-week, time-of-day)
- Drizzle schema with tenant-isolated composite primary keys
- 58 passing tests across 13 files

### Broken
1. **`COLUMN_ALIASES` maps `TYPE` → `Side`** — DAS Trader's `Type` column (`Margin`/`Short`) overwrites the real `Side` column (`B`/`SS`/`S`), misclassifying every trade
2. **`B` side is ambiguous** — DAS uses `B` for both long entries AND short covers; parser maps `B` exclusively to short exit (`BUY TO COVER`)
3. **No time-sorting** — DAS exports arrive in reverse chronological order; FIFO matcher pairs entries/exits in wrong order
4. **Trailing comma** — DAS header `Time,Symbol,...,Type,` creates phantom empty column key
5. **Execution data discarded** — `processCsvData` aggregates fills into averages, throws away individual fill records

### Missing
1. `trade_executions` DB table and `Execution` TypeScript type
2. `grossPnl`, `netPnl`, `entryTime`, `exitTime`, `mfe`, `mae`, `bestExitPnl`, `exitEfficiency` on Trade type and DB schema
3. Candlestick chart on trade detail view (only wired in backtesting tab)
4. MFE/MAE calculation engine
5. Trade detail UI with execution timeline, chart, and tabbed layout

---

## Workstream A: Schema Migration + DAS Parser Fix (Combined)

> **This is the critical-path workstream.** Everything else depends on the data model being correct and the parser producing accurate trades with execution-level detail. These two concerns are combined because the parser must emit `Execution[]` data that the schema must be ready to store. Building one without the other creates a broken intermediate state.

### Change A.1: Extend `lib/types.ts`

- **File:** `lib/types.ts`
- **Action:** MODIFY
- **Complexity:** LOW

Add `Execution` interface and extend `Trade`:

```typescript
export interface Execution {
  id: string;                    // deterministic: `${tradeId}|${side}|${index}`
  side: 'ENTRY' | 'EXIT';
  price: number;
  qty: number;
  time: string;                  // HH:mm:ss from CSV
  timestamp?: Date;              // full datetime (file date + time)
  commission: number;
  fees: number;
}
```

Extend `Trade` interface — add these fields:

```typescript
  grossPnl: number;             // PnL before commissions/fees
  netPnl: number;               // PnL after commissions/fees (replaces ambiguous `pnl`)
  entryTime: string;            // earliest entry execution HH:mm:ss
  exitTime: string;             // latest exit execution HH:mm:ss
  mfe?: number;                 // max favorable excursion in $
  mae?: number;                 // max adverse excursion in $
  bestExitPnl?: number;         // net PnL achievable at MFE point
  exitEfficiency?: number;      // netPnl / mfe ratio (0–1)
  rawExecutions: Execution[];   // all individual fills preserved
```

Rename `executions: number` → `executionCount: number` to eliminate the collision between the integer count and the new array. **This is a breaking rename** — every file referencing `trade.executions` must be updated to `trade.executionCount`.

- **Acceptance Criteria:**
  - [ ] `Execution` interface exported from `lib/types.ts`
  - [ ] `Trade.rawExecutions` is `Execution[]`
  - [ ] `Trade.executionCount` replaces `Trade.executions`
  - [ ] `Trade.grossPnl` and `Trade.netPnl` both exist
  - [ ] `Trade.pnl` retained as alias for `netPnl` during transition (avoids breaking all consumers at once)
  - [ ] `tsc --noEmit` passes after all references updated

### Change A.2: Add `trade_executions` table + extend `trades` table

- **File:** `lib/db/schema.ts`
- **Action:** MODIFY
- **Complexity:** MEDIUM

New table:

```typescript
export const tradeExecutions = pgTable('trade_executions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tradeId: text('trade_id').notNull(),
  side: text('side', { enum: ['ENTRY', 'EXIT'] }).notNull(),
  price: doublePrecision('price').notNull(),
  qty: doublePrecision('qty').notNull(),
  time: text('time').notNull(),
  timestamp: text('timestamp'),
  commission: doublePrecision('commission').default(0),
  fees: doublePrecision('fees').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.userId, table.tradeId],
    foreignColumns: [trades.userId, trades.id],
  }).onDelete('cascade'),
  index('idx_executions_user_trade').on(table.userId, table.tradeId),
]);
```

Add columns to existing `trades` table:
- `gross_pnl` (doublePrecision, notNull, default 0)
- `net_pnl` (doublePrecision, notNull, default 0)
- `entry_time` (text, notNull, default `''`)
- `exit_time` (text, notNull, default `''`)
- `mfe` (doublePrecision, nullable)
- `mae` (doublePrecision, nullable)
- `best_exit_pnl` (doublePrecision, nullable)
- `exit_efficiency` (doublePrecision, nullable)

Rename `executions` column → `execution_count` (integer).

- **Acceptance Criteria:**
  - [ ] `trade_executions` table defined with cascade FK to `trades`
  - [ ] All new columns added to `trades`
  - [ ] `executions` → `execution_count` rename in schema
  - [ ] Migration generated: `npx drizzle-kit generate`
  - [ ] Migration applies cleanly: `npx drizzle-kit push`

### Change A.3: Backfill migration script

- **File:** `drizzle/backfill-v2.sql` (NEW)
- **Action:** CREATE
- **Complexity:** LOW

```sql
-- Backfill new columns for existing trades
UPDATE trades SET
  gross_pnl = pnl + COALESCE(commission, 0) + COALESCE(fees, 0),
  net_pnl = pnl,
  entry_time = '',
  exit_time = ''
WHERE gross_pnl IS NULL OR gross_pnl = 0;
```

Existing trades will have empty `rawExecutions` (no historical fill data to recover). MFE/MAE stays null until recalculated.

- **Acceptance Criteria:**
  - [ ] Script is idempotent (safe to run multiple times)
  - [ ] Existing trades retain correct `pnl` value
  - [ ] `gross_pnl = pnl + commission + fees` for all backfilled rows

### Change A.4: Create DAS Trader parser

- **File:** `lib/parsers/das-trader.ts` (NEW)
- **Action:** CREATE
- **Complexity:** HIGH
- **Dependencies:** A.1

DAS Trader CSV format:
```
Time,Symbol,Qty,Price,Side,Route,Account,Type,
```

Implementation requirements:

**Detection logic:**
```typescript
detect: (headers) => {
  const upper = headers.map(h => h.toUpperCase().trim()).filter(h => h !== '');
  return upper.includes('ROUTE') && upper.includes('ACCOUNT') && upper.includes('TYPE');
}
```

**Context-aware side resolution (two-pass):**
- First pass: scan ALL rows to build a set of symbols that have `SS` executions
- Second pass: normalize each row:
  - `SS` → short entry (always)
  - `S` → long exit (always)
  - `B` + symbol has SS in file → short exit (buy to cover)
  - `B` + symbol has NO SS in file → long entry

**Row normalization:**
```typescript
normalizeRow: (row, rowIndex, context) => {
  // context.shortSymbols: Set<string> built during first pass
  const side = String(row['Side'] ?? '').toUpperCase().trim();
  const symbol = String(row['Symbol'] ?? '').toUpperCase().trim();
  const qty = Math.abs(parseFloat(String(row['Qty'] ?? '0')));
  const price = parseFloat(String(row['Price'] ?? '0'));
  const time = String(row['Time'] ?? '');

  if (!symbol || qty === 0 || price === 0) return null;

  let normalizedSide: 'SS' | 'B' | 'MARGIN' | 'S';
  if (side === 'SS') normalizedSide = 'SS';
  else if (side === 'S') normalizedSide = 'S';
  else if (side === 'B') {
    normalizedSide = context.shortSymbols.has(symbol) ? 'B' : 'MARGIN';
  } else return null;

  return {
    symbol, side: normalizedSide, qty, price, time,
    commission: 0,  // DAS does not include commission in CSV
    fees: 0,        // DAS does not include fees in CSV
  };
}
```

**Critical: DAS CSVs have no commission/fee columns.** Commission and fees must be entered manually per-trade or set via a default-commission setting (future feature). The parser returns 0 for both.

**Trailing comma handling:** Filter empty-string keys during header parsing:
```typescript
const cleanHeaders = headers.filter(h => h.trim() !== '');
```

- **Acceptance Criteria:**
  - [ ] `dasTraderParser` exported and registered in `lib/parsers/index.ts`
  - [ ] Detects DAS format via `Route` + `Account` + `Type` headers
  - [ ] `SS` always maps to short entry
  - [ ] `B` maps to cover when symbol has SS rows, long entry otherwise
  - [ ] `S` always maps to long exit
  - [ ] `Type` column is ignored (not mapped to Side)
  - [ ] Empty header keys from trailing commas are skipped
  - [ ] Commission and fees default to 0

### Change A.5: Update `BrokerParserConfig` interface for two-pass context

- **File:** `lib/parsers/types.ts`
- **Action:** MODIFY
- **Complexity:** LOW
- **Dependencies:** A.4

Add optional context parameter and pre-scan hook:

```typescript
export interface BrokerParserConfig {
  id: string;
  name: string;
  detect: (headers: string[], rows: Record<string, unknown>[]) => boolean;
  extractDate?: (filename: string, rows: Record<string, unknown>[]) => { date: Date; sortKey: string } | null;

  // NEW: pre-scan all rows to build context (e.g., which symbols have SS)
  buildContext?: (rows: Record<string, unknown>[]) => Record<string, unknown>;

  // MODIFIED: accepts context from buildContext
  normalizeRow: (row: Record<string, unknown>, rowIndex: number, context?: Record<string, unknown>) => NormalizedExecution | null;
}
```

- **Acceptance Criteria:**
  - [ ] `buildContext` is optional (existing parsers unaffected)
  - [ ] `normalizeRow` signature accepts optional `context` parameter
  - [ ] Existing parsers continue to work without changes

### Change A.6: Update `processCsvData` — time sorting + execution preservation

- **File:** `lib/csv-parser.ts`
- **Action:** MODIFY
- **Complexity:** HIGH
- **Dependencies:** A.1, A.4, A.5

Three changes:

**1. Sort executions by time before FIFO matching:**
```typescript
// After bucketing into symbolMap, before matching loop:
for (const sym of Object.keys(symbolMap)) {
  symbolMap[sym].shortEntry.sort((a, b) => a.time.localeCompare(b.time));
  symbolMap[sym].shortExit.sort((a, b) => a.time.localeCompare(b.time));
  symbolMap[sym].longEntry.sort((a, b) => a.time.localeCompare(b.time));
  symbolMap[sym].longExit.sort((a, b) => a.time.localeCompare(b.time));
}
```

**2. Preserve execution data in matched pairs:**

Extend the internal `MatchedPair` to carry the original `RawExecution` for both entry and exit. When building the merged `Trade`, accumulate `rawExecutions: Execution[]` from all pairs.

**3. Compute `grossPnl`, `netPnl`, `entryTime`, `exitTime`:**
```typescript
trade.grossPnl = trade.rawExecutions.reduce(/* sum price*qty deltas */);
trade.netPnl = trade.grossPnl - trade.commission - trade.fees;
trade.entryTime = trade.rawExecutions.filter(e => e.side === 'ENTRY')
  .sort((a,b) => a.time.localeCompare(b.time))[0]?.time ?? '';
trade.exitTime = trade.rawExecutions.filter(e => e.side === 'EXIT')
  .sort((a,b) => b.time.localeCompare(a.time))[0]?.time ?? '';
```

**4. Remove `TYPE` from `COLUMN_ALIASES`:**

Delete the line `TYPE: 'Side'` from the alias map. This prevents DAS `Type` column from overwriting `Side` even when the built-in parser path is used.

**5. Consolidate same-timestamp/same-price fills (optional optimization):**

After building `rawExecutions`, merge fills that share the same `time` + `price` + `side`:
```typescript
// 8 fills of USEG @ 1.64 at 08:22:50 → 1 fill of 3900 @ 1.64
```

- **Acceptance Criteria:**
  - [ ] Executions sorted by time before FIFO matching
  - [ ] `Trade.rawExecutions` populated with all individual fills
  - [ ] `Trade.grossPnl` = raw price delta * qty (no commissions)
  - [ ] `Trade.netPnl` = grossPnl - commission - fees
  - [ ] `Trade.entryTime` = earliest entry fill time
  - [ ] `Trade.exitTime` = latest exit fill time
  - [ ] `TYPE` removed from `COLUMN_ALIASES`
  - [ ] Consolidated fills reduce duplicate same-time/same-price records
  - [ ] Existing non-DAS parser tests still pass

### Change A.7: Update API routes and storage layer

- **Files:** `app/api/trades/import/route.ts`, `app/api/trades/route.ts`, `app/api/trades/[id]/route.ts`, `lib/server-db-utils.ts`
- **Action:** MODIFY
- **Complexity:** MEDIUM
- **Dependencies:** A.1, A.2

Updates:
- Import route: accept and store `rawExecutions` in `trade_executions` table within same transaction as trade upsert
- GET `/api/trades/[id]`: join `trade_executions` and return `rawExecutions` array
- GET `/api/trades` (list): do NOT join executions (performance) — return `executionCount` only
- `toTrade` helper in `server-db-utils.ts`: map new columns (`grossPnl`, `netPnl`, `entryTime`, `exitTime`, `mfe`, `mae`, `bestExitPnl`, `exitEfficiency`)
- Bulk operations route: handle `executionCount` rename

- **Acceptance Criteria:**
  - [ ] Import creates `trade_executions` rows in same DB transaction
  - [ ] Single-trade GET returns full `rawExecutions` array
  - [ ] Trade list GET does not query `trade_executions` table
  - [ ] All routes use `execution_count` column name
  - [ ] `toTrade` maps all new fields

### Change A.8: Update `use-trades.ts` hook

- **File:** `hooks/use-trades.ts`
- **Action:** MODIFY
- **Complexity:** MEDIUM
- **Dependencies:** A.6, A.7

Updates:
- `handleImport`: pass execution data through to import API
- Add `fetchTradeDetail(tradeId)` for lazy-loading executions on detail view open
- `fromApiTrade` / `toApiTrade`: handle new fields and `executionCount` rename
- localStorage fallback: store `rawExecutions` inline on trade object (small enough to serialize)

- **Acceptance Criteria:**
  - [ ] Import flow sends execution data to API
  - [ ] `fetchTradeDetail` returns trade with `rawExecutions`
  - [ ] localStorage adapter stores/retrieves executions
  - [ ] `executionCount` used everywhere (no references to old `executions` field)

### Change A.9: Update all components referencing `trade.executions`

- **Files:** All components referencing `trade.executions` (TradeTable, TradeDetailSheet, PerformanceCharts, SettingsMenu, NewTradeDialog, etc.)
- **Action:** MODIFY
- **Complexity:** LOW
- **Dependencies:** A.1

Global find-and-replace: `trade.executions` → `trade.executionCount` (only where it was used as the integer count). Grep for `.executions` across all `.ts` and `.tsx` files.

- **Acceptance Criteria:**
  - [ ] Zero references to `trade.executions` as integer (all → `trade.executionCount`)
  - [ ] `trade.rawExecutions` only used where execution array is needed
  - [ ] `tsc --noEmit` passes
  - [ ] `npm run lint` passes

### Change A.10: Update and add tests

- **File:** `__tests__/csv-parser.test.ts`, `__tests__/das-trader-parser.test.ts` (NEW)
- **Action:** MODIFY + CREATE
- **Complexity:** MEDIUM
- **Dependencies:** A.4, A.6

Update existing tests:
- All `expect(trade.executions)` → `expect(trade.executionCount)`
- Add assertions for `trade.rawExecutions.length`
- Add assertions for `trade.grossPnl` and `trade.netPnl`
- Add assertions for `trade.entryTime` and `trade.exitTime`

New DAS Trader test file covering:
- DAS header detection (with trailing comma)
- `SS` → short entry mapping
- `B` → context-aware resolution (cover vs long entry)
- `S` → long exit mapping
- `Type` column ignored
- Reverse-chronological input sorted correctly before matching
- Actual DAS sample data from user (the USEG short trades + SNDK long trade)
- Fill consolidation (8 fills → 1 consolidated)
- `rawExecutions` preserved through full pipeline

Sample test for the USEG short trades:
```typescript
it('parses DAS short trade with reverse-chronological fills', () => {
  const rows = [
    { Time: '15:22:31', Symbol: 'USEG', Qty: '2380', Price: '1.2', Side: 'B', Route: 'INET', Account: '2LD16758', Type: 'Margin' },
    { Time: '09:30:00', Symbol: 'USEG', Qty: '2380', Price: '1.5', Side: 'SS', Route: 'INET', Account: '2LD16758', Type: 'Short' },
    { Time: '08:22:50', Symbol: 'USEG', Qty: '31', Price: '1.64', Side: 'B', Route: 'INET', Account: '2LD16758', Type: 'Margin' },
    { Time: '08:22:50', Symbol: 'USEG', Qty: '500', Price: '1.64', Side: 'B', Route: 'INET', Account: '2LD16758', Type: 'Margin' },
    // ... remaining 6 fills at 08:22:50 ...
    { Time: '08:22:50', Symbol: 'USEG', Qty: '180', Price: '1.64', Side: 'B', Route: 'INET', Account: '2LD16758', Type: 'Margin' },
    { Time: '07:25:23', Symbol: 'USEG', Qty: '3900', Price: '1.53', Side: 'SS', Route: 'INET', Account: '2LD16758', Type: 'Short' },
  ];

  const dateInfo = { date: new Date('2026-03-02'), sortKey: '2026-03-02' };
  const result = processCsvData(rows, dateInfo, 'das-trader');

  expect(result.trades).toHaveLength(2);
  expect(result.warnings).toHaveLength(0);

  // Trade 1 (chronological): Short 3900 @ 1.53, cover 3900 @ 1.64 → loss
  const trade1 = result.trades.find(t => t.totalQuantity === 3900);
  expect(trade1.direction).toBe('SHORT');
  expect(trade1.avgEntryPrice).toBeCloseTo(1.53);
  expect(trade1.avgExitPrice).toBeCloseTo(1.64);
  expect(trade1.grossPnl).toBeCloseTo((1.53 - 1.64) * 3900);  // -429
  expect(trade1.entryTime).toBe('07:25:23');
  expect(trade1.exitTime).toBe('08:22:50');

  // Trade 2 (chronological): Short 2380 @ 1.50, cover 2380 @ 1.20 → win
  const trade2 = result.trades.find(t => t.totalQuantity === 2380);
  expect(trade2.direction).toBe('SHORT');
  expect(trade2.avgEntryPrice).toBeCloseTo(1.50);
  expect(trade2.avgExitPrice).toBeCloseTo(1.20);
  expect(trade2.grossPnl).toBeCloseTo((1.50 - 1.20) * 2380);  // +714
  expect(trade2.entryTime).toBe('09:30:00');
  expect(trade2.exitTime).toBe('15:22:31');
});
```

- **Acceptance Criteria:**
  - [ ] All existing csv-parser tests updated and passing
  - [ ] New DAS parser test file with 8+ test cases
  - [ ] USEG short trade sample produces 2 correct trades
  - [ ] SNDK long trade sample produces 1 correct trade
  - [ ] `npm test` passes with zero failures

---

## Workstream B: Candlestick Charts (TradingView lightweight-charts)

> **Can start in parallel with Workstream A** as soon as Change A.1 (types) is complete. Chart rendering does not depend on the parser fix.

### Change B.1: Create `useCandleData` hook

- **File:** `hooks/use-candle-data.ts` (NEW)
- **Action:** CREATE
- **Complexity:** LOW

```typescript
export function useCandleData(symbol: string | null, options?: {
  periodType?: string;
  frequencyType?: string;
  frequency?: string;
  startDate?: string;
  endDate?: string;
}): { candles: CandleData[]; isLoading: boolean; error: string | null }
```

Fetches from `/api/schwab/market-data`. Skips fetch when `symbol` is null. Caches responses in a `useRef` map keyed by `${symbol}|${periodType}|${frequencyType}|${frequency}` to avoid duplicate requests during re-renders.

- **Acceptance Criteria:**
  - [ ] Returns `CandleData[]` matching existing `CandleData` interface in `CandlestickChart.tsx`
  - [ ] Does not fetch when symbol is null
  - [ ] Shows loading state
  - [ ] Handles 401 (Schwab not connected), 429 (rate limit), 404 (unknown symbol)

### Change B.2: Wire chart into TradeDetailSheet

- **File:** `components/trading/TradeDetailSheet.tsx`
- **Action:** MODIFY
- **Complexity:** MEDIUM
- **Dependencies:** A.1, B.1

When a trade is opened:
1. Call `useCandleData` with trade symbol, `periodType=day`, `frequencyType=minute`, `frequency=5`, `startDate` and `endDate` as epoch ms of trade date market open (09:30 ET) to market close (16:00 ET)
2. Convert `rawExecutions` to `TradeMarker[]` array
3. Render `CandlestickChart` with candles + markers + default indicators

Add a timeframe selector: 1m, 5m, 15m, Daily.

- **Acceptance Criteria:**
  - [ ] Chart renders when trade detail sheet opens
  - [ ] Entry markers shown as green up arrows at correct times
  - [ ] Exit markers shown as red down arrows at correct times
  - [ ] Timeframe selector changes candle granularity
  - [ ] Loading spinner while candles fetch
  - [ ] Graceful message if Schwab not connected

### Change B.3: Fix chart resize and cleanup

- **File:** `components/trading/CandlestickChart.tsx`
- **Action:** MODIFY
- **Complexity:** LOW

The existing component has a resize observer and cleanup in the useEffect return. Verify that:
- Chart properly disposes when trade detail sheet closes
- No memory leak from multiple open/close cycles
- Volume histogram renders below candles (already configured with `scaleMargins: { top: 0.8, bottom: 0 }`)

- **Acceptance Criteria:**
  - [ ] No console errors on sheet open/close cycle
  - [ ] Chart resizes correctly in sheet panel width
  - [ ] Volume renders in bottom 20% of chart area

---

## Workstream C: MFE / MAE Calculation

> **Depends on both Workstream A (execution times) and Workstream B (candle data hook).**

### Change C.1: Create `lib/mfe-mae.ts`

- **File:** `lib/mfe-mae.ts` (NEW)
- **Action:** CREATE
- **Complexity:** MEDIUM

```typescript
export interface MfeMaeResult {
  mfe: number;               // max favorable excursion in $
  mae: number;               // max adverse excursion in $
  bestExitPnl: number;       // gross PnL at MFE point minus estimated costs
  exitEfficiency: number;    // netPnl / mfe, clamped 0–1, 0 if mfe <= 0
}

export function calculateMfeMae(
  direction: Direction,
  avgEntryPrice: number,
  totalQuantity: number,
  entryTime: string,         // HH:mm:ss
  exitTime: string,          // HH:mm:ss
  commission: number,
  fees: number,
  netPnl: number,
  candles: CandleData[],     // 1-min or 5-min candles covering trade window
): MfeMaeResult | null       // null if candles don't cover the window
```

Logic:
- Filter candles to window `[entryTime, exitTime]`
- LONG: MFE = `(maxHigh - entry) * qty`, MAE = `(entry - minLow) * qty`
- SHORT: MFE = `(entry - minLow) * qty`, MAE = `(maxHigh - entry) * qty`
- bestExitPnl = MFE - commission - fees
- exitEfficiency = `netPnl > 0 && mfe > 0 ? netPnl / mfe : 0`
- Return null if no candles match the time window

- **Acceptance Criteria:**
  - [ ] LONG and SHORT calculations correct
  - [ ] Returns null when candle window is empty
  - [ ] exitEfficiency clamped to 0–1 range
  - [ ] Unit tests with known candle data produce expected values

### Change C.2: Batch MFE/MAE on import

- **File:** `hooks/use-trades.ts` (or new `lib/mfe-mae-batch.ts`)
- **Action:** MODIFY
- **Complexity:** HIGH
- **Dependencies:** A.8, B.1, C.1

After CSV import saves trades:
1. Group trades by `(sortKey, symbol)` — trades on same day + symbol share candle data
2. For each group, fetch 1-min candles from Schwab API with 200ms delay between calls
3. Call `calculateMfeMae` for each trade
4. Batch-update trades with computed values
5. Show progress toast: "Computing MFE/MAE... 3/12 trades"

**Schwab limitation:** Minute data only available for recent ~30 days. For older trades, skip and set `mfe = null`.

- **Acceptance Criteria:**
  - [ ] MFE/MAE computed for all trades within Schwab's data window
  - [ ] Rate limiting: max 1 Schwab request per 200ms
  - [ ] Progress indicator during batch computation
  - [ ] Older trades gracefully marked as unavailable
  - [ ] Partial failure does not block remaining trades

### Change C.3: Manual recalculation action

- **File:** `components/trading/TradeDetailSheet.tsx`, `components/trading/TradeTable.tsx`
- **Action:** MODIFY
- **Complexity:** LOW
- **Dependencies:** C.1, C.2

Add "Recalculate MFE/MAE" button to:
- Trade detail sheet (single trade)
- Bulk operations bar (multi-select in trade table)

- **Acceptance Criteria:**
  - [ ] Button visible on trade detail when MFE is null
  - [ ] Bulk recalculate available for selected trades
  - [ ] Toast on success/failure

---

## Workstream D: UI/UX Overhaul

> **Depends on Workstreams A, B, and C.** Can begin layout work (D.1) once A.1 types are finalized, but full wiring requires all workstreams complete.

### Change D.1: Redesign TradeDetailSheet with tabs

- **File:** `components/trading/TradeDetailSheet.tsx`
- **Action:** MODIFY (major rewrite)
- **Complexity:** HIGH
- **Dependencies:** A.1, B.2, C.3

Replace flat metric grid with tabbed layout:

**Tab 1 — Overview:**
Metric grid (2-column) showing: Shares Traded, Closed Gross PnL, Gross Return (R), Commissions/Fees, Closed Net PnL, Net Return (R), Position MFE, Price MFE, Position MAE, Price MAE, Best Exit PnL, Exit Efficiency. Direction badge. Initial Risk display.

**Tab 2 — Chart:**
Full-width `CandlestickChart` with trade markers. Timeframe selector. Indicator toggles. Pre/post market toggle.

**Tab 3 — Executions:**
Table: Time | Side | Qty | Price | Commission | Fees | Running PnL. Sortable by time.

**Tab 4 — Notes:**
Existing textarea + template insertion.

- **Acceptance Criteria:**
  - [ ] 4 tabs render with correct content
  - [ ] All Trade fields displayed (including new MFE/MAE/efficiency fields)
  - [ ] "Not yet calculated" shown for null MFE/MAE
  - [ ] Executions table renders all `rawExecutions`
  - [ ] Tab state persists while sheet is open
  - [ ] Mobile responsive (tabs stack or scroll)

### Change D.2: Journal page day-card layout

- **File:** `components/trading/JournalTab.tsx` (or equivalent)
- **Action:** MODIFY
- **Complexity:** MEDIUM

Redesign to match TradeVue's day-card pattern:
- Date header with right-aligned daily PnL (colored)
- Mini sparkline for daily cumulative PnL
- Summary row: Total Trades, Win %, Commissions, MFE/MAE Ratio, Net PnL
- Expandable trade table per day

- **Acceptance Criteria:**
  - [ ] Each day renders as a card
  - [ ] Daily PnL is color-coded (green/red)
  - [ ] Trade table expands on click
  - [ ] Sorted by date descending

### Change D.3: Dashboard KPI additions

- **File:** `components/trading/DashboardTab.tsx`
- **Action:** MODIFY
- **Complexity:** LOW
- **Dependencies:** A.1

Add cards:
- Average MFE / Average MAE
- Average Exit Efficiency %
- Gross vs Net PnL toggle
- Largest Win / Largest Loss (with symbol)

- **Acceptance Criteria:**
  - [ ] New KPI cards render with correct values
  - [ ] Gross/Net toggle switches all PnL displays
  - [ ] Cards show "-" when no data available

### Change D.4: Reports tab — Win vs Loss Days, Drawdown, Tag Breakdown

- **File:** `components/trading/PerformanceCharts.tsx` or new sub-components
- **Action:** MODIFY
- **Complexity:** MEDIUM

Add chart panels:
- Win vs Loss Days: bar chart by week/month
- Drawdown: equity curve with shaded drawdown area (Recharts AreaChart)
- Tag Breakdown: PnL grouped by tag (data from `tradeTags`)

- **Acceptance Criteria:**
  - [ ] Three new chart panels render
  - [ ] Drawdown shading starts at peak equity
  - [ ] Tag breakdown handles trades with multiple tags (count PnL once per tag)

---

## Files Modified Summary

| File | Action | Workstream | Risk |
|------|--------|------------|------|
| `lib/types.ts` | MODIFY | A.1 | HIGH — breaking rename |
| `lib/db/schema.ts` | MODIFY | A.2 | HIGH — migration |
| `drizzle/backfill-v2.sql` | CREATE | A.3 | LOW |
| `lib/parsers/das-trader.ts` | CREATE | A.4 | MEDIUM |
| `lib/parsers/types.ts` | MODIFY | A.5 | LOW |
| `lib/parsers/index.ts` | MODIFY | A.4 | LOW |
| `lib/csv-parser.ts` | MODIFY | A.6 | HIGH — core logic |
| `app/api/trades/import/route.ts` | MODIFY | A.7 | MEDIUM |
| `app/api/trades/route.ts` | MODIFY | A.7 | LOW |
| `app/api/trades/[id]/route.ts` | MODIFY | A.7 | MEDIUM |
| `app/api/trades/bulk/route.ts` | MODIFY | A.7 | LOW |
| `lib/server-db-utils.ts` | MODIFY | A.7 | MEDIUM |
| `hooks/use-trades.ts` | MODIFY | A.8 | HIGH |
| `components/trading/TradeTable.tsx` | MODIFY | A.9 | LOW |
| `components/trading/TradeDetailSheet.tsx` | MODIFY | A.9, B.2, D.1 | HIGH |
| `components/trading/PerformanceCharts.tsx` | MODIFY | A.9, D.4 | MEDIUM |
| `components/trading/NewTradeDialog.tsx` | MODIFY | A.9 | LOW |
| `components/trading/SettingsMenu.tsx` | MODIFY | A.9 | LOW |
| `components/trading/TradingCalendar.tsx` | MODIFY | A.9 | LOW |
| `__tests__/csv-parser.test.ts` | MODIFY | A.10 | MEDIUM |
| `__tests__/das-trader-parser.test.ts` | CREATE | A.10 | — |
| `hooks/use-candle-data.ts` | CREATE | B.1 | — |
| `components/trading/CandlestickChart.tsx` | MODIFY | B.3 | LOW |
| `lib/mfe-mae.ts` | CREATE | C.1 | — |
| `components/trading/DashboardTab.tsx` | MODIFY | D.3 | LOW |

---

## Order of Operations for Codex

```
1.  A.1  — Extend lib/types.ts (Execution interface, Trade fields, rename)
2.  A.2  — Extend lib/db/schema.ts (trade_executions table, new columns)
3.  A.3  — Create backfill migration SQL
4.  A.5  — Update BrokerParserConfig interface (buildContext)
5.  A.4  — Create lib/parsers/das-trader.ts
6.  A.6  — Update lib/csv-parser.ts (sort, preserve executions, remove TYPE alias)
7.  A.9  — Global rename: trade.executions → trade.executionCount
8.  A.7  — Update API routes and server-db-utils
9.  A.8  — Update use-trades.ts hook
10. A.10 — Update and add tests
11. B.1  — Create useCandleData hook
12. B.2  — Wire chart into TradeDetailSheet
13. B.3  — Chart resize/cleanup verification
14. C.1  — Create lib/mfe-mae.ts
15. C.2  — Batch MFE/MAE on import
16. C.3  — Manual recalculation button
17. D.1  — TradeDetailSheet tabbed redesign
18. D.2  — Journal day-card layout
19. D.3  — Dashboard KPI additions
20. D.4  — Reports tab new panels
```

**Validation gate after step 10:**
```bash
npm run lint
npx tsc --noEmit
npm test
```
All must pass before proceeding to Workstream B.

**Validation gate after step 16:**
```bash
npm run lint
npx tsc --noEmit
npm test
```
All must pass before proceeding to Workstream D.

---

## Security Considerations

- `trade_executions` table uses `userId` FK — all queries must be tenant-scoped
- DAS `Account` column contains broker account IDs — do NOT store in DB or logs
- Schwab API rate limiting: enforce 200ms minimum between calls during batch MFE/MAE
- No new environment variables required
- No new auth flows required
- Backfill SQL must be run by authenticated admin, not exposed as API endpoint

## Rollback Plan

1. Schema migration: keep old `executions` integer column alongside new `execution_count` for one release cycle
2. Parser: DAS parser is additive (new file) — rollback = remove from parser registry
3. Types: if `executionCount` rename causes too many breakages, keep `executions` as deprecated alias
4. MFE/MAE: all fields nullable — incomplete computation is safe

---

## DAS Trader CSV Reference (from user samples)

**Headers:**
```
Time,Symbol,Qty,Price,Side,Route,Account,Type,
```
Note trailing comma creating phantom empty column.

**Side values observed:**
- `B` — buy (long entry OR short cover, context-dependent)
- `S` — sell (long exit)
- `SS` — short sell (short entry)

**Type values observed:**
- `Margin` — appears on both buys and sells
- `Short` — appears on short sells

**Missing from DAS exports:**
- Commission (not included)
- Fees (not included)
- Date (derived from filename, pattern MM-DD-YY)

**Data ordering:**
- Rows arrive in REVERSE chronological order (most recent first)
- Multiple partial fills can share the same timestamp
