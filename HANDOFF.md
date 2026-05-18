# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-18
> Purpose: active execution spec for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

## Current Context

- Completed spec below: **Multi-Day & Overnight Position Support — Phase 4** (multi-day span rendering on the calendar + an `OVERNIGHT` badge in the trade table). `isCrossDayTrade` is now shared from `lib/journal-aggregates.ts`; closed cross-day trades render span bars across their entry-to-close calendar cells; cross-day rows in `TradeTable` show a violet `OVERNIGHT` badge. Open positions still stay invisible to the calendar — surfacing them is a separate sprint.
- Validation completed 2026-05-18: `npx vitest run __tests__/journal-aggregates.test.ts` (15 tests), `npm run lint`, `npx tsc --noEmit`, `npm test` (94 files / 698 tests), `npm run workflow:audit`, and `git diff --check` all passed.
- Prior shipped work: Phase 3 (`3e6a0f2`) — `bucketKey` helper in `lib/journal-aggregates.ts`, calendar/journal/stats now bucket realized PnL by `closedAt`, open trades excluded from the calendar roll-up; validated 2026-05-18 with lint + tsc + 94 test files / 694 tests all green. Phase 2 (`41cf32e`) — server-side `/api/trades/import-raw` route, matcher accepts pre-existing open positions, CSV upload flow swapped to the new endpoint. Phase 1 (`62a641107`) — schema/migration `0038`, close/merge/open-position UI, closed-only stats and journal aggregation. Collaborative Sample-Set Building (`b3bd170`, `d512db9`, `dfe35b4`, `cc33025`).
- Open parked items unrelated to active work: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, Backtest Manager `broke_premarket_high`.

## Active Execution Spec

## Multi-Day & Overnight Position Support — Phase 4

> Generated: 2026-05-18 | Agent: claude (plan)
> Status: COMPLETED — validated and locally committed by Codex on 2026-05-18

### Summary

Phase 3 made the *math* multi-day-aware (PnL realized on Tue counts against Tuesday). Phase 4 makes the *visualization* multi-day-aware. Two surfaces:

1. **Trading Calendar** (`components/trading/TradingCalendar.tsx`) — for closed cross-day trades, render a thin colored bar inside each day cell the position was open through (entry day, any in-between days, close day). The user sees at a glance that "TICK was held Fri → Mon" by reading the bars across the cells.
2. **Trade Table** (`components/trading/TradeTable.tsx`) — add an `OVERNIGHT` badge next to the symbol when a trade entered on one day and closed on another. Mirrors the existing `OPEN` badge pattern at line 141–145.

A small helper `isCrossDayTrade(trade)` lands in `lib/journal-aggregates.ts` so both consumers (and the tests) share one definition of "cross-day."

**Out of scope (deliberate, leave for later sprints):**
- Open-position spans on the calendar. Phase 3 hides open positions from the calendar entirely; Phase 4 keeps it that way. Rendering an "still open" span would require deciding what its end date is (today? indefinite?) and where its PnL lives. Separate sprint.
- Journal day-card carry-over UI. The `OVERNIGHT` badge in `TradeTable` is enough surfacing for this phase — a full "this day card includes a trade that started on a different day" treatment in `JournalTab.tsx` can come later if needed.
- The pre-existing inconsistency where clicking a calendar cell that owes its PnL to a cross-day close opens the *entry-day* journal card (because `JournalTab` groups by `sortKey`). Fixing this means changing journal grouping, which is a much bigger change. Left for a follow-up.
- Mobile-specific layout polish. Cells on mobile are `min-h-[60px]`; the spec's bar height + endpoint glyphs fit but may look cramped. Acceptable for Phase 4 — revisit if it looks bad in practice.
- Schema, API routes, new types. None of these change.

### Scope

**In scope (files touched):**
- `lib/journal-aggregates.ts` — add `isCrossDayTrade` helper, export it.
- `components/trading/TradingCalendar.tsx` — compute a `spanMap` (date → trades whose `[entry, close]` interval contains the date) and render bars per cell.
- `components/trading/TradeTable.tsx` — render `OVERNIGHT` badge next to the symbol cell when `isCrossDayTrade(trade)` is true.
- `__tests__/journal-aggregates.test.ts` — tests for `isCrossDayTrade` (same-day, cross-day, null `closedAt`, open trade).

**Not touched:**
- Schema, migrations, drizzle config.
- API routes (`app/api/**`).
- `lib/types.ts` — no new types.
- `JournalTab.tsx`, `DailyReportSheet.tsx`, `WeeklyReviewSheet.tsx`, `PerformanceStatsTable.tsx` — Phase 3 already fixed the math; visual treatment in those surfaces is deferred.
- `PerformanceCharts.tsx`, `hooks/use-trade-filters.ts` — these explicitly stay entry-day-keyed (see Phase 3 spec).

---

### Decisions Locked For Phase 4

These remove ambiguity before Codex starts. If any of them is wrong, update this section before execution.

- **D1. Span scope: closed cross-day trades only.** Open positions stay hidden on the calendar (Phase 3 behavior). The criterion for a "span" is `!isOpen && bucketKey(trade) !== toLocalDateKey(trade.date)`. Reasoning: open positions don't have a well-defined end and surfacing them is the next sprint's job; this phase is purely about visualizing already-closed cross-day exits.
- **D2. Bar color: PnL color, not direction color.** A winning span is `bg-emerald-500/50`; a losing span is `bg-rose-500/50`; a scratch span (`netPnl === 0`) is `bg-zinc-500/40`. Reasoning: the calendar's dominant visual signal is already win/loss color (cell PnL number); introducing a separate LONG/SHORT color scheme for bars would clash and confuse. PnL color is also what the user actually cares about on a calendar.
- **D3. Bar location inside the cell: vertically centered between the date number and the PnL block.** A new `<div className="flex flex-col gap-0.5">` lane sits between the day-number `<span>` and the bottom-aligned PnL block. Reasoning: keeps the existing PnL block at `mt-auto`; the lane just consumes some of the flex space that used to be empty. No need to refactor the cell's overall flex layout.
- **D4. Maximum visible bars per cell: 2.** Trades sorted by `bucketKey` ascending (close day) so the earliest-closing position renders first. If 3+ cross-day positions overlap on a single day, render the first 2 bars and a `+N` text in zinc-500. Reasoning: prevents the lane from blowing past the cell height; rare in practice and the user can still click in to see all trades.
- **D5. Endpoint markers: rounded edges, no glyphs.** On the entry-day cell, the bar gets `rounded-l-full` (closed on the left). On the close-day cell, the bar gets `rounded-r-full` (closed on the right). In-between days render the bar with no rounding at either edge. Reasoning: glyphs (`→`, `←`) at this size become illegible noise; rounded caps read as "this is where the position starts/ends" without adding text.
- **D6. Cross-week handling: bar breaks at the Weekly column.** The 8-column grid (Sun–Sat + Weekly) means a Fri→Mon position renders bars on Fri, the *Weekly* column for that row is left untouched, and the bar resumes on the next row's Mon. The Fri bar gets `rounded-l-full` (entry cap) and no right rounding; the Mon bar gets `rounded-r-full` (close cap) and no left rounding. The Weekly cell never shows span bars. Reasoning: cleanly visualizing a span across the weekend gap would require breaking out of the grid flow; rounded endpoints already communicate the start/end visually.
- **D7. Mobile (7-column grid, no Weekly column): identical rendering.** Bars render the same way; rounded endpoints on entry/close, no rounding in between. Cell `min-h-[60px]` is enough for date + 2 bars + (optional) `+N` chip + PnL block. If it overflows in practice we'll polish in a follow-up.
- **D8. The `OVERNIGHT` badge style: violet, matching the OPEN badge pattern.** Use `bg-violet-500/20 text-violet-400` and the exact same `ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold` classes as the existing OPEN badge at `TradeTable.tsx:142–144`. Reasoning: copying the OPEN badge keeps visual consistency, and violet is unused elsewhere in the trade table — won't clash with the existing green/rose PnL signals or amber OPEN badge.
- **D9. Hover affordance: native `title` attribute, not a custom tooltip.** Each bar has `title={`${trade.symbol} • opened ${entryDate}, closed ${closeDate}`}` (`MMM dd` format on both dates). Reasoning: a custom tooltip would pull in another dependency or wrapper; native `title` is enough for an at-a-glance affordance.

---

### Implementation Steps

---

#### Step 1: Add `isCrossDayTrade` helper to `lib/journal-aggregates.ts`

**File:** `lib/journal-aggregates.ts`
**Action:** MODIFY

**Goal:** One shared definition of "this trade was held overnight." Used by the calendar's span computation and the trade table's badge.

**Instructions:**

1. Add the helper immediately after the `bucketKey` export (currently lines 26–34):

```ts
/**
 * True when a closed trade was opened on one local day and closed on another.
 * Open trades return false — they have no realized close day yet.
 */
export function isCrossDayTrade(
  trade: Pick<Trade, 'date' | 'closedAt' | 'isOpen'>,
): boolean {
  if (trade.isOpen) return false;
  return bucketKey(trade) !== toLocalDateKey(trade.date);
}
```

That's the entire change to this file.

**Acceptance:**
- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes
- [x] `isCrossDayTrade` is exported from `lib/journal-aggregates.ts`

---

#### Step 2: Add `OVERNIGHT` badge to `TradeTable.tsx`

**File:** `components/trading/TradeTable.tsx`
**Action:** MODIFY

**Instructions:**

1. Add an import for `isCrossDayTrade` near the top of the file. Look for any existing `@/lib/...` import line and add this next to it:

```ts
import { isCrossDayTrade } from '@/lib/journal-aggregates';
```

If `TradeTable.tsx` doesn't currently import from `@/lib/journal-aggregates` (it doesn't — confirmed by grep), add this as a new import line in the existing import block.

2. Modify the symbol cell (currently `TradeTable.tsx:139–146`) to render the OVERNIGHT badge after the OPEN badge:

```tsx
                <td className="px-4 py-3 font-medium">
                  <span>{trade.symbol}</span>
                  {trade.isOpen ? (
                    <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400">
                      OPEN
                    </span>
                  ) : null}
                  {isCrossDayTrade(trade) ? (
                    <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-500/20 text-violet-400">
                      OVERNIGHT
                    </span>
                  ) : null}
                </td>
```

Notes:
- Both badges can theoretically appear together if a trade is somehow `isOpen` AND has `closedAt` set, but that shouldn't happen in practice. `isCrossDayTrade` already short-circuits on `isOpen`, so an open position will only show the OPEN badge.
- Don't touch any other cell in the row.

**Acceptance:**
- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes
- [x] No regressions to existing columns
- [x] `grep "OVERNIGHT" components/trading/TradeTable.tsx` returns the new badge

---

#### Step 3: Render multi-day span bars in `TradingCalendar.tsx`

**File:** `components/trading/TradingCalendar.tsx`
**Action:** MODIFY

**Instructions:**

1. Extend the existing `@/lib/journal-aggregates` import (currently `import { bucketKey } from '@/lib/journal-aggregates';` at line 5) to also import `isCrossDayTrade` and `toLocalDateKey`:

```ts
import { bucketKey, isCrossDayTrade, toLocalDateKey } from '@/lib/journal-aggregates';
```

2. Below the existing `dailyStats` useMemo (currently lines 68–85), add a new `spanMap` useMemo. This computes, for each local-day key, the list of cross-day trades whose `[entry, close]` interval includes that day:

```ts
  // For each local-day key, the cross-day trades whose [entry, close] window
  // contains that day. We pre-sort by closeKey ascending so endpoint rendering
  // is stable: the earliest-closing position renders first.
  const spanMap = useMemo(() => {
    const map: Record<
      string,
      Array<{
        tradeId: string;
        symbol: string;
        netPnl: number;
        entryKey: string;
        closeKey: string;
      }>
    > = {};

    const crossDayTrades = trades
      .filter((t) => isCrossDayTrade(t))
      .map((t) => ({
        tradeId: t.id,
        symbol: t.symbol,
        netPnl: t.netPnl,
        entryKey: toLocalDateKey(t.date),
        closeKey: bucketKey(t),
      }))
      .sort((a, b) => a.closeKey.localeCompare(b.closeKey));

    for (const span of crossDayTrades) {
      // Walk from entryKey to closeKey inclusive in 1-day steps using a Date
      // anchored at the entry day. addDays via date-fns keeps DST correct.
      let cursor = new Date(`${span.entryKey}T00:00:00`);
      const end = new Date(`${span.closeKey}T00:00:00`);
      while (cursor.getTime() <= end.getTime()) {
        const key = format(cursor, 'yyyy-MM-dd');
        if (!map[key]) map[key] = [];
        map[key].push(span);
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    return map;
  }, [trades]);
```

Notes:
- `new Date('${key}T00:00:00')` parses as local time (no `Z` suffix), which matches how the rest of the calendar treats day keys.
- We step in 24-hour increments. This is correct for the day-key walk even across DST because we re-format with `format(cursor, 'yyyy-MM-dd')` each iteration — DST shifts only matter if you're doing arithmetic on the displayed time, which we're not.
- The cursor exit condition is `<=` so the close day is included.

3. Inside the cell render block, add the bar lane between the date number and the bottom-aligned PnL block. The existing cell JSX is at `TradingCalendar.tsx:170–204`. After the `<span>{format(day, 'd')}</span>` block (line 186–188) and before the `{stats && ...}` block (line 190), insert:

```tsx
                    {(() => {
                      const spans = spanMap[dateKey];
                      if (!spans || spans.length === 0) return null;
                      const visible = spans.slice(0, 2);
                      const overflow = spans.length - visible.length;
                      return (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {visible.map((span) => {
                            const isStart = span.entryKey === dateKey;
                            const isEnd = span.closeKey === dateKey;
                            const color =
                              span.netPnl > 0
                                ? 'bg-emerald-500/50'
                                : span.netPnl < 0
                                  ? 'bg-rose-500/50'
                                  : 'bg-zinc-500/40';
                            const rounded =
                              isStart && isEnd
                                ? 'rounded-full'
                                : isStart
                                  ? 'rounded-l-full'
                                  : isEnd
                                    ? 'rounded-r-full'
                                    : '';
                            return (
                              <div
                                key={span.tradeId}
                                className={`h-[3px] ${color} ${rounded}`}
                                title={`${span.symbol} • opened ${format(new Date(`${span.entryKey}T00:00:00`), 'MMM dd')}, closed ${format(new Date(`${span.closeKey}T00:00:00`), 'MMM dd')}`}
                              />
                            );
                          })}
                          {overflow > 0 ? (
                            <span className="text-[9px] text-zinc-500 leading-none">
                              +{overflow}
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
```

Notes:
- The `isStart && isEnd` branch handles a same-week round-trip that we already filtered out (`isCrossDayTrade` is false for same-day), so this is unreachable in practice, but it falls through to `rounded-full` defensively if someone changes the upstream filter.
- The IIFE pattern (`{(() => {...})()}`) keeps the per-cell computation inline without lifting `visible` and `overflow` into the outer scope, which would clutter the existing cell render. If you prefer, pull this into a helper component `SpanLane`, but the inline version is fine and matches the existing style of the file.

4. **Do NOT** modify the existing `weeks` useMemo (lines 91–113), the `monthlyR` useMemo (lines 118–124), or the Weekly column render (lines 207–230). Span bars only appear in day cells; the Weekly column stays clean.

5. **Do NOT** modify the cell-click behavior, the `selectedDate` ring, or any other existing styling. Span bars are an additive layer.

**Acceptance:**
- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes
- [x] A trade with entry on Mon and close on Tue renders bars on both the Mon and Tue cells
- [x] A trade with entry on Fri and close on the next Mon renders bars on Fri, Sat, Sun, and Mon (Weekly column stays bar-free)
- [x] No bars render on cells where no cross-day trade was open

---

#### Step 4: Add tests for `isCrossDayTrade` in `__tests__/journal-aggregates.test.ts`

**File:** `__tests__/journal-aggregates.test.ts`
**Action:** MODIFY

**Instructions:**

1. Update the import line (currently `import { aggregateDay, aggregateWeek } from '@/lib/journal-aggregates';`) to include the new helper:

```ts
import { aggregateDay, aggregateWeek, isCrossDayTrade } from '@/lib/journal-aggregates';
```

2. Append a new `describe` block at the end of the file (after the last `describe('aggregateWeek', ...)` block):

```ts
describe('isCrossDayTrade', () => {
  it('returns false for a same-day trade', () => {
    const trade = makeTrade({
      id: 'same-day',
      date: new Date(2026, 4, 18, 10, 0),
      // makeTrade defaults closedAt to date.toISOString() — same local day
    });
    expect(isCrossDayTrade(trade)).toBe(false);
  });

  it('returns true for a cross-day-close trade', () => {
    const trade = makeTrade({
      id: 'cross-day',
      date: new Date(2026, 4, 18, 14, 0),
      closedAt: new Date(2026, 4, 19, 10, 0).toISOString(),
    });
    expect(isCrossDayTrade(trade)).toBe(true);
  });

  it('returns false for an open trade even if closedAt is set (defensive)', () => {
    const trade = makeTrade({
      id: 'open',
      date: new Date(2026, 4, 18, 10, 0),
      closedAt: new Date(2026, 4, 19, 10, 0).toISOString(),
      isOpen: true,
    });
    expect(isCrossDayTrade(trade)).toBe(false);
  });

  it('falls back to date when closedAt is null (legacy row → not cross-day)', () => {
    const trade = makeTrade({
      id: 'legacy',
      date: new Date(2026, 4, 18, 10, 0),
      closedAt: null,
    });
    expect(isCrossDayTrade(trade)).toBe(false);
  });
});
```

3. **Do NOT** remove or change any existing test. The `makeTrade` factory introduced in Phase 3 (lines 9–32) already handles `closedAt` correctly via `overrides.closedAt ?? overrides.date.toISOString()`, so these new tests slot in cleanly.

**Acceptance:**
- [x] `npx vitest run __tests__/journal-aggregates.test.ts` — all tests pass, no failures
- [x] No other test file is modified

---

#### Step 5: Lint, typecheck, full test, commit

**Action:** RUN COMMANDS

```
npm run lint
npx tsc --noEmit
npm test
```

All must pass with 0 errors. Then commit:

```
git add -A
git commit -m "Phase 4: multi-day span rendering on calendar + OVERNIGHT badge in trade table"
```

Do NOT push.

**Acceptance:**
- [x] `npm run lint` — 0 errors
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm test` — 0 failing tests
- [x] `git log --oneline -1` shows the commit above
- [x] `git status` is clean after the local commit

---

### Files Changed Summary

| File | Action | Lines +/- est. | Risk |
|---|---|---|---|
| `lib/journal-aggregates.ts` | MODIFY | +~10 | LOW — pure additive helper |
| `components/trading/TradeTable.tsx` | MODIFY | +~7 | LOW — single inline badge next to existing OPEN badge |
| `components/trading/TradingCalendar.tsx` | MODIFY | +~60 | MED — one new useMemo + one IIFE block inside cell render; additive, no existing logic removed |
| `__tests__/journal-aggregates.test.ts` | MODIFY | +~40 | LOW — new describe block only |

**Not touched in Phase 4:** schema, migrations, API routes, `lib/types.ts`, `JournalTab.tsx`, `DailyReportSheet.tsx`, `WeeklyReviewSheet.tsx`, `PerformanceStatsTable.tsx`, `PerformanceCharts.tsx`, `hooks/use-trade-filters.ts`, any agent or services code.

---

### Verification Steps

**Automated:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`

**Manual checks (Codex does NOT need to run these — they're for the user post-execution):**
- [ ] Open the Performance tab → Trading Calendar. A trade you know spans two days renders thin colored bars on both cells (PnL color: green if it closed positive, red if it closed negative).
- [ ] Hover one of the bars → tooltip shows symbol and `opened MMM DD, closed MMM DD`.
- [ ] A Fri→Mon trade renders bars on Fri, Sat, Sun, Mon (4 cells). The Weekly column stays bar-free.
- [ ] In any TradeTable view that shows a cross-day trade (Journal day card expansion, trade detail sheet, etc.), the symbol cell shows the violet `OVERNIGHT` badge.
- [ ] Same-day round-trip trades show NO bars and NO OVERNIGHT badge.
- [ ] Open positions still don't appear on the calendar at all (no bars, no PnL).
- [ ] DO NOT git push — verify Codex stopped after committing locally.

---

### Complexity Estimate

LOW–MED. 4 files touched, no schema/API/type changes. The bar render block in `TradingCalendar.tsx` is the largest single addition (~60 lines including the useMemo and the IIFE), and it's the only "thinking" the executor has to do — the other three files are surgical. Estimate 30–60 minutes of Codex execution time.

---

## Follow-up Specs (not yet planned)

### Route-level testing infrastructure

Stand up a test DB harness (Postgres in Docker via testcontainers, or a vitest setup that points at a disposable schema) so we can write real integration tests for API routes. Phase 1's `__tests__/trade-merge.test.ts` only covers the merge math in isolation — auth, ownership, opposite-direction 400s, and the FK cascade on `trade_executions` are uncovered today. Phase 2 adds `/api/trades/import-raw` which similarly has only matcher-level tests. Once the harness exists, immediate targets are `app/api/trades/merge/route.ts`, the close-position branch of `app/api/trades/[id]/route.ts`, and `app/api/trades/import-raw/route.ts`.

### Partial close UX on the Close Position button

Phase 1 ships a "Close Position (Full)" button on `TradeDetailSheet`. Phase 2's matcher handles partial closes from CSV imports, but the UI button still closes the full position. A future sprint should let the user enter a quantity ≤ `remainingQty`, similar to how brokers offer partial fills. Touches `TradeDetailSheet.tsx`, the close-position schema, and the PATCH `/api/trades/[id]` branch.

### Open-position visualization on the calendar

Phase 4 renders spans only for closed cross-day trades. Currently-open positions (still held today) are invisible to the calendar entirely. A follow-up could surface them — e.g. ghost bars from entry day through today, in a neutral color (zinc) since they have no realized PnL yet, with a tooltip showing days held. Touches `TradingCalendar.tsx` (extend `spanMap` to optionally include open trades with `closeKey = today`) and possibly a new toggle in the calendar header ("Show open positions"). Decide first whether open positions belong on the realized-PnL calendar at all, or whether they need their own view.

### Journal day-card carry-over UI

Phase 4 adds the OVERNIGHT badge to individual trade rows in `TradeTable`. The journal's *day-card grouping* still keys off `trade.sortKey` (entry day) — so clicking a Tuesday calendar cell whose PnL came from a Mon→Tue close opens a Tuesday day card that does NOT contain that trade (its sortKey is Monday). A future sprint should reconcile this: either group the journal day card by `bucketKey` too, or add a "carried over from Monday" panel inside the Tuesday card listing trades that realized PnL there but entered earlier. Touches `JournalTab.tsx` `dayCards` useMemo and the day-card render block. Decide first whether to flip grouping or to add a second panel — the former is simpler but changes long-standing behavior.

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
