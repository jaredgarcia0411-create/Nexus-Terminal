# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-18
> Purpose: active execution spec for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

## Current Context

- Completed spec below: **Multi-Day & Overnight Position Support — Phase 2**. Phase 2 wires `lib/position-matcher.ts` (built in Phase 1) into a new server-side import route, switches CSV uploads to that route, and extends the matcher to consume pre-existing open positions for true cross-day matching. Partial-close UX on the TradeDetailSheet button remains out of scope (deferred).
- Validation completed 2026-05-18: `npm run lint`, `npx tsc --noEmit`, and `npm test` all passed. `npm test` reported 94 files / 691 tests passing.
- Just shipped: **Multi-Day & Overnight Position Support — Phase 1** at commit `62a641107` (2026-05-18). Schema/migration `0038`, server matcher (built, tests only), close/merge/open-position UI, open/closed filter chip, closed-only stats and journal aggregation. Validation: lint, types, `db:migrate`, and 685 tests across 94 files all passed.
- Older shipped work: Collaborative Sample-Set Building (`b3bd170`, `d512db9`, `dfe35b4`, `cc33025`).
- Open parked items unrelated to active work: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, Backtest Manager `broke_premarket_high`.

## Active Execution Spec

## Multi-Day & Overnight Position Support — Phase 2

> Generated: 2026-05-18 | Agent: claude (plan)
> Status: COMPLETED — validated and locally committed by Codex on 2026-05-18

### Summary

Phase 1 created `lib/position-matcher.ts` with same-day FIFO matching and unit tests, but no caller. Phase 2:

1. Extends the matcher to accept pre-existing open positions, FIFO-match new exits against them across days, and emit per-open-position closing instructions (full or partial).
2. Builds the deferred Phase 1 Step 8 endpoint: `app/api/trades/import-raw/route.ts`. The route accepts raw broker executions for ONE day at a time, loads the user's open positions for the affected symbols, runs the matcher, and persists results in a transaction.
3. Adds `extractRawExecutions` in `lib/csv-parser.ts` (the row-normalization step alone, without FIFO matching) and `collectRawExecutions` in `lib/trade-utils.ts` (the file-walking wrapper).
4. Switches the CSV folder/file import path in `hooks/use-trades.ts` `processImportFiles` to use the new helper + endpoint. The TraderVue path is unchanged (TraderVue CSVs ship already-aggregated trade rows; they do not go through the matcher).
5. Extends `__tests__/position-matcher.test.ts` with cross-day cases.

**Out of scope (later sprints):**
- Partial-close UX in the Close Position button (still full-close only — Phase 1's behavior). Note: partial closes happening *via CSV import* are handled by the matcher in this phase, since real-world CSV data produces them. The UI button stays full-close-only.
- `realized_segments` JSONB column.
- `closedAt`-based PnL bucketing for journal/calendar (multi-day spans still render against `date`, the entry day, in Phase 2).
- Calendar/journal multi-day span views.
- Auto stop-out and other unrelated items.

### Scope

**In scope (files touched):**
- `lib/position-matcher.ts` — extend types and `matchExecutions`
- `lib/validations/trades.ts` — add `importRawSchema`
- `lib/csv-parser.ts` — add `extractRawExecutions` export
- `lib/trade-utils.ts` — add `collectRawExecutions` helper
- `app/api/trades/import-raw/route.ts` — CREATE
- `hooks/use-trades.ts` — switch `processImportFiles` to new endpoint
- `__tests__/position-matcher.test.ts` — extend with cross-day tests

**Not touched in Phase 2:**
- Schema (`is_open`, `closed_at`, `remaining_qty` already shipped in Phase 1 migration `0038`)
- `app/api/trades/import/route.ts` (kept as-is — still used by the TraderVue import path)
- `app/api/trades/route.ts`, `app/api/trades/[id]/route.ts`, `app/api/trades/merge/route.ts`
- All UI components

---

### Design decisions baked into this spec

These choices are non-obvious and worth understanding before reading the steps:

1. **One CSV file = one API call, serialized.** Today `processImportFiles` batches client-side matched trades into 200-row POST chunks. The new path uploads one day's raw executions per call and processes them sequentially. This is slower but correct: each call needs to see DB state after prior calls (so Tuesday's CSV can match against the open position created by Monday's CSV).

2. **The matcher handles partial closes from CSV.** Day 1 BUY 100 → Day 2 SELL 50 is real. The matcher emits a `ClosingFill` with `matchedQty: 50`. The route inserts a new closed trade for the 50-share realized portion AND updates the open position's `totalQuantity` and `remainingQty` to 50.

3. **Fully-closed open positions are UPDATED, not deleted.** When `matchedQty === open.totalQuantity`, the matcher emits one `ClosingFill` and the route updates that row to `isOpen=false`, sets exit fields, and recomputes PnL. The trade ID does not change. Existing `trade_executions` for the open position stay; the closing executions are APPENDED to that same trade.

4. **Newly-opened positions get auto-created.** Phase 1's matcher emitted a warning for unmatched entries ("position may still be open — use the checkbox"). Phase 2 changes that behavior: unmatched same-day entries become `isOpen=true` trade rows automatically. The "Open position" checkbox in `NewTradeDialog` stays for manual entry but isn't required for CSV uploads.

5. **Trade ID conventions:**
   - Same-day closed: `${sortKey}|${symbol}|${direction}` (matches current convention; allows re-import upsert).
   - Newly-opened: `${sortKey}|${symbol}|${direction}|${HHMMSS}-${hex4}` (matches `NewTradeDialog` convention).
   - Partial-close realized row: `${exitSortKey}|${symbol}|${direction}|p-${hex4}` (new — `p-` prefix differentiates from same-day).
   - Full-close updates: no new ID, updates the existing open position.

6. **Idempotency via `batchKey`.** The new route accepts an optional `batchKey` like `/api/trades/import` does. Re-uploading the same CSV with the same batchKey is a no-op. Without a batchKey, re-uploads can produce duplicates on `newOpenPositions` (their IDs include random suffixes). The client always sends a batchKey derived from filename + content hash.

7. **`processCsvData` and `collectImportedTrades` become production-dead but stay alive.** The csv-parser tests (`__tests__/csv-parser.test.ts`, `__tests__/das-trader-parser.test.ts`) still exercise `processCsvData`. We leave the function in place — deleting it would require rewriting ~15 tests. Codex must NOT delete `processCsvData` or `collectImportedTrades`. A future cleanup sprint can prune them.

---

### Implementation Steps

---

#### Step 1: Extend `lib/position-matcher.ts` — accept open positions, return closing fills

**File:** `lib/position-matcher.ts`
**Action:** MODIFY

**Goal:** `matchExecutions` accepts an optional second argument `openPositions: OpenPositionInput[]`. When provided, the matcher FIFO-consumes those open positions with new exit executions before pairing same-day entries with exits. Unmatched same-day entries become `newOpenPositions` (no longer warnings).

**Instructions:**

1. **Add new exported types** at the top of the file, after the existing `MatchedTrade` interface (currently line 13-25):

```ts
export interface OpenPositionInput {
  /** trade.id of the existing open position in the DB. */
  id: string;
  symbol: string;
  direction: Direction;
  /** Outstanding share count on this open position. */
  totalQuantity: number;
  avgEntryPrice: number;
  entryTime: string;
  /** Used for FIFO ordering across days. */
  entryDate: Date;
  /** Total entry-side commission/fees already booked on this open position. */
  commission: number;
  fees: number;
}

export interface ClosingFill {
  /** The open position being (fully or partially) closed. */
  openPositionId: string;
  /** Symbol/direction copied through so the route can route the update. */
  symbol: string;
  direction: Direction;
  /** Weighted average of the closing executions' prices. */
  exitPrice: number;
  /** Latest closing execution time. */
  exitTime: string;
  /** Shares consumed from the open position. May be < open.totalQuantity (partial close). */
  matchedQty: number;
  /** PnL on the matched portion. */
  grossPnl: number;
  netPnl: number;
  /** Proportional split of the open position's entry-side commission/fees,
   *  scaled by matchedQty / open.totalQuantity. */
  entryCommissionAllocated: number;
  entryFeesAllocated: number;
  /** Sum of commission/fees on the consumed exit executions. */
  exitCommission: number;
  exitFees: number;
  /** Raw exit executions consumed (for trade_executions append). */
  exitExecutions: MatcherExecution[];
}
```

2. **Add an `isOpen` flag to `MatchedTrade`** so the route can tell apart same-day closed vs newly-opened positions. After `fees: number;` in `MatchedTrade` (currently line 24):

```ts
  /** True when this trade was produced from unmatched entries with no closing exit. */
  isOpen?: boolean;
  /** When true, equals totalQuantity. Helps the route persist remainingQty. */
  remainingQty?: number;
```

3. **Extend `MatcherResult`** (currently line 27-30):

```ts
export interface MatcherResult {
  /** Same-day matched closed trades. Each has isOpen omitted/false. */
  trades: MatchedTrade[];
  /** Unmatched same-day entries — to be persisted as isOpen=true rows. */
  newOpenPositions: MatchedTrade[];
  /** Updates to existing open positions (full or partial closes). */
  closingFills: ClosingFill[];
  warnings: string[];
}
```

4. **Replace `matchExecutions`** (currently line 152-183). The new implementation has THREE phases per (symbol, direction):
   - PASS A: consume new exits against open positions FIFO. Each open position is closed fully or partially.
   - PASS B: FIFO-match same-day entries vs remaining same-day exits (the existing Phase 1 logic).
   - PASS C: any leftover entries become `newOpenPositions`; any leftover exits become warnings.

The new signature:

```ts
export function matchExecutions(
  executions: MatcherExecution[],
  openPositions: OpenPositionInput[] = [],
): MatcherResult {
  const warnings: string[] = [];
  const trades: MatchedTrade[] = [];
  const newOpenPositions: MatchedTrade[] = [];
  const closingFills: ClosingFill[] = [];

  // Bucket executions by symbol + side (existing behavior).
  const longEntries: Record<string, RawBucket[]> = {};
  const longExits: Record<string, RawBucket[]> = {};
  const shortEntries: Record<string, RawBucket[]> = {};
  const shortExits: Record<string, RawBucket[]> = {};

  for (const exec of executions) {
    const { symbol, side, qty, price, time, commission, fees } = exec;
    const bucket: RawBucket = { qty, price, time, commission: commission ?? 0, fees: fees ?? 0 };
    if (side === 'LONG_ENTRY') (longEntries[symbol] ??= []).push(bucket);
    else if (side === 'LONG_EXIT') (longExits[symbol] ??= []).push(bucket);
    else if (side === 'SHORT_ENTRY') (shortEntries[symbol] ??= []).push(bucket);
    else if (side === 'SHORT_EXIT') (shortExits[symbol] ??= []).push(bucket);
  }

  // Bucket open positions by symbol + direction, FIFO by (entryDate, entryTime).
  const longOpen: Record<string, OpenPositionInput[]> = {};
  const shortOpen: Record<string, OpenPositionInput[]> = {};
  for (const op of openPositions) {
    if (op.direction === 'LONG') (longOpen[op.symbol] ??= []).push(op);
    else (shortOpen[op.symbol] ??= []).push(op);
  }
  const sortFifo = (list: OpenPositionInput[]) =>
    list.sort((a, b) => {
      const d = a.entryDate.getTime() - b.entryDate.getTime();
      if (d !== 0) return d;
      return compareTimes(a.entryTime, b.entryTime);
    });
  for (const list of Object.values(longOpen)) sortFifo(list);
  for (const list of Object.values(shortOpen)) sortFifo(list);

  const allSymbols = new Set<string>([
    ...Object.keys(longEntries), ...Object.keys(longExits),
    ...Object.keys(shortEntries), ...Object.keys(shortExits),
    ...Object.keys(longOpen), ...Object.keys(shortOpen),
  ]);

  for (const symbol of allSymbols) {
    matchSide(
      symbol, 'LONG',
      longEntries[symbol] ?? [], longExits[symbol] ?? [], longOpen[symbol] ?? [],
      trades, newOpenPositions, closingFills, warnings,
    );
    matchSide(
      symbol, 'SHORT',
      shortEntries[symbol] ?? [], shortExits[symbol] ?? [], shortOpen[symbol] ?? [],
      trades, newOpenPositions, closingFills, warnings,
    );
  }

  return { trades, newOpenPositions, closingFills, warnings };
}
```

5. **Add the `matchSide` helper** between `fifoMatch` and `matchExecutions`. This is where PASS A (consume open positions) happens, then PASS B/C reuse `fifoMatch` for same-day entries:

```ts
function matchSide(
  symbol: string,
  direction: Direction,
  entries: RawBucket[],
  exits: RawBucket[],
  opens: OpenPositionInput[],
  outTrades: MatchedTrade[],
  outNewOpen: MatchedTrade[],
  outClosing: ClosingFill[],
  warnings: string[],
): void {
  const sortedEntries = [...entries].sort((a, b) => compareTimes(a.time, b.time));
  const sortedExits = [...exits].sort((a, b) => compareTimes(a.time, b.time));

  // PASS A: consume exits against open positions FIFO.
  // We mutate sortedExits in place: fully-consumed exits are removed from the front,
  // partially-consumed exits are replaced with their remainder.
  for (const open of opens) {
    let remainingToClose = open.totalQuantity;
    const consumed: { price: number; qty: number; time: string; commission: number; fees: number }[] = [];

    while (remainingToClose > 0 && sortedExits.length > 0) {
      const exit = sortedExits[0];
      const take = Math.min(remainingToClose, exit.qty);
      const ratio = exit.qty > 0 ? take / exit.qty : 0;
      const takeCommission = exit.commission * ratio;
      const takeFees = exit.fees * ratio;
      consumed.push({
        price: exit.price,
        qty: take,
        time: exit.time,
        commission: takeCommission,
        fees: takeFees,
      });

      if (take >= exit.qty) {
        sortedExits.shift();
      } else {
        sortedExits[0] = {
          ...exit,
          qty: exit.qty - take,
          commission: exit.commission - takeCommission,
          fees: exit.fees - takeFees,
        };
      }
      remainingToClose -= take;
    }

    const matchedQty = open.totalQuantity - remainingToClose;
    if (matchedQty <= 0) continue; // no exits available — open stays untouched.

    // Build the ClosingFill.
    const exitValueSum = consumed.reduce((s, c) => s + c.price * c.qty, 0);
    const avgExitPrice = matchedQty > 0 ? exitValueSum / matchedQty : 0;
    const latestExitTime = consumed.reduce((latest, c) =>
      !latest || compareTimes(c.time, latest) > 0 ? c.time : latest, '');
    const exitCommission = consumed.reduce((s, c) => s + c.commission, 0);
    const exitFees = consumed.reduce((s, c) => s + c.fees, 0);

    // Proportional split of the open position's entry commission/fees.
    const entryRatio = open.totalQuantity > 0 ? matchedQty / open.totalQuantity : 0;
    const entryCommissionAllocated = open.commission * entryRatio;
    const entryFeesAllocated = open.fees * entryRatio;

    const gross = direction === 'LONG'
      ? (avgExitPrice - open.avgEntryPrice) * matchedQty
      : (open.avgEntryPrice - avgExitPrice) * matchedQty;
    const net = gross - entryCommissionAllocated - entryFeesAllocated - exitCommission - exitFees;

    outClosing.push({
      openPositionId: open.id,
      symbol,
      direction,
      exitPrice: avgExitPrice,
      exitTime: latestExitTime,
      matchedQty,
      grossPnl: gross,
      netPnl: net,
      entryCommissionAllocated,
      entryFeesAllocated,
      exitCommission,
      exitFees,
      exitExecutions: consumed.map((c) => ({
        symbol,
        side: direction === 'LONG' ? 'LONG_EXIT' : 'SHORT_EXIT',
        qty: c.qty,
        price: c.price,
        time: c.time,
        commission: c.commission,
        fees: c.fees,
      })),
    });
  }

  // PASS B: FIFO-match remaining same-day entries against remaining same-day exits.
  // Reuse the existing fifoMatch — it already does the right thing and warns on
  // leftovers. But we DON'T want its leftover-entry warnings (Phase 2 turns those
  // into newOpenPositions). So we inline a slightly modified version here, OR
  // we let fifoMatch handle the trade and then check leftovers ourselves.
  // Simpler: walk fifoMatch's algorithm inline so we can keep leftovers cleanly.

  const se = [...sortedEntries];
  const sx = sortedExits; // already mutated by PASS A

  let totalQty = 0;
  let entryValueSum = 0;
  let exitValueSum = 0;
  let totalGross = 0;
  let totalNet = 0;
  let totalCommission = 0;
  let totalFees = 0;
  let earliestEntry = '';
  let latestExit = '';

  while (se.length > 0 && sx.length > 0) {
    const entry = se.shift()!;
    const exit = sx.shift()!;
    const qty = Math.min(entry.qty, exit.qty);
    if (qty <= 0) {
      const er = remainder(entry, qty);
      const xr = remainder(exit, qty);
      if (er) se.unshift(er);
      if (xr) sx.unshift(xr);
      continue;
    }

    const entryCommission = entry.qty > 0 ? (entry.commission / entry.qty) * qty : 0;
    const exitCommission = exit.qty > 0 ? (exit.commission / exit.qty) * qty : 0;
    const entryFees = entry.qty > 0 ? (entry.fees / entry.qty) * qty : 0;
    const exitFees = exit.qty > 0 ? (exit.fees / exit.qty) * qty : 0;
    const pairCommission = entryCommission + exitCommission;
    const pairFees = entryFees + exitFees;
    const gross = direction === 'LONG'
      ? (exit.price - entry.price) * qty
      : (entry.price - exit.price) * qty;
    const net = gross - pairCommission - pairFees;

    entryValueSum += entry.price * qty;
    exitValueSum += exit.price * qty;
    totalQty += qty;
    totalGross += gross;
    totalNet += net;
    totalCommission += pairCommission;
    totalFees += pairFees;

    if (!earliestEntry || compareTimes(entry.time, earliestEntry) < 0) earliestEntry = entry.time;
    if (!latestExit || compareTimes(exit.time, latestExit) > 0) latestExit = exit.time;

    const er = remainder(entry, qty);
    const xr = remainder(exit, qty);
    if (er) se.unshift(er);
    if (xr) sx.unshift(xr);
  }

  if (totalQty > 0) {
    outTrades.push({
      symbol, direction,
      avgEntryPrice: entryValueSum / totalQty,
      avgExitPrice: exitValueSum / totalQty,
      totalQuantity: totalQty,
      grossPnl: totalGross,
      netPnl: totalNet,
      entryTime: earliestEntry,
      exitTime: latestExit,
      commission: totalCommission,
      fees: totalFees,
    });
  }

  // PASS C: leftover entries become newOpenPositions; leftover exits become warnings.
  if (se.length > 0) {
    // Aggregate leftover entries into a single open-position MatchedTrade.
    const totalOpenQty = se.reduce((s, e) => s + e.qty, 0);
    const openValueSum = se.reduce((s, e) => s + e.price * e.qty, 0);
    const openCommission = se.reduce((s, e) => s + e.commission, 0);
    const openFees = se.reduce((s, e) => s + e.fees, 0);
    const earliest = se.reduce((acc, e) =>
      !acc || compareTimes(e.time, acc) < 0 ? e.time : acc, '');
    outNewOpen.push({
      symbol, direction,
      avgEntryPrice: totalOpenQty > 0 ? openValueSum / totalOpenQty : 0,
      avgExitPrice: 0,
      totalQuantity: totalOpenQty,
      grossPnl: 0,
      netPnl: 0,
      entryTime: earliest,
      exitTime: '',
      commission: openCommission,
      fees: openFees,
      isOpen: true,
      remainingQty: totalOpenQty,
    });
  }
  if (sx.length > 0) {
    const unmatchedQty = sx.reduce((s, e) => s + e.qty, 0);
    const label = direction === 'LONG' ? 'SELL' : 'COVER BUY';
    warnings.push(
      `${symbol}: ${unmatchedQty} unmatched ${label} share(s) (${sx.length} fill(s)) — no matching entry or open position`,
    );
  }
}
```

6. **Update the existing `fifoMatch` warning text** — since the new flow funnels open-entry leftovers through `matchSide`, the old `fifoMatch` is now only called by tests. Leave its warning text alone (don't change Phase 1's tests). The new `matchSide` is the production caller.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] Calling `matchExecutions(execs)` with no openPositions argument: previously-passing tests still pass (the new return shape is a superset — `trades` and `warnings` are unchanged for the same-day-only path). Exception: the existing Phase 1 tests expect unmatched LONG_ENTRY to produce a warning + zero trades; that behavior moved. **Update those tests in Step 7.**

---

#### Step 2: Add `importRawSchema` to `lib/validations/trades.ts`

**File:** `lib/validations/trades.ts`
**Action:** MODIFY

**Instructions:**

After the `mergeTradesSchema` block (currently line 109-113), append:

```ts
// Schema for POST /api/trades/import-raw.
// One CSV file's worth of raw broker executions, all for the same trading day.
export const importRawSchema = z.object({
  /** Sortable day key (YYYY-MM-DD) the executions occurred on. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  executions: z.array(z.object({
    symbol: z.string().min(1),
    side: z.enum(['LONG_ENTRY', 'LONG_EXIT', 'SHORT_ENTRY', 'SHORT_EXIT']),
    qty: z.number().finite().positive(),
    price: z.number().finite(),
    time: z.string().min(1),
    commission: z.number().finite().optional().default(0),
    fees: z.number().finite().optional().default(0),
  })).min(1, 'executions must not be empty'),
  /** Idempotency key — re-uploading the same CSV with the same key is a no-op. */
  batchKey: z.string().max(256).optional(),
});

export type ImportRawInput = z.infer<typeof importRawSchema>;
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes

---

#### Step 3: Add `extractRawExecutions` to `lib/csv-parser.ts`

**File:** `lib/csv-parser.ts`
**Action:** MODIFY (additive — do NOT touch existing exports)

**Goal:** Expose the row-normalization step (broker parser → side normalization → MatcherExecution shape) without running FIFO matching. The existing `processCsvData` stays in place for the csv-parser tests.

**Instructions:**

1. Add an import at the top of the file for the matcher types and `normalizeSide`:

```ts
import { normalizeSide, type MatcherExecution } from '@/lib/position-matcher';
```

2. After `parseDateFromFilename` (currently ends at line 106), add the new export. This function reuses the existing `builtinNormalizeRow` and `BrokerParserConfig` path — it just skips the matching pass:

```ts
export interface ExtractRawResult {
  executions: MatcherExecution[];
  warnings: string[];
}

/**
 * Parse a CSV's rows into MatcherExecution[] WITHOUT running FIFO matching.
 * Used by the server-side import-raw path. Mirrors processCsvData's
 * row-normalization, then maps the broker side codes (MARGIN/B/S/SS) to the
 * matcher's canonical sides (LONG_ENTRY/etc) via `normalizeSide`.
 */
export const extractRawExecutions = (
  data: Record<string, string>[],
  parser?: BrokerParserConfig,
): ExtractRawResult => {
  const warnings: string[] = [];
  const executions: MatcherExecution[] = [];
  const parserContext = parser?.buildContext?.(data as Record<string, unknown>[]);

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = parser
        ? parser.normalizeRow(rawRow as Record<string, unknown>, rowIndex, parserContext)
        : builtinNormalizeRow(rawRow as Record<string, unknown>, rowIndex, warnings);

      if (!exec) return;

      // exec.side is one of 'MARGIN' | 'B' | 'S' | 'SS' (or parser-specific aliases).
      // normalizeSide maps it to 'LONG_ENTRY' | 'LONG_EXIT' | 'SHORT_ENTRY' | 'SHORT_EXIT'.
      const canonicalSide = normalizeSide(exec.side);
      if (!canonicalSide) {
        warnings.push(`Row ${rowIndex + 1}: Unknown side "${exec.side}" for ${exec.symbol}, skipping`);
        return;
      }

      executions.push({
        symbol: exec.symbol,
        side: canonicalSide,
        qty: exec.qty,
        price: exec.price,
        time: exec.time,
        commission: exec.commission,
        fees: exec.fees,
      });
    } catch (rowError) {
      const msg = rowError instanceof Error ? rowError.message : 'Unknown error';
      warnings.push(`Row ${rowIndex + 1}: Parse error — ${msg}`);
    }
  });

  // Propagate parser-level warnings (mirrors processCsvData behavior).
  if (parserContext && typeof parserContext === 'object') {
    const parserWarnings = (parserContext as { warnings?: unknown }).warnings;
    if (Array.isArray(parserWarnings)) {
      for (const w of parserWarnings) {
        if (typeof w === 'string' && w.trim()) warnings.push(w);
      }
    }
  }

  return { executions, warnings };
};
```

3. Leave `processCsvData` (currently line 168) **unchanged**. It is still exercised by `__tests__/csv-parser.test.ts` and `__tests__/das-trader-parser.test.ts`. Future cleanup can prune it once those tests migrate.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] `__tests__/csv-parser.test.ts` still passes (unchanged)
- [ ] `__tests__/das-trader-parser.test.ts` still passes (unchanged)

---

#### Step 4: Add `collectRawExecutions` to `lib/trade-utils.ts`

**File:** `lib/trade-utils.ts`
**Action:** MODIFY (additive)

**Instructions:**

1. Extend the existing csv-parser import (currently line 2) to add `extractRawExecutions`:

```ts
import { extractRawExecutions, parseDateFromFilename, processCsvData } from '@/lib/csv-parser';
```

(`processCsvData` stays in the import because `collectImportedTrades` still uses it.)

2. Add an import for the matcher type:

```ts
import type { MatcherExecution } from '@/lib/position-matcher';
```

3. After `collectImportedTrades` (currently ends at line 139), add a new exported helper. Output shape: one batch per CSV file, each batch tagged with its parsed date. The route consumes one batch per HTTP call.

```ts
export interface RawExecutionBatch {
  /** Parsed from filename (YYYY-MM-DD). */
  date: string;
  /** SHA-256-ish digest of the file name + execution payload, used as batchKey. */
  batchKey: string;
  executions: MatcherExecution[];
}

export interface CollectRawResult {
  batches: RawExecutionBatch[];
  warnings: string[];
}

/**
 * Walk a FileList, parse each CSV with Papa, normalize rows via extractRawExecutions,
 * and return one batch per file. Date comes from the filename (same convention as
 * collectImportedTrades). The matching step happens server-side.
 */
export async function collectRawExecutions(
  files: FileList,
  options: CollectImportedTradesOptions,
): Promise<CollectRawResult> {
  const batches: RawExecutionBatch[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (options.includeFile && !options.includeFile(file)) continue;

    const dateInfo = parseDateFromFilename(file.name);
    if (!dateInfo) {
      warnings.push(`Skipped ${file.name}: could not parse date from filename`);
      continue;
    }

    await new Promise<void>((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const rows = results.data as Record<string, string>[];
            const parseIssues = (results.errors ?? []) as CsvParseIssue[];
            if (parseIssues.length > 0) appendCsvParseWarnings(file.name, parseIssues, warnings);

            const parser = options.resolveParser(file, rows);
            const extracted = extractRawExecutions(
              rows,
              parser && parser.id !== 'default' ? parser : undefined,
            );

            warnings.push(...extracted.warnings);
            if (extracted.executions.length > 0) {
              batches.push({
                date: dateInfo.sortKey,
                // Cheap, deterministic batchKey: filename + sortKey + row count + first/last times.
                // Good enough for "same file uploaded twice" idempotency.
                batchKey: `raw|${file.name}|${dateInfo.sortKey}|${extracted.executions.length}`,
                executions: extracted.executions,
              });
            }
            resolve();
          } catch (parseError) {
            reject(parseError);
          }
        },
        error: (parseError) => reject(parseError),
      });
    });
  }

  return { batches, warnings };
}
```

Note on `batchKey`: the simple concat (`raw|filename|date|count`) is intentionally lossy — re-uploading a corrected CSV with the same filename but different content WILL collide. That is acceptable for Phase 2 (matches `/api/trades/import`'s current trust model; the user is expected to rename or delete the prior import first). A future sprint can swap in a content hash if needed.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes

---

#### Step 5: Create `app/api/trades/import-raw/route.ts`

**File:** `app/api/trades/import-raw/route.ts`
**Action:** CREATE

**Instructions:**

The route accepts ONE day's worth of raw executions, runs the matcher with the user's existing open positions for the affected symbols, and persists results in a transaction. Returns the full refreshed trade list (matches `/api/trades/import`'s return shape so the client can `refreshTrades()`-style re-render).

```ts
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import {
  tradeExecutions,
  tradeImportBatches,
  trades,
  tags as tagsTable,
} from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
} from '@/lib/server-db-utils';
import { importRawSchema } from '@/lib/validations/trades';
import {
  matchExecutions,
  type ClosingFill,
  type MatchedTrade,
  type OpenPositionInput,
} from '@/lib/position-matcher';

function makeId(parts: string[]): string {
  return parts.join('|');
}

function hex4(): string {
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
}

function compactTimeForId(time: string): string {
  // Strip non-digits so '09:31:05' -> '093105'. Falls back to '000000'.
  const digits = time.replace(/\D/g, '');
  return (digits.padEnd(6, '0')).slice(0, 6);
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, importRawSchema);
    if (bodyState.error) return bodyState.error;
    const { date: sortKey, executions, batchKey } = bodyState.data;

    // Build the Date object the schema's trade.date column expects.
    // `date` is YYYY-MM-DD; we store it as 'YYYY-MM-DD' string in trade.date (per
    // existing convention) — see app/api/trades/import/route.ts:266 where it
    // writes `date: trade.date` from a string body. We persist a Date object
    // for the row but use `sortKey` as the string for trade.sortKey.
    const tradeDate = new Date(`${sortKey}T00:00:00Z`);

    // Idempotency check — same as /api/trades/import.
    let importSkipped = false;

    // Load existing open positions for the symbols in this batch.
    const symbols = Array.from(new Set(executions.map((e) => e.symbol)));
    const openRows = await db.select().from(trades).where(and(
      eq(trades.userId, authState.user.id),
      eq(trades.isOpen, true),
      inArray(trades.symbol, symbols),
    ));

    const openPositions: OpenPositionInput[] = openRows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      direction: row.direction as 'LONG' | 'SHORT',
      totalQuantity: row.totalQuantity,
      avgEntryPrice: row.avgEntryPrice,
      entryTime: row.entryTime ?? '',
      entryDate: row.date instanceof Date ? row.date : new Date(row.date as unknown as string),
      commission: row.commission ?? 0,
      fees: row.fees ?? 0,
    }));

    // Run the matcher.
    const { trades: matchedClosed, newOpenPositions, closingFills, warnings } =
      matchExecutions(executions, openPositions);

    await db.transaction(async (tx) => {
      if (batchKey) {
        const inserted = await tx.insert(tradeImportBatches)
          .values({ userId: authState.user.id, batchKey })
          .onConflictDoNothing()
          .returning({ batchKey: tradeImportBatches.batchKey });
        if (inserted.length === 0) {
          importSkipped = true;
          return;
        }
      }

      // 1) Insert same-day closed trades. ID convention matches the existing
      //    client-side path: `${sortKey}|${symbol}|${direction}`.
      for (const t of matchedClosed) {
        const tradeId = makeId([sortKey, t.symbol, t.direction]);
        const grossPnl = t.grossPnl;
        const netPnl = t.netPnl;

        await tx.insert(trades).values({
          id: tradeId,
          userId: authState.user.id,
          date: tradeDate,
          sortKey,
          symbol: t.symbol,
          direction: t.direction,
          avgEntryPrice: t.avgEntryPrice,
          avgExitPrice: t.avgExitPrice,
          totalQuantity: t.totalQuantity,
          grossPnl,
          netPnl,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          executionCount: 1,
          pnl: netPnl,
          executions: 1,
          commission: t.commission,
          fees: t.fees,
          isOpen: false,
          closedAt: tradeDate,
          remainingQty: 0,
        }).onConflictDoUpdate({
          target: [trades.userId, trades.id],
          set: {
            avgEntryPrice: t.avgEntryPrice,
            avgExitPrice: t.avgExitPrice,
            totalQuantity: t.totalQuantity,
            grossPnl,
            netPnl,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
            pnl: netPnl,
            commission: t.commission,
            fees: t.fees,
            // NOTE: do NOT update isOpen/closedAt/remainingQty here. Same rule
            // as /api/trades/import — re-imports must not flip an open trade
            // (which shouldn't happen for same-day-closed IDs, but be safe).
          },
        });
      }

      // 2) Insert newly-opened positions.
      for (const p of newOpenPositions) {
        const tradeId = makeId([sortKey, p.symbol, p.direction, `${compactTimeForId(p.entryTime)}-${hex4()}`]);
        await tx.insert(trades).values({
          id: tradeId,
          userId: authState.user.id,
          date: tradeDate,
          sortKey,
          symbol: p.symbol,
          direction: p.direction,
          avgEntryPrice: p.avgEntryPrice,
          avgExitPrice: 0,
          totalQuantity: p.totalQuantity,
          grossPnl: 0,
          netPnl: 0,
          entryTime: p.entryTime,
          exitTime: '',
          executionCount: 1,
          pnl: 0,
          executions: 1,
          commission: p.commission,
          fees: p.fees,
          isOpen: true,
          remainingQty: p.totalQuantity,
        });
      }

      // 3) Apply closing fills (full + partial closes of pre-existing open positions).
      for (const fill of closingFills) {
        const open = openRows.find((r) => r.id === fill.openPositionId);
        if (!open) continue; // shouldn't happen — matcher only emits fills for loaded opens.

        const isFullClose = fill.matchedQty >= open.totalQuantity;

        if (isFullClose) {
          // UPDATE the open row to closed. PnL/exit fields reflect the full position.
          await tx.update(trades).set({
            avgExitPrice: fill.exitPrice,
            exitTime: fill.exitTime,
            grossPnl: fill.grossPnl,
            netPnl: fill.netPnl,
            pnl: fill.netPnl,
            commission: open.commission + fill.exitCommission,
            fees: open.fees + fill.exitFees,
            isOpen: false,
            closedAt: tradeDate,
            remainingQty: 0,
          }).where(and(
            eq(trades.userId, authState.user.id),
            eq(trades.id, open.id),
          ));
        } else {
          // PARTIAL close. Reduce the open row's qty AND insert a new closed row
          // for the realized portion.
          const newOpenQty = open.totalQuantity - fill.matchedQty;
          await tx.update(trades).set({
            totalQuantity: newOpenQty,
            remainingQty: newOpenQty,
            // Reduce entry-side commission/fees proportionally — the realized
            // portion's commission lives on the new closed row.
            commission: open.commission - fill.entryCommissionAllocated,
            fees: open.fees - fill.entryFeesAllocated,
          }).where(and(
            eq(trades.userId, authState.user.id),
            eq(trades.id, open.id),
          ));

          const realizedId = makeId([sortKey, fill.symbol, fill.direction, `p-${hex4()}`]);
          await tx.insert(trades).values({
            id: realizedId,
            userId: authState.user.id,
            // Use the OPEN position's entry date so the trade row reflects its
            // entry day. closedAt holds the exit day for Phase 2 -> later sprints
            // can re-bucket on closedAt.
            date: open.date,
            sortKey: open.sortKey,
            symbol: fill.symbol,
            direction: fill.direction,
            avgEntryPrice: open.avgEntryPrice,
            avgExitPrice: fill.exitPrice,
            totalQuantity: fill.matchedQty,
            grossPnl: fill.grossPnl,
            netPnl: fill.netPnl,
            entryTime: open.entryTime ?? '',
            exitTime: fill.exitTime,
            executionCount: 1,
            pnl: fill.netPnl,
            executions: 1,
            commission: fill.entryCommissionAllocated + fill.exitCommission,
            fees: fill.entryFeesAllocated + fill.exitFees,
            isOpen: false,
            closedAt: tradeDate,
            remainingQty: 0,
          });
        }

        // Append the closing executions to the open position's trade_executions.
        // We store them as plain EXIT rows. IDs are generated to avoid collision
        // with existing executions on that trade.
        const baseId = `${fill.openPositionId}|x|${sortKey}`;
        for (let idx = 0; idx < fill.exitExecutions.length; idx += 1) {
          const e = fill.exitExecutions[idx];
          await tx.insert(tradeExecutions).values({
            id: `${baseId}|${idx}-${hex4()}`,
            userId: authState.user.id,
            tradeId: fill.openPositionId,
            side: 'EXIT',
            price: e.price,
            qty: e.qty,
            time: e.time,
            timestamp: null,
            commission: e.commission ?? 0,
            fees: e.fees ?? 0,
          }).onConflictDoNothing();
        }
      }
    });

    // Reload the user's full trade list (mirrors /api/trades/import return shape).
    const tradeRows = await db.select().from(trades)
      .where(eq(trades.userId, authState.user.id))
      .orderBy(desc(trades.date));
    const tradeIds = tradeRows.map((row) => row.id);
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, tradeIds);

    const tradeList = tradeRows.map((row) => toTrade(row, tagMap.get(row.id) ?? []));
    return Response.json({
      trades: tradeList,
      warnings,
      importSkipped,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    logRouteError('trades.import-raw.post', error);
    return internalServerError();
  }
}
```

**Note on `tagsTable` import:** included for parity with the existing `import` route but not used in Phase 2 (no tag-assignment via CSV). It can be omitted if Codex prefers — the lint rule will flag unused imports. Either path is fine; if removing, also remove from the import line at the top.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes (no unused-import warnings)
- [ ] Body validation: posting an empty `executions` array returns 400
- [ ] Body validation: posting a malformed `date` (e.g. "2026/05/18") returns 400

---

#### Step 6: Switch `processImportFiles` in `hooks/use-trades.ts` to the new endpoint

**File:** `hooks/use-trades.ts`
**Action:** MODIFY

**Instructions:**

1. Update the import (currently line 10) to add `collectRawExecutions`:

```ts
import { apiRequest, collectImportedTrades, collectRawExecutions, fromApiTrade, sortTradesByDate, toApiTrade } from '@/lib/trade-utils';
```

(`collectImportedTrades` stays imported — it's still used by no production caller after this change, but leaving it imported here would trip the unused-import lint. **Remove it from the import line** since it's no longer used in this file:)

```ts
import { apiRequest, collectRawExecutions, fromApiTrade, sortTradesByDate, toApiTrade } from '@/lib/trade-utils';
```

2. Replace the body of `processImportFiles` (currently line 264-300) with the new implementation that uploads one batch per HTTP call, sequentially:

```ts
  const processImportFiles = async (files: FileList, options: ImportOptions): Promise<void> => {
    setIsImporting(true);
    setError(null);

    try {
      const { batches, warnings } = await collectRawExecutions(files, {
        includeFile: options.includeFile,
        resolveParser: options.resolveParser,
      });

      if (warnings.length > 0) {
        console.warn(`[trade import] ${warnings.length} warning(s):`, warnings);
        toast.warning(`${warnings.length} warning(s) during ${options.warningLabel} import (see DevTools console)`);
      }
      if (batches.length === 0) {
        if (warnings.length === 0) toast.warning(options.emptyMessage);
        return;
      }

      // Serialize per-batch so each call sees DB state from prior batches.
      // Each batch corresponds to one CSV file (one trading day).
      const allServerWarnings: string[] = [];
      for (const batch of batches) {
        const result = await apiRequest<{ trades: ApiTrade[]; warnings?: string[]; importSkipped?: boolean }>(
          '/api/trades/import-raw',
          {
            method: 'POST',
            body: JSON.stringify({
              date: batch.date,
              executions: batch.executions,
              batchKey: batch.batchKey,
            }),
          },
        );
        if (Array.isArray(result.warnings)) allServerWarnings.push(...result.warnings);
      }

      if (allServerWarnings.length > 0) {
        console.warn(`[trade import] server warnings:`, allServerWarnings);
        toast.warning(`${allServerWarnings.length} server warning(s) during import (see DevTools console)`);
      }

      await refreshTrades();
    } catch (uploadError) {
      const msg = uploadError instanceof Error ? uploadError.message : 'Processing error';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsImporting(false);
    }
  };
```

3. **Do NOT touch `handleTraderVueImport`** (currently line 336+). TraderVue CSVs are pre-aggregated trade rows; they continue to POST to `/api/trades/import`.

4. The `IMPORT_CHUNK_SIZE` constant (currently line 12) is no longer referenced by `processImportFiles` after this change but is still used by `handleTraderVueImport`. **Leave it as-is.**

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes (no unused imports — `collectImportedTrades` is gone from this file)
- [ ] CSV file upload still works in the UI (the import button → file picker → success toast)
- [ ] CSV folder upload still works (the folder import button)
- [ ] TraderVue CSV upload still works (untouched path)

---

#### Step 7: Extend `__tests__/position-matcher.test.ts`

**File:** `__tests__/position-matcher.test.ts`
**Action:** MODIFY

**Instructions:**

1. **Update the existing "unmatched entry" test** (currently around line 35 — the NVDA test). Its previous expectation (`trades.length === 0` + warning) is no longer correct: Phase 2 turns unmatched entries into `newOpenPositions`. Replace that test block:

```ts
describe('matchExecutions — unmatched entry becomes a new open position', () => {
  it('emits a new open position for unmatched long entry (no warning)', () => {
    const result = matchExecutions([
      exec('NVDA', 'LONG_ENTRY', 200, 100, '09:30:00'),
    ]);
    expect(result.trades).toHaveLength(0);
    expect(result.newOpenPositions).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    const open = result.newOpenPositions[0];
    expect(open.symbol).toBe('NVDA');
    expect(open.direction).toBe('LONG');
    expect(open.totalQuantity).toBe(200);
    expect(open.avgEntryPrice).toBeCloseTo(100);
    expect(open.isOpen).toBe(true);
    expect(open.remainingQty).toBe(200);
  });
});
```

2. **Add new `describe` blocks at the end of the file** for cross-day cases:

```ts
import type { OpenPositionInput } from '@/lib/position-matcher';

function openPos(
  id: string,
  symbol: string,
  direction: 'LONG' | 'SHORT',
  totalQuantity: number,
  avgEntryPrice: number,
  entryTime: string,
  entryDate: Date,
  commission = 0,
  fees = 0,
): OpenPositionInput {
  return { id, symbol, direction, totalQuantity, avgEntryPrice, entryTime, entryDate, commission, fees };
}

describe('matchExecutions — cross-day full close', () => {
  it('closes a prior-day open long with same-symbol sells, emits a ClosingFill', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 100, 160, '10:00:00'),
    ], opens);

    expect(result.trades).toHaveLength(0);
    expect(result.newOpenPositions).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.closingFills).toHaveLength(1);

    const fill = result.closingFills[0];
    expect(fill.openPositionId).toBe('open1');
    expect(fill.matchedQty).toBe(100);
    expect(fill.exitPrice).toBeCloseTo(160);
    expect(fill.grossPnl).toBeCloseTo(1000); // (160-150)*100
    expect(fill.netPnl).toBeCloseTo(1000);
  });
});

describe('matchExecutions — cross-day partial close', () => {
  it('partially closes a prior-day open long, emits a ClosingFill with matchedQty < totalQty', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 40, 160, '10:00:00'),
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    const fill = result.closingFills[0];
    expect(fill.matchedQty).toBe(40);
    expect(fill.grossPnl).toBeCloseTo(400); // (160-150)*40
    // No new open positions, no warnings — the matcher is fine with partials.
    expect(result.newOpenPositions).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('matchExecutions — cross-day FIFO across multiple opens', () => {
  it('consumes the OLDER open position first', () => {
    const opens = [
      openPos('open-newer', 'AAPL', 'LONG', 100, 160, '09:30:00', new Date('2026-05-16')),
      openPos('open-older', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15')),
    ];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 100, 170, '10:00:00'),
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    expect(result.closingFills[0].openPositionId).toBe('open-older');
    // PnL uses the older's entry price (150), not the newer's (160).
    expect(result.closingFills[0].grossPnl).toBeCloseTo(2000); // (170-150)*100
  });
});

describe('matchExecutions — mixed same-day round-trip + cross-day close', () => {
  it('closes the open position first, then matches any leftover same-day pairs', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      // First exit consumes the open. Second pair is a same-day round trip.
      exec('AAPL', 'LONG_EXIT', 100, 160, '09:31:00'),
      exec('AAPL', 'LONG_ENTRY', 50, 161, '09:35:00'),
      exec('AAPL', 'LONG_EXIT', 50, 165, '09:45:00'),
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    expect(result.closingFills[0].matchedQty).toBe(100);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].totalQuantity).toBe(50);
    expect(result.trades[0].grossPnl).toBeCloseTo(200); // (165-161)*50
  });
});

describe('matchExecutions — opposite-direction open position is NOT consumed', () => {
  it('does not match a long exit against a short open position', () => {
    const opens = [openPos('open-short', 'AAPL', 'SHORT', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 100, 160, '10:00:00'),
    ], opens);

    // The long exit can't close a short open — it's unmatched and warns.
    expect(result.closingFills).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/AAPL/);
    expect(result.warnings[0]).toMatch(/unmatched/i);
  });
});

describe('matchExecutions — proportional commission allocation on partial close', () => {
  it('splits the open positions commission/fees proportionally to matchedQty', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'), 10, 2)];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 40, 160, '10:00:00', 4, 1), // 40% of the 100
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    const fill = result.closingFills[0];
    expect(fill.entryCommissionAllocated).toBeCloseTo(4);  // 10 * 0.4
    expect(fill.entryFeesAllocated).toBeCloseTo(0.8);       // 2 * 0.4
    expect(fill.exitCommission).toBeCloseTo(4);
    expect(fill.exitFees).toBeCloseTo(1);
    // netPnl = gross - allocatedCommission - allocatedFees - exitCommission - exitFees
    //       = 400 - 4 - 0.8 - 4 - 1 = 390.2
    expect(fill.netPnl).toBeCloseTo(390.2);
  });
});
```

3. **Existing `matchExecutions — unmatched exit` test (the AMD test)** still passes — Phase 2 still warns on unmatched exits. No change needed.

**Acceptance:**
- [ ] `npm test` — `position-matcher.test.ts` passes with 0 failures
- [ ] All 11 pre-existing tests still pass (except the NVDA test, which was rewritten in this step)
- [ ] All ~6 new cross-day tests pass

---

#### Step 8: Lint, typecheck, test, commit

**Action:** RUN COMMANDS

```
npm run lint
npx tsc --noEmit
npm test
```

All must pass with 0 errors. Then commit:

```
git add -A
git commit -m "Phase 2: cross-day position matching — server import route, raw-executions helper, matcher accepts open positions"
```

Do NOT push.

**Acceptance:**
- [x] `npm run lint` — 0 errors
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm test` — 0 failing tests (94 files / 691 tests)
- [x] `git log --oneline -1` shows the commit above
- [x] `git status` is clean after the local commit

---

### Files Changed Summary

| File | Action | Lines +/- est. | Risk |
|---|---|---|---|
| `lib/position-matcher.ts` | MODIFY | +~200 | HIGH — algorithm changes, new types, new return shape |
| `lib/validations/trades.ts` | MODIFY | +~20 | LOW |
| `lib/csv-parser.ts` | MODIFY | +~60 | LOW — additive only, existing exports untouched |
| `lib/trade-utils.ts` | MODIFY | +~60 | LOW |
| `app/api/trades/import-raw/route.ts` | CREATE | +~220 | HIGH — transactional, multi-row insert/update path |
| `hooks/use-trades.ts` | MODIFY | +~10 / -~15 | MEDIUM — production import flow swap |
| `__tests__/position-matcher.test.ts` | MODIFY | +~120 / -~10 | LOW — tests only |

**Not touched in Phase 2:** schema, `app/api/trades/import/route.ts`, manual trade routes, merge route, UI components, journal aggregates, stats table.

---

### Verification Steps

**Automated:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`

**Manual checks (Codex does NOT need to run these — they're for the user post-execution):**
- [ ] Upload a single-day CSV with a round-trip (buy + sell same day) → one closed trade appears
- [ ] Upload a single-day CSV with only buys → one open position appears (no warning)
- [ ] Upload Monday's CSV (buy 100) then Tuesday's CSV (sell 100) → Monday's row flips to closed with the correct exit price; no duplicate row created
- [ ] Upload Monday's CSV (buy 100) then Tuesday's CSV (sell 40) → Monday's row stays open with totalQuantity=60; a new closed row for 40 shares appears dated Monday
- [ ] Upload the same CSV twice → second upload is a no-op (no duplicate rows; check DB)
- [ ] Folder upload with mixed broker subdirs still works
- [ ] TraderVue CSV upload still works (untouched path)
- [ ] Stats table: closed trades count includes the cross-day closed row
- [ ] DO NOT git push — verify Codex stopped after committing locally

---

### Complexity Estimate

MEDIUM-HIGH — 7 files touched, 1 new route, significant matcher refactor with new return shape, partial-close arithmetic. Estimate 3-5 hours of Codex execution time. The matcher logic in Step 1 is the riskiest piece; Step 7's tests will catch most regressions.

---

## Follow-up Specs (not yet planned)

### Route-level testing infrastructure

Stand up a test DB harness (Postgres in Docker via testcontainers, or a vitest setup that points at a disposable schema) so we can write real integration tests for API routes. Phase 1's `__tests__/trade-merge.test.ts` only covers the merge math in isolation — auth, ownership, opposite-direction 400s, and the FK cascade on `trade_executions` are uncovered today. Phase 2 adds `/api/trades/import-raw` which similarly has only matcher-level tests. Once the harness exists, immediate targets are `app/api/trades/merge/route.ts`, the close-position branch of `app/api/trades/[id]/route.ts`, and `app/api/trades/import-raw/route.ts`.

### Partial close UX on the Close Position button

Phase 1 ships a "Close Position (Full)" button on `TradeDetailSheet`. Phase 2's matcher handles partial closes from CSV imports, but the UI button still closes the full position. A future sprint should let the user enter a quantity ≤ `remainingQty`, similar to how brokers offer partial fills. Touches `TradeDetailSheet.tsx`, the close-position schema, and the PATCH `/api/trades/[id]` branch.

### `closedAt`-based PnL bucketing for journal / calendar

Phase 1 backfilled `closed_at` for historical trades. Phase 2 sets `closed_at` correctly for cross-day closes. Both journal aggregation and the trading calendar still bucket by `date` (entry day). A future sprint should switch them to bucket by `closed_at` so a Monday-buy-Tuesday-sell shows up under Tuesday's PnL. Touches `lib/journal-aggregates.ts`, `components/trading/PerformanceCalendar.tsx`, and a handful of stats helpers.

### Auto-sync sample sets from tags

When a trade is tagged with a tag that was used to build an existing sample set, append that trade's `{ticker, date}` to the set automatically.

**Why this is non-trivial** — today a sample set is a frozen `jsonb` row snapshot with no link back to the source tags. We'd need a small schema change plus a hook on the tag-add endpoint.

**Open decisions before drafting a spec:**

- Opt-in at creation, or auto-sync any tag-built set by default? (Prefer opt-in — predictable behavior.)
- Tag *removal* — should it remove the row? (Prefer no — silent shrinkage is confusing.)
- Whose tags trigger sync? (Owner only — tags are user-scoped today; non-owner tag adds shouldn't mutate someone else's set.)
- Should the picker / Backtest Manager show a "synced from #tag" badge with an "unlink → convert to manual" action? (Yes, otherwise the sync is invisible.)

**Rough scope** — schema migration on `sample_sets` (add `source_tags jsonb` nullable), validator extension, POST `/api/sample-sets` persists `source_tags`, hook in the tag-add endpoint that calls a shared "backfill row into linked sets" helper (reusing `mergeDedupedRows` from `lib/sample-set-rows.ts`), Backtest Manager UI badge + unlink action, tests for the tag-add → set-append flow. ~6 files, half a sprint.

**Risks** — extra query on the tag-add hot path (mitigate with a GIN index on `(user_id, source_tags)`); race conditions on simultaneous tag-adds (the existing transactional dedup already protects against this); UX confusion if rows silently appear in a set the user forgot they linked.

## Session Maintenance Checklist

- [ ] Read this file before starting.
- [ ] If the active spec drifts from the live repo, update the spec or stop and ask before editing.
- [ ] After each step, run lint + type-check.
- [ ] Run full `npm test` before reporting a spec complete.
- [ ] Do NOT push to remote without explicit user instruction.
- [ ] Do NOT modify `.env*` or workflow assets under `AGENTS.md` / `codex-skills/` without explicit instruction.
