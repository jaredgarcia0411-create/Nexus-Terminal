# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-16
> Purpose: active execution spec for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

> Historical completed sections (SEC filing expansion Phases 0–6, shipped 2026-05-13) were removed to keep this file focused. Recent shipped commits are visible via `git log`.

## Current Context

- Last shipped: Daily Review watchlist Chart column (commit `b764e5a`), watchlist "+ Add to Watchlist" button on Research page (`666ae8d`), saved per-day research reports on watchlist rows (`e3765d4`).
- Open parked items unrelated to this spec: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, and Backtest Manager `broke_premarket_high`.

## Active Execution Spec

## Collaborative Sample-Set Building

> Generated: 2026-05-16 | Author: claude (opus-4-7)
> Status: IMPLEMENTED (2026-05-16; awaiting review/commit)
> Validation: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run workflow:audit` when `HANDOFF.md` is updated. No services touched, so `typecheck:services` is not required.

### Goal

Let any authenticated user append rows to any sample set (owner-only for rename/delete), enforce dedup on append, add a tag-based source for building sample sets, restructure `AddSampleSetDialog` and `AddSampleSetRowsDialog` to share a multi-source row-builder (CSV + Manual + Tags + staging list), and add a Save column to the daily-review watchlist for per-row and bulk appends.

Ownership model: **B** (chosen 2026-05-16). Anyone can append; owner-only for rename/delete. Tag scope: caller's own trades only (tags are user-scoped today). Watchlist Save opens a picker that includes a "Create new sample set" option pre-seeded with the row(s).

### Constraints

- No schema migration. `sample_sets.rows` stays as a `jsonb` array of `{ticker, date}` (`lib/db/schema.ts:522`).
- Dedup must work atomically across concurrent appends. Use `getPoolDb()` + `db.transaction()` + `SELECT ... FOR UPDATE` (pattern established in `app/api/trades/bulk/route.ts:13,52`).
- Use existing helpers: `requireUser`, `ensureUser`, `parseAndValidate`, `internalServerError`, `logRouteError`.
- All new validators go in `lib/validations/sample-sets.ts`.
- Watchlist Save column follows the Chart column gating pattern (`date` prop present → render).
- No changes to `useBacktestManager` hook surface beyond a new `currentUserId` consumer convenience; its `appendSampleSetRows` already wraps PATCH.

---

### Step-by-step Implementation

#### 1. Validators — extend `lib/validations/sample-sets.ts`

**File:** `lib/validations/sample-sets.ts`
**Action:** MODIFY

1. After the existing `sampleSetDuplicateSchema` block (current line 18-20), add:
   ```ts
   export const sampleSetFromTagsSchema = z.object({
     tags: z.array(z.string().trim().min(1)).min(1, 'at least one tag is required').max(20),
   });
   export type SampleSetFromTagsBody = z.infer<typeof sampleSetFromTagsSchema>;
   ```
2. No changes to existing schemas. `sampleSetRowSchema` already uppercases ticker and enforces `YYYY-MM-DD` — keep using it.

**Acceptance:**
- [ ] `sampleSetFromTagsSchema` exported.
- [ ] `npx tsc --noEmit` passes.

---

#### 2. Helper — extract dedup logic into `lib/sample-set-rows.ts`

**File:** `lib/sample-set-rows.ts`
**Action:** CREATE

The same dedup needs to run in POST (in-batch only) and PATCH (in-batch + against existing), and inside the new from-tags endpoint when the caller wants a final preview. Extracting it once avoids drift.

```ts
import type { SampleSetRow } from '@/lib/sample-set-csv';

function rowKey(row: SampleSetRow): string {
  return `${row.ticker.toUpperCase()}|${row.date}`;
}

/**
 * Append `incoming` to `existing` while skipping any (ticker,date) pair already
 * present in `existing` OR earlier in `incoming`. Comparison is case-insensitive
 * on ticker. Returns the merged list and how many incoming rows were skipped.
 */
export function mergeDedupedRows(
  existing: ReadonlyArray<SampleSetRow>,
  incoming: ReadonlyArray<SampleSetRow>,
): { merged: SampleSetRow[]; skippedCount: number } {
  const seen = new Set<string>(existing.map(rowKey));
  const merged: SampleSetRow[] = [...existing];
  let skippedCount = 0;

  for (const row of incoming) {
    const key = rowKey(row);
    if (seen.has(key)) {
      skippedCount += 1;
      continue;
    }
    seen.add(key);
    merged.push({ ticker: row.ticker.toUpperCase(), date: row.date });
  }

  return { merged, skippedCount };
}

/** Same as `mergeDedupedRows` but starts from an empty existing list. */
export function dedupeRows(incoming: ReadonlyArray<SampleSetRow>): {
  rows: SampleSetRow[];
  skippedCount: number;
} {
  const { merged, skippedCount } = mergeDedupedRows([], incoming);
  return { rows: merged, skippedCount };
}
```

**Acceptance:**
- [ ] File compiles.
- [ ] `mergeDedupedRows` and `dedupeRows` exported.

---

#### 3. Server — POST `/api/sample-sets` add in-batch dedup

**File:** `app/api/sample-sets/route.ts`
**Action:** MODIFY

1. After the imports block (after line 7), add:
   ```ts
   import { dedupeRows } from '@/lib/sample-set-rows';
   ```
2. Replace the insert block (current lines 63-72) so it dedupes the incoming rows before insert and reports `skippedCount`:
   ```ts
   const { rows: dedupedRows, skippedCount } = dedupeRows(body.rows);

   const [created] = await db
     .insert(sampleSets)
     .values({
       userId: authState.user.id,
       name: body.name,
       rows: dedupedRows,
       rowCount: dedupedRows.length,
       updatedAt: new Date(),
     })
     .returning();

   return Response.json({ sampleSet: created, skippedCount }, { status: 201 });
   ```
3. Leave the 409 collision branch unchanged.

**Acceptance:**
- [ ] Creating a sample set with `[{AAPL,2026-05-01},{AAPL,2026-05-01},{TSLA,2026-05-02}]` returns `rowCount: 2` and `skippedCount: 1`.
- [ ] Name collision still returns 409.

---

#### 4. Server — PATCH `/api/sample-sets/[id]` split ownership, add transactional dedup

**File:** `app/api/sample-sets/[id]/route.ts`
**Action:** MODIFY

This is the most important change. The existing handler 403s any non-owner. We need:
- `name` rename → still owner-only (403 for non-owner).
- `appendRows` → any authenticated user, wrapped in a transaction with `SELECT ... FOR UPDATE` so two concurrent appends can't lose each other's rows.

1. Replace the imports (current lines 1-7) with:
   ```ts
   import { and, eq, sql } from 'drizzle-orm';

   import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
   import { getDb, getPoolDb } from '@/lib/db';
   import { sampleSets } from '@/lib/db/schema';
   import { mergeDedupedRows } from '@/lib/sample-set-rows';
   import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
   import { sampleSetPatchSchema } from '@/lib/validations/sample-sets';
   ```
2. The `GET` and `DELETE` handlers stay unchanged.
3. Replace the entire `PATCH` handler body (current lines 34-107) with:
   ```ts
   export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
     try {
       const authState = await requireUser();
       if ('error' in authState) return authState.error;

       const bodyState = await parseAndValidate(request, sampleSetPatchSchema);
       if (bodyState.error) return bodyState.error;
       const body = bodyState.data;

       const { id } = await context.params;

       // Rename path is owner-only and uses the HTTP client — single statement.
       if (body.name !== undefined && body.appendRows === undefined) {
         const db = getDb();
         if (!db) return dbUnavailable();
         await ensureUser(db, authState.user);

         const [row] = await db
           .select({ id: sampleSets.id, userId: sampleSets.userId })
           .from(sampleSets)
           .where(eq(sampleSets.id, id))
           .limit(1);

         if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });
         if (row.userId !== authState.user.id) {
           return Response.json({ error: 'Forbidden' }, { status: 403 });
         }

         const [collision] = await db
           .select({ id: sampleSets.id })
           .from(sampleSets)
           .where(
             sql`${sampleSets.userId} = ${authState.user.id} AND lower(${sampleSets.name}) = lower(${body.name}) AND ${sampleSets.id} <> ${id}`,
           )
           .limit(1);

         if (collision) {
           return Response.json({ error: 'A sample set with that name already exists' }, { status: 409 });
         }

         const [updated] = await db
           .update(sampleSets)
           .set({ name: body.name, updatedAt: new Date() })
           .where(and(eq(sampleSets.id, id), eq(sampleSets.userId, authState.user.id)))
           .returning();

         return Response.json({ sampleSet: updated, skippedCount: 0 });
       }

       // Append path: anyone can append. Wrap in a transaction with row-level
       // lock so two concurrent appends don't lose each other's rows.
       if (body.appendRows !== undefined) {
         const poolDb = getPoolDb();
         if (!poolDb) return dbUnavailable();
         await ensureUser(poolDb, authState.user);

         const result = await poolDb.transaction(async (tx) => {
           // Lock the target row. drizzle-orm doesn't expose `.for('update')` on
           // every driver, so use a raw SELECT inside the transaction.
           const lockRows = await tx.execute(
             sql`SELECT id, rows FROM sample_sets WHERE id = ${id} FOR UPDATE`,
           );
           const locked = (lockRows.rows ?? lockRows) as Array<{ id: string; rows: unknown }>;
           if (locked.length === 0) {
             return { notFound: true as const };
           }

           const existingRows = (locked[0].rows as Array<{ ticker: string; date: string }>) ?? [];
           const { merged, skippedCount } = mergeDedupedRows(existingRows, body.appendRows ?? []);

           // If rename was also requested, apply it in the same transaction with
           // the same owner gate.
           const updates: {
             rows: typeof merged;
             rowCount: number;
             updatedAt: Date;
             name?: string;
           } = {
             rows: merged,
             rowCount: merged.length,
             updatedAt: new Date(),
           };

           if (body.name !== undefined) {
             // Need owner check for the rename leg.
             const ownerRow = await tx
               .select({ userId: sampleSets.userId })
               .from(sampleSets)
               .where(eq(sampleSets.id, id))
               .limit(1);
             if (ownerRow[0]?.userId !== authState.user.id) {
               return { forbidden: true as const };
             }
             updates.name = body.name;
           }

           const [updated] = await tx
             .update(sampleSets)
             .set(updates)
             .where(eq(sampleSets.id, id))
             .returning();

           return { updated, skippedCount };
         });

         if ('notFound' in result) {
           return Response.json({ error: 'Sample set not found' }, { status: 404 });
         }
         if ('forbidden' in result) {
           return Response.json({ error: 'Forbidden' }, { status: 403 });
         }
         return Response.json({ sampleSet: result.updated, skippedCount: result.skippedCount });
       }

       // Empty patch — surface the current state.
       const db = getDb();
       if (!db) return dbUnavailable();
       const [row] = await db.select().from(sampleSets).where(eq(sampleSets.id, id)).limit(1);
       if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });
       return Response.json({ sampleSet: row, skippedCount: 0 });
     } catch (error) {
       logRouteError('sample-sets.id.patch', error);
       return internalServerError();
     }
   }
   ```

**Acceptance:**
- [ ] Owner can rename → 200.
- [ ] Non-owner rename → 403.
- [ ] Owner can append → 200, merged rows deduped, `skippedCount` reported.
- [ ] Non-owner can append → 200 (no 403).
- [ ] Concurrent appends from two users do not lose rows (manual sanity check; covered by transactional lock).
- [ ] Renaming + appending in the same PATCH as non-owner returns 403 (rename leg blocks).

---

#### 5. Server — new endpoint `POST /api/sample-sets/from-tags`

**File:** `app/api/sample-sets/from-tags/route.ts`
**Action:** CREATE

Resolves the caller's own tagged trades into a deduped `{ticker, date}[]` preview. The dialog calls this to surface the matched rows before staging them.

```ts
import { and, eq, inArray } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { trades, tradeTags as tradeTagsTable } from '@/lib/db/schema';
import { dedupeRows } from '@/lib/sample-set-rows';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetFromTagsSchema } from '@/lib/validations/sample-sets';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, sampleSetFromTagsSchema);
    if (bodyState.error) return bodyState.error;
    const { tags } = bodyState.data;

    // Caller's own trades only — tags are user-scoped.
    const rawRows = await db
      .select({ ticker: trades.symbol, date: trades.date })
      .from(trades)
      .innerJoin(
        tradeTagsTable,
        and(eq(tradeTagsTable.userId, trades.userId), eq(tradeTagsTable.tradeId, trades.id)),
      )
      .where(and(eq(trades.userId, authState.user.id), inArray(tradeTagsTable.tag, tags)));

    let skippedBadDate = 0;
    const valid = rawRows.flatMap((row) => {
      if (!row.ticker || !DATE_REGEX.test(row.date)) {
        skippedBadDate += 1;
        return [];
      }
      return [{ ticker: row.ticker.toUpperCase(), date: row.date }];
    });

    const { rows: deduped, skippedCount: skippedDuplicates } = dedupeRows(valid);

    return Response.json({
      rows: deduped,
      skippedCount: skippedDuplicates + skippedBadDate,
    });
  } catch (error) {
    logRouteError('sample-sets.from-tags.post', error);
    return internalServerError();
  }
}
```

**Acceptance:**
- [ ] Returns rows from the caller's own tagged trades only.
- [ ] Dedupes `(ticker, date)` pairs across multiple tags.
- [ ] Skips trades with invalid dates and reports them in `skippedCount`.
- [ ] Empty tag list (Zod rejects) → 400.

---

#### 6. Tests — update `__tests__/sample-sets-route.test.ts`

**File:** `__tests__/sample-sets-route.test.ts`
**Action:** MODIFY

1. The existing test `'PATCH /api/sample-sets/[id] returns 403 when not owner'` (lines 204-219) is sending `{ name: 'Renamed' }` — leave it; the rename path still 403s. Keep this test as-is.
2. Add a new test that asserts non-owner can append rows. Append uses `getPoolDb()` and `db.transaction()` so the mock has to expose `transaction` and `execute`. Add this helper above `describe`:
   ```ts
   const { getPoolDbMock } = vi.hoisted(() => ({ getPoolDbMock: vi.fn() }));
   ```
   then extend `vi.mock('@/lib/db', ...)` to:
   ```ts
   vi.mock('@/lib/db', () => ({
     getDb: getDbMock,
     getPoolDb: getPoolDbMock,
   }));
   ```
3. Add a `createPoolDbMock` factory that supports the new code path:
   ```ts
   function createPoolDbMock(options: {
     lockRows?: Array<{ id: string; rows: unknown }>;
     ownerRows?: Array<{ userId: string }>;
     updateResult?: unknown[];
   }) {
     const updateResult = options.updateResult ?? [];
     const lockRows = options.lockRows ?? [];
     const ownerRows = options.ownerRows ?? [];

     const tx = {
       execute: vi.fn(async () => ({ rows: lockRows })),
       select: vi.fn(() => ({
         from: vi.fn(() => ({
           where: vi.fn(() => ({
             limit: vi.fn(() => Promise.resolve(ownerRows)),
           })),
         })),
       })),
       update: vi.fn(() => ({
         set: vi.fn(() => ({
           where: vi.fn(() => ({
             returning: vi.fn(() => Promise.resolve(updateResult)),
           })),
         })),
       })),
     };

     return {
       transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)),
     };
   }
   ```
4. Add new test cases inside the existing `describe('sample set routes', ...)`:
   - `'PATCH appendRows succeeds for non-owner'`: `lockRows = [{ id: 'ss-1', rows: [] }]`, body `{ appendRows: [{ ticker: 'AAPL', date: '2026-05-01' }] }`, expect 200 and `skippedCount: 0`.
   - `'PATCH appendRows dedupes against existing rows'`: `lockRows = [{ id: 'ss-1', rows: [{ ticker: 'AAPL', date: '2026-05-01' }] }]`, body `{ appendRows: [{ ticker: 'AAPL', date: '2026-05-01' }, { ticker: 'TSLA', date: '2026-05-02' }] }`, expect `skippedCount: 1` and `updated.rowCount === 2`.
   - `'PATCH appendRows on missing set returns 404'`: `lockRows = []`, expect 404.
   - `'POST /api/sample-sets dedupes in-batch'`: body has `[{AAPL,01-01},{AAPL,01-01}]`, expect `skippedCount: 1`.
5. New test file: `__tests__/sample-sets-from-tags-route.test.ts`. Mock `getDb` and `requireUser` similarly. Cover:
   - Single tag returns deduped rows.
   - Multiple tags union-deduped.
   - Trades with non-`YYYY-MM-DD` dates skipped.
   - Empty `tags` array → 400 (Zod).

**Acceptance:**
- [ ] `npx vitest run __tests__/sample-sets-route.test.ts __tests__/sample-sets-from-tags-route.test.ts` all green.

---

### Steps 1-6 Checkpoint Status (2026-05-16)

- Implemented `sampleSetFromTagsSchema` and the shared `lib/sample-set-rows.ts` dedupe helpers.
- Updated sample-set creation to dedupe in-batch rows and return `skippedCount`.
- Split sample-set PATCH behavior so renames remain owner-only while append uses `getPoolDb()` transactions plus `SELECT ... FOR UPDATE` and shared dedupe.
- Added `POST /api/sample-sets/from-tags` for caller-owned tagged trade previews with invalid-date and duplicate skip counts.
- Expanded `__tests__/sample-sets-route.test.ts` and added `__tests__/sample-sets-from-tags-route.test.ts`.
- Validation completed for this checkpoint:
  - `npx vitest run __tests__/sample-sets-route.test.ts __tests__/sample-sets-from-tags-route.test.ts` passed: 2 files, 17 tests.
  - `npm run lint` passed.
  - `npx tsc --noEmit` passed.
  - `npm test` passed: 91 files, 658 tests.
  - `npm run workflow:audit` passed.
- Steps 7-11 were completed in the next checkpoint below. Step 12 and later remain unopened.

---

#### 7. Hook — `useBacktestManager` returns `currentUserId` for clients

This already happens (`hooks/use-backtest-manager.ts:241`). No change required, but verify by reading the file.

**Acceptance:**
- [ ] No code change. Documented as verified.

---

#### 8. Component — extract `SampleSetRowsBuilder`

**File:** `components/trading/SampleSetRowsBuilder.tsx`
**Action:** CREATE

Shared multi-source row builder used by both `AddSampleSetDialog` and `AddSampleSetRowsDialog`. Exposes:
- `rows` (controlled — parent owns the staging state)
- `onChange(next: SampleSetRow[])`
- internal in-component dedup so staging never shows duplicates
- a small `dupesSkipped` ribbon

Pseudocode-level structure (real implementation should follow existing dialog styling — see `AddSampleSetDialog.tsx` for the dark cell pattern):

```tsx
'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { apiRequest } from '@/lib/trade-utils';
import { parseSampleSetCsv, type SampleSetRow } from '@/lib/sample-set-csv';
import { mergeDedupedRows } from '@/lib/sample-set-rows';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface SampleSetRowsBuilderProps {
  rows: SampleSetRow[];
  onChange: (next: SampleSetRow[]) => void;
  // Optional initial seed (used by watchlist Save → "Create new").
  initialSeed?: SampleSetRow[];
}

export default function SampleSetRowsBuilder({
  rows,
  onChange,
  initialSeed,
}: SampleSetRowsBuilderProps) {
  const [manualTicker, setManualTicker] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const [csvError, setCsvError] = useState<string | null>(null);
  const [lastCsvImport, setLastCsvImport] = useState<{ added: number; skipped: number } | null>(null);

  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFetching, setTagFetching] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [lastTagImport, setLastTagImport] = useState<{ added: number; skipped: number } | null>(null);

  // One-shot seed on mount (Watchlist Save → Create new).
  useEffect(() => {
    if (!initialSeed || initialSeed.length === 0) return;
    const { merged } = mergeDedupedRows(rows, initialSeed);
    onChange(merged);
    // intentionally only run on mount with the initial seed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load tag list once.
  useEffect(() => {
    let aborted = false;
    void fetch('/api/tags')
      .then((response) => (response.ok ? response.json() : { tags: [] }))
      .then((data) => {
        if (aborted) return;
        const list = Array.isArray(data?.tags) ? (data.tags as string[]) : [];
        setAllTags(list);
      })
      .catch(() => {
        if (!aborted) setAllTags([]);
      });
    return () => {
      aborted = true;
    };
  }, []);

  const handleCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCsvError(null);
    try {
      const text = await file.text();
      const parsed = parseSampleSetCsv(text);
      const { merged, skippedCount } = mergeDedupedRows(rows, parsed.rows);
      const added = merged.length - rows.length;
      onChange(merged);
      setLastCsvImport({ added, skipped: skippedCount + parsed.skippedCount });
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : 'Could not parse CSV');
    }
  };

  const handleManualAdd = () => {
    const ticker = manualTicker.trim().toUpperCase();
    const date = manualDate.trim();
    if (!ticker) { setManualError('Ticker is required'); return; }
    if (!DATE_PATTERN.test(date)) { setManualError('Date must be YYYY-MM-DD'); return; }
    const { merged, skippedCount } = mergeDedupedRows(rows, [{ ticker, date }]);
    onChange(merged);
    setManualTicker('');
    setManualDate('');
    setManualError(skippedCount > 0 ? `${ticker} ${date} already in list` : null);
  };

  const handleAddFromTags = async () => {
    if (selectedTags.length === 0) return;
    setTagFetching(true);
    setTagError(null);
    try {
      const payload = await apiRequest<{ rows: SampleSetRow[]; skippedCount: number }>(
        '/api/sample-sets/from-tags',
        { method: 'POST', body: JSON.stringify({ tags: selectedTags }) },
      );
      if (payload.rows.length === 0) {
        setTagError('No matching trades for the selected tag(s)');
        setLastTagImport({ added: 0, skipped: payload.skippedCount });
        return;
      }
      const { merged, skippedCount } = mergeDedupedRows(rows, payload.rows);
      const added = merged.length - rows.length;
      onChange(merged);
      setLastTagImport({ added, skipped: skippedCount + payload.skippedCount });
      setSelectedTags([]);
    } catch (error) {
      setTagError(error instanceof Error ? error.message : 'Could not load tag rows');
    } finally {
      setTagFetching(false);
    }
  };

  const removeRow = (key: string) => {
    onChange(rows.filter((row) => `${row.ticker}|${row.date}` !== key));
  };

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ticker.localeCompare(b.ticker))),
    [rows],
  );

  return (
    <div className="space-y-4">
      {/* CSV section */}
      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <Label className="text-xs font-semibold text-white">From CSV</Label>
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void handleCsv(event)}
          className="border-white/10 bg-white/5 text-zinc-100 file:mr-3 file:border-0 file:bg-transparent file:text-zinc-300"
        />
        {lastCsvImport ? (
          <p className="text-xs text-zinc-500">
            Added {lastCsvImport.added}{lastCsvImport.skipped > 0 ? `, skipped ${lastCsvImport.skipped} duplicate/invalid` : ''}.
          </p>
        ) : null}
        {csvError ? <p className="text-xs text-rose-400">{csvError}</p> : null}
      </section>

      {/* Manual entry section */}
      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <Label className="text-xs font-semibold text-white">Manual entry</Label>
        <div className="flex gap-2">
          <Input
            value={manualTicker}
            onChange={(event) => setManualTicker(event.target.value.toUpperCase())}
            placeholder="AAPL"
            className="flex-1 border-white/10 bg-white/5 text-zinc-100"
          />
          <Input
            type="date"
            value={manualDate}
            onChange={(event) => setManualDate(event.target.value)}
            className="flex-1 border-white/10 bg-white/5 text-zinc-100 [color-scheme:dark]"
          />
          <Button
            type="button"
            onClick={handleManualAdd}
            className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
        {manualError ? <p className="text-xs text-rose-400">{manualError}</p> : null}
      </section>

      {/* Tags section */}
      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <Label className="text-xs font-semibold text-white">From tags</Label>
        <div className="flex gap-2">
          <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="flex-1 justify-start border border-white/10 bg-white/5 text-left text-zinc-200"
              >
                {selectedTags.length > 0 ? selectedTags.join(', ') : 'Select tag(s)…'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 border-white/10 bg-[#18181b] p-0 text-white" align="start">
              <Command className="bg-transparent">
                <CommandInput placeholder="Search tags…" />
                <CommandList>
                  <CommandEmpty>No tags yet.</CommandEmpty>
                  <CommandGroup>
                    {allTags.map((tag) => {
                      const selected = selectedTags.includes(tag);
                      return (
                        <CommandItem
                          key={tag}
                          value={tag}
                          onSelect={() => {
                            setSelectedTags((current) =>
                              current.includes(tag)
                                ? current.filter((value) => value !== tag)
                                : [...current, tag],
                            );
                          }}
                        >
                          <span className="flex-1">{tag}</span>
                          {selected ? <X className="h-3 w-3 text-emerald-400" /> : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            disabled={selectedTags.length === 0 || tagFetching}
            onClick={() => void handleAddFromTags()}
            className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {tagFetching ? 'Loading…' : 'Add to set'}
          </Button>
        </div>
        {lastTagImport ? (
          <p className="text-xs text-zinc-500">
            Added {lastTagImport.added}{lastTagImport.skipped > 0 ? `, skipped ${lastTagImport.skipped} duplicate/invalid` : ''}.
          </p>
        ) : null}
        {tagError ? <p className="text-xs text-rose-400">{tagError}</p> : null}
      </section>

      {/* Staging list */}
      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-white">Staging ({rows.length} row{rows.length === 1 ? '' : 's'})</Label>
          {rows.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-zinc-500 hover:text-rose-400"
            >
              Clear all
            </button>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <p className="text-xs italic text-zinc-500">No rows staged yet.</p>
        ) : (
          <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
            {sortedRows.map((row) => {
              const key = `${row.ticker}|${row.date}`;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between rounded border border-white/5 bg-[#121214] px-2 py-1 text-xs"
                >
                  <span className="font-mono text-zinc-100">{row.ticker}</span>
                  <span className="text-zinc-400">{row.date}</span>
                  <button
                    type="button"
                    onClick={() => removeRow(key)}
                    className="ml-2 rounded p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                    aria-label={`Remove ${row.ticker} ${row.date}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
```

**Acceptance:**
- [ ] All three sources update the same staging array.
- [ ] Duplicate ticker/date never appears twice in staging.
- [ ] Per-row delete works.
- [ ] Tag picker is multi-select.
- [ ] Component renders cleanly inside both dialogs.

---

#### 9. Refactor `AddSampleSetDialog` to use the builder

**File:** `components/trading/AddSampleSetDialog.tsx`
**Action:** MODIFY

1. Replace the entire file with a thin dialog wrapper around `SampleSetRowsBuilder`. Keep the props signature (`open`, `onOpenChange`, `onSubmit`), but expand `onSubmit` to receive the deduped rows.
2. Add an optional `initialSeedRows` prop (used by watchlist Save → Create new path):
   ```ts
   interface AddSampleSetDialogProps {
     open: boolean;
     onOpenChange: (open: boolean) => void;
     onSubmit: (body: { name: string; rows: SampleSetRow[] }) => Promise<void>;
     initialSeedRows?: SampleSetRow[];
   }
   ```
3. Internal state: `name` (string), `rows` (SampleSetRow[]), `submitting`, `error`. On submit: trim name, require ≥1 staged row, call `onSubmit`, then close.
4. Error display path: if `onSubmit` throws `A sample set with that name already exists`, surface an inline message offering "Rename or use Add Row from Backtest Manager." (Keep it simple — no auto-append flow in v1; the user can rename.)
5. Title stays "Add Sample Set".

**Acceptance:**
- [ ] Existing call site `BacktestManagerView.tsx:409-416` still works.
- [ ] Dialog renders builder, submits with the deduped rows.
- [ ] Name collision shows inline guidance.

---

#### 10. Refactor `AddSampleSetRowsDialog` to use the builder

**File:** `components/trading/AddSampleSetRowsDialog.tsx`
**Action:** MODIFY

1. Replace the ticker/date single-row inputs with `<SampleSetRowsBuilder>`.
2. Keep props identical (`open`, `onOpenChange`, `sampleSetName`, `onSubmit`) — `onSubmit` receives the full staged rows array (already the contract).
3. Submit guard: require ≥1 staged row.
4. Title stays `Add to "<sampleSetName>"`.

**Acceptance:**
- [ ] Existing call site `BacktestManagerView.tsx:418-430` still works.
- [ ] Dialog supports CSV + Manual + Tags + staging just like create.

---

#### 11. Backtest Manager — let everyone see the "+ Add Row" button

**File:** `components/trading/BacktestManagerView.tsx`
**Action:** MODIFY

1. Line 364 wraps both buttons (Add Row + Delete) in `{isOwner ? ... : null}`. Split that:
   - The `+ Add Row` button should always render (anyone can append now).
   - The `Trash2` Delete button stays owner-only.

   Replace the current block:
   ```tsx
   {isOwner ? (
     <div className="flex shrink-0 items-center gap-2">
       <Button ... Add Row ... />
       <Button ... Delete ... />
     </div>
   ) : null}
   ```
   With:
   ```tsx
   <div className="flex shrink-0 items-center gap-2">
     <Button
       type="button"
       variant="ghost"
       size="icon-xs"
       onClick={() => setAppendRowsTarget(sampleSet)}
       aria-label={`Add Row to ${sampleSet.name}`}
       title="Add Row"
       className={addIconButtonClass}
     >
       <Plus className="size-4" />
     </Button>
     {isOwner ? (
       <Button
         type="button"
         variant="ghost"
         size="icon-xs"
         onClick={() => void handleDeleteSampleSet(sampleSet.id, sampleSet.name)}
         aria-label={`Delete ${sampleSet.name}`}
         title="Delete"
         className={deleteIconButtonClass}
       >
         <Trash2 className="size-4" />
       </Button>
     ) : null}
   </div>
   ```

**Acceptance:**
- [ ] Non-owner sees "+ Add Row" on every sample set; clicking opens `AddSampleSetRowsDialog`.
- [ ] Non-owner does not see the Delete trash icon.
- [ ] Owner sees both.

---

### Steps 7-11 Checkpoint Status (2026-05-16)

- Verified `hooks/use-backtest-manager.ts` already returns `currentUserId`; no hook code change was required for Step 7.
- Added shared `components/trading/SampleSetRowsBuilder.tsx` with CSV, manual, tags, deduped staging, duplicate/invalid skip feedback, per-row removal, and optional seed rows.
- Refactored `AddSampleSetDialog` and `AddSampleSetRowsDialog` to use the shared builder while preserving existing call-site contracts.
- Updated `BacktestManagerView` so every sample set shows the append button while delete remains owner-only.
- Added focused Backtest Manager coverage for non-owner append visibility and owner-only delete.
- Validation completed for this checkpoint:
  - `npx vitest run __tests__/sample-sets-route.test.ts __tests__/sample-sets-from-tags-route.test.ts __tests__/backtest-manager-view.test.tsx` passed: 3 files, 24 tests.
  - `npm run lint` passed.
  - `npx tsc --noEmit` passed.
  - `npm test` passed: 91 files, 659 tests.
  - `npm run workflow:audit` passed.
- Steps 12-13 were completed in the final checkpoint below.

---

#### 12. Watchlist — Save column + bulk save

**File:** `components/trading/WatchlistEditor.tsx`
**Action:** MODIFY

This component is the most invasive UI change. Add:
- A Save column (date-only, same gating as `showChartColumn`).
- A leading checkbox column (date-only) for bulk select.
- A toolbar action `Save selected to sample set…` above the grid when ≥1 row is checked.
- A new `<WatchlistSavePicker>` subcomponent (defined below in step 13) wired to the picker open/close state.

Specific edits:

1. Add new state in `WatchlistEditor`:
   ```ts
   const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
   const [savePickerRows, setSavePickerRows] = useState<SampleSetRow[] | null>(null);
   ```
   `savePickerRows` opens the picker dialog when non-null. Rows passed in are what'll be appended on pick.

2. Gate the new columns the same way as Chart: `const showSaveColumn = Boolean(date);` and `const showSelectColumn = showSaveColumn && !readOnly;`.

3. Update `gridTemplateColumns` (current line 175):
   ```ts
   const selectColumn = showSelectColumn ? '28px ' : '';
   const baseColumns = '80px minmax(140px, 1fr) 70px minmax(160px, 2fr) 56px';
   const chartColumn = showChartColumn ? ' 56px' : '';
   const saveColumn = showSaveColumn ? ' 56px' : '';
   const deleteColumn = readOnly ? '' : ' 28px';
   const gridTemplateColumns = `${selectColumn}${baseColumns}${chartColumn}${saveColumn}${deleteColumn}`;
   ```

4. Add headers in the same order (`<select header>`, Ticker, Thesis, Grade, Notes, Report, [Chart], [Save], [delete]). Use the existing `bg-[#121214] px-3 py-2 text-xs font-semibold text-white` header style. Save header label: `Save`.

5. Add a toolbar above the grid (between the title row and the grid wrapper) that appears when `selectedRowIds.size > 0`:
   ```tsx
   {selectedRowIds.size > 0 ? (
     <div className="flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
       <span>{selectedRowIds.size} row{selectedRowIds.size === 1 ? '' : 's'} selected</span>
       <div className="flex items-center gap-2">
         <button
           type="button"
           onClick={() => {
             const targetRows: SampleSetRow[] = value
               .filter((row) => selectedRowIds.has(row.id) && row.ticker.trim() && date)
               .map((row) => ({ ticker: row.ticker.toUpperCase(), date: date as string }));
             if (targetRows.length === 0) return;
             setSavePickerRows(targetRows);
           }}
           className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 hover:bg-emerald-500/20"
         >
           Save selected to sample set…
         </button>
         <button
           type="button"
           onClick={() => setSelectedRowIds(new Set())}
           className="text-zinc-400 hover:text-white"
         >
           Clear
         </button>
       </div>
     </div>
   ) : null}
   ```

6. Pass these new props through `RowCellsProps` to `RowCells`: `showSaveColumn`, `showSelectColumn`, `isSelected`, `onToggleSelected`, `onClickSave`.

7. In `RowCells`, render two new cells when the column is shown:
   - **Select cell** (first column): a small checkbox tied to `isSelected` / `onToggleSelected`.
   - **Save cell** (after Chart, before delete): a `+` icon button, disabled if ticker is empty:
     ```tsx
     function SaveCell({ ticker, onClick }: { ticker: string; onClick: () => void }) {
       if (!ticker.trim()) {
         return <div className="flex items-center justify-center bg-[#121214] px-1 py-1.5 text-xs text-zinc-700">—</div>;
       }
       return (
         <div className="flex items-center justify-center bg-[#121214] px-1 py-1.5">
           <button
             type="button"
             onClick={onClick}
             className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-emerald-400"
             title="Save to sample set"
             aria-label="Save to sample set"
           >
             <Plus className="h-3.5 w-3.5" />
           </button>
         </div>
       );
     }
     ```
   - `onClickSave` in `WatchlistEditor` builds the single-row payload and sets `savePickerRows`:
     ```ts
     const handleClickSave = useCallback((row: WatchlistRow) => {
       if (!row.ticker.trim() || !date) return;
       setSavePickerRows([{ ticker: row.ticker.toUpperCase(), date }]);
     }, [date]);
     ```

8. At the bottom of the returned JSX (still inside the outer `<section>`), mount the picker:
   ```tsx
   {savePickerRows ? (
     <WatchlistSavePicker
       open
       onOpenChange={(open) => {
         if (!open) {
           setSavePickerRows(null);
           setSelectedRowIds(new Set());
         }
       }}
       seedRows={savePickerRows}
     />
   ) : null}
   ```

9. Import `WatchlistSavePicker` at the top: `import WatchlistSavePicker from '@/components/trading/WatchlistSavePicker';`. Also import `Plus` from lucide (already present).

10. Re-export the `SampleSetRow` shape from `lib/sample-set-csv` at the top — `import type { SampleSetRow } from '@/lib/sample-set-csv';`.

**Acceptance:**
- [ ] Save column hidden on weekly review (no `date` prop).
- [ ] Per-row `+` icon disabled when ticker empty.
- [ ] Checkbox column shows on daily review, hidden on weekly and in readOnly mode.
- [ ] Bulk toolbar appears only when ≥1 row checked.
- [ ] Bulk "Save selected" filters out empty-ticker rows.
- [ ] Picker dialog opens with seeded rows.

---

#### 13. New component: `WatchlistSavePicker`

**File:** `components/trading/WatchlistSavePicker.tsx`
**Action:** CREATE

Picker dialog used by the watchlist Save column. Lists all sample sets (caller's pinned at top, others labeled with owner). Top entry is `+ Create new sample set…` which opens `AddSampleSetDialog` pre-seeded with `seedRows`.

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import AddSampleSetDialog from '@/components/trading/AddSampleSetDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/trade-utils';
import type { SampleSetRow } from '@/lib/sample-set-csv';

interface WatchlistSavePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seedRows: SampleSetRow[];
}

type SampleSetListItem = {
  id: string;
  name: string;
  rowCount: number;
  ownerId: string;
  ownerName: string | null;
};

export default function WatchlistSavePicker({
  open,
  onOpenChange,
  seedRows,
}: WatchlistSavePickerProps) {
  const [sampleSets, setSampleSets] = useState<SampleSetListItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [appending, setAppending] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let aborted = false;
    void apiRequest<{ sampleSets: SampleSetListItem[]; currentUserId: string }>(
      '/api/sample-sets',
    )
      .then((payload) => {
        if (aborted) return;
        setSampleSets(payload.sampleSets ?? []);
        setCurrentUserId(payload.currentUserId ?? null);
      })
      .catch(() => {
        if (!aborted) setSampleSets([]);
      });
    return () => {
      aborted = true;
    };
  }, [open]);

  const sortedSets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = sampleSets.filter((set) => {
      if (!query) return true;
      return set.name.toLowerCase().includes(query) || (set.ownerName ?? '').toLowerCase().includes(query);
    });
    return [...filtered].sort((a, b) => {
      const aMine = a.ownerId === currentUserId ? 0 : 1;
      const bMine = b.ownerId === currentUserId ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return a.name.localeCompare(b.name);
    });
  }, [sampleSets, currentUserId, search]);

  const handlePick = async (set: SampleSetListItem) => {
    setAppending(set.id);
    try {
      const payload = await apiRequest<{ skippedCount: number }>(
        `/api/sample-sets/${set.id}`,
        { method: 'PATCH', body: JSON.stringify({ appendRows: seedRows }) },
      );
      const added = seedRows.length - (payload.skippedCount ?? 0);
      toast.success(
        added > 0
          ? `Added ${added} row${added === 1 ? '' : 's'} to "${set.name}"${payload.skippedCount > 0 ? ` (${payload.skippedCount} dupes skipped)` : ''}`
          : `All ${seedRows.length} row${seedRows.length === 1 ? '' : 's'} already in "${set.name}"`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save to sample set');
    } finally {
      setAppending(null);
    }
  };

  return (
    <>
      <Dialog open={open && !createOpen} onOpenChange={onOpenChange}>
        <DialogContent className="border-white/10 bg-[#121214] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to sample set</DialogTitle>
          </DialogHeader>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sample sets…"
            className="border-white/10 bg-white/5 text-zinc-100"
          />

          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex w-full items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-left text-sm text-emerald-300 hover:bg-emerald-500/10"
            >
              <Plus className="h-4 w-4" />
              Create new sample set…
            </button>

            {sortedSets.length === 0 ? (
              <p className="px-3 py-4 text-xs italic text-zinc-500">No sample sets found.</p>
            ) : (
              sortedSets.map((set) => {
                const isMine = set.ownerId === currentUserId;
                return (
                  <button
                    key={set.id}
                    type="button"
                    disabled={appending === set.id}
                    onClick={() => void handlePick(set)}
                    className="flex w-full items-center justify-between rounded border border-white/5 bg-[#0f0f12] px-3 py-2 text-left text-sm text-zinc-100 hover:bg-white/5 disabled:opacity-40"
                  >
                    <span className="flex flex-col">
                      <span className="font-mono">{set.name}</span>
                      <span className="text-[11px] text-zinc-500">
                        {set.rowCount} row{set.rowCount === 1 ? '' : 's'}{isMine ? ' · yours' : ` · by ${set.ownerName ?? 'Unknown'}`}
                      </span>
                    </span>
                    {appending === set.id ? <span className="text-xs text-zinc-400">Adding…</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AddSampleSetDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) onOpenChange(false);
        }}
        initialSeedRows={seedRows}
        onSubmit={async (body) => {
          const payload = await apiRequest<{ sampleSet: { name: string }; skippedCount: number }>(
            '/api/sample-sets',
            { method: 'POST', body: JSON.stringify(body) },
          );
          toast.success(
            `Created "${payload.sampleSet.name}"${payload.skippedCount > 0 ? ` (${payload.skippedCount} dupes skipped)` : ''}`,
          );
        }}
      />
    </>
  );
}
```

**Acceptance:**
- [ ] Picker lists all sample sets with yours first.
- [ ] Owner label is shown for others' sets.
- [ ] Search filters by name and owner.
- [ ] Append shows toast with added/skipped counts.
- [ ] "Create new sample set…" opens AddSampleSetDialog pre-seeded with `seedRows`.
- [ ] Closing the create dialog also closes the picker (cleans up state).

---

### Steps 12-13 Final Checkpoint Status (2026-05-16)

- Updated `components/trading/WatchlistEditor.tsx` with daily-review Save and checkbox columns, per-row save buttons, bulk save selection, empty-ticker filtering, and seeded picker state.
- Added `components/trading/WatchlistSavePicker.tsx` to list searchable sample sets, pin the caller's sets first, append seeded rows, and open seeded create-new sample set flow.
- Added `__tests__/watchlist-editor.test.tsx` covering weekly/no-date gating, daily checkbox visibility, read-only checkbox hiding, per-row seeded save, and bulk filtering of empty tickers.
- Validation completed for the full Collaborative Sample-Set Building spec:
  - `npx vitest run __tests__/watchlist-editor.test.tsx` passed: 1 file, 4 tests.
  - `npm run lint` passed.
  - `npx tsc --noEmit` passed.
  - `npx vitest run __tests__/sample-sets-route.test.ts __tests__/sample-sets-from-tags-route.test.ts __tests__/backtest-manager-view.test.tsx __tests__/watchlist-editor.test.tsx` passed: 4 files, 28 tests.
  - `npm test` passed: 92 files, 663 tests.
- Browser/manual smoke was not run in this session.
- All implementation steps 1-13 are complete; no next phase remains unopened in this active spec.

---

### Files Changed Summary

| File | Action | Approx lines | Risk |
|------|--------|--------------|------|
| `lib/validations/sample-sets.ts` | MODIFY | +5 | Low |
| `lib/sample-set-rows.ts` | CREATE | +40 | Low |
| `app/api/sample-sets/route.ts` | MODIFY | +5 / -3 | Low |
| `app/api/sample-sets/[id]/route.ts` | MODIFY | ~100 (rewrite PATCH) | **Medium** — transactional logic + auth model change |
| `app/api/sample-sets/from-tags/route.ts` | CREATE | +60 | Low |
| `__tests__/sample-sets-route.test.ts` | MODIFY | +120 | Low |
| `__tests__/sample-sets-from-tags-route.test.ts` | CREATE | +100 | Low |
| `components/trading/SampleSetRowsBuilder.tsx` | CREATE | +280 | **Medium** — new shared UI primitive |
| `components/trading/AddSampleSetDialog.tsx` | MODIFY | rewrite (~80) | Low |
| `components/trading/AddSampleSetRowsDialog.tsx` | MODIFY | rewrite (~60) | Low |
| `components/trading/BacktestManagerView.tsx` | MODIFY | +5 / -5 | Low |
| `components/trading/WatchlistEditor.tsx` | MODIFY | +120 / -10 | **Medium** — grid template change has historically caused JIT misses |
| `components/trading/WatchlistSavePicker.tsx` | CREATE | +160 | Low |
| `__tests__/watchlist-editor.test.tsx` | CREATE | +100 | Low |

**Total:** 6 new files, 9 modified.

### Verification Steps

Required commands from repo root:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npx vitest run __tests__/sample-sets-route.test.ts __tests__/sample-sets-from-tags-route.test.ts __tests__/backtest-manager-view.test.tsx __tests__/watchlist-editor.test.tsx`
4. `npm test`
5. `npm run workflow:audit` if `HANDOFF.md` was updated

Manual checks (browser, logged in as two different users in two browsers):

- [ ] User A creates a sample set with `[AAPL/2026-05-01, AAPL/2026-05-01]` from the manual entry section → set saved with 1 row, toast notes 1 dupe skipped.
- [ ] User A creates a sample set from one of their tags with ≥5 trades; preview/staging shows deduped rows.
- [ ] User B opens Backtest Manager → sees `+ Add Row` on User A's set, can append a row → set's `rowCount` increments for both users.
- [ ] User B does NOT see the Delete trash icon on User A's set.
- [ ] User B tries to rename User A's set via direct PATCH (curl/devtools) → 403.
- [ ] Two simultaneous appends from A and B to the same set both land (open both browsers, click roughly together) — no rows lost.
- [ ] Daily review watchlist shows Save column + checkbox column when `date` is present.
- [ ] Weekly review watchlist does NOT show those columns.
- [ ] Per-row `+` Save → picker opens, lists sets, "yours" pinned, append works.
- [ ] Multi-select checkboxes → bulk "Save selected to sample set…" appears.
- [ ] Picker → "+ Create new sample set" opens AddSampleSetDialog pre-seeded with the row(s).

### Out of Scope

- Schema migration to per-row `sample_set_rows` table (Option C). Stays as jsonb.
- Team/shared tags. Tag scope is caller's own trades only.
- System-sheet → sample-set integration. Separate effort.
- Renaming or deleting by non-owners.
- Per-row attribution / audit log of who appended what.
- Notification when someone appends to your set.

### Open Questions for the User

None. All four planning decisions have been made (ownership model B, tag = own trades only, picker includes Create new option, multi-select tags with OR-union).

---

## Session Maintenance Checklist

- [ ] Read this file before starting.
- [ ] If the active spec drifts from the live repo, update the spec or stop and ask before editing.
- [ ] After each step, run lint + type-check.
- [ ] Run full `npm test` before reporting the spec complete.
- [ ] Do NOT push to remote without explicit user instruction.
- [ ] Do NOT modify `.env*` or workflow assets under `AGENTS.md` / `codex-skills/` for this spec.
