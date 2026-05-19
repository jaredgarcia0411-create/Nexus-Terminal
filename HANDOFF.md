# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-19
> Purpose: active execution spec for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.
>
> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Current Context

- Phase 4 (multi-day calendar spans + `OVERNIGHT` badge) shipped in `ccb2567`, then the badge was dropped in `2b9d78b` and the closedAt midnight-UTC fix landed in `a039c0d`. Two follow-up bugs surfaced today (2026-05-19) and are the subject of the active spec below.
- Open parked items unrelated to active work: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, Backtest Manager `broke_premarket_high`.

## Active Execution Spec

## Fix False-Positive Overnight Spans + Restore Re-Upload After Delete

> Generated: 2026-05-19 | Agent: nexus-architect
> Status: COMPLETED - validated by Codex on 2026-05-19, not committed

### Summary

Two bugs regressed after the `closedAt` noon-UTC anchoring commit (`a039c0d`). Bug 1: `isCrossDayTrade` compares `bucketKey(trade)` (derived from `closedAt`) against `toLocalDateKey(trade.date)`, which parses the DB's `"YYYY-MM-DD"` text column as midnight UTC — in any timezone west of GMT this rolls back one calendar day, making every trade appear cross-day on the journal Trading Calendar. Bug 2: deleting a trade from the UI does not remove its `tradeImportBatches` dedup row, so re-uploading the same CSV silently does nothing (the import is skipped at the batch-key check and the user sees no feedback). Both fixes are surgical: Bug 1 is a one-line change to compare against `trade.sortKey` (the canonical `YYYY-MM-DD` string already on every trade), Bug 2 adds a transactional batch-row cleanup to the DELETE handler.

### Scope

**In scope:**

- `lib/journal-aggregates.ts` — fix `isCrossDayTrade`
- `components/trading/TradingCalendar.tsx` — fix `spanMap` entryKey
- `__tests__/journal-aggregates.test.ts` — add regression tests
- `app/api/trades/[id]/route.ts` — fix DELETE handler

**Out of scope:**

- Do not refactor `normalizeTrade` in `lib/trade-utils.ts`
- Do not change `lib/db/schema.ts`
- Do not add new types to `lib/types.ts` (expanding a `Pick` is not a type addition)
- Do not surface `importSkipped: true` as a toast in `hooks/use-trades.ts` (follow-up item)
- Do not touch any other file

**Execution note:** `__tests__/trade-id-route.test.ts` also required a narrow mock update after the DELETE handler switched from `getDb()` to `getPoolDb()`. Without that test-file change, full `npm test` failed because the existing `@/lib/db` mock did not export `getPoolDb`.

### Decisions Locked

- **D1:** `isCrossDayTrade` compares `bucketKey(trade)` against `trade.sortKey` directly. Reason: `sortKey` is the canonical server-written `YYYY-MM-DD` entry-day string and is never re-parsed through `new Date()`, making it immune to UTC-vs-local timezone shifts.
- **D2:** `TradingCalendar`'s `spanMap` uses `trade.sortKey` for `entryKey` instead of `toLocalDateKey(trade.date)`. Reason: same as D1. Re-deriving the entry day through `new Date()` is what introduced the bug.
- **D3:** The DELETE handler clears `tradeImportBatches` rows matching `raw|{sortKey}|%` in a transaction, atomically with deleting the trade row. Reason: the user deleting a trade is an explicit signal that they want to re-import that day's file; leaving the dedup row in place violates that intent.
- **D4:** The batch-key filter uses the `raw|` prefix (`raw|${sortKey}|%`), not a bare `%${sortKey}%` substring. Reason: future batch-key formats (e.g. broker-sync) might embed the same date string; scoping to `raw|` prevents false-positive deletions against unrelated batch types.
- **D5:** Do NOT surface `importSkipped: true` as a frontend toast in this spec. Reason: the delete-clears-batch fix already restores the re-upload flow without any UI change. Surfacing the skip status is a useful follow-up but out of scope here.
- **D6:** The DELETE handler must swap from `getDb()` to `getPoolDb()`. Verified in `lib/db.ts`: `getDb()` returns `NeonHttpDatabase` (`drizzle-orm/neon-http`) which does not support `.transaction()`; `getPoolDb()` returns `NeonDatabase` (`drizzle-orm/neon-serverless`) which does. `ensureUser()` accepts `Db | PoolDb` (type `QueryDb`, `lib/server-db-utils.ts:6`), so the swap is compatible.

---

### Step 1: Fix `isCrossDayTrade` — `lib/journal-aggregates.ts`

**File:** `lib/journal-aggregates.ts`
**Action:** MODIFY
**Goal:** Remove the re-parsed `trade.date` comparison; compare against `trade.sortKey` instead.

**Instructions:**

1. Line 41 — expand the `Pick` to include `'sortKey'`:

   Old:
   ```ts
     trade: Pick<Trade, 'date' | 'closedAt' | 'isOpen'>,
   ```
   New:
   ```ts
     trade: Pick<Trade, 'date' | 'closedAt' | 'isOpen' | 'sortKey'>,
   ```

2. Line 44 — replace the comparison:

   Old:
   ```ts
     return bucketKey(trade) !== toLocalDateKey(trade.date);
   ```
   New:
   ```ts
     return bucketKey(trade) !== trade.sortKey;
   ```

3. No import changes needed. `toLocalDateKey` remains used by `bucketKey` (line 32) and is exported; do not remove it.

**Post-edit lines 40–45 must read:**
```ts
export function isCrossDayTrade(
  trade: Pick<Trade, 'date' | 'closedAt' | 'isOpen' | 'sortKey'>,
): boolean {
  if (trade.isOpen) return false;
  return bucketKey(trade) !== trade.sortKey;
}
```

**Acceptance:**
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` — all existing tests in the `isCrossDayTrade` describe block (lines 263–303) still pass

---

### Step 2: Fix `spanMap` entry key — `components/trading/TradingCalendar.tsx`

**File:** `components/trading/TradingCalendar.tsx`
**Action:** MODIFY
**Goal:** Use `trade.sortKey` for the span's entry key; remove now-unused `toLocalDateKey` import.

**Instructions:**

1. Line 5 — remove `toLocalDateKey` from the import (it is only used at line 107 which this step changes):

   Old:
   ```ts
   import { bucketKey, isCrossDayTrade, toLocalDateKey } from '@/lib/journal-aggregates';
   ```
   New:
   ```ts
   import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
   ```

2. Line 107 — replace the entryKey expression:

   Old:
   ```ts
           entryKey: toLocalDateKey(trade.date),
   ```
   New:
   ```ts
           entryKey: trade.sortKey,
   ```

**Post-edit lines 101–110 must read:**
```ts
    const crossDayTrades = trades
      .filter((trade) => isCrossDayTrade(trade))
      .map((trade) => ({
        tradeId: trade.id,
        symbol: trade.symbol,
        netPnl: trade.netPnl,
        entryKey: trade.sortKey,
        closeKey: bucketKey(trade),
      }))
      .sort((a, b) => a.closeKey.localeCompare(b.closeKey));
```

**Acceptance:**
- [ ] `npm run lint` passes (no unused-import warning for `toLocalDateKey`)
- [ ] `npx tsc --noEmit` passes
- [ ] Manual: open the Trading Calendar — same-day trades show no overnight bar

---

### Step 3: Add regression tests — `__tests__/journal-aggregates.test.ts`

**File:** `__tests__/journal-aggregates.test.ts`
**Action:** MODIFY
**Goal:** Regression-test `isCrossDayTrade` with the production ISO-string `Date` construction so the bug would be caught if the fix is reverted.

**Instructions:**

Append the following block after the last `});` on line 303 (end of file):

```ts
describe('isCrossDayTrade - production Date construction (ISO string)', () => {
  // In production, trade.date is built via `new Date(row.date)` where row.date
  // is a "YYYY-MM-DD" text column from the DB. `new Date("YYYY-MM-DD")` parses
  // as midnight UTC. In timezones west of GMT (e.g. EST UTC-5, PST UTC-8),
  // date-fns format(d, 'yyyy-MM-dd') returns the *previous* local calendar day
  // for a midnight-UTC Date — which made the old toLocalDateKey(trade.date)
  // comparison return "2026-05-18" instead of "2026-05-19", causing
  // isCrossDayTrade to return true for every same-day trade.
  //
  // The fix compares bucketKey(trade) against trade.sortKey (never re-parsed),
  // which is tz-agnostic. These tests use the exact production construction so
  // they would fail under the old implementation on west-of-GMT hosts.
  it('returns false for a same-day trade when date is constructed from an ISO date string', () => {
    const trade = makeTrade({
      id: 'iso-same-day',
      date: new Date('2026-05-19'),
      sortKey: '2026-05-19',
      closedAt: '2026-05-19T12:00:00.000Z',
    });

    expect(isCrossDayTrade(trade)).toBe(false);
  });

  it('still returns true for a genuine cross-day trade when using ISO date string construction', () => {
    const trade = makeTrade({
      id: 'iso-cross-day',
      date: new Date('2026-05-19'),
      sortKey: '2026-05-19',
      closedAt: '2026-05-20T12:00:00.000Z',
    });

    expect(isCrossDayTrade(trade)).toBe(true);
  });
});
```

**Acceptance:**
- [ ] Both new tests pass: `npm test -- --reporter=verbose journal-aggregates`
- [ ] All pre-existing tests in the file still pass
- [ ] `npm run lint` passes

---

### Step 4: Fix the DELETE handler — `app/api/trades/[id]/route.ts`

**File:** `app/api/trades/[id]/route.ts`
**Action:** MODIFY
**Goal:** Atomically delete the trade and its `tradeImportBatches` dedup rows so re-upload works after delete.

**Instructions:**

1. **Line 1** — add `like` to the drizzle-orm import:
   ```ts
   import { and, asc, eq, like, sql } from 'drizzle-orm';
   ```

2. **Line 4** — add `getPoolDb` to the db import:
   ```ts
   import { getDb, getPoolDb } from '@/lib/db';
   ```

3. **Line 5** — add `tradeImportBatches` to the schema import:
   ```ts
   import { tradeExecutions, tradeImportBatches, trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
   ```

4. **Lines 215–234** — replace the entire `DELETE` export function with:
   ```ts
   export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
     try {
       const authState = await requireUser();
       if ('error' in authState) return authState.error;

       // getPoolDb() is required because we use db.transaction().
       // getDb() uses the HTTP transport (NeonHttpDatabase) which does not
       // support transactions; getPoolDb() uses the WebSocket pool (NeonDatabase)
       // which does — the same client used by import-raw/route.ts.
       const db = getPoolDb();
       if (!db) return dbUnavailable();
       await ensureUser(db, authState.user);

       const { id } = await context.params;

       // Read sortKey before deleting so we can clear dedup rows.
       const [row] = await db.select({ sortKey: trades.sortKey })
         .from(trades)
         .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
         .limit(1);

       await db.transaction(async (tx) => {
         // Clear matching tradeImportBatches rows so the user can re-upload
         // the same CSV after deleting this trade. The raw| prefix scopes
         // the like() to CSV-import batches only, protecting against future
         // batch-key formats that might share the same date string.
         if (row?.sortKey) {
           await tx.delete(tradeImportBatches).where(
             and(
               eq(tradeImportBatches.userId, authState.user.id),
               like(tradeImportBatches.batchKey, `raw|${row.sortKey}|%`),
             ),
           );
         }

         await tx.delete(trades).where(
           and(eq(trades.id, id), eq(trades.userId, authState.user.id)),
         );
       });

       return Response.json({ success: true, id });
     } catch (error) {
       logRouteError('trades.id.delete', error);
       return internalServerError();
     }
   }
   ```

**The `GET` and `PATCH` handlers above this function are unchanged — do not touch them.**

**Acceptance:**
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] Response shape is `{ success: true, id }` — unchanged from before
- [ ] Manual: delete a trade, re-upload same CSV, trade reappears

---

### Step 5: Lint, typecheck, full test, commit

```bash
npm run lint
npx tsc --noEmit
npm test
```

All three must pass before committing.

**Commit message:**
```
Fix false-positive overnight spans and restore re-upload after delete

Bug 1: isCrossDayTrade compared bucketKey against toLocalDateKey(trade.date),
where new Date("YYYY-MM-DD") parses as midnight UTC and rolls back one local day
west of GMT — marking every trade as cross-day. Fix: compare against trade.sortKey
(canonical YYYY-MM-DD string, never re-parsed). TradingCalendar spanMap entryKey
updated to use trade.sortKey for the same reason.

Bug 2: DELETE /api/trades/[id] did not clear tradeImportBatches dedup rows, so
re-uploading a deleted trade's CSV was silently blocked. Fix: wrap the delete in
a transaction (requires getPoolDb instead of getDb) and clear raw|{sortKey}|%
batch rows atomically.

Adds regression tests for isCrossDayTrade with ISO-string Date construction.
```

**Acceptance:**
- [x] `git diff --stat HEAD` intentionally shows 6 files changed: the 4 implementation/test files from the spec, `__tests__/trade-id-route.test.ts` for the required `getPoolDb` mock update, and this `HANDOFF.md` evidence update.

---

### Files Changed Summary

| File | Action | Risk Level |
|------|--------|------------|
| `lib/journal-aggregates.ts` | MODIFY | LOW |
| `components/trading/TradingCalendar.tsx` | MODIFY | LOW |
| `__tests__/journal-aggregates.test.ts` | MODIFY | LOW |
| `app/api/trades/[id]/route.ts` | MODIFY | MEDIUM |
| `__tests__/trade-id-route.test.ts` | MODIFY | LOW |

---

### Verification Steps

**Automated:**
```bash
npm run lint
npx tsc --noEmit
npm test
```

**Completed 2026-05-19:**

- `npm test -- --reporter=verbose journal-aggregates` passed: 1 file / 17 tests.
- `npx vitest run __tests__/trade-id-route.test.ts` passed: 1 file / 5 tests.
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed: 94 files / 700 tests.
- `git diff --check` passed.
- `npm run workflow:audit` passed.

**Manual (in running app):**

1. Open Journal > Trading Calendar. Any day with same-day-closed trades should have no overnight bars.
2. If a genuine overnight trade exists (entered Monday, closed Tuesday), its span bar should still render across both days.
3. Import a CSV. Delete the imported trade. Re-upload the same CSV. The trade should reappear — not be silently skipped.

---

### Complexity Estimate

LOW-to-MEDIUM overall. The `isCrossDayTrade` and `spanMap` fixes are one-line changes to pure logic — LOW. The DELETE handler is MEDIUM: it adds a pre-read query, swaps the DB client, and wraps two deletes in a transaction. The structural pattern is identical to what `import-raw/route.ts` already does. No schema migrations, no new types, no API contract changes. The four files are independent and can be executed in any order, though Step 1 must precede Step 2 to avoid a TypeScript error (Step 2's `isCrossDayTrade(trade)` call must see the expanded Pick before tsc runs).

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
