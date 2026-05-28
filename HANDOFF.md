# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-28
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Next Up: Sprint 6 — Rate Limiting

> Status: NOT YET SPECCED

Scope: DB-backed sliding-window rate limiter for expensive endpoints (`/api/research-report`, `/api/askedgar/tldr`). New `rate_limit_hits` table, shared `lib/rate-limit.ts` helper, integration into target routes, 429 responses with standard headers. See `docs/repo-cleanup.md` § "Rate Limiting On Expensive Endpoints" for the finding.

---

## Multi-Day Trade Replay Charts

> Generated: 2026-05-28 | Agent: claude (inline, post-investigation)
> Status: COMPLETE — validated 2026-05-28

### Problem

The trade replay chart is hard-locked to a single day. `JournalTradeChart` and `TradeDetailSheet` both build the candle window from `trade.sortKey` (the entry day) and pin every execution marker to that day. For a multi-day (swing) trade, the chart only shows the entry day, the exit-day fills land on the wrong day, and the date label shows a single day instead of the span.

### Fix (decided with user)

For **closed** trades that span more than one day, widen the intraday candle window from the entry day through the exit day, place `EXIT`-side execution markers on the exit day, and show a date *range* in the labels. Open positions are intentionally left single-day. Detection reuses the existing `isCrossDayTrade(trade)` helper (which already returns `false` for open trades) and `bucketKey(trade)` (the exit day, derived from `closedAt`). Default timeframe stays `5m` (already the default in both render sites); the timeframe selector is unchanged.

The multi-day window is added behind an **optional** third param on `buildTradeChartOptions`, so the two non-trade callers (`ResearchChart`, `WatchlistTickerChart`, which pass only 2 args) are completely unaffected.

> Scope: only the two trade-replay render paths change. Do NOT change `ResearchChart` or `WatchlistTickerChart`.

---

#### 1. File: `lib/chart-timeframes.ts` — Action: MODIFY

Add an optional `endSortKey` param to `buildTradeChartOptions` (currently lines 24-44). When `endSortKey` is provided and differs from `sortKey`, take the window end from the exit day's session; otherwise behavior is identical to today. Replace the function body:

```ts
export function buildTradeChartOptions(
  sortKey: string,
  timeframe: TradeChartTimeframeKey,
  endSortKey?: string,
): TradeChartRequestOptions {
  const base = TRADE_CHART_TIMEFRAME_CONFIG[timeframe];
  const baseOptions: TradeChartRequestOptions = {
    periodType: base.periodType,
    period: base.period,
    frequencyType: base.frequencyType,
    frequency: base.frequency,
  };

  if (timeframe === '1d') {
    return baseOptions;
  }

  const startWindow = getIntradaySessionWindow(sortKey, true);
  const endWindow = endSortKey && endSortKey !== sortKey
    ? getIntradaySessionWindow(endSortKey, false)
    : startWindow;
  return {
    ...baseOptions,
    startDate: startWindow?.startDate,
    endDate: endWindow?.endDate,
    includePrePost: true,
  };
}
```

Behavior: 2-arg calls → `endWindow === startWindow` → identical output to today. 3-arg calls with a later `endSortKey` → window runs from the entry day's prior-session start through the exit day's session end.

Acceptance:
- [x] `buildTradeChartOptions('2026-05-26', '5m')` is byte-identical to the pre-change output.
- [x] `buildTradeChartOptions('2026-05-26', '5m', '2026-05-28')` returns a larger `endDate` than the 2-arg call (window extends to the later day).
- [x] `'1d'` timeframe still returns base options (no dates), regardless of `endSortKey`.

---

#### 2. File: `lib/ui-trade-utils.ts` — Action: MODIFY

Add the import (after line 2, the existing type import):
```ts
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
```
(No circular import: `journal-aggregates.ts` imports only `date-fns` and `@/lib/types`; it does not import `ui-trade-utils`.)

Rewrite `buildTradeMarkers` (currently lines 43-71) so `EXIT`-side fills resolve against the exit day:

```ts
export function buildTradeMarkers(trade: Trade): TradeMarker[] {
  const exitDay = isCrossDayTrade(trade) ? bucketKey(trade) : trade.sortKey;

  if (trade.rawExecutions.length > 0) {
    return trade.rawExecutions.flatMap((execution) => {
      const dayKey = execution.side === 'EXIT' ? exitDay : trade.sortKey;
      const abs = parseAbsoluteTimestampMs(execution.timestamp);
      const time = abs ?? nyDateTimeToEpoch(dayKey, execution.time);
      if (time == null || !Number.isFinite(time)) return [];
      const direction = execution.side === 'ENTRY'
        ? trade.direction
        : trade.direction === 'LONG' ? 'SHORT' : 'LONG';
      return [{ time, direction, price: execution.price, label: execution.side }];
    });
  }

  const markers: TradeMarker[] = [];
  const entry = nyDateTimeToEpoch(trade.sortKey, trade.entryTime);
  const exit = nyDateTimeToEpoch(exitDay, trade.exitTime);
  if (entry != null) {
    markers.push({ time: entry, direction: trade.direction, price: trade.avgEntryPrice, label: 'ENTRY' });
  }
  if (exit != null) {
    markers.push({
      time: exit,
      direction: trade.direction === 'LONG' ? 'SHORT' : 'LONG',
      price: trade.avgExitPrice,
      label: 'EXIT',
    });
  }
  return markers;
}
```

For a same-day or open trade, `exitDay === trade.sortKey`, so output is unchanged. Executions that carry an absolute `timestamp` are still honored first (the `abs ??` path).

Acceptance:
- [x] For a same-day trade, marker output is unchanged.
- [x] For a closed cross-day trade, an `EXIT` execution (or the fallback exit marker) resolves to an epoch on the exit day — strictly greater than the entry-day epoch.

---

#### 3. File: `components/trading/JournalTradeChart.tsx` — Action: MODIFY

Add the import (with the other `@/lib` imports near the top):
```ts
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
```

Replace the `chartOptions` memo (currently lines 20-22) so it passes the exit day:
```ts
  const chartOptions = useMemo(() => {
    return buildTradeChartOptions(
      trade.sortKey,
      timeframe,
      isCrossDayTrade(trade) ? bucketKey(trade) : undefined,
    );
  }, [trade, timeframe]);
```
(Dependency array changes from `[trade.sortKey, timeframe]` to `[trade, timeframe]`.) Markers already come from `buildTradeMarkers(trade)`, so they are fixed by step 2 — no other change here.

Acceptance:
- [x] A closed cross-day trade's chart requests candles spanning entry→exit day; a same-day trade is unchanged.

---

#### 4. File: `components/trading/TradeDetailSheet.tsx` — Action: MODIFY

Add the import (with the other `@/lib` imports):
```ts
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
```

4a. Replace the `chartOptions` memo (currently lines 63-66):
```ts
  const chartOptions = useMemo(() => {
    if (!trade) return null;
    return buildTradeChartOptions(
      trade.sortKey,
      timeframe,
      isCrossDayTrade(trade) ? bucketKey(trade) : undefined,
    );
  }, [trade, timeframe]);
```

4b. Replace the `sortedExecutions` memo (currently lines 73-78) so `EXIT` fills sort by their real day:
```ts
  const sortedExecutions = useMemo(() => {
    if (!trade) return [];
    const exitDay = isCrossDayTrade(trade) ? bucketKey(trade) : trade.sortKey;
    return [...(trade.rawExecutions ?? [])].sort(
      (a, b) =>
        timeValue(a.side === 'EXIT' ? exitDay : trade.sortKey, a.time, a.timestamp) -
        timeValue(b.side === 'EXIT' ? exitDay : trade.sortKey, b.time, b.timestamp),
    );
  }, [trade]);
```

4c. Replace `tradeDateLabel` (currently line 85) with a range when cross-day:
```ts
  const tradeDateLabel = trade
    ? isCrossDayTrade(trade)
      ? `${format(new Date(`${trade.sortKey}T00:00:00`), 'MMM dd')} – ${format(new Date(`${bucketKey(trade)}T00:00:00`), 'MMM dd, yyyy')}`
      : format(new Date(`${trade.sortKey}T00:00:00`), 'MMM dd, yyyy')
    : '';
```
(`bucketKey` returns a `yyyy-MM-dd` string, so the `new Date(...T00:00:00)` pattern matches the existing one. `format` is already imported.)

Acceptance:
- [x] Closed cross-day trade shows e.g. `May 26 – May 28, 2026`; same-day shows the single date as before.
- [x] The executions table orders entry-day fills before exit-day fills.

---

#### 5. File: `components/trading/JournalTab.tsx` — Action: MODIFY

Add the import (with the other `@/lib` imports near line 13):
```ts
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
```

Replace the time-range label (currently line 329):
```tsx
                            <p className="font-mono text-muted-foreground">
                              {isCrossDayTrade(trade)
                                ? `${format(new Date(`${trade.sortKey}T00:00:00`), 'MMM dd')} ${trade.entryTime || '--:--'} → ${format(new Date(`${bucketKey(trade)}T00:00:00`), 'MMM dd')} ${trade.exitTime || '--:--'}`
                                : `${trade.entryTime || '--:--'} - ${trade.exitTime || '--:--'}`}
                            </p>
```
(`format` is already imported in this file.)

Acceptance:
- [x] Cross-day trade reads e.g. `May 26 15:59 → May 28 09:31`; same-day keeps `09:30 - 09:45`.

---

#### 6. File: `__tests__/chart-timeframes.test.ts` — Action: MODIFY

Add a test that the optional `endSortKey` widens the window. Mirror the existing test style in the file:
```ts
it('widens the intraday window to the exit day when endSortKey is later', () => {
  const single = buildTradeChartOptions('2026-05-26', '5m');
  const multi = buildTradeChartOptions('2026-05-26', '5m', '2026-05-28');
  expect(multi.startDate).toBe(single.startDate);
  expect(Number(multi.endDate)).toBeGreaterThan(Number(single.endDate));
});
```

Acceptance:
- [x] New test passes under `npm test`.

---

### Known limitations (document, do not engineer around)

1. **Scale-outs across 3+ days.** Executions store only a clock time + `ENTRY`/`EXIT` side, not a per-fill date. All `EXIT` fills are placed on the final close day (`closedAt`). Correct for the common two-day swing; approximate for exits spread across 3+ days.
2. **Weekend/holiday gaps** render as flat spots in the multi-day window (cosmetic; the provider only returns trading days).
3. **Provider intraday history depth.** Very old multi-day trades may return no intraday candles; the existing "No intraday candles for this trade day." message already covers this.
4. **Open positions stay single-day** by design (`isCrossDayTrade` returns `false` for open trades).

### Files Changed Summary

| File | Action | ~LOC | Risk |
| --- | --- | --- | --- |
| `lib/chart-timeframes.ts` | MODIFY | +8/-4 | Low |
| `lib/ui-trade-utils.ts` | MODIFY | +5 | Low |
| `components/trading/JournalTradeChart.tsx` | MODIFY | +5/-1 | Low |
| `components/trading/TradeDetailSheet.tsx` | MODIFY | +12/-4 | Low |
| `components/trading/JournalTab.tsx` | MODIFY | +5/-1 | Low |
| `__tests__/chart-timeframes.test.ts` | MODIFY | +6 | Low |

### Verification Steps

Automated (from repo root):
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

Manual (browser; not run in this session):
- [ ] Open a same-day closed trade in the detail sheet and in the Journal replay view → chart, markers, date label, and time label are unchanged from today.
- [ ] Open a closed multi-day swing (e.g. ARM short opened May 26, covered May 28) → the chart spans May 26 through May 28, the entry marker sits on May 26 and the exit/cover marker sits on May 28, the detail-sheet date reads `May 26 – May 28, 2026`, and the Journal label reads `May 26 … → May 28 …`.
- [ ] `ResearchChart` and `WatchlistTickerChart` are visually unchanged (still single-day).

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

## Recently Completed

### CSV Parser: Position-Aware B Resolution

Status: completed 2026-05-28 (commit 5ea235b).

Outcome:
- Lifted DAS Trader's chronological position-resolver into shared `resolveSidesByPositionState` helper in `lib/parsers/utils.ts`.
- `defaultParser` now runs the resolver in `buildContext`, disambiguating raw `B` to `MARGIN` (long open) when no open short exists, or `B` (cover) when one does.
- Deleted `builtinNormalizeRow`; both `processCsvData` and `extractRawExecutions` default to `defaultParser`. Removed `parser.id === 'default'` bypass in `lib/trade-utils.ts`.

Validation:
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed (92 files, 671 tests).
- Manual browser smoke with coworker's 2026-05-28 CSV: PENDING — confirm ASTC/ATPC LONG trades appear, NCT/SPRC SHORT remain correct, ARM shows as open long.

### Cover/Close Entry Flow — Manual Entry (FIFO) + Import Side Resolution

Status: completed 2026-05-28 (commit c846e4a).

Outcome:
- Part A: manual New Trade form now detects an offsetting open position (same symbol, opposite direction) and prompts to close it FIFO instead of creating a new opposite open trade. New `lib/cover-position.ts` (pure FIFO math) + `app/api/trades/cover/route.ts` handle full close / partial / flip; `useTrades.handleCoverPosition` merges affected rows by id.
- Part B: import (raw CSV) path seeds `resolveSidesByPositionState` with the client's currently-open positions so a later-day `B` covering a carried-over short labels as a cover, not a new long. Threaded through `extractRawExecutions` → `collectRawExecutions` → `processImportFiles`.
- Known limits (intentional): multi-day folder import in one action won't link an open+cover across batches; same-symbol intraday round-trip while holding a carried-over position can mislabel. Supported workflow documented for coworkers.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (93 files, 677 tests) all passed.
- Manual browser smoke (Part A confirm/partial/flip/decline, Part B import seeding): PENDING user verification.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
