# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-28
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Next Up: Sprint 6 — Rate Limiting

> Status: NOT YET SPECCED

Scope: DB-backed sliding-window rate limiter for expensive endpoints (`/api/research-report`, `/api/askedgar/tldr`). New `rate_limit_hits` table, shared `lib/rate-limit.ts` helper, integration into target routes, 429 responses with standard headers. See `docs/repo-cleanup.md` § "Rate Limiting On Expensive Endpoints" for the finding.

---

## CSV Parser: Position-Aware B Resolution

> Generated: 2026-05-28 | Agent: claude (inline)
> Status: CODE COMPLETE 2026-05-28; MANUAL SMOKE PENDING

### Problem

The default CSV parser path maps the raw side `B` directly to `B` (short cover / SHORT_EXIT). When a broker exports `B` for "buy to open long" (which is what most generic brokers do), pure long trades disappear — the `B` rows land in the short-cover bucket, the matching `S` rows land in the long-exit bucket, and neither matches anything. Only short trades (`SS` → `B`) and explicit `MARGIN` → `S` long trades come through.

The DAS Trader parser (`lib/parsers/das-trader.ts:35-100`) already solves this with a chronological position-tracker: it walks executions in time order, tracks `longQty`/`shortQty` per symbol, and resolves each `B` to either `B` (cover) when an open short exists, or `MARGIN` (long entry) when none does. But this logic only runs when the CSV headers include `ROUTE`, `ACCOUNT`, and `TYPE` — most coworker exports don't.

Lift the DAS position-resolver into a shared helper and have the default parser use it too. Stop bypassing `defaultParser` in the import flow.

### Files to change

#### 1. `lib/parsers/utils.ts` — MODIFY

Add a shared position-resolver helper after the existing `parseTimeToSeconds` function (after line 82).

**Step 1.1** Add the helper export:

```ts
export interface PositionResolverRow {
  rowIndex: number;
  symbol: string;
  rawSide: 'SS' | 'S' | 'B' | 'MARGIN';
  qty: number;
  timeRank: number | null;
}

export interface PositionResolverResult {
  resolvedSideByRow: Record<number, NormalizedExecution['side']>;
  warnings: string[];
}

/**
 * Walks executions in chronological order to disambiguate each raw `B`:
 * if there is an open short for the symbol, the B covers it (resolves to `B`);
 * otherwise the B opens a new long (resolves to `MARGIN`).
 * `SS`, `S`, and `MARGIN` pass through unchanged but still update tracked state.
 */
export function resolveSidesByPositionState(rows: PositionResolverRow[]): PositionResolverResult {
  const ordered = [...rows].sort((a, b) => {
    if (a.timeRank != null && b.timeRank != null && a.timeRank !== b.timeRank) {
      return a.timeRank - b.timeRank;
    }
    if (a.timeRank != null && b.timeRank == null) return -1;
    if (a.timeRank == null && b.timeRank != null) return 1;
    return a.rowIndex - b.rowIndex;
  });

  const stateBySymbol = new Map<string, { longQty: number; shortQty: number }>();
  const resolvedSideByRow: Record<number, NormalizedExecution['side']> = {};
  const warnings: string[] = [];

  for (const row of ordered) {
    const state = stateBySymbol.get(row.symbol) ?? { longQty: 0, shortQty: 0 };
    stateBySymbol.set(row.symbol, state);

    if (row.rawSide === 'SS') {
      state.shortQty += row.qty;
      resolvedSideByRow[row.rowIndex] = 'SS';
      continue;
    }

    if (row.rawSide === 'MARGIN') {
      state.longQty += row.qty;
      resolvedSideByRow[row.rowIndex] = 'MARGIN';
      continue;
    }

    if (row.rawSide === 'S') {
      state.longQty = Math.max(0, state.longQty - row.qty);
      resolvedSideByRow[row.rowIndex] = 'S';
      continue;
    }

    // rawSide === 'B'
    if (state.shortQty > 0) {
      if (row.qty > state.shortQty + 1e-9) {
        warnings.push(
          `Row ${row.rowIndex + 1}: Ambiguous BUY for ${row.symbol}; qty ${row.qty} exceeds open short ${state.shortQty}. Treating as short cover.`,
        );
      }
      state.shortQty = Math.max(0, state.shortQty - row.qty);
      resolvedSideByRow[row.rowIndex] = 'B';
    } else {
      state.longQty += row.qty;
      resolvedSideByRow[row.rowIndex] = 'MARGIN';
    }
  }

  return { resolvedSideByRow, warnings };
}
```

#### 2. `lib/parsers/default.ts` — MODIFY

Replace the entire file with the version below. Two changes: add `buildContext` that runs the new position resolver, and make `normalizeRow` prefer the resolved side over the raw `SIDE_ALIASES` mapping.

```ts
import { parsePrice } from '../ui-trade-utils';
import type { BrokerParserConfig, NormalizedExecution } from './types';
import {
  SIDE_ALIASES,
  normalizeColumnNames,
  parseCost,
  parseTimeToSeconds,
  resolveSidesByPositionState,
  type PositionResolverRow,
} from './utils';

type DefaultContext = {
  resolvedSideByRow: Record<number, NormalizedExecution['side']>;
  warnings: string[];
};

export const defaultParser: BrokerParserConfig = {
  id: 'default',
  name: 'Default (DAS Trader / Generic)',

  detect: (headers) => {
    const upper = headers.map((h) => h.toUpperCase().trim());
    return upper.includes('SYMBOL') && (upper.includes('SIDE') || upper.includes('ACTION'));
  },

  buildContext: (rawRows) => {
    const inputs: PositionResolverRow[] = [];

    rawRows.forEach((rawRow, rowIndex) => {
      const row = normalizeColumnNames(rawRow);
      const symbol = String(row.Symbol ?? '').toUpperCase().trim();
      const rawSideString = String(row.Side ?? row.Action ?? row.Type ?? '').toUpperCase().trim();
      const rawSide = SIDE_ALIASES[rawSideString];
      const qty = parseFloat(String(row.Qty ?? row.Quantity ?? '')) || 0;
      const time = String(row.Time ?? '');

      if (!symbol || !rawSide || qty === 0) return;

      inputs.push({
        rowIndex,
        symbol,
        rawSide,
        qty,
        timeRank: parseTimeToSeconds(time),
      });
    });

    return resolveSidesByPositionState(inputs);
  },

  normalizeRow: (rawRow, rowIndex, context): NormalizedExecution | null => {
    const row = normalizeColumnNames(rawRow);
    const sym = String(row.Symbol ?? '').toUpperCase().trim();
    const rawSideString = String(row.Side ?? row.Action ?? row.Type ?? '').toUpperCase().trim();
    const fallbackSide = SIDE_ALIASES[rawSideString];
    const qty = parseFloat(String(row.Qty ?? row.Quantity ?? '')) || 0;
    const price = parsePrice(row.Price);
    const time = String(row.Time ?? '');
    const commission = parseCost(row.Commission ?? row.Comm);
    const fees = parseCost(row.Fees ?? row.Fee);

    if (!sym || qty === 0) return null;

    const resolved = (context as DefaultContext | undefined)?.resolvedSideByRow?.[rowIndex];
    const side = resolved ?? fallbackSide;
    if (!side) return null;

    return { symbol: sym, side, qty, price, time, commission, fees };
  },
};
```

#### 3. `lib/parsers/das-trader.ts` — MODIFY

Refactor `buildContext` to call the shared helper. This removes the duplicated tracking loop. Leave `normalizeRow` and `detect` untouched.

**Step 3.1** Replace the imports at the top with:

```ts
import type { BrokerParserConfig, NormalizedExecution } from './types';
import {
  parseTimeToSeconds,
  resolveSidesByPositionState,
  type PositionResolverRow,
} from './utils';
```

**Step 3.2** Replace the entire `buildContext` function (lines 35-100) with:

```ts
  buildContext: (rows) => {
    const inputs: PositionResolverRow[] = [];

    rows.forEach((row, rowIndex) => {
      const symbol = cleanString(readCell(row, 'Symbol')).toUpperCase();
      const rawSide = cleanString(readCell(row, 'Side')).toUpperCase();
      const qty = Math.abs(parseNumber(readCell(row, 'Qty')));

      if (!symbol || qty === 0) return;
      if (rawSide !== 'SS' && rawSide !== 'S' && rawSide !== 'B') return;

      inputs.push({
        rowIndex,
        symbol,
        rawSide,
        qty,
        timeRank: parseTimeToSeconds(cleanString(readCell(row, 'Time'))),
      });
    });

    return resolveSidesByPositionState(inputs);
  },
```

The `DasContext` type alias at the top of the file becomes redundant — delete it. Update the cast inside `normalizeRow` from `(ctx as DasContext | undefined)?.resolvedSideByRow?.[rowIndex]` to `(ctx as { resolvedSideByRow?: Record<number, NormalizedExecution['side']> } | undefined)?.resolvedSideByRow?.[rowIndex]`.

#### 4. `lib/csv-parser.ts` — MODIFY

Stop bypassing the default parser. Have `processCsvData` and `extractRawExecutions` default to `defaultParser` when no parser argument is provided, so the position-resolving `buildContext` always runs.

**Step 4.1** Add an import at the top (after the existing imports):

```ts
import { defaultParser } from './parsers/default';
```

**Step 4.2** Inside `extractRawExecutions` (currently line 114), replace:

```ts
  const warnings: string[] = [];
  const executions: MatcherExecution[] = [];
  const parserContext = parser?.buildContext?.(data as Record<string, unknown>[]);

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = parser
        ? parser.normalizeRow(rawRow as Record<string, unknown>, rowIndex, parserContext)
        : builtinNormalizeRow(rawRow as Record<string, unknown>, rowIndex, warnings);
```

with:

```ts
  const warnings: string[] = [];
  const executions: MatcherExecution[] = [];
  const activeParser = parser ?? defaultParser;
  const parserContext = activeParser.buildContext?.(data as Record<string, unknown>[]);

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = activeParser.normalizeRow(rawRow as Record<string, unknown>, rowIndex, parserContext);
```

**Step 4.3** Inside `processCsvData` (currently line 225), apply the same swap. Replace:

```ts
  const symbolMap: Record<string, SymbolExecutions> = {};
  const warnings: string[] = [];
  const parserContext = parser?.buildContext?.(data as Record<string, unknown>[]);

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = parser
        ? parser.normalizeRow(rawRow as Record<string, unknown>, rowIndex, parserContext)
        : builtinNormalizeRow(rawRow as Record<string, unknown>, rowIndex, warnings);
```

with:

```ts
  const symbolMap: Record<string, SymbolExecutions> = {};
  const warnings: string[] = [];
  const activeParser = parser ?? defaultParser;
  const parserContext = activeParser.buildContext?.(data as Record<string, unknown>[]);

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = activeParser.normalizeRow(rawRow as Record<string, unknown>, rowIndex, parserContext);
```

**Step 4.4** Delete `builtinNormalizeRow` (currently lines 197-223) entirely. It is no longer referenced.

Note: `defaultParser.normalizeRow` does NOT emit "Unknown side" or "Zero quantity" warnings that `builtinNormalizeRow` did. That's an acceptable behavior change — these warnings were noisy and the unmatched-execution warnings downstream still catch real issues. If you find a test that relied on the "Unknown side" warning string, update the expectation rather than re-adding the warning.

#### 5. `lib/trade-utils.ts` — MODIFY

Stop substituting `undefined` for the default parser. After the parser change, the default parser carries position-tracking, so it must run.

**Step 5.1** Line 163, replace:

```ts
            const parsed = processCsvData(rows, dateInfo, parser && parser.id !== 'default' ? parser : undefined);
```

with:

```ts
            const parsed = processCsvData(rows, dateInfo, parser ?? undefined);
```

**Step 5.2** Lines 209-212, replace:

```ts
            const extracted = extractRawExecutions(
              rows,
              parser && parser.id !== 'default' ? parser : undefined,
            );
```

with:

```ts
            const extracted = extractRawExecutions(rows, parser ?? undefined);
```

#### 6. `__tests__/csv-parser.test.ts` — MODIFY

Two test updates:

**Step 6.1** Update the "produces warnings for unknown sides, zero quantities, and unmatched executions" test (currently lines 182-202). After the fix, the lone `B` for SPY (no open short) resolves to a long entry, so the warning text changes. Also, the `HOLD` and zero-qty warnings are no longer emitted by the default parser, so those expectations drop out.

Replace the entire `expect(result.warnings).toEqual([...])` block with:

```ts
    expect(result.warnings).toEqual([
      'QQQ: 3 unmatched SHORT SELL shares (1 fill) — position may still be open short',
      'SPY: 2 unmatched BUY shares (1 fill) — position may still be open long',
      'ORCL: 5 unmatched SELL shares (1 fill) — no matching long entries (carry-over from earlier session?)',
    ]);
```

**Step 6.2** Append a new `describe` block after the existing "basic FIFO pairing" suite (after the closing `});` on line 344) to lock in the position-tracking behavior:

```ts
describe('processCsvData — position-tracking B resolution', () => {
  const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };

  it('treats lone B/S pair (no SS) as a long round-trip', () => {
    const rows = [
      { Symbol: 'ASTC', Side: 'B', Qty: '100', Price: '27', Time: '09:30:00', Commission: '0', Fees: '0' },
      { Symbol: 'ASTC', Side: 'S', Qty: '100', Price: '29', Time: '10:00:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].direction).toBe('LONG');
    expect(result.trades[0].pnl).toBeCloseTo(200);
  });

  it('treats SS-then-B as a short cover, not a long open', () => {
    const rows = [
      { Symbol: 'NCT', Side: 'SS', Qty: '100', Price: '5.50', Time: '08:56:00', Commission: '0', Fees: '0' },
      { Symbol: 'NCT', Side: 'B', Qty: '100', Price: '4.00', Time: '14:02:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].direction).toBe('SHORT');
    expect(result.trades[0].pnl).toBeCloseTo(150);
  });

  it('splits SS→B→B→S into one short and one long', () => {
    const rows = [
      { Symbol: 'SPRC', Side: 'SS', Qty: '100', Price: '12', Time: '09:24:00', Commission: '0', Fees: '0' },
      { Symbol: 'SPRC', Side: 'B', Qty: '100', Price: '15', Time: '09:46:00', Commission: '0', Fees: '0' },
      { Symbol: 'SPRC', Side: 'B', Qty: '50', Price: '12.50', Time: '11:46:00', Commission: '0', Fees: '0' },
      { Symbol: 'SPRC', Side: 'S', Qty: '50', Price: '10.30', Time: '12:58:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.trades).toHaveLength(2);
    const short = result.trades.find((t) => t.direction === 'SHORT');
    const long = result.trades.find((t) => t.direction === 'LONG');
    expect(short?.totalQuantity).toBe(100);
    expect(short?.pnl).toBeCloseTo(-300);
    expect(long?.totalQuantity).toBe(50);
    expect(long?.pnl).toBeCloseTo(-110);
  });

  it('emits an open-position warning when B has no matching S in the same file', () => {
    const rows = [
      { Symbol: 'ARM', Side: 'B', Qty: '500', Price: '315', Time: '09:32:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.trades).toHaveLength(0);
    expect(result.warnings).toContain(
      'ARM: 500 unmatched BUY shares (1 fill) — position may still be open long',
    );
  });
});
```

### Coworker's database state

You do NOT need to delete the coworker's existing 2026-05-28 trades before he re-imports. Here is why, based on the `import-raw` route (`app/api/trades/import-raw/route.ts`):

- Closed trades use deterministic IDs (`sortKey|symbol|direction`) and are inserted with `onConflictDoUpdate`. His existing `NCT|SHORT` and `SPRC|SHORT` rows will be **overwritten** with corrected totals on re-import. The associated `tradeExecutions` are deleted and re-inserted per the route logic at lines 154-161.
- Newly-correct long trades (`ASTC|LONG`, `ATPC|LONG`, `SPRC|LONG`) get fresh inserts with no collisions.
- Open positions like `ARM|LONG` (no exit) use random-suffixed IDs and insert cleanly.
- The `tradeImportBatches` dedup row uses a SHA-256 hash of the executions array. After the fix, the parser emits different sides for the same CSV, so the hash differs and the dedup check (lines 99-107) does **not** block the re-import.

The only artifact left behind will be the original (stale) batchKey row in `tradeImportBatches` — harmless.

If the coworker wants a 100% clean slate anyway, he can manually delete his 2026-05-28 trades from the UI before re-importing, but it is not required.

### Files Changed Summary

| File | Lines +/- | Risk |
|---|---|---|
| `lib/parsers/utils.ts` | +~65 / -0 | Low — pure new export |
| `lib/parsers/default.ts` | ~+50 / -28 (rewrite) | Medium — behavior change for default path |
| `lib/parsers/das-trader.ts` | ~+20 / -65 (refactor) | Low — delegates to shared helper, behavior unchanged |
| `lib/csv-parser.ts` | ~+5 / -32 (drops `builtinNormalizeRow`) | Medium — every import goes through `defaultParser` |
| `lib/trade-utils.ts` | +2 / -2 | Low |
| `__tests__/csv-parser.test.ts` | +~65 / -5 | Low — test updates + new coverage |

### Verification Steps

Run all of these from the repo root after implementing:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npx vitest run __tests__/csv-parser.test.ts __tests__/das-trader-parser.test.ts __tests__/position-matcher.test.ts __tests__/trades-import-route.test.ts`
4. `npm test`

Manual smoke test (golden path):

5. Start `npm run dev`, log in as a non-prod user.
6. Import the coworker's CSV (file content is in the session log if needed — header: `Time,Symbol,Action,Price,Quantity,Commision`; mix of `B`, `S`, `SS` rows).
7. Confirm the Trades tab now shows:
   - `ASTC` LONG (B→S round-trip)
   - `ATPC` LONG (B→S round-trip)
   - `NCT` SHORT (SS→B)
   - `SPRC` SHORT (SS→B) AND `SPRC` LONG (later B→S)
   - `ARM` LONG **open position** (B with no S — should appear with an "open" badge)
8. Confirm no unmatched-fill warnings for ASTC, ATPC, NCT.

### Acceptance Criteria

- [x] `lib/parsers/utils.ts` exports `resolveSidesByPositionState` and the `PositionResolverRow` / `PositionResolverResult` types.
- [x] `lib/parsers/default.ts` defines a `buildContext` that uses `resolveSidesByPositionState`, and `normalizeRow` prefers the resolved side over `SIDE_ALIASES[rawSide]`.
- [x] `lib/parsers/das-trader.ts` calls `resolveSidesByPositionState` from its `buildContext` instead of duplicating the loop.
- [x] `lib/csv-parser.ts` has no `builtinNormalizeRow` function and both `processCsvData` and `extractRawExecutions` use `defaultParser` when no parser is supplied.
- [x] `lib/trade-utils.ts` no longer special-cases `parser.id === 'default'`.
- [x] The new "position-tracking B resolution" describe block in `__tests__/csv-parser.test.ts` passes.
- [x] `npm run lint`, `npx tsc --noEmit`, and `npm test` all pass.
- [ ] Manual smoke confirms ASTC and ATPC LONG trades now appear after re-importing the coworker's CSV.

Completion evidence:
- `npx vitest run __tests__/csv-parser.test.ts __tests__/das-trader-parser.test.ts __tests__/position-matcher.test.ts __tests__/trades-import-route.test.ts` passed (4 files, 60 tests).
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed (92 files, 671 tests).
- Manual browser/import smoke was not run in this session.

## Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
