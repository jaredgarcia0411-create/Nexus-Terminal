# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-18
> Purpose: active execution spec for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

## Current Context

- Completed spec below: **Multi-Day & Overnight Position Support — Phase 1**. Phase 1 shipped schema/migration, server matcher, close/merge/open-position UI, open/closed filtering, and closed-only stats/journal aggregation. Steps 8 and 19 remain explicitly deferred to Phase 2.
- Validation completed 2026-05-18: `npm run lint`, `npx tsc --noEmit`, `npm run db:migrate`, and `npm test` all passed. `npm test` reported 94 files / 685 tests passing.
- Phase 2 (cross-day auto-matcher, partial close UX, `realized_segments` JSONB, `closedAt`-based PnL bucketing, calendar/journal multi-day spans) is explicitly OUT of scope for this sprint.
- Last shipped before this: Collaborative Sample-Set Building (commits `b3bd170`, `d512db9`, `dfe35b4`, `cc33025`).
- Open parked items unrelated to active work: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, Backtest Manager `broke_premarket_high`.

## Active Execution Spec

## Multi-Day & Overnight Position Support — Phase 1

> Generated: 2026-05-18 | Agent: nexus-architect
> Status: COMPLETED — validated and locally committed by Codex on 2026-05-18

### Summary

Adds three new columns to the `trades` table (`is_open`, `closed_at`, `remaining_qty`), extracts FIFO position-matching into a new server-side `lib/position-matcher.ts` module with unit tests (the matching algorithm currently lives in `lib/csv-parser.ts` and runs client-side; Phase 1 just lifts it out so Phase 2 can wire it to a new server endpoint without redesigning the algorithm — the new module is NOT yet called from anywhere), and delivers the full Phase 1 UI surface: "Open position" checkbox in NewTradeDialog, "Close Position" panel in TradeDetailSheet, "Merge" action in TradeTable, OPEN badge + filter chip in TradeTable, and closed-only filtering in PerformanceStatsTable/journal-aggregates. Phase 2 (cross-day auto-matching, server-side CSV import, partial close, realized_segments) is not in scope.

### Scope

**In scope:**
- Schema migration 0038 — 3 new columns + backfill
- `lib/position-matcher.ts` — extracted, server-side FIFO matcher (used by Phase 2; built now with tests so Phase 2 can wire it without re-deriving the algorithm)
- `lib/types.ts`, `lib/trade-utils.ts`, `lib/server-db-utils.ts` — surface new fields
- `lib/validations/trades.ts` — new schemas for import-raw, close-position, merge
- `app/api/trades/[id]/route.ts` PATCH — extend to handle close-position action
- `app/api/trades/merge/route.ts` — new endpoint
- `components/trading/NewTradeDialog.tsx` — open position checkbox
- `components/trading/TradeDetailSheet.tsx` — Close Position panel
- `components/trading/TradeTable.tsx` — OPEN badge, PnL `—`, filter chip, Merge button
- `hooks/use-trade-filters.ts` — `positionFilter` state
- `hooks/use-trades.ts` — `handleMergeTrades`, `handleCloseTrade` actions
- `components/trading/PerformanceStatsTable.tsx` — exclude open trades, show indicator
- `lib/journal-aggregates.ts` — exclude open trades
- `__tests__/position-matcher.test.ts` — new unit tests
- `__tests__/trade-merge.test.ts` — new unit tests
- `__tests__/journal-aggregates.test.ts` — extend with open-trade exclusion cases

**Out of scope (Phase 2):**
- Cross-day auto-matching in the CSV importer
- `app/api/trades/import-raw/route.ts` — the server endpoint that consumes `lib/position-matcher.ts`. Deferred because the CSV import path can't be cleanly switched over until Phase 2 introduces a client-side raw-extraction helper. Phase 1 ships only the matcher module + tests.
- Partial close UX
- `realized_segments` JSONB column
- Calendar / journal multi-day span views

---

### Implementation Steps

---

#### Step 1: Schema — add columns to `trades` table

**File:** `lib/db/schema.ts`
**Action:** MODIFY

**Instructions:**
1. On line 40 (after `fees: doublePrecision('fees').default(0),`), add three new column definitions before the closing of the `trades` pgTable call body:

```ts
  isOpen: boolean('is_open').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  remainingQty: doublePrecision('remaining_qty').notNull().default(0),
```

The block from line 39 through the closing of the column list (line 42, `createdAt`) should now read:

```ts
  commission: doublePrecision('commission').default(0),
  fees: doublePrecision('fees').default(0),
  isOpen: boolean('is_open').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  remainingQty: doublePrecision('remaining_qty').notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
```

Note: `notes` is currently on line 41, between `fees` and `createdAt`. Insert the three new columns between `fees` and `notes`.

2. `boolean` is already imported on line 2 — no import change needed.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run db:generate` produces a new SQL file in `drizzle/` prefixed `0038_`
- [ ] The generated SQL contains `ALTER TABLE "trades" ADD COLUMN "is_open" boolean NOT NULL DEFAULT false`
- [ ] The generated SQL contains `ALTER TABLE "trades" ADD COLUMN "closed_at" timestamp with time zone`
- [ ] The generated SQL contains `ALTER TABLE "trades" ADD COLUMN "remaining_qty" double precision NOT NULL DEFAULT 0`

---

#### Step 2: Migration file — generate + write backfill

**File:** `drizzle/0038_<name>.sql` (name assigned by drizzle-kit)
**Action:** MODIFY (append to the generated file after running generate)

**Instructions:**
1. Run `npm run db:generate`. Drizzle-kit will create `drizzle/0038_<marvel-name>.sql` — the exact name does not matter.
2. Open the generated file. Verify it contains the three `ALTER TABLE "trades" ADD COLUMN` statements from Step 1.
3. Append the following SQL at the end of the file, after the generated statements (before any trailing `-->` breakpoint comment if present, otherwise just at the end):

```sql
--> statement-breakpoint
UPDATE "trades" SET "closed_at" = (date::date)::timestamptz WHERE "closed_at" IS NULL;
```

`is_open` and `remaining_qty` already have `NOT NULL DEFAULT` clauses on the ALTER, so all existing rows pick up `false` / `0` automatically — no backfill needed for those.

The `closed_at` backfill sets every pre-existing trade's close timestamp to its `date` value (cast `text` → `date` → `timestamptz`). Historical trades are all closed, so their close date is their trade date. This sets up Phase 2's `closedAt`-based PnL bucketing to work correctly for historical data without a separate backfill later. The cast is safe because `date` is validated as `YYYY-MM-DD` everywhere it's written (CSV parser, manual entry, TraderVue importer).

**Acceptance:**
- [ ] `npm run db:migrate` applies the migration without error
- [ ] Running `SELECT is_open, closed_at, remaining_qty FROM trades LIMIT 5;` via any SQL client shows `is_open=false`, `closed_at` populated to each trade's date (e.g. `2026-05-15 00:00:00+00`), `remaining_qty=0` for all pre-existing rows

---

#### Step 3: Types — add `isOpen`, `closedAt`, `remainingQty` to `Trade` and `ApiTrade`

**File:** `lib/types.ts`
**Action:** MODIFY

**Instructions:**
1. In the `Trade` interface (lines 14-42), add three fields after `notes?: string;` (currently line 41):

```ts
  isOpen?: boolean;
  closedAt?: string | null;
  remainingQty?: number;
```

2. In the `ApiTrade` type (lines 48-74), add the same three fields after `notes?: string;` (currently line 73):

```ts
  isOpen?: boolean;
  closedAt?: string | null;
  remainingQty?: number;
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes

---

#### Step 4: `normalizeTrade` — default new fields

**File:** `lib/trade-utils.ts`
**Action:** MODIFY

**Instructions:**
1. In `normalizeTrade` (lines 21-42), inside the returned object spread, add after `tags: trade.tags ?? [],`:

```ts
    isOpen: trade.isOpen ?? false,
    remainingQty: trade.remainingQty ?? 0,
```

`closedAt` is already optional/nullable — no default needed.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes

---

#### Step 5: `toTrade` — surface new fields from DB row

**File:** `lib/server-db-utils.ts`
**Action:** MODIFY

**Instructions:**
1. In `toTrade` (lines 132-169), add three fields to the returned object after `notes: row.notes ?? undefined,`:

```ts
    isOpen: row.isOpen ?? false,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    remainingQty: row.remainingQty ?? 0,
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes

---

#### Step 6: Validations — extend schemas and add new ones

**File:** `lib/validations/trades.ts`
**Action:** MODIFY

**Instructions:**

1. In `createTradeSchema` (lines 14-40), add these three optional fields after `tags: z.array(z.string()).optional(),` (currently line 39):

```ts
  isOpen: z.boolean().optional().default(false),
  closedAt: z.string().nullable().optional(),
  remainingQty: z.number().finite().optional().default(0),
```

2. In `importTradeItemSchema` (lines 60-86), add the same three fields after `tags: z.array(z.string()).optional(),` (currently line 85):

```ts
  isOpen: z.boolean().optional().default(false),
  closedAt: z.string().nullable().optional(),
  remainingQty: z.number().finite().optional().default(0),
```

3. After the `importTradesSchema` block (currently ends at line 93), add these new schemas:

```ts
// Schema for the close-position action on PATCH /api/trades/[id]
export const closePositionSchema = z.object({
  action: z.literal('close'),
  exitPrice: z.number().finite().positive(),
  exitTime: z.string().min(1),
});

export type ClosePositionInput = z.infer<typeof closePositionSchema>;

// Schema for POST /api/trades/merge
export const mergeTradesSchema = z.object({
  ids: z.array(z.string().min(1)).min(2, 'Select at least 2 trades to merge'),
});

export type MergeTradesInput = z.infer<typeof mergeTradesSchema>;
```

(Note: an `importRawSchema` was originally planned here to support a Phase 1 server-side CSV import endpoint. That endpoint is now deferred to Phase 2 — see Step 8 — so the schema is not added in Phase 1.)

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes

---

#### Step 7: Create `lib/position-matcher.ts`

**File:** `lib/position-matcher.ts`
**Action:** CREATE

**Instructions:**

Create this file with the following content. This is the FIFO matching logic extracted from `lib/csv-parser.ts:processCsvData` (lines 220-320), refactored to work on pre-normalized execution inputs instead of raw CSV rows. The file stands alone — no circular dependencies.

```ts
/**
 * lib/position-matcher.ts
 *
 * Server-side FIFO position matcher. Accepts a list of raw executions for a
 * single trading day and produces matched trade objects.
 *
 * Phase 1: same-day matching only (unmatched executions produce warnings).
 * Phase 2 will extend this to consume pre-existing open positions.
 */

import type { Direction } from '@/lib/types';

export interface MatcherExecution {
  symbol: string;
  /** Canonical side after broker normalization. */
  side: 'LONG_ENTRY' | 'LONG_EXIT' | 'SHORT_ENTRY' | 'SHORT_EXIT';
  qty: number;
  price: number;
  time: string;
  commission: number;
  fees: number;
}

export interface MatchedTrade {
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  commission: number;
  fees: number;
}

export interface MatcherResult {
  trades: MatchedTrade[];
  warnings: string[];
}

type RawBucket = { qty: number; price: number; time: string; commission: number; fees: number };

function compareTimes(a: string, b: string): number {
  const toSeconds = (t: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
  };
  const aSecs = toSeconds(a);
  const bSecs = toSeconds(b);
  if (aSecs != null && bSecs != null) return aSecs - bSecs;
  if (aSecs != null) return -1;
  if (bSecs != null) return 1;
  return a.localeCompare(b);
}

function remainder(exec: RawBucket, matched: number): RawBucket | null {
  const rem = exec.qty - matched;
  if (rem <= 0) return null;
  const ratio = exec.qty > 0 ? rem / exec.qty : 0;
  return { ...exec, qty: rem, commission: exec.commission * ratio, fees: exec.fees * ratio };
}

function fifoMatch(
  entries: RawBucket[],
  exits: RawBucket[],
  direction: Direction,
  symbol: string,
  warnings: string[],
): MatchedTrade[] {
  const se = [...entries].sort((a, b) => compareTimes(a.time, b.time));
  const sx = [...exits].sort((a, b) => compareTimes(a.time, b.time));
  const trades: MatchedTrade[] = [];

  // Accumulated running totals for the single merged trade row.
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
    const q = Math.min(entry.qty, exit.qty);
    if (q <= 0) {
      const re = remainder(entry, q);
      const rx = remainder(exit, q);
      if (re) se.unshift(re);
      if (rx) sx.unshift(rx);
      continue;
    }

    const entryCommission = entry.qty > 0 ? (entry.commission / entry.qty) * q : 0;
    const exitCommission = exit.qty > 0 ? (exit.commission / exit.qty) * q : 0;
    const entryFees = entry.qty > 0 ? (entry.fees / entry.qty) * q : 0;
    const exitFees = exit.qty > 0 ? (exit.fees / exit.qty) * q : 0;
    const pairCommission = entryCommission + exitCommission;
    const pairFees = entryFees + exitFees;
    const gross = direction === 'LONG'
      ? (exit.price - entry.price) * q
      : (entry.price - exit.price) * q;
    const net = gross - pairCommission - pairFees;

    entryValueSum += entry.price * q;
    exitValueSum += exit.price * q;
    totalQty += q;
    totalGross += gross;
    totalNet += net;
    totalCommission += pairCommission;
    totalFees += pairFees;

    if (!earliestEntry || compareTimes(entry.time, earliestEntry) < 0) earliestEntry = entry.time;
    if (!latestExit || compareTimes(exit.time, latestExit) > 0) latestExit = exit.time;

    const re = remainder(entry, q);
    const rx = remainder(exit, q);
    if (re) se.unshift(re);
    if (rx) sx.unshift(rx);
  }

  if (totalQty > 0) {
    trades.push({
      symbol,
      direction,
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

  // Unmatched entries/exits — Phase 1 behavior: warn and drop.
  if (se.length > 0) {
    const unmatchedQty = se.reduce((s, e) => s + e.qty, 0);
    const label = direction === 'LONG' ? 'BUY' : 'SHORT SELL';
    const hint = 'position may still be open — use the "Open position" checkbox to record it manually';
    warnings.push(`${symbol}: ${unmatchedQty} unmatched ${label} share(s) (${se.length} fill(s)) — ${hint}`);
  }
  if (sx.length > 0) {
    const unmatchedQty = sx.reduce((s, e) => s + e.qty, 0);
    const label = direction === 'LONG' ? 'SELL' : 'COVER BUY';
    const hint = 'no matching entry fills for this day (carry-over from prior session?)';
    warnings.push(`${symbol}: ${unmatchedQty} unmatched ${label} share(s) (${sx.length} fill(s)) — ${hint}`);
  }

  return trades;
}

/**
 * Match a flat list of normalized executions for a single day.
 * Returns one merged MatchedTrade per symbol+direction combination.
 */
export function matchExecutions(executions: MatcherExecution[]): MatcherResult {
  const warnings: string[] = [];

  // Group by symbol + direction bucket.
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

  const allSymbols = new Set([
    ...Object.keys(longEntries),
    ...Object.keys(longExits),
    ...Object.keys(shortEntries),
    ...Object.keys(shortExits),
  ]);

  const trades: MatchedTrade[] = [];
  for (const symbol of allSymbols) {
    const longMatched = fifoMatch(
      longEntries[symbol] ?? [],
      longExits[symbol] ?? [],
      'LONG',
      symbol,
      warnings,
    );
    const shortMatched = fifoMatch(
      shortEntries[symbol] ?? [],
      shortExits[symbol] ?? [],
      'SHORT',
      symbol,
      warnings,
    );
    trades.push(...longMatched, ...shortMatched);
  }

  return { trades, warnings };
}

/**
 * Normalize broker-specific side codes into canonical MatcherExecution sides.
 * MARGIN / BUY -> LONG_ENTRY, S / SELL -> LONG_EXIT
 * SS / SHORT   -> SHORT_ENTRY, B / COVER -> SHORT_EXIT
 */
export function normalizeSide(
  raw: string,
): 'LONG_ENTRY' | 'LONG_EXIT' | 'SHORT_ENTRY' | 'SHORT_EXIT' | null {
  switch (raw.trim().toUpperCase()) {
    case 'MARGIN':
    case 'BUY':
      return 'LONG_ENTRY';
    case 'S':
    case 'SELL':
      return 'LONG_EXIT';
    case 'SS':
    case 'SHORT':
      return 'SHORT_ENTRY';
    case 'B':
    case 'COVER':
      return 'SHORT_EXIT';
    default:
      return null;
  }
}
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes

---

#### Step 8: (DEFERRED to Phase 2) — `app/api/trades/import-raw/route.ts`

**Action:** SKIP — do nothing in Phase 1.

The original plan for this step was to create a new server endpoint that consumes the matcher built in Step 7. Phase 1 ships the matcher module + tests only; the route is deferred to Phase 2.

**Why deferred:** The route can't be wired to the CSV import path without a client-side helper that extracts raw executions before FIFO matching. That helper is itself non-trivial (it has to parse every supported broker CSV format and stop *before* the matching pass that `processCsvData` currently does). Shipping the route now would mean shipping dead code — a route that no client ever calls. Phase 2 will build the client helper and the route together so they can be designed against each other.

**For Codex:** Skip this step entirely. Do NOT create `app/api/trades/import-raw/route.ts`. Do NOT add `importRawSchema` to `lib/validations/trades.ts` (Step 6 already excludes it from the schemas to add — re-check Step 6 if uncertain). Continue to Step 9.

**Acceptance:**
- [ ] `app/api/trades/import-raw/route.ts` does NOT exist after this sprint
- [ ] No reference to `importRawSchema` appears in `lib/validations/trades.ts`

---

#### Step 9: Extend PATCH `/api/trades/[id]` — close-position action

**File:** `app/api/trades/[id]/route.ts`
**Action:** MODIFY

**Instructions:**

1. Add `closePositionSchema` to the import from `@/lib/validations/trades` (currently line 6):

```ts
import { updateTradeSchema, closePositionSchema } from '@/lib/validations/trades';
```

2. Add `sql` to the import from `drizzle-orm` (currently line 1: `import { and, asc, eq } from 'drizzle-orm';`):

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
```

3. Replace the entire `PATCH` handler (lines 54-131) with the following. The new handler tries to parse as `closePositionSchema` first; if the `action` field is not present, it falls back to `updateTradeSchema`. This keeps all existing notes/tags/risk functionality intact.

```ts
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;

    // Try close-position action first.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const isCloseAction =
      rawBody && typeof rawBody === 'object' && (rawBody as Record<string, unknown>)['action'] === 'close';

    if (isCloseAction) {
      const parsed = closePositionSchema.safeParse(rawBody);
      if (!parsed.success) {
        return Response.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      const { exitPrice, exitTime } = parsed.data;

      // Load the trade to get current state.
      const [current] = await db.select().from(trades)
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
        .limit(1);

      if (!current) return Response.json({ error: 'Trade not found' }, { status: 404 });
      if (!current.isOpen) return Response.json({ error: 'Trade is already closed' }, { status: 400 });

      const qty = current.totalQuantity;
      const entryPrice = current.avgEntryPrice;
      const commission = current.commission ?? 0;
      const fees = current.fees ?? 0;
      const grossPnl = current.direction === 'LONG'
        ? (exitPrice - entryPrice) * qty
        : (entryPrice - exitPrice) * qty;
      const netPnl = grossPnl - commission - fees;

      await db.update(trades).set({
        avgExitPrice: exitPrice,
        exitTime,
        grossPnl,
        netPnl,
        pnl: netPnl,
        isOpen: false,
        closedAt: sql`now()`,
        remainingQty: 0,
      }).where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));

      const [updated] = await db.select().from(trades)
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
        .limit(1);
      if (!updated) return Response.json({ error: 'Trade not found after update' }, { status: 404 });

      const [tagRows, executionRows] = await Promise.all([
        db.select({ tag: tradeTagsTable.tag })
          .from(tradeTagsTable)
          .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tradeId, id))),
        db.select().from(tradeExecutions)
          .where(and(eq(tradeExecutions.userId, authState.user.id), eq(tradeExecutions.tradeId, id)))
          .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id)),
      ]);
      const tagList = tagRows.map((r) => r.tag);
      const rawExecutions = executionRows.map((row) => ({
        id: row.id,
        side: row.side,
        price: row.price,
        qty: row.qty,
        time: row.time,
        timestamp: row.timestamp ?? undefined,
        commission: row.commission ?? 0,
        fees: row.fees ?? 0,
      }));

      return Response.json({ trade: toTrade(updated, tagList, rawExecutions) });
    }

    // Fall through to normal update (notes / initialRisk / tags).
    const parseResult = updateTradeSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return Response.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 },
      );
    }
    const body = parseResult.data;

    const updateData: Partial<typeof trades.$inferInsert> = {};
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      updateData.notes = body.notes?.trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'initialRisk')) {
      updateData.initialRisk = body.initialRisk ?? null;
    }
    if (Object.keys(updateData).length > 0) {
      await db.update(trades)
        .set(updateData)
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
    }

    if (Array.isArray(body.tags)) {
      await db.delete(tradeTagsTable).where(and(
        eq(tradeTagsTable.userId, authState.user.id),
        eq(tradeTagsTable.tradeId, id),
      ));
      for (const tag of body.tags) {
        await db.insert(tradeTagsTable).values({
          userId: authState.user.id,
          tradeId: id,
          tag,
        }).onConflictDoNothing();
        await db.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
      }
    }

    const [trade] = await db.select().from(trades)
      .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
      .limit(1);
    if (!trade) return Response.json({ error: 'Trade not found' }, { status: 404 });

    const [tagRows, executionRows] = await Promise.all([
      db.select({ tag: tradeTagsTable.tag })
        .from(tradeTagsTable)
        .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tradeId, id))),
      db.select().from(tradeExecutions)
        .where(and(eq(tradeExecutions.userId, authState.user.id), eq(tradeExecutions.tradeId, id)))
        .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id)),
    ]);
    const tagList = tagRows.map((r) => r.tag);
    const rawExecutions = executionRows.map((row) => ({
      id: row.id,
      side: row.side,
      price: row.price,
      qty: row.qty,
      time: row.time,
      timestamp: row.timestamp ?? undefined,
      commission: row.commission ?? 0,
      fees: row.fees ?? 0,
    }));

    return Response.json({ trade: toTrade(trade, tagList, rawExecutions) });
  } catch (error) {
    logRouteError('trades.id.patch', error);
    return internalServerError();
  }
}
```

Also add `toTrade` and `tradeTagsTable` to the imports from `@/lib/server-db-utils` and schema if not already present. Check current line 5: `import { dbUnavailable, ensureUser, requireUser, toTrade } from '@/lib/server-db-utils';` — `toTrade` is already there. Check current line 4: `import { tradeExecutions, trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';` — `tradeTagsTable` and `tagsTable` are already imported.

4. **Remove the now-unused `parseAndValidate` import on line 2.** The new PATCH handler parses the JSON body manually (via `await request.json()`) so it can dispatch on the `action` field before validating, which means `parseAndValidate` is no longer called anywhere in this file. Leaving it imported will trip the lint rule for unused imports.

The cleaned line 2 should read:

```ts
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes (no unused-import warnings)

---

#### Step 10: Create `app/api/trades/merge/route.ts`

**File:** `app/api/trades/merge/route.ts`
**Action:** CREATE

**Instructions:**

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import {
  trades,
  tradeExecutions,
  tradeTags as tradeTagsTable,
  tags as tagsTable,
} from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
} from '@/lib/server-db-utils';
import { mergeTradesSchema } from '@/lib/validations/trades';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, mergeTradesSchema);
    if (bodyState.error) return bodyState.error;
    const { ids } = bodyState.data;

    // Load and verify ownership.
    const tradeRows = await db.select().from(trades)
      .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, ids)));

    if (tradeRows.length !== ids.length) {
      return Response.json(
        { error: 'One or more trades not found or not owned by you' },
        { status: 404 },
      );
    }

    if (tradeRows.length < 2) {
      return Response.json({ error: 'Select at least 2 trades to merge' }, { status: 400 });
    }

    // Validate: all same symbol.
    const symbols = new Set(tradeRows.map((t) => t.symbol));
    if (symbols.size > 1) {
      return Response.json(
        { error: 'Cannot merge trades with different symbols' },
        { status: 400 },
      );
    }

    // Validate: all same direction (block opposite-direction merges).
    const directions = new Set(tradeRows.map((t) => t.direction));
    if (directions.size > 1) {
      return Response.json(
        { error: 'Cannot merge trades with opposite directions (LONG vs SHORT)' },
        { status: 400 },
      );
    }

    // Compute merged fields.
    const symbol = tradeRows[0].symbol;
    const direction = tradeRows[0].direction;

    const totalQty = tradeRows.reduce((s, t) => s + t.totalQuantity, 0);

    // Weighted-average entry and exit prices.
    const avgEntryPrice = totalQty > 0
      ? tradeRows.reduce((s, t) => s + t.avgEntryPrice * t.totalQuantity, 0) / totalQty
      : 0;
    const avgExitPrice = totalQty > 0
      ? tradeRows.reduce((s, t) => s + t.avgExitPrice * t.totalQuantity, 0) / totalQty
      : 0;

    const totalGrossPnl = tradeRows.reduce((s, t) => s + t.grossPnl, 0);
    const totalNetPnl = tradeRows.reduce((s, t) => s + t.netPnl, 0);
    const totalCommission = tradeRows.reduce((s, t) => s + (t.commission ?? 0), 0);
    const totalFees = tradeRows.reduce((s, t) => s + (t.fees ?? 0), 0);

    // Earliest entry time, latest exit time (sort lexicographically — HH:MM:SS format is safe).
    const entryTimes = tradeRows.map((t) => t.entryTime).filter(Boolean);
    const exitTimes = tradeRows.map((t) => t.exitTime).filter(Boolean);
    const entryTime = entryTimes.length > 0 ? entryTimes.sort()[0] : '';
    const exitTime = exitTimes.length > 0 ? [...exitTimes].sort().reverse()[0] : '';

    // Earliest-opened trade's sortKey and date (sort by date then entryTime).
    const sorted = [...tradeRows].sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return (a.entryTime ?? '').localeCompare(b.entryTime ?? '');
    });
    const earliest = sorted[0];

    // initialRisk from the earliest-opened trade.
    const initialRisk = earliest.initialRisk ?? null;

    // Any open position in the set makes the merged trade open.
    const anyOpen = tradeRows.some((t) => t.isOpen);
    const remainingQty = anyOpen ? tradeRows.reduce((s, t) => s + (t.remainingQty ?? 0), 0) : 0;

    // Merged ID.
    const mergedId = `merged|${randomUUID().slice(0, 8)}|${symbol}|${direction}`;

    // Load all tags and executions for the source trades.
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, ids);
    const unionTags = Array.from(new Set(ids.flatMap((id) => tagMap.get(id) ?? [])));

    // Concatenate notes.
    const noteFragments = tradeRows
      .map((t) => t.notes?.trim())
      .filter((n): n is string => !!n);
    const mergedNotes = noteFragments.length > 0 ? noteFragments.join(' --- ') : null;

    await db.transaction(async (tx) => {
      // Insert merged trade.
      await tx.insert(trades).values({
        id: mergedId,
        userId: authState.user.id,
        date: earliest.date,
        sortKey: earliest.sortKey,
        symbol,
        direction,
        avgEntryPrice,
        avgExitPrice,
        totalQuantity: totalQty,
        grossPnl: totalGrossPnl,
        netPnl: totalNetPnl,
        entryTime,
        exitTime,
        executionCount: tradeRows.reduce((s, t) => s + t.executionCount, 0),
        pnl: totalNetPnl,
        executions: tradeRows.reduce((s, t) => s + t.executions, 0),
        commission: totalCommission,
        fees: totalFees,
        initialRisk,
        notes: mergedNotes,
        isOpen: anyOpen,
        remainingQty,
      });

      // Move all trade_executions to the merged trade.
      await tx.update(tradeExecutions)
        .set({ tradeId: mergedId })
        .where(and(
          eq(tradeExecutions.userId, authState.user.id),
          inArray(tradeExecutions.tradeId, ids),
        ));

      // Insert unioned tags.
      for (const tag of unionTags) {
        await tx.insert(tagsTable)
          .values({ userId: authState.user.id, name: tag })
          .onConflictDoNothing();
        await tx.insert(tradeTagsTable)
          .values({ userId: authState.user.id, tradeId: mergedId, tag })
          .onConflictDoNothing();
      }

      // Delete original trades (cascade will clean up trade_tags via FK).
      await tx.delete(trades)
        .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, ids)));
    });

    // Return the merged trade.
    const [mergedRow] = await db.select().from(trades)
      .where(and(eq(trades.id, mergedId), eq(trades.userId, authState.user.id)))
      .limit(1);

    if (!mergedRow) {
      return Response.json({ error: 'Merge succeeded but could not reload merged trade' }, { status: 500 });
    }

    const mergedTags = await loadTagsForTradeIds(db, authState.user.id, [mergedId]);
    return Response.json({
      trade: toTrade(mergedRow, mergedTags.get(mergedId) ?? []),
      deletedIds: ids,
    });
  } catch (error) {
    logRouteError('trades.merge.post', error);
    return internalServerError();
  }
}
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes

---

#### Step 11: `hooks/use-trade-filters.ts` — add `positionFilter`

**File:** `hooks/use-trade-filters.ts`
**Action:** MODIFY

**Instructions:**

1. After `type FilterPreset = 'all' | '30' | '60' | '90';` (line 5), add:

```ts
type PositionFilter = 'all' | 'open' | 'closed';
```

2. Inside `useTradeFilters`, after the `[bulkTagInput, setBulkTagInput]` state declaration (line 22), add:

```ts
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('all');
```

3. In the `filteredTrades` `useMemo` filter chain (lines 26-48), add a new filter clause after the `selectedFilterTags` check and before the final `return true`. Insert:

```ts
          if (positionFilter === 'open' && !trade.isOpen) return false;
          if (positionFilter === 'closed' && trade.isOpen) return false;
```

4. Add `positionFilter` to the `useMemo` dependency array (currently line 48: `[trades, searchQuery, startDate, endDate, filterPreset, selectedFilterTags]`):

```ts
    [trades, searchQuery, startDate, endDate, filterPreset, selectedFilterTags, positionFilter],
```

5. In the returned object (lines 100-122), add:

```ts
    positionFilter,
    setPositionFilter,
```

6. Update the `hasActiveFilters` line (currently line 51) to also count an active positionFilter:

```ts
  const hasActiveFilters = !!startDate || !!endDate || filterPreset !== 'all' || selectedFilterTags.size > 0 || positionFilter !== 'all';
```

7. Update `activeFilterCount` (lines 52-53):

```ts
  const activeFilterCount =
    (startDate ? 1 : 0) + (endDate ? 1 : 0) + (filterPreset !== 'all' ? 1 : 0) + selectedFilterTags.size + (positionFilter !== 'all' ? 1 : 0);
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes

---

#### Step 12: `hooks/use-trades.ts` — expose `positionFilter`, add `handleMergeTrades` and `handleCloseTrade`

**File:** `hooks/use-trades.ts`
**Action:** MODIFY

**Instructions:**

1. In the destructuring from `useTradeFilters` (lines 39-67), add `positionFilter` and `setPositionFilter` to the destructured names:

```ts
    positionFilter,
    setPositionFilter,
```

2. After `handleSaveNotes` (lines 154-159), add two new action handlers:

```ts
  const handleCloseTrade = async (tradeId: string, exitPrice: number, exitTime: string) => {
    const result = await apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'close', exitPrice, exitTime }),
    });
    setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? fromApiTrade(result.trade) : trade)));
  };

  const handleMergeTrades = async (ids: string[]) => {
    const result = await apiRequest<{ trade: ApiTrade; deletedIds: string[] }>('/api/trades/merge', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    const merged = fromApiTrade(result.trade);
    setTrades((prev) => {
      const without = prev.filter((trade) => !result.deletedIds.includes(trade.id));
      return sortTrades([merged, ...without]);
    });
    setSelectedIds(new Set());
  };
```

3. In `clearAllFilters` (lines 69-74), also reset the position filter:

```ts
    setPositionFilter('all');
```

4. Return `positionFilter`, `setPositionFilter`, `handleCloseTrade`, and `handleMergeTrades` from the `useTrades` hook (add them to the returned object at the bottom of the hook).

**Acceptance:**
- [ ] `npx tsc --noEmit` passes

---

#### Step 13: `components/trading/NewTradeDialog.tsx` — "Open position" checkbox

**File:** `components/trading/NewTradeDialog.tsx`
**Action:** MODIFY

**Instructions:**

1. Add `isOpen` to the `tradeFormSchema` (lines 22-30). The schema currently has `exitPrice: z.coerce.number().positive()` as a required field. Change that field to conditional: when `isOpen` is true, exit price should be optional. The simplest approach for Phase 1 is to make `exitPrice` optional at the schema level and validate it manually in `handleSubmit`.

Replace the existing schema (lines 22-30) with:

```ts
const tradeFormSchema = z.object({
  symbol: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  direction: z.enum(['LONG', 'SHORT']),
  entryPrice: z.coerce.number().positive(),
  exitPrice: z.coerce.number().optional(),
  quantity: z.coerce.number().int().positive(),
  date: z.string().min(1),
  entryTime: z.string().optional(),
  exitTime: z.string().optional(),
  initialRisk: z.string().optional(),
  isOpenPosition: z.boolean().optional().default(false),
});
```

2. Update the `defaultValues` object passed to `useForm` (currently lines 44-52) so the three new fields have initial values. Without this, RHF will treat them as `undefined` and the controlled `isOpenPosition` checkbox flickers between uncontrolled/controlled on the first toggle. Replace the existing `defaultValues` block with:

```ts
    defaultValues: {
      symbol: '',
      direction: 'LONG',
      entryPrice: undefined,
      exitPrice: undefined,
      quantity: undefined,
      date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: '',
      exitTime: '',
      initialRisk: '',
      isOpenPosition: false,
    },
```

3. Add `useWatch` (already imported on line 5) usage for `isOpenPosition`. After the existing `direction` watch (line 107), add:

```ts
  const isOpenPosition = useWatch({ control: form.control, name: 'isOpenPosition' }) ?? false;
```

4. Replace `handleSubmit` (lines 55-106) with the updated version that branches on `isOpenPosition`:

```ts
  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      const date = parseISO(values.date);
      const sortKey = format(date, 'yyyy-MM-dd');
      const timeOfDay = values.entryTime?.trim()
        ? values.entryTime.trim().replace(/:/g, '')
        : format(new Date(), 'HHmmss');
      // 4-hex suffix prevents collisions when two open positions are created
      // within the same second (rare today, but possible once broker sync runs).
      const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      const id = `${sortKey}|${values.symbol}|${values.direction}|${timeOfDay}-${suffix}`;
      const initialRisk = values.initialRisk?.trim() ? Number(values.initialRisk) : undefined;
      if (initialRisk !== undefined && (!Number.isFinite(initialRisk) || initialRisk <= 0)) {
        throw new Error('Invalid initial risk');
      }

      let trade: Trade;
      if (values.isOpenPosition) {
        trade = {
          id,
          date,
          sortKey,
          symbol: values.symbol,
          direction: values.direction,
          avgEntryPrice: values.entryPrice,
          avgExitPrice: 0,
          totalQuantity: values.quantity,
          grossPnl: 0,
          netPnl: 0,
          entryTime: values.entryTime?.trim() ?? '',
          exitTime: '',
          executionCount: 1,
          rawExecutions: [],
          pnl: 0,
          executions: 1,
          initialRisk,
          commission: 0,
          fees: 0,
          tags: [],
          isOpen: true,
          remainingQty: values.quantity,
        };
      } else {
        const exitPrice = values.exitPrice;
        if (!exitPrice || exitPrice <= 0) {
          throw new Error('Exit price is required for closed trades');
        }
        const netPnl = calculatePnL(values.direction, values.entryPrice, exitPrice, values.quantity);
        trade = {
          id,
          date,
          sortKey,
          symbol: values.symbol,
          direction: values.direction,
          avgEntryPrice: values.entryPrice,
          avgExitPrice: exitPrice,
          totalQuantity: values.quantity,
          grossPnl: netPnl,
          netPnl,
          entryTime: values.entryTime?.trim() ?? '',
          exitTime: values.exitTime?.trim() ?? '',
          executionCount: 1,
          rawExecutions: [],
          pnl: netPnl,
          executions: 1,
          initialRisk,
          commission: 0,
          fees: 0,
          tags: [],
          isOpen: false,
          remainingQty: 0,
        };
      }

      await onCreateTrade(trade);
      form.reset({
        symbol: '',
        direction: 'LONG',
        entryPrice: undefined,
        exitPrice: undefined,
        quantity: undefined,
        date: format(new Date(), 'yyyy-MM-dd'),
        entryTime: '',
        exitTime: '',
        initialRisk: '',
        isOpenPosition: false,
      });
      onOpenChange(false);
      toast.success(values.isOpenPosition ? 'Open position recorded' : 'Trade added');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to add trade');
    }
  });
```

5. Add `Checkbox` to the import list. Add at the top of the file (after the existing Button import):

```ts
import { Checkbox } from '@/components/ui/checkbox';
```

6. In the JSX form body, after the `initialRisk` input block (the `md:col-span-2` div, currently lines 159-162), add the checkbox and the conditional exit fields. The full replacement for the grid content after `initialRisk` and before the error message block:

```tsx
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="initialRisk">Initial Risk (optional)</Label>
              <Input id="initialRisk" type="number" step="0.01" {...form.register('initialRisk')} className="bg-white/5 border-white/10" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="entryTime">Entry Time (optional)</Label>
              <Input id="entryTime" type="text" placeholder="09:30:00" {...form.register('entryTime')} className="bg-white/5 border-white/10" />
            </div>

            {!isOpenPosition && (
              <div className="space-y-2">
                <Label htmlFor="exitTime">Exit Time (optional)</Label>
                <Input id="exitTime" type="text" placeholder="10:15:00" {...form.register('exitTime')} className="bg-white/5 border-white/10" />
              </div>
            )}

            <div className="flex items-center gap-2 md:col-span-2 pt-1">
              <Checkbox
                id="isOpenPosition"
                checked={isOpenPosition}
                onCheckedChange={(checked) =>
                  form.setValue('isOpenPosition', checked === true, { shouldValidate: true })
                }
                className="border-white/20"
              />
              <Label htmlFor="isOpenPosition" className="cursor-pointer text-sm text-zinc-300">
                Open position (no exit yet)
              </Label>
            </div>

            {!isOpenPosition && (
              <div className="space-y-2">
                <Label htmlFor="exitPrice">Exit Price</Label>
                <Input id="exitPrice" type="number" step="0.01" {...form.register('exitPrice')} className="bg-white/5 border-white/10" />
              </div>
            )}
```

Note: The existing `exitPrice` input block (lines 144-147) should be removed from its current position since it is now rendered conditionally above.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] Checking the "Open position" checkbox hides the Exit Price and Exit Time fields
- [ ] Unchecking shows them again

---

#### Step 14: `components/trading/TradeDetailSheet.tsx` — Close Position panel

**File:** `components/trading/TradeDetailSheet.tsx`
**Action:** MODIFY

**Instructions:**

1. Extend the `TradeDetailSheetProps` interface (line 22-27) to add the close handler:

```ts
interface TradeDetailSheetProps {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveNotes: (tradeId: string, notes: string) => Promise<void> | void;
  onCloseTrade?: (tradeId: string, exitPrice: number, exitTime: string) => Promise<void>;
}
```

2. Update the function signature (line 54) to destructure `onCloseTrade`:

```ts
export default function TradeDetailSheet({ trade, open, onOpenChange, onSaveNotes, onCloseTrade }: TradeDetailSheetProps) {
```

3. After the existing `useState` declarations (lines 55-56), add local state for the close form:

```ts
  const [closeExitPrice, setCloseExitPrice] = useState('');
  const [closeExitTime, setCloseExitTime] = useState('');
  const [isClosing, setIsClosing] = useState(false);
```

4. Add a `handleClosePosition` function after the `handleSave` function (after line 89):

```ts
  const handleClosePosition = async () => {
    if (!trade || !onCloseTrade) return;
    const exitPrice = parseFloat(closeExitPrice);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      toast.error('Enter a valid exit price');
      return;
    }
    if (!closeExitTime.trim()) {
      toast.error('Enter a valid exit time (HH:MM or HH:MM:SS)');
      return;
    }
    setIsClosing(true);
    try {
      await onCloseTrade(trade.id, exitPrice, closeExitTime.trim());
      setCloseExitPrice('');
      setCloseExitTime('');
      toast.success('Position closed');
    } catch (error) {
      console.error(error);
      toast.error('Failed to close position');
    } finally {
      setIsClosing(false);
    }
  };
```

5. In the header section (lines 119-137), add an OPEN badge next to the PnL display when `trade.isOpen` is true. Replace the `<div className="text-right">` block with:

```tsx
              <div className="text-right">
                {trade.isOpen ? (
                  <span className="inline-block rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-400 mb-1">
                    OPEN
                  </span>
                ) : (
                  <p className={`text-sm font-semibold ${getPnLColor(trade.netPnl)}`}>{formatCurrency(trade.netPnl)}</p>
                )}
                <p className="text-[12px] text-zinc-500">{trade.isOpen ? 'Open Position' : 'Net PnL'}</p>
              </div>
```

6. Add the Close Position section to the scrollable content area. Insert it after the Overview section (`</section>` that closes the overview block, after line 150) and before the Chart section:

```tsx
              {trade.isOpen && onCloseTrade ? (
                <section className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <h3 className="text-base font-semibold uppercase tracking-wider text-amber-400">Close Position</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wider text-zinc-500">Exit Price</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={closeExitPrice}
                        onChange={(e) => setCloseExitPrice(e.target.value)}
                        className="bg-white/5 border-white/10 h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wider text-zinc-500">Exit Time (HH:MM:SS)</label>
                      <Input
                        type="text"
                        placeholder="15:59:00"
                        value={closeExitTime}
                        onChange={(e) => setCloseExitTime(e.target.value)}
                        className="bg-white/5 border-white/10 h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      onClick={handleClosePosition}
                      disabled={isClosing}
                      className="border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    >
                      {isClosing ? 'Closing...' : 'Close Position (Full)'}
                    </Button>
                  </div>
                </section>
              ) : null}
```

7. Add `Input` to imports (it's not currently imported in this file). Add at the top after Button import:

```ts
import { Input } from '@/components/ui/input';
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] Open trades show the amber OPEN badge and Close Position panel
- [ ] Closed trades show PnL as before, no Close Position panel

---

#### Step 15: `components/trading/TradeTable.tsx` — OPEN badge, PnL `—`, filter chip, Merge button

**File:** `components/trading/TradeTable.tsx`
**Action:** MODIFY

**Instructions:**

1. Extend `TradeTableProps` (lines 11-24) with new props:

```ts
interface TradeTableProps {
  trades: Trade[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
  onTradeClick?: (trade: Trade) => void;
  onMergeTrades?: (ids: string[]) => void;
  globalTags: string[];
  readOnly?: boolean;
  hideSelection?: boolean;
  pnlMode?: 'net' | 'gross';
  positionFilter?: 'all' | 'open' | 'closed';
  onPositionFilterChange?: (filter: 'all' | 'open' | 'closed') => void;
}
```

2. Add `onMergeTrades`, `positionFilter`, `onPositionFilterChange` to the function destructuring (line 26-38):

```ts
  onMergeTrades,
  positionFilter = 'all',
  onPositionFilterChange,
```

3. Above the `return` statement (before line 47), add a computed `canMerge` variable:

```ts
  const canMerge = !readOnly && onMergeTrades && selectedIds.size >= 2;
```

4. Wrap the existing `return (...)` body in a React fragment and add the filter chip row + Merge button as a sibling above the existing `<div className="overflow-x-auto...">` wrapper. The component currently returns that wrapper directly, so this change is structural — without the fragment, JSX won't accept two sibling roots.

Replace the existing `return (` line and the opening `<div className="overflow-x-auto...">` block so the top of the return reads like this (the existing table `<div>` continues unchanged underneath):

```tsx
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        {onPositionFilterChange ? (
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
            {(['all', 'open', 'closed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => onPositionFilterChange(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  positionFilter === f
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        ) : <div />}
        {canMerge ? (
          <button
            onClick={() => onMergeTrades?.(Array.from(selectedIds))}
            className="px-3 py-1 rounded-md border border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            Merge {selectedIds.size} trades
          </button>
        ) : null}
      </div>
      <div className={`overflow-x-auto rounded border border-white/5 bg-[#121214] ${shouldScroll ? 'max-h-[46rem] overflow-y-auto' : ''}`}>
        {/* existing table contents unchanged */}
```

And close the fragment at the end of the existing return. The current return ends with `</div>\n  );` — change that to `</div>\n    </>\n  );`.

5. In the PnL column cell (currently lines 191-195), change the rendering to show `—` for open trades:

```tsx
                <td className={`px-4 py-3 text-right font-mono font-medium ${trade.isOpen ? 'text-zinc-500' : getPnLColor(pnlValue)}`}>
                  <div className="flex flex-col items-end">
                    {trade.isOpen ? (
                      <span className="text-zinc-500">—</span>
                    ) : (
                      <>
                        <span>{formatCurrency(pnlValue)}</span>
                        {trade.initialRisk ? <span className="text-[10px] opacity-70">{formatR(pnlValue / trade.initialRisk)}</span> : null}
                      </>
                    )}
                  </div>
                </td>
```

6. In the Symbol cell (currently lines 102-103), add the OPEN badge after the symbol text:

```tsx
                <td className="px-4 py-3 font-medium">
                  <span>{trade.symbol}</span>
                  {trade.isOpen ? (
                    <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400">
                      OPEN
                    </span>
                  ) : null}
                </td>
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] OPEN badge visible on open trades in the table
- [ ] PnL column shows `—` for open trades
- [ ] Filter chips appear and filter correctly
- [ ] Merge button appears when 2+ trades are selected

---

#### Step 16: Wire the new props through the rendering chain

**Files:**
- `app/page.tsx` (renders `<TradeDetailSheet>` directly at ~line 258, and renders `<ManagementTab>` which transitively renders `<TradeTable>`)
- `components/trading/ManagementTab.tsx` (renders `<TradesTab>`)
- `components/trading/TradesTab.tsx` (renders `<TradeTable>` at ~line 156)

`<TradeTable>` is also rendered by `components/trading/JournalTab.tsx` (~line 309), but in journal context we do NOT want the merge button or position-filter chip — leave that call site alone. The new props are all optional, so omitting them is correct.

**Action:** MODIFY (three files, prop-drilled in sequence)

**Instructions:**

1. **In `app/page.tsx`**:

   a. Add `handleCloseTrade`, `handleMergeTrades`, `positionFilter`, and `setPositionFilter` to the destructuring of `useTrades()` (currently lines 61-108). Insert them anywhere in the destructured list — order does not matter, but group them near the other `handle*` functions for readability.

   b. Pass `onCloseTrade={handleCloseTrade}` to the `<TradeDetailSheet>` at ~line 258. The existing JSX is:

   ```tsx
         <TradeDetailSheet
           key={selectedTrade?.id ?? 'no-trade'}
           trade={selectedTrade}
           open={!!selectedTrade}
           onOpenChange={(open) => {
             if (!open) setSelectedTradeId(null);
           }}
           onSaveNotes={handleSaveNotes}
         />
   ```

   Add `onCloseTrade={handleCloseTrade}` as a new prop on this element.

   c. Find the `<ManagementTab>` element (currently ~line 206) and pass through four new props: `onMergeTrades={handleMergeTrades}`, `positionFilter={positionFilter}`, `onPositionFilterChange={setPositionFilter}`. They will be forwarded to `<TradesTab>` in step 2.

2. **In `components/trading/ManagementTab.tsx`**:

   a. Extend the props interface to accept `onMergeTrades?: (ids: string[]) => void`, `positionFilter?: 'all' | 'open' | 'closed'`, `onPositionFilterChange?: (filter: 'all' | 'open' | 'closed') => void`.

   b. Destructure them from props and forward to `<TradesTab>` at ~line 95.

3. **In `components/trading/TradesTab.tsx`**:

   a. Extend the `TradesTabProps` interface (currently lines 10-37) with the same three optional props.

   b. Destructure them in the function signature (currently lines 39-62).

   c. Pass them to `<TradeTable>` at ~line 156. The existing call is:

   ```tsx
   <TradeTable
     trades={filteredTrades}
     selectedIds={selectedIds}
     onToggleSelect={onToggleSelect}
     onSelectAll={onSelectAll}
     onAddTag={onAddTag}
     onRemoveTag={onRemoveTag}
     onDeleteGlobalTag={onDeleteGlobalTag}
     onTradeClick={onTradeClick}
     globalTags={globalTags}
     readOnly={false}
   />
   ```

   Add three new prop lines: `onMergeTrades={onMergeTrades}`, `positionFilter={positionFilter}`, `onPositionFilterChange={onPositionFilterChange}`.

4. **Do NOT modify `components/trading/JournalTab.tsx`.** Its `<TradeTable>` call site stays as-is. The new props default to `undefined`, which keeps the merge button and filter chip hidden in the journal view (matches existing behavior).

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] In the main trades view (Management tab), the position filter chip row and Merge button render above the table
- [ ] In the Journal tab, the trade table looks identical to before this sprint (no filter chip, no merge button)
- [ ] Clicking an open trade in the table opens TradeDetailSheet with the Close Position panel visible

---

#### Step 17: `components/trading/PerformanceStatsTable.tsx` — exclude open trades, show "N excluded" banner

**File:** `components/trading/PerformanceStatsTable.tsx`
**Action:** MODIFY

**Goal:** Every stat in this table represents realized performance on closed trades only. Open positions have no realized PnL, so including them would skew win rate, average gain, profit factor, drawdown, etc. The user still sees how many open positions were excluded via a small amber banner next to the "Stats" header.

**Design decisions baked into this step:**
- `closedTrades` is derived **inside** the `stats` `useMemo`. Every existing `trades.{reduce,filter,map,slice,length}` call gets rerouted through `closedTrades`.
- `openCount` is derived in a **separate `useMemo` outside** the stats memo, because the JSX needs to read it directly (the stats memo returns an array of cells, not the count).
- "Total Number of Trades" intentionally changes meaning from "all trades" to "closed trades only" — this matches what every other stat in the table now reports. The amber banner above the table tells the user how many were excluded.
- The empty-state guard (`if (trades.length === 0)`) is unchanged — it still fires only when there are zero trades total. When there are open trades but no closed ones, the stats memo returns its existing zero-trades path (`return [] as StatsCell[]`) once we also early-return on `closedTrades.length === 0` from inside the memo — see the snippet.

**Instructions:**

1. **Replace lines 122-303** (the entire `stats` `useMemo` block, ending at `}, [trades]);`) with the version below. Two structural changes vs the existing code: (a) add `const openCount = useMemo(...)` immediately before `const stats = useMemo(...)`, and (b) inside the stats memo body, derive `closedTrades` once and route every collection operation through it.

```ts
export default function PerformanceStatsTable({ trades, onTradeClick }: PerformanceStatsTableProps) {
  const openCount = useMemo(() => trades.filter((t) => t.isOpen).length, [trades]);

  const stats = useMemo(() => {
    if (trades.length === 0) {
      return [] as StatsCell[];
    }

    const closedTrades = trades.filter((trade) => !trade.isOpen);
    if (closedTrades.length === 0) {
      // All trades are open — no realized stats to compute. The banner in the
      // JSX still tells the user how many open positions exist.
      return [] as StatsCell[];
    }

    const totalGainLoss = closedTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
    const winningTrades = closedTrades.filter((trade) => trade.netPnl > 0);
    const losingTrades = closedTrades.filter((trade) => trade.netPnl < 0);
    const scratchTrades = closedTrades.filter((trade) => Math.abs(trade.netPnl) === 0);

    const dailyTotals = new Map<string, number>();
    const dailyVolume = new Map<string, number>();
    for (const trade of closedTrades) {
      const key = trade.sortKey;
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + trade.netPnl);
      dailyVolume.set(key, (dailyVolume.get(key) ?? 0) + trade.totalQuantity);
    }
    const dailyValues = Array.from(dailyTotals.values());
    const dailyVolumeValues = Array.from(dailyVolume.values());

    const averageDailyGainLoss = dailyValues.length > 0 ? dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length : 0;
    const averageDailyVolume = dailyVolumeValues.length > 0 ? dailyVolumeValues.reduce((sum, value) => sum + value, 0) / dailyVolumeValues.length : 0;

    const totalQuantity = closedTrades.reduce((sum, trade) => sum + trade.totalQuantity, 0);
    const averagePerShareGainLoss = totalQuantity > 0 ? totalGainLoss / totalQuantity : 0;
    const averageTradeGainLoss = closedTrades.length > 0 ? totalGainLoss / closedTrades.length : 0;
    const averageWinningTrade = winningTrades.length > 0 ? winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length : 0;
    const averageLosingTrade = losingTrades.length > 0 ? losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length : 0;

    const winningCount = winningTrades.length;
    const losingCount = losingTrades.length;
    const winPercent = closedTrades.length > 0 ? (winningCount / closedTrades.length) * 100 : 0;
    const lossPercent = closedTrades.length > 0 ? (losingCount / closedTrades.length) * 100 : 0;

    const holdTradePairs = closedTrades
      .map((trade) => {
        const minutes = parseHoldMinutes(trade);
        return minutes == null ? null : { trade, minutes };
      })
      .filter((entry): entry is HoldInfo => entry !== null);

    const winningHoldTrades = holdTradePairs.filter((entry) => entry.trade.netPnl > 0);
    const losingHoldTrades = holdTradePairs.filter((entry) => entry.trade.netPnl < 0);
    const scratchHoldTrades = holdTradePairs.filter((entry) => Math.abs(entry.trade.netPnl) <= 1);

    const averageScratchHoldTime = scratchHoldTrades.length > 0 ? calculateMean(scratchHoldTrades.map((entry) => entry.minutes)) : null;
    const averageWinningHoldTime = winningHoldTrades.length > 0 ? calculateMean(winningHoldTrades.map((entry) => entry.minutes)) : null;
    const averageLosingHoldTime = losingHoldTrades.length > 0 ? calculateMean(losingHoldTrades.map((entry) => entry.minutes)) : null;

    const sortedByDate = [...closedTrades].sort((a, b) => a.date.getTime() - b.date.getTime());
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let maxConsecutiveWinTrade: Trade | null = null;
    let maxConsecutiveLossTrade: Trade | null = null;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    for (const trade of sortedByDate) {
      if (trade.netPnl > 0) {
        currentWinStreak += 1;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) {
          maxConsecutiveWins = currentWinStreak;
          maxConsecutiveWinTrade = trade;
        }
      } else if (trade.netPnl < 0) {
        currentLossStreak += 1;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentLossStreak;
          maxConsecutiveLossTrade = trade;
        }
      } else {
        currentWinStreak = 0;
        currentLossStreak = 0;
      }
    }

    const largestGainTrade = closedTrades.slice().sort((a, b) => b.netPnl - a.netPnl)[0] ?? null;
    const largestLossTrade = closedTrades.slice().sort((a, b) => a.netPnl - b.netPnl)[0] ?? null;

    const pnlValues = closedTrades.map((trade) => trade.netPnl);
    const meanPnl = calculateMean(pnlValues);
    const pnlStdDev = calculateStdDev(pnlValues);
    const sqn = pnlValues.length > 0 && pnlStdDev > 0 ? (Math.sqrt(pnlValues.length) * meanPnl) / pnlStdDev : 0;

    const grossProfit = winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

    const pWin = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;
    const zDenom = Math.sqrt(Math.max(pWin * (1 - pWin), 1e-8));
    const zScore = closedTrades.length > 1 ? (pWin - 0.5) * Math.sqrt(closedTrades.length) / zDenom : 0;
    const randomChance = clampProbability(1 - erf(Math.abs(zScore) / Math.SQRT2));

    const avgWinAbs =
      winningTrades.length > 0 ? winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length : 0;
    const avgLossAbs =
      losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length) : 0;
    const winProb = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;
    const kellyPercentage =
      avgLossAbs > 0 && winProb > 0 && winProb < 1 ? winProb - (1 - winProb) / (avgWinAbs / avgLossAbs) : 0;

    const kRatio = pWin > 0 && pnlStdDev > 0 ? (avgWinAbs * winProb) / pnlStdDev : 0;

    const totalCommissions = closedTrades.reduce((sum, trade) => sum + (trade.commission ?? 0), 0);
    const totalFees = closedTrades.reduce((sum, trade) => sum + (trade.fees ?? 0), 0);

    const maeValues = closedTrades
      .map((trade) => trade.mae)
      .filter((mae): mae is number => typeof mae === 'number' && Number.isFinite(mae));
    const mfeValues = closedTrades
      .map((trade) => trade.mfe)
      .filter((mfe): mfe is number => typeof mfe === 'number' && Number.isFinite(mfe));

    const avgMae = maeValues.length > 0 ? maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length : 0;
    const avgMfe = mfeValues.length > 0 ? mfeValues.reduce((sum, value) => sum + value, 0) / mfeValues.length : 0;

    const cells: StatsCell[] = [
      { label: 'Total Gain/Loss', value: formatCurrency(totalGainLoss) },
      { label: 'Largest Gain', value: largestGainTrade ? formatCurrency(largestGainTrade.netPnl) : '-', clickTrade: largestGainTrade ?? undefined },
      { label: 'Largest Loss', value: largestLossTrade ? formatCurrency(largestLossTrade.netPnl) : '-', clickTrade: largestLossTrade ?? undefined },
      { label: 'Average Daily Gain/Loss', value: formatCurrency(averageDailyGainLoss) },
      { label: 'Average Daily Volume', value: averageDailyVolume.toFixed(0) },
      { label: 'Average Per Share Gain/Loss', value: formatCurrency(averagePerShareGainLoss) },
      { label: 'Average Trade Gain/Loss', value: formatCurrency(averageTradeGainLoss) },
      { label: 'Average Winning Trade', value: winningTrades.length > 0 ? formatCurrency(averageWinningTrade) : '-' },
      { label: 'Average Losing Trade', value: losingTrades.length > 0 ? formatCurrency(averageLosingTrade) : '-' },
      { label: 'Total Number of Trades', value: `${closedTrades.length}` },
      { label: 'Number of Winning Trades', value: `${winningCount} (${formatPercent(winPercent)})` },
      { label: 'Number of Losing Trades', value: `${losingCount} (${formatPercent(lossPercent)})` },
      { label: 'Average Hold Time (Scratch)', value: formatHoldTime(scratchTrades.length > 0 ? averageScratchHoldTime : null) },
      { label: 'Average Hold Time (Winning)', value: formatHoldTime(averageWinningHoldTime) },
      { label: 'Average Hold Time (Losing)', value: formatHoldTime(averageLosingHoldTime) },
      { label: 'Number of Scratch Trades', value: `${scratchTrades.length}` },
      {
        label: 'Max Consecutive Wins',
        value: maxConsecutiveWins > 0 ? String(maxConsecutiveWins) : '-',
        clickTrade: maxConsecutiveWinTrade ?? undefined,
      },
      {
        label: 'Max Consecutive Losses',
        value: maxConsecutiveLosses > 0 ? String(maxConsecutiveLosses) : '-',
        clickTrade: maxConsecutiveLossTrade ?? undefined,
      },
      { label: 'Trade P&L Std Dev', value: Number.isFinite(pnlStdDev) ? formatCurrency(pnlStdDev) : '-' },
      { label: 'System Quality Number', value: Number.isFinite(sqn) ? sqn.toFixed(2) : '-' },
      { label: 'Probability of Random Chance', value: `${(randomChance * 100).toFixed(1)}%` },
      { label: 'Kelly Percentage', value: `${(kellyPercentage * 100).toFixed(2)}%` },
      { label: 'K-Ratio', value: Number.isFinite(kRatio) ? kRatio.toFixed(2) : '-' },
      { label: 'Profit Factor', value: profitFactor === Number.POSITIVE_INFINITY ? '∞' : profitFactor.toFixed(2) },
      { label: 'Total Commissions', value: formatCurrency(totalCommissions) },
      { label: 'Total Fees', value: formatCurrency(totalFees) },
      { label: 'Average MAE', value: formatCurrency(avgMae) },
      { label: 'Average MFE', value: formatCurrency(avgMfe) },
      {
        label: 'Avg Risk per Trade',
        value: (() => {
          const riskedTrades = closedTrades.filter((trade) => trade.initialRisk);
          if (riskedTrades.length === 0) return '-';
          const avg = riskedTrades.reduce((acc, trade) => acc + (trade.initialRisk ?? 0), 0) / riskedTrades.length;
          return formatCurrency(avg);
        })(),
      },
      {
        label: 'Total R-Multiple',
        value: (() => {
          const riskedTrades = closedTrades.filter((trade) => trade.initialRisk);
          if (riskedTrades.length === 0) return '-';
          const total = riskedTrades.reduce((acc, trade) => acc + trade.netPnl / (trade.initialRisk ?? 1), 0);
          return `${total.toFixed(2)}R`;
        })(),
      },
    ];

    while (cells.length < 30) {
      cells.push({ label: '', value: '' });
    }

    return cells.slice(0, 30);
  }, [trades]);
```

2. **Locate the header `<div>` that currently renders the "Stats" title** in the JSX render block (search for `tracking-wider text-zinc-400` — there's only one match). Replace that header `<div>` with the version below, which adds the amber banner. The rest of the JSX (the rows grid built from `stats`) is unchanged.

```tsx
      <div className="mb-6 flex items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Stats</h3>
        <Info className="h-3.5 w-3.5 text-zinc-600" />
        {openCount > 0 ? (
          <span className="ml-auto text-xs text-amber-400 font-medium">
            {openCount} open position{openCount === 1 ? '' : 's'} excluded
          </span>
        ) : null}
      </div>
```

3. **Leave the existing `if (trades.length === 0)` empty-state guard unchanged.** It correctly fires only when there are zero trades total. When there are open trades but no closed ones, the stats memo returns `[]`, the rows grid renders as blank padded cells, and the amber banner shows the excluded count — that's the desired UX.

**Notes on intentional behavior changes:**
- `Total Number of Trades` now reports the count of closed trades, not all trades. This is intentional — every other stat in this table already excludes open positions, and showing a mixed count next to win-rate stats would be misleading. The amber banner communicates the exclusion.
- No new stat cell is added. (An earlier draft of this spec mentioned an "Open Positions" cell; we drop that in favor of the banner so all 30 grid slots stay reserved for performance stats.)

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] With a mix of open and closed trades, win rate / averages / profit factor / streaks all compute on closed trades only
- [ ] Amber "N open position(s) excluded" banner appears in the header when at least one trade is open
- [ ] Banner is hidden when all trades are closed
- [ ] Empty state ("Import trades to see statistics") still shows when there are zero total trades
- [ ] When all trades are open, the stats cells render blank and the banner shows the count — no crash, no negative numbers

---

#### Step 18: `lib/journal-aggregates.ts` — exclude open trades

**File:** `lib/journal-aggregates.ts`
**Action:** MODIFY

**Instructions:**

1. In `aggregateDay` (lines 30-48), add a filter at the top of the function body, after the `matching` filter, to exclude open trades:

```ts
export function aggregateDay(trades: Trade[], date: string): DayAggregate {
  const matching = trades.filter((t) => toLocalDateKey(t.date) === date && !t.isOpen);
  ...
```

2. In `aggregateWeek` (lines 53-86), do the same — add `&& !t.isOpen` to the `matching` filter:

```ts
  const matching = trades.filter((t) => {
    const key = toLocalDateKey(t.date);
    return key >= weekStart && key <= weekEnd && !t.isOpen;
  });
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] Existing `__tests__/journal-aggregates.test.ts` tests still pass

---

#### Step 19: (DEFERRED to Phase 2) — switch CSV import path to the server matcher

**Action:** SKIP — do nothing in Phase 1.

The original plan was to change `hooks/use-trades.ts` `processImportFiles` to send raw broker executions to a new `/api/trades/import-raw` endpoint (Step 8) instead of running client-side FIFO matching. Both Step 8 (the route) and this step are deferred to Phase 2 — see Step 8's body for the rationale.

**For Codex:** Skip this step entirely. Do NOT modify `hooks/use-trades.ts` for the import path. `processImportFiles` continues to call `/api/trades/import` exactly as it does today (Step 12 still adds the new `handleCloseTrade` / `handleMergeTrades` functions to this file — those are separate changes and stay in scope).

**Acceptance:**
- [ ] `hooks/use-trades.ts` `processImportFiles` still calls `/api/trades/import` (not `/api/trades/import-raw`)
- [ ] No `collectRawExecutions` helper is added to `lib/trade-utils.ts`

---

#### Step 20: `app/api/trades/route.ts` — persist `isOpen`/`closedAt`/`remainingQty` on POST (manual create)

**File:** `app/api/trades/route.ts`
**Action:** MODIFY

**Instructions:**

The POST handler (lines 75-end) creates trades via `createTradeSchema`. That schema now accepts `isOpen`, `closedAt`, `remainingQty` (added in Step 6). The DB insert needs to write them.

1. In the `db.insert(trades).values({...})` call (currently starting around line 94), add:

```ts
          isOpen: body.isOpen ?? false,
          closedAt: body.closedAt ? new Date(body.closedAt) : null,
          remainingQty: body.remainingQty ?? 0,
```

2. In the `.onConflictDoUpdate({ set: {...} })` block (lines 119-145), add the same three fields to the `set` object:

```ts
          isOpen: body.isOpen ?? false,
          closedAt: body.closedAt ? new Date(body.closedAt) : null,
          remainingQty: body.remainingQty ?? 0,
```

**Acceptance:**
- [ ] `npx tsc --noEmit` passes
- [ ] Creating a trade via `POST /api/trades` with `isOpen: true` stores it correctly

---

#### Step 21: `app/api/trades/import/route.ts` — persist new fields on upsert

**File:** `app/api/trades/import/route.ts`
**Action:** MODIFY

**Instructions:**

The import route's `tx.insert(trades).values({...})` (lines 263-308) does not yet include the new columns. Add them to both the `values` and `onConflictDoUpdate.set` objects.

1. In `values({...})` (starting line 263), after `notes: trade.notes ?? null,`, add:

```ts
            isOpen: trade.isOpen ?? false,
            closedAt: trade.closedAt ? new Date(trade.closedAt) : null,
            remainingQty: trade.remainingQty ?? 0,
```

2. **Do NOT add `isOpen`, `closedAt`, or `remainingQty` to the `onConflictDoUpdate({ set: {...} })` block** (lines 288-308). Leave the `set` object exactly as it is today — the existing field list (avgEntryPrice, avgExitPrice, totalQuantity, grossPnl, netPnl, entryTime, exitTime, executionCount, mfe, mae, bestExitPnl, exitEfficiency, pnl, executions, commission, fees) stays unchanged.

**Why:** On a re-import collision, we want prices and PnL to refresh (in case the user re-imports a corrected CSV) but we do NOT want a re-import to flip an open position back to closed, or overwrite a user-edited `closedAt` timestamp. The close-position and merge actions are the only writers for those three fields. Omitting them from `set` is the actual mechanism for this — no comment is needed.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes

---

#### Step 22: Tests — `__tests__/position-matcher.test.ts`

**File:** `__tests__/position-matcher.test.ts`
**Action:** CREATE

**Instructions:**

```ts
import { describe, it, expect } from 'vitest';
import { matchExecutions, normalizeSide } from '@/lib/position-matcher';
import type { MatcherExecution } from '@/lib/position-matcher';

function exec(
  symbol: string,
  side: MatcherExecution['side'],
  qty: number,
  price: number,
  time: string,
  commission = 0,
  fees = 0,
): MatcherExecution {
  return { symbol, side, qty, price, time, commission, fees };
}

describe('normalizeSide', () => {
  it('maps MARGIN and BUY to LONG_ENTRY', () => {
    expect(normalizeSide('MARGIN')).toBe('LONG_ENTRY');
    expect(normalizeSide('BUY')).toBe('LONG_ENTRY');
  });
  it('maps S and SELL to LONG_EXIT', () => {
    expect(normalizeSide('S')).toBe('LONG_EXIT');
    expect(normalizeSide('SELL')).toBe('LONG_EXIT');
  });
  it('maps SS and SHORT to SHORT_ENTRY', () => {
    expect(normalizeSide('SS')).toBe('SHORT_ENTRY');
    expect(normalizeSide('SHORT')).toBe('SHORT_ENTRY');
  });
  it('maps B and COVER to SHORT_EXIT', () => {
    expect(normalizeSide('B')).toBe('SHORT_EXIT');
    expect(normalizeSide('COVER')).toBe('SHORT_EXIT');
  });
  it('returns null for unknown side', () => {
    expect(normalizeSide('UNKNOWN')).toBeNull();
  });
});

describe('matchExecutions — LONG round-trip', () => {
  it('pairs a single buy+sell into one trade', () => {
    const result = matchExecutions([
      exec('AAPL', 'LONG_ENTRY', 100, 150, '09:30:00'),
      exec('AAPL', 'LONG_EXIT', 100, 155, '10:00:00'),
    ]);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.symbol).toBe('AAPL');
    expect(trade.direction).toBe('LONG');
    expect(trade.totalQuantity).toBe(100);
    expect(trade.avgEntryPrice).toBeCloseTo(150);
    expect(trade.avgExitPrice).toBeCloseTo(155);
    expect(trade.grossPnl).toBeCloseTo(500);
    expect(trade.netPnl).toBeCloseTo(500);
    expect(trade.entryTime).toBe('09:30:00');
    expect(trade.exitTime).toBe('10:00:00');
  });
});

describe('matchExecutions — SHORT round-trip', () => {
  it('pairs a single short sell + cover into one trade', () => {
    const result = matchExecutions([
      exec('TSLA', 'SHORT_ENTRY', 50, 200, '09:31:00'),
      exec('TSLA', 'SHORT_EXIT', 50, 195, '09:45:00'),
    ]);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.direction).toBe('SHORT');
    expect(trade.grossPnl).toBeCloseTo(250); // (200-195)*50
  });
});

describe('matchExecutions — unmatched entry', () => {
  it('produces a warning for unmatched long entry', () => {
    const result = matchExecutions([
      exec('NVDA', 'LONG_ENTRY', 200, 100, '09:30:00'),
    ]);
    expect(result.trades).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/NVDA/);
    expect(result.warnings[0]).toMatch(/unmatched/i);
  });
});

describe('matchExecutions — unmatched exit', () => {
  it('produces a warning for unmatched long exit (carry-over)', () => {
    const result = matchExecutions([
      exec('AMD', 'LONG_EXIT', 100, 50, '09:35:00'),
    ]);
    expect(result.trades).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/AMD/);
  });
});

describe('matchExecutions — multi-symbol', () => {
  it('produces separate trades for different symbols', () => {
    const result = matchExecutions([
      exec('AAPL', 'LONG_ENTRY', 100, 150, '09:30:00'),
      exec('AAPL', 'LONG_EXIT', 100, 155, '10:00:00'),
      exec('MSFT', 'SHORT_ENTRY', 50, 300, '09:31:00'),
      exec('MSFT', 'SHORT_EXIT', 50, 290, '10:05:00'),
    ]);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(2);
    const symbols = result.trades.map((t) => t.symbol).sort();
    expect(symbols).toEqual(['AAPL', 'MSFT']);
  });
});

describe('matchExecutions — commission and fees propagate', () => {
  it('deducts commission and fees from netPnl', () => {
    const result = matchExecutions([
      exec('X', 'LONG_ENTRY', 100, 10, '09:30:00', 2, 0.5),
      exec('X', 'LONG_EXIT', 100, 11, '10:00:00', 2, 0.5),
    ]);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.grossPnl).toBeCloseTo(100);   // (11-10)*100
    expect(trade.commission).toBeCloseTo(4);    // 2+2
    expect(trade.fees).toBeCloseTo(1);          // 0.5+0.5
    expect(trade.netPnl).toBeCloseTo(95);       // 100-4-1
  });
});
```

**Acceptance:**
- [ ] `npm test` — `position-matcher.test.ts` passes with 0 failures

---

#### Step 23: Tests — `__tests__/trade-merge.test.ts`

**File:** `__tests__/trade-merge.test.ts`
**Action:** CREATE

**Coverage gap (deliberate, follow-up tracked):** The actual merge logic lives in `app/api/trades/merge/route.ts`, not in a standalone utility. These tests re-implement the math (weighted avg, tag union, note concatenation) inline and verify it in isolation — they prove the algorithm is correct but do NOT exercise the route. Auth, ownership checks, opposite-direction 400s, FK cascade behavior on `trade_executions`, and the transactional path are uncovered.

This is intentional for Phase 1 — there's no route-level testing infra in this repo yet (no test DB harness, no in-memory PG mock). The "Follow-up Specs" section at the bottom of HANDOFF.md tracks this gap, and Phase 2 (or a dedicated test-infra sprint) should pick it up.

```ts
import { describe, it, expect } from 'vitest';

// Pure helper: weighted average of entry/exit prices across merged trades.
function weightedAvg(trades: { price: number; qty: number }[]): number {
  const totalQty = trades.reduce((s, t) => s + t.qty, 0);
  if (totalQty === 0) return 0;
  return trades.reduce((s, t) => s + t.price * t.qty, 0) / totalQty;
}

// Pure helper: union of tag arrays.
function unionTags(tagSets: string[][]): string[] {
  return Array.from(new Set(tagSets.flat()));
}

// Pure helper: concatenate non-empty notes with separator.
function mergeNotes(notes: (string | null | undefined)[]): string | null {
  const fragments = notes.map((n) => n?.trim()).filter((n): n is string => !!n);
  return fragments.length > 0 ? fragments.join(' --- ') : null;
}

describe('merge helpers — weightedAvg', () => {
  it('computes weighted average entry price', () => {
    const trades = [
      { price: 100, qty: 200 },
      { price: 120, qty: 100 },
    ];
    expect(weightedAvg(trades)).toBeCloseTo(106.67, 2);
  });

  it('returns 0 for zero total qty', () => {
    expect(weightedAvg([])).toBe(0);
  });
});

describe('merge helpers — unionTags', () => {
  it('deduplicates tags across merged trades', () => {
    const tags = unionTags([['momentum', 'breakout'], ['momentum', 'earnings']]);
    expect(tags.sort()).toEqual(['breakout', 'earnings', 'momentum']);
  });

  it('handles empty tag sets', () => {
    expect(unionTags([[], []])).toEqual([]);
  });
});

describe('merge helpers — mergeNotes', () => {
  it('joins non-empty notes with separator', () => {
    expect(mergeNotes(['Good entry', 'Follow through'])).toBe('Good entry --- Follow through');
  });

  it('skips null/empty notes', () => {
    expect(mergeNotes([null, 'Only this', ''])).toBe('Only this');
  });

  it('returns null when all notes are empty', () => {
    expect(mergeNotes([null, '', undefined])).toBeNull();
  });
});

describe('merge — direction validation (logic parity)', () => {
  it('detects opposite directions', () => {
    const directions = new Set(['LONG', 'SHORT']);
    expect(directions.size).toBe(2); // would 400 in the route
  });

  it('allows same-direction merge', () => {
    const directions = new Set(['LONG', 'LONG']);
    expect(directions.size).toBe(1); // would proceed
  });
});
```

**Acceptance:**
- [ ] `npm test` — `trade-merge.test.ts` passes with 0 failures

---

#### Step 24: Extend `__tests__/journal-aggregates.test.ts` — open-trade exclusion

**File:** `__tests__/journal-aggregates.test.ts`
**Action:** MODIFY

**Instructions:**

The `makeTrade` helper at line 9 needs to support `isOpen`. Add `isOpen: overrides.isOpen ?? false` to the returned object in `makeTrade` (after `tags: [],`):

```ts
    isOpen: overrides.isOpen ?? false,
    remainingQty: overrides.remainingQty ?? 0,
```

Then add a new `describe` block at the end of the file:

```ts
describe('aggregateDay — excludes open trades', () => {
  it('does not count an open trade in netResult or tradeIds', () => {
    const trades: Trade[] = [
      makeTrade({ id: 'closed', date: new Date(2026, 3, 17, 10, 0), netPnl: 100, grossPnl: 100 }),
      makeTrade({ id: 'open', date: new Date(2026, 3, 17, 11, 0), netPnl: 0, grossPnl: 0, isOpen: true }),
    ];
    const result = aggregateDay(trades, '2026-04-17');
    expect(result.tradeIds).toEqual(['closed']);
    expect(result.netResult).toBe(100);
  });
});

describe('aggregateWeek — excludes open trades', () => {
  it('does not count open trades in weekly totals', () => {
    const trades: Trade[] = [
      makeTrade({ id: 'c1', date: new Date(2026, 3, 14, 10, 0), netPnl: 200, grossPnl: 200, initialRisk: 100 }),
      makeTrade({ id: 'o1', date: new Date(2026, 3, 15, 10, 0), netPnl: 0, grossPnl: 0, isOpen: true }),
    ];
    const result = aggregateWeek(trades, '2026-04-13', '2026-04-17');
    expect(result.tradeIds).toEqual(['c1']);
    expect(result.netResult).toBe(200);
    expect(result.rTotal).toBeCloseTo(2, 10);
  });
});
```

**Acceptance:**
- [ ] `npm test` — `journal-aggregates.test.ts` passes with 0 failures

---

#### Step 25: Lint, typecheck, test, commit

**Action:** RUN COMMANDS

**Instructions:**

Run in order from the repo root:

```
npm run lint
npx tsc --noEmit
npm run db:migrate
npm test
```

All must pass with 0 errors. Then commit:

```
git add -A
git commit -m "Phase 1: overnight position support — schema, server matcher, close/merge/open UI, filter chip, stats exclusion"
```

Do NOT push.

**Acceptance:**
- [x] `npm run lint` — 0 errors
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm run db:migrate` — migration applies cleanly
- [x] `npm test` — 0 failing tests (all new tests pass)
- [x] `git log --oneline -1` shows the commit above
- [x] `git status` is clean after the local commit

---

### Files Changed Summary

| File | Action | Lines +/- est. | Risk |
|---|---|---|---|
| `lib/db/schema.ts` | MODIFY | +3 | LOW — additive schema only |
| `drizzle/0038_*.sql` | CREATE (generated) | +~6 | MEDIUM — migration with closed_at backfill |
| `lib/types.ts` | MODIFY | +6 | LOW |
| `lib/trade-utils.ts` | MODIFY | +2 | LOW |
| `lib/server-db-utils.ts` | MODIFY | +3 | LOW |
| `lib/validations/trades.ts` | MODIFY | +~15 | LOW |
| `lib/position-matcher.ts` | CREATE | +~170 | MEDIUM — new logic, covered by tests (no caller in Phase 1) |
| `app/api/trades/[id]/route.ts` | MODIFY | +~80 | HIGH — replaces PATCH handler |
| `app/api/trades/merge/route.ts` | CREATE | +~120 | HIGH — transactional, multi-table |
| `app/api/trades/route.ts` | MODIFY | +6 | LOW |
| `app/api/trades/import/route.ts` | MODIFY | +3 | LOW (insert only — re-import deliberately does not update isOpen/closedAt/remainingQty) |
| `hooks/use-trade-filters.ts` | MODIFY | +12 | LOW |
| `hooks/use-trades.ts` | MODIFY | +25 | MEDIUM |
| `components/trading/NewTradeDialog.tsx` | MODIFY | +65 | MEDIUM — form schema change |
| `components/trading/TradeDetailSheet.tsx` | MODIFY | +55 | MEDIUM |
| `components/trading/TradeTable.tsx` | MODIFY | +45 | MEDIUM |
| `components/trading/PerformanceStatsTable.tsx` | MODIFY | +20 | MEDIUM — stat exclusion logic |
| `lib/journal-aggregates.ts` | MODIFY | +2 | LOW |
| `__tests__/position-matcher.test.ts` | CREATE | +~100 | LOW |
| `__tests__/trade-merge.test.ts` | CREATE | +~70 | LOW (coverage gap on the route is intentional — see Step 23) |
| `__tests__/journal-aggregates.test.ts` | MODIFY | +~25 | LOW |
| `app/page.tsx` | MODIFY | +6 | LOW — prop wiring |
| `components/trading/ManagementTab.tsx` | MODIFY | +6 | LOW — prop pass-through |
| `components/trading/TradesTab.tsx` | MODIFY | +9 | LOW — prop pass-through |

**Deferred to Phase 2 (NOT touched in Phase 1):** `app/api/trades/import-raw/route.ts` (would have been ~90 lines), `importRawSchema` block in `lib/validations/trades.ts` (~30 lines), `hooks/use-trades.ts` `processImportFiles` rewrite (~10 lines).

---

### Verification Steps

**Automated:**
- `npm run lint`
- `npx tsc --noEmit`
- `npm test` — covers position-matcher, trade-merge, journal-aggregates, and all pre-existing suites
- `npm run db:migrate` — apply migration 0038

**Manual checks:**
- [ ] Import a CSV containing an unmatched BUY — confirm the same "X unmatched share(s)" warning toast appears (behavior preserved)
- [ ] Create a closed trade via the dialog (no checkbox) — confirm it appears with PnL filled, no OPEN badge
- [ ] Create an open position via the dialog checkbox — confirm it appears with OPEN badge and PnL `—`
- [ ] Click Close Position on the open trade, supply exit price + time, confirm the trade flips to closed with correct PnL
- [ ] Select 2 closed trades with the same symbol + direction, click Merge, confirm one merged row replaces them with summed qty, correct PnL, unioned tags, concatenated notes
- [ ] Try to merge two trades of opposite direction — confirm the request 400s with "Cannot merge trades with opposite directions"
- [ ] Filter chip: switch Open / Closed / All and confirm row visibility changes correctly
- [ ] PerformanceStatsTable shows "N open positions excluded" indicator and stats reflect closed trades only
- [ ] All pre-existing trades after migration show `isOpen=false` and `remainingQty=0` (spot-check via SQL: `SELECT id, is_open, remaining_qty FROM trades LIMIT 10;`)
- [ ] DO NOT git push — verify Codex stopped after committing locally

---

### Complexity Estimate

HIGH — ~22 files touched, 2 new endpoints (close-position action + merge), 1 migration with `closed_at` backfill, new server-side matching module (built + tested but not yet wired), significant UI changes across 4 components. Estimate 4-6 hours of Codex execution time assuming no major blockers. Steps 8 and 19 are deferred no-ops that should add negligible time.

---

## Follow-up Specs (not yet planned)

### Route-level testing infrastructure

Stand up a test DB harness (Postgres in Docker via testcontainers, or a vitest setup that points at a disposable schema) so we can write real integration tests for API routes. Phase 1's `__tests__/trade-merge.test.ts` only covers the merge math in isolation — auth, ownership, opposite-direction 400s, and the FK cascade on `trade_executions` are uncovered today. Once the harness exists, the immediate target is `app/api/trades/merge/route.ts` and the close-position branch of `app/api/trades/[id]/route.ts`.

### Server-side CSV import + position matcher wiring (Phase 2 multi-day support)

Phase 1 ships `lib/position-matcher.ts` with unit tests but no caller. Phase 2 should build the `app/api/trades/import-raw/route.ts` endpoint that was deferred from Phase 1 Step 8, plus the client-side `collectRawExecutions` helper in `lib/trade-utils.ts` (parses CSV → broker normalize → stops before FIFO matching). Then switch `hooks/use-trades.ts` `processImportFiles` to send raw executions to the new endpoint. This unlocks cross-day matching (the matcher will consume pre-existing open positions for the user before matching the day's executions).

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
