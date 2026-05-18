# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-18
> Purpose: active execution spec for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

## Current Context

- Completed spec below: **Multi-Day & Overnight Position Support — Phase 3** (closedAt-based PnL bucketing). Journal aggregates, the trading calendar, and the daily-PnL view in the performance stats table now bucket realized PnL by `closedAt` with `date` as a fallback; open trades are excluded from the calendar roll-up. Out of scope stayed untouched: entry-time analyses (`PerformanceCharts` day-of-week / hour-of-day stats), the trade table's entry-date column, and `hooks/use-trade-filters.ts`.
- Validation completed 2026-05-18: `npx vitest run __tests__/journal-aggregates.test.ts`, `npm run lint`, `npx tsc --noEmit`, `npm test` (94 files / 694 tests), and `npm run workflow:audit` all passed.
- Prior shipped work: Phase 2 (`41cf32e`) — server-side `/api/trades/import-raw` route, matcher accepts pre-existing open positions, CSV upload flow swapped to the new endpoint. Phase 1 (`62a641107`) — schema/migration `0038`, close/merge/open-position UI, closed-only stats and journal aggregation. Collaborative Sample-Set Building (`b3bd170`, `d512db9`, `dfe35b4`, `cc33025`).
- Open parked items unrelated to active work: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, Backtest Manager `broke_premarket_high`.

## Active Execution Spec

## Multi-Day & Overnight Position Support — Phase 3

> Generated: 2026-05-18 | Agent: claude (plan)
> Status: COMPLETED — validated and locally committed by Codex on 2026-05-18

### Summary

Phase 1 backfilled `closed_at` on every closed trade in migration `0038`. Phase 2 set `closed_at` correctly when CSV imports close a prior-day open position. Phase 3 finally **uses** `closed_at` for time-of-realization bucketing in the three places it matters:

1. **Journal aggregates** (`lib/journal-aggregates.ts`) — `aggregateDay` / `aggregateWeek` currently bucket on `t.date` (entry day). They will switch to a `bucketKey(t)` derived from `closedAt`, with `t.date` as a fallback for safety.
2. **Trading calendar** (`components/trading/TradingCalendar.tsx`) — the daily PnL map at line 67–83 currently buckets on `trade.date`. It will use the same `bucketKey` and exclude `isOpen` trades (it does not exclude them today, even though they only contribute 0 PnL).
3. **Performance stats table** (`components/trading/PerformanceStatsTable.tsx`) — `dailyTotals` / `dailyVolume` and the streak detector (`sortedByDate`) currently key off `trade.sortKey` and `trade.date`. They will switch to `bucketKey`.

A Mon-buy/Tue-sell trade then shows its realized PnL under Tuesday everywhere users look at realized performance. Open trades stay invisible to PnL aggregates (already true for journal, becomes true for the calendar).

**Out of scope (deliberate, leave for later sprints):**
- `components/trading/PerformanceCharts.tsx` day-of-week and hour-of-day stats — those describe **entry-time** patterns. Keep using `trade.date`.
- `components/trading/TradeTable.tsx` Date column — shows the trade's entry day; that's correct for a trade list.
- `hooks/use-trade-filters.ts` date-range filter — filters by entry day ("trades I took in May"); user expectation.
- Multi-day span rendering on the calendar (a separate follow-up — Phase 3 only changes bucketing, not rendering).
- New schema migration (no schema work needed — `closed_at` already exists).

### Scope

**In scope (files touched):**
- `lib/journal-aggregates.ts` — add `bucketKey` helper, switch `aggregateDay` / `aggregateWeek` to use it
- `components/trading/TradingCalendar.tsx` — bucket on `bucketKey`, skip `isOpen` trades
- `components/trading/PerformanceStatsTable.tsx` — bucket on `bucketKey` for `dailyTotals` / `dailyVolume`, sort by `bucketKey` for streak detection
- `__tests__/journal-aggregates.test.ts` — add cross-day-close cases

**Not touched:**
- Schema, migrations, drizzle config
- API routes (`app/api/**`) — all routes already write `closed_at` correctly per Phase 1/2
- `lib/types.ts` — `Trade.closedAt` already exists as `string | null`
- `lib/server-db-utils.ts` — `toTrade` already maps `closedAt`
- `PerformanceCharts.tsx`, `TradeTable.tsx`, `hooks/use-trade-filters.ts` (see "Out of scope")

---

### Design decisions baked into this spec

1. **Helper goes in `lib/journal-aggregates.ts`, exported.** All three consumers import it from there. Naming it generically (`bucketKey`) keeps the dependency one-way: components depend on the lib, not vice versa.

2. **Fallback to `t.date` when `closedAt` is null.** Defensive — Phase 1's migration backfilled every `is_open=false` row, but if a future code path ever forgets to set `closedAt`, the trade still buckets somewhere sensible instead of falling out of the calendar entirely. `closedAt ?? date` is the rule.

3. **Open trades are excluded from all PnL buckets.** Journal aggregates already do this. The calendar will start doing this — currently open trades contribute `netPnl = 0` to their entry day, which is technically a no-op for totals but does increment the day's trade-count display. After Phase 3, open trades don't appear in any daily roll-up. This matches user intuition ("the calendar shows realized PnL").

4. **Timezone semantics are unchanged.** Both `t.date` (string `'2026-05-15'`) and `t.closedAt` (UTC ISO string) get fed to `new Date(...)` then `format(d, 'yyyy-MM-dd')` (date-fns local format). This mirrors the existing `toLocalDateKey` in `lib/journal-aggregates.ts`. Pre-existing edge cases around UTC-midnight strings rendering as the previous local day are not introduced or fixed here — Phase 3 explicitly preserves the current behavior.

5. **`PerformanceStatsTable.dailyTotals` switches from `trade.sortKey` to `bucketKey`.** `sortKey` is always the entry-day key (e.g. `'2026-05-15'`). For a cross-day trade, that's the wrong day for a "daily PnL" stat. After this change, the same trade's realized PnL counts against its close day in average-daily-PnL and average-daily-volume metrics.

6. **No new types.** `bucketKey` is a `string` (yyyy-MM-dd, local). The existing `toLocalDateKey` is exported as the underlying day-formatter and reused.

---

### Implementation Steps

---

#### Step 1: Add `bucketKey` to `lib/journal-aggregates.ts`

**File:** `lib/journal-aggregates.ts`
**Action:** MODIFY

**Goal:** Expose a single helper that returns the local-day key a trade should bucket into for PnL aggregation. Make `toLocalDateKey` exported (it's the underlying primitive) and add `bucketKey` on top.

**Instructions:**

1. **Export `toLocalDateKey`** (currently line 21–24 — local, not exported). Change `function toLocalDateKey(...)` to `export function toLocalDateKey(...)`. The body stays identical.

2. **Add a new exported `bucketKey` helper** immediately after `toLocalDateKey`:

```ts
/**
 * The local day key (yyyy-MM-dd) a trade should bucket into for realized PnL.
 * - Closed trades bucket on `closedAt` (the day PnL was realized).
 * - Falls back to `date` (entry day) for safety — should be unreachable for
 *   closed rows after migration 0038, but defensive.
 * - Open trades have no realized PnL; callers should exclude them BEFORE
 *   asking for a bucket key, but if asked, this returns the entry-day key.
 */
export function bucketKey(trade: Pick<Trade, 'date' | 'closedAt'>): string {
  const source = trade.closedAt ?? trade.date;
  return toLocalDateKey(source);
}
```

3. **Replace `aggregateDay`** (currently line 30–48) to use `bucketKey`:

```ts
export function aggregateDay(trades: Trade[], date: string): DayAggregate {
  const matching = trades.filter((t) => !t.isOpen && bucketKey(t) === date);

  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    grossResult += t.grossPnl;
    netResult += t.netPnl;
    if (t.initialRisk && t.initialRisk > 0) {
      rTotal += t.netPnl / t.initialRisk;
    }
    tradeIds.push(t.id);
  }

  return { grossResult, netResult, rTotal, tradeIds };
}
```

4. **Replace `aggregateWeek`** (currently line 53–86) to use `bucketKey`:

```ts
export function aggregateWeek(
  trades: Trade[],
  weekStart: string,
  weekEnd: string,
): WeekAggregate {
  const matching = trades.filter((t) => {
    if (t.isOpen) return false;
    const key = bucketKey(t);
    return key >= weekStart && key <= weekEnd;
  });

  const dayRMap: Record<string, number> = {};
  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    const key = bucketKey(t);
    grossResult += t.grossPnl;
    netResult += t.netPnl;
    if (t.initialRisk && t.initialRisk > 0) {
      const r = t.netPnl / t.initialRisk;
      rTotal += r;
      dayRMap[key] = (dayRMap[key] ?? 0) + r;
    }
    tradeIds.push(t.id);
  }

  const perDayR = Object.entries(dayRMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => ({ date, r }));

  return { grossResult, netResult, rTotal, perDayR, tradeIds };
}
```

The only functional change versus today: a closed trade whose `closedAt` is on a different day than `date` now buckets on `closedAt`. Same-day round-trips and pre-Phase-1 backfilled trades behave identically (because Phase 1's migration set `closed_at = date` for those).

**Acceptance:**
- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes
- [x] `bucketKey` is exported from `lib/journal-aggregates.ts`
- [x] `toLocalDateKey` is exported from `lib/journal-aggregates.ts`

---

#### Step 2: Switch `TradingCalendar.tsx` to `bucketKey` and exclude open trades

**File:** `components/trading/TradingCalendar.tsx`
**Action:** MODIFY

**Instructions:**

1. **Add an import** for `bucketKey` from journal-aggregates. Add to the existing import block at the top of the file (after the date-fns import):

```ts
import { bucketKey } from '@/lib/journal-aggregates';
```

2. **Replace the `dailyStats` useMemo** (currently line 67–83). The two changes:
   - Skip `isOpen` trades entirely.
   - Use `bucketKey(trade)` instead of `format(new Date(trade.date), 'yyyy-MM-dd')`.

```ts
  const dailyStats = useMemo(() => {
    const stats: Record<string, { pnl: number; r: number; trades: Trade[] }> = {};
    trades.forEach((trade) => {
      if (trade.isOpen) return;
      const dateKey = bucketKey(trade);
      if (!stats[dateKey]) {
        stats[dateKey] = { pnl: 0, r: 0, trades: [] };
      }
      stats[dateKey].pnl += trade.netPnl;
      stats[dateKey].trades.push(trade);
      // Sort by entry day descending so the day's trades render newest-first.
      stats[dateKey].trades.sort((a, b) => b.date.getTime() - a.date.getTime());
      if (trade.initialRisk) {
        stats[dateKey].r += trade.netPnl / trade.initialRisk;
      }
    });
    return stats;
  }, [trades]);
```

Don't change `weeks`, `monthlyR`, or any of the cell-render code — they read from `dailyStats` and stay correct.

**Acceptance:**
- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes
- [x] No other code in `TradingCalendar.tsx` references `format(new Date(trade.date), ...)` for bucketing — only the spot replaced above.

---

#### Step 3: Switch `PerformanceStatsTable.tsx` daily aggregates + streak sort to `bucketKey`

**File:** `components/trading/PerformanceStatsTable.tsx`
**Action:** MODIFY

**Instructions:**

1. **Add an import** for `bucketKey`. Add to the existing imports near the top of the file:

```ts
import { bucketKey } from '@/lib/journal-aggregates';
```

2. **Replace the `dailyTotals` / `dailyVolume` loop** (currently line 140–146):

```ts
    const dailyTotals = new Map<string, number>();
    const dailyVolume = new Map<string, number>();
    for (const trade of closedTrades) {
      const key = bucketKey(trade);
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + trade.netPnl);
      dailyVolume.set(key, (dailyVolume.get(key) ?? 0) + trade.totalQuantity);
    }
```

This is the only change to the "daily averages" stats — they now reflect realized-per-day, not entry-per-day.

3. **Replace the streak sort line** (currently line 179):

```ts
    const sortedByDate = [...closedTrades].sort((a, b) => {
      const aKey = bucketKey(a);
      const bKey = bucketKey(b);
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      // Tie-break by exit time within the same close day so streaks are
      // chronologically ordered by realization, not entry.
      return a.exitTime.localeCompare(b.exitTime);
    });
```

Rationale: streaks ("max consecutive wins/losses") should be ordered by when the trade was *closed* (realized), not when it was *opened*. A Mon-buy/Tue-sell that closes profitably belongs after Tuesday's earlier closes in the streak ordering.

4. **Do NOT touch** the `parseHoldMinutes` calls (line 81–82) — those are computing hold duration from entry-day timestamps, which is correct.

5. **Do NOT touch** `largestGainTrade` / `largestLossTrade` (line 208–209) — these sort on `netPnl`, not date.

**Acceptance:**
- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes
- [x] No leftover `trade.sortKey` references in the `dailyTotals` block
- [x] `parseHoldMinutes` is left alone

---

#### Step 4: Extend `__tests__/journal-aggregates.test.ts` with cross-day-close cases

**File:** `__tests__/journal-aggregates.test.ts`
**Action:** MODIFY

**Instructions:**

1. **Update `makeTrade`** (currently line 9–30) to accept and pass through `closedAt`. The current factory builds a Date in local time for `date` but doesn't set `closedAt`. Add a default that mirrors `date` so existing tests stay green:

```ts
function makeTrade(overrides: Partial<Trade> & { date: Date; id: string }): Trade {
  const closedAt = overrides.closedAt ?? overrides.date.toISOString();
  return {
    symbol: 'TEST',
    direction: 'LONG',
    avgEntryPrice: 100,
    avgExitPrice: 101,
    totalQuantity: 100,
    grossPnl: 100,
    netPnl: 100,
    entryTime: overrides.date.toISOString(),
    exitTime: overrides.date.toISOString(),
    executionCount: 1,
    rawExecutions: [],
    pnl: 100,
    executions: 1,
    tags: [],
    isOpen: overrides.isOpen ?? false,
    remainingQty: overrides.remainingQty ?? 0,
    sortKey: '2026-04-17',
    closedAt,
    ...overrides,
  };
}
```

Notes:
- The default `closedAt = date.toISOString()` keeps same-day-close trades bucketing on `date` (because `bucketKey` falls back to `date` when `closedAt` is the same day).
- `overrides.closedAt` lets a test set a *different* close day to exercise the new bucketing.
- `overrides.closedAt ?? overrides.date.toISOString()` is evaluated BEFORE the `...overrides` spread; the spread then re-applies any explicit `closedAt` from overrides. Both reach the same value, so the order is safe.

2. **Add a new `describe` block at the end of the file** with cross-day cases:

```ts
describe('aggregateDay — closedAt-based bucketing', () => {
  it('buckets a cross-day-close trade under its close day, not its entry day', () => {
    const monEntry = new Date(2026, 4, 18, 14, 0); // Monday 2pm local
    const tueClose = new Date(2026, 4, 19, 10, 0); // Tuesday 10am local
    const trades: Trade[] = [
      makeTrade({
        id: 'cross-day',
        date: monEntry,
        closedAt: tueClose.toISOString(),
        netPnl: 250,
        grossPnl: 250,
        initialRisk: 100,
      }),
    ];

    // Monday: zero, because the trade's PnL realized on Tuesday.
    expect(aggregateDay(trades, '2026-05-18').netResult).toBe(0);
    expect(aggregateDay(trades, '2026-05-18').tradeIds).toEqual([]);

    // Tuesday: the full $250.
    const tue = aggregateDay(trades, '2026-05-19');
    expect(tue.tradeIds).toEqual(['cross-day']);
    expect(tue.netResult).toBe(250);
    expect(tue.rTotal).toBeCloseTo(2.5, 10);
  });

  it('falls back to date when closedAt is null', () => {
    const trades: Trade[] = [
      makeTrade({
        id: 'legacy',
        date: new Date(2026, 4, 18, 10, 0),
        closedAt: null,
        netPnl: 100,
        grossPnl: 100,
      }),
    ];

    expect(aggregateDay(trades, '2026-05-18').netResult).toBe(100);
    expect(aggregateDay(trades, '2026-05-18').tradeIds).toEqual(['legacy']);
  });
});

describe('aggregateWeek — closedAt-based bucketing', () => {
  it('counts a Fri-buy/Mon-sell trade against the week containing the close day', () => {
    // Entry on Friday 2026-05-15 (week 1), close on Monday 2026-05-18 (week 2).
    const friEntry = new Date(2026, 4, 15, 14, 0);
    const monClose = new Date(2026, 4, 18, 10, 0);
    const trades: Trade[] = [
      makeTrade({
        id: 'span',
        date: friEntry,
        closedAt: monClose.toISOString(),
        netPnl: 400,
        grossPnl: 400,
        initialRisk: 100,
      }),
    ];

    // Week 1 (Mon 5/11 – Fri 5/15): trade entered here but did NOT realize PnL.
    const week1 = aggregateWeek(trades, '2026-05-11', '2026-05-15');
    expect(week1.tradeIds).toEqual([]);
    expect(week1.netResult).toBe(0);

    // Week 2 (Mon 5/18 – Fri 5/22): trade closed here.
    const week2 = aggregateWeek(trades, '2026-05-18', '2026-05-22');
    expect(week2.tradeIds).toEqual(['span']);
    expect(week2.netResult).toBe(400);
    expect(week2.perDayR.map((d) => d.date)).toEqual(['2026-05-18']);
    expect(week2.perDayR[0].r).toBeCloseTo(4, 10);
  });
});
```

3. **Do NOT remove or change** the existing tests. They use `closedAt = date.toISOString()` by default (via the updated factory), so they continue to bucket on entry day — and pass.

**Acceptance:**
- [x] `npm test` — `__tests__/journal-aggregates.test.ts` passes with 0 failures (existing tests + new cross-day tests)
- [x] No other test file changes

---

#### Step 5: Lint, typecheck, test, commit

**Action:** RUN COMMANDS

```
npm run lint
npx tsc --noEmit
npm test
```

All must pass with 0 errors. Then commit:

```
git add -A
git commit -m "Phase 3: closedAt-based PnL bucketing — journal aggregates, trading calendar, performance stats"
```

Do NOT push.

**Acceptance:**
- [x] `npm run lint` — 0 errors
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm test` — 0 failing tests (94 files / 694 tests)
- [x] `git log --oneline -1` shows the commit above
- [x] `git status` is clean after the local commit

---

### Files Changed Summary

| File | Action | Lines +/- est. | Risk |
|---|---|---|---|
| `lib/journal-aggregates.ts` | MODIFY | +~20 / -~5 | LOW — additive helper, two surgical filter swaps |
| `components/trading/TradingCalendar.tsx` | MODIFY | +~3 / -~2 | LOW — one useMemo block touched |
| `components/trading/PerformanceStatsTable.tsx` | MODIFY | +~10 / -~5 | LOW — two surgical replacements |
| `__tests__/journal-aggregates.test.ts` | MODIFY | +~80 | LOW — tests only |

**Not touched in Phase 3:** schema, migrations, API routes, `lib/types.ts`, `lib/server-db-utils.ts`, `PerformanceCharts.tsx`, `TradeTable.tsx`, `hooks/use-trade-filters.ts`, any UI outside the calendar / stats table.

---

### Verification Steps

**Automated:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`

**Manual checks (Codex does NOT need to run these — they're for the user post-execution):**
- [ ] Open the Journal tab → daily aggregate for a known Mon-buy/Tue-sell trade shows the PnL under Tuesday, not Monday
- [ ] Open the Performance tab → Trading Calendar shows the same trade colored on the Tuesday cell, not the Monday cell
- [ ] Open the Performance Stats table → "Average Daily Gain/Loss" reflects the trade against its close day
- [ ] Same-day round-trip trades still appear on their (single) day — no regression
- [ ] Open positions do NOT appear in any calendar cell PnL or journal aggregate (Phase 3 also fixes the calendar's pre-existing "open trade leaks 0-pnl trade-count" bug)
- [ ] DO NOT git push — verify Codex stopped after committing locally

---

### Complexity Estimate

LOW — 4 files touched, no schema changes, no new API routes, no new types. The `bucketKey` helper is the central abstraction; the three call sites are surgical. Estimate 30–60 minutes of Codex execution time. The risk surface is small because most of the new behavior is opt-in via `closedAt`, which Phase 1 already backfilled.

---

## Follow-up Specs (not yet planned)

### Route-level testing infrastructure

Stand up a test DB harness (Postgres in Docker via testcontainers, or a vitest setup that points at a disposable schema) so we can write real integration tests for API routes. Phase 1's `__tests__/trade-merge.test.ts` only covers the merge math in isolation — auth, ownership, opposite-direction 400s, and the FK cascade on `trade_executions` are uncovered today. Phase 2 adds `/api/trades/import-raw` which similarly has only matcher-level tests. Once the harness exists, immediate targets are `app/api/trades/merge/route.ts`, the close-position branch of `app/api/trades/[id]/route.ts`, and `app/api/trades/import-raw/route.ts`.

### Partial close UX on the Close Position button

Phase 1 ships a "Close Position (Full)" button on `TradeDetailSheet`. Phase 2's matcher handles partial closes from CSV imports, but the UI button still closes the full position. A future sprint should let the user enter a quantity ≤ `remainingQty`, similar to how brokers offer partial fills. Touches `TradeDetailSheet.tsx`, the close-position schema, and the PATCH `/api/trades/[id]` branch.

### Calendar / journal multi-day span views

Phase 3 buckets cross-day trades by `closedAt`. The trade still only renders as a single cell on the calendar (the close day). A future sprint could render multi-day positions as a horizontal span across the entry → close days, similar to how Gantt charts show duration. The same idea applies to the journal list, which today shows one row per trade with no visual cue that the trade was open overnight. Touches `TradingCalendar.tsx` (cell layout becomes harder — spans cross week boundaries), `JournalTab.tsx`, and likely a small CSS-grid refactor. Mostly a visual feature; depends on user feedback after Phase 3 ships.

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
