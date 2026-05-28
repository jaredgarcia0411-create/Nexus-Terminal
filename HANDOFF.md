# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-28
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Next Up: Sprint 6 — Rate Limiting

> Status: NOT YET SPECCED

Scope: DB-backed sliding-window rate limiter for expensive endpoints (`/api/research-report`, `/api/askedgar/tldr`). New `rate_limit_hits` table, shared `lib/rate-limit.ts` helper, integration into target routes, 429 responses with standard headers. See `docs/repo-cleanup.md` § "Rate Limiting On Expensive Endpoints" for the finding.

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

---

## Cover/Close Entry Flow — Manual Entry (FIFO) + Import Side Resolution

> Generated: 2026-05-28 | Agent: claude (inline, post-investigation)
> Status: COMPLETED 2026-05-28

### Problem

A swing cover that closes a position taken on a prior day is mishandled in **two separate code paths**, both surfacing the same symptom: the cover (a buy that closes a short, or a sell that closes a long) shows up as a brand-new **open trade in the opposite direction** (a short cover becomes an open LONG), leaving the original open position open.

- **Manual entry** (`NewTradeDialog`): the New Trade form has no concept of a "cover". It only creates a standalone LONG/SHORT trade, so a logged cover becomes a new opposite open trade. The Merge button then refuses to combine them ("opposite directions").
- **Import** (file/folder CSV button → `/api/trades/import-raw`): the import-raw route already loads open DB positions and matches against them *correctly* — but the raw `B` (buy) is labeled LONG vs cover **client-side** by `resolveSidesByPositionState`, which only walks the current file's rows. A cover imported on a later day than the short has no open short *in that file*, so it is labeled `MARGIN` (long open) and never matches the open short.

### Fix (decided with user)

**Part A — Manual entry:** When a manual trade is logged that **offsets an existing open position** (same symbol, opposite direction), prompt the user (confirm dialog) to close that open position instead of creating a new opposite open trade. On confirm, a new server route applies the cover **FIFO** across the open position(s):
- Cover qty == open qty → fully close the open trade(s) in place at the cover price (one closed trade each, same direction; the user can then use the existing Merge button to collapse multiple into one swing trade).
- Cover qty < open qty → partial: reduce the oldest open trade and emit a closed trade for the matched portion.
- Cover qty > open qty → flip: close all open qty, then open a new trade in the cover direction for the leftover.

On decline, the trade is logged exactly as entered (today's behavior). Detection only triggers when an **open** opposite position exists, so normal round-trip trades and same-direction logging are unaffected.

`coverDirection` = the side of the closing fill the user entered (LONG = a buy → closes open SHORTs; SHORT = a sell → closes open LONGs). `positionDirection` = the opposite (the open positions being closed).

**Part B — Import:** Seed the existing chronological side resolver (`resolveSidesByPositionState`) with the user's currently-open positions, so a `B` that covers a short carried over from a prior day is labeled as a cover (`B`/SHORT_EXIT) instead of a new long. The server's `import-raw` route already closes the matching open position once the cover is correctly labeled — no server matching changes are needed. We seed the *resolver* (not a blunt server relabel) because the resolver walks fills chronologically and so still handles genuine intraday two-sided activity correctly even when an unrelated open position exists. Seed source is the client's current open trades (`tradesRef.current`); this matches the existing client-side resolution design.

> Out of scope for Part B: `processCsvData` / `collectImportedTrades` / `/api/trades/import` (TraderVue and the non-raw path) — the file/folder import button uses the raw-execution path only. Leave those unchanged.

---

### Part A — Manual entry (New Trade form)

---

#### 1. File: `lib/cover-position.ts` — Action: CREATE

Pure, testable FIFO math. No DB access.

```ts
import type { Direction } from '@/lib/types';

export interface CoverOpenInput {
  id: string;
  totalQuantity: number;
  avgEntryPrice: number;
  commission: number;
  fees: number;
}

export interface CoverMatch {
  id: string;
  matchedQty: number;
  remainingQty: number;
  grossPnl: number;
  netPnl: number;
  matchedCommission: number;
  matchedFees: number;
}

export interface CoverResult {
  matches: CoverMatch[];
  flipQty: number;
}

// positionDirection = direction of the OPEN positions being closed.
// `opens` MUST be pre-sorted oldest-first (FIFO).
export function computeCover(
  positionDirection: Direction,
  coverPrice: number,
  coverQty: number,
  opens: CoverOpenInput[],
): CoverResult {
  const matches: CoverMatch[] = [];
  let remainingCover = coverQty;

  for (const open of opens) {
    if (remainingCover <= 0) break;
    const matchedQty = Math.min(remainingCover, open.totalQuantity);
    if (matchedQty <= 0) continue;

    const ratio = open.totalQuantity > 0 ? matchedQty / open.totalQuantity : 0;
    const matchedCommission = open.commission * ratio;
    const matchedFees = open.fees * ratio;
    const grossPnl = positionDirection === 'LONG'
      ? (coverPrice - open.avgEntryPrice) * matchedQty
      : (open.avgEntryPrice - coverPrice) * matchedQty;
    const netPnl = grossPnl - matchedCommission - matchedFees;

    matches.push({
      id: open.id,
      matchedQty,
      remainingQty: open.totalQuantity - matchedQty,
      grossPnl,
      netPnl,
      matchedCommission,
      matchedFees,
    });
    remainingCover -= matchedQty;
  }

  return { matches, flipQty: Math.max(0, remainingCover) };
}
```

Acceptance:
- [ ] File exports `computeCover`, `CoverOpenInput`, `CoverMatch`, `CoverResult`.
- [ ] `tsc --noEmit` passes.

---

#### 2. File: `__tests__/cover-position.test.ts` — Action: CREATE

vitest tests for `computeCover`. Cover at least these cases:

```ts
import { describe, expect, it } from 'vitest';
import { computeCover } from '@/lib/cover-position';

const open = (id: string, qty: number, entry: number) => ({
  id, totalQuantity: qty, avgEntryPrice: entry, commission: 0, fees: 0,
});

describe('computeCover', () => {
  it('fully closes a single short at the cover price', () => {
    const r = computeCover('SHORT', 315.33, 500, [open('a', 500, 313)]);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].remainingQty).toBe(0);
    expect(r.matches[0].grossPnl).toBeCloseTo((313 - 315.33) * 500);
    expect(r.flipQty).toBe(0);
  });

  it('closes multiple shorts FIFO', () => {
    const r = computeCover('SHORT', 315.33, 500, [open('a', 300, 314.98), open('b', 200, 312.92)]);
    expect(r.matches).toHaveLength(2);
    expect(r.matches.every((m) => m.remainingQty === 0)).toBe(true);
    expect(r.flipQty).toBe(0);
  });

  it('partially closes when cover qty < open qty', () => {
    const r = computeCover('SHORT', 315, 300, [open('a', 500, 313)]);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].matchedQty).toBe(300);
    expect(r.matches[0].remainingQty).toBe(200);
    expect(r.flipQty).toBe(0);
  });

  it('flips leftover when cover qty > open qty', () => {
    const r = computeCover('SHORT', 315, 700, [open('a', 500, 313)]);
    expect(r.matches[0].matchedQty).toBe(500);
    expect(r.matches[0].remainingQty).toBe(0);
    expect(r.flipQty).toBe(200);
  });

  it('closes a long via a sell', () => {
    const r = computeCover('LONG', 12, 100, [open('a', 100, 10)]);
    expect(r.matches[0].grossPnl).toBeCloseTo((12 - 10) * 100);
  });
});
```

Acceptance:
- [ ] All cases pass under `npm test`.

---

#### 3. File: `lib/validations/trades.ts` — Action: MODIFY

Insert immediately after `export type MergeTradesInput = ...` (line 113), before `importRawSchema`:

```ts
export const coverPositionSchema = z.object({
  symbol: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  coverDirection: z.enum(['LONG', 'SHORT']),
  price: z.number().finite().positive(),
  qty: z.number().int().positive(),
  time: z.string().min(1).max(50),
  date: z.string().min(1).max(20),
  sortKey: z.string().min(1).max(20),
});

export type CoverPositionInput = z.infer<typeof coverPositionSchema>;
```

Acceptance:
- [ ] `coverPositionSchema` and `CoverPositionInput` exported. Uses Zod v4 (`z.flattenError` is already used elsewhere in this file).

---

#### 4. File: `app/api/trades/cover/route.ts` — Action: CREATE

Mirror the structure of `app/api/trades/merge/route.ts` (auth → `getPoolDb` → `ensureUser` → `parseAndValidate` → transaction → reload → `toTrade`). Use `getPoolDb()` because it uses a DB transaction.

```ts
import { randomUUID } from 'crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { trades } from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
} from '@/lib/server-db-utils';
import { coverPositionSchema } from '@/lib/validations/trades';
import { computeCover, type CoverOpenInput } from '@/lib/cover-position';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, coverPositionSchema);
    if (bodyState.error) return bodyState.error;
    const { symbol, coverDirection, price, qty, time, date, sortKey } = bodyState.data;

    const positionDirection = coverDirection === 'LONG' ? 'SHORT' : 'LONG';

    const opens = await db.select().from(trades)
      .where(and(
        eq(trades.userId, authState.user.id),
        eq(trades.symbol, symbol),
        eq(trades.direction, positionDirection),
        eq(trades.isOpen, true),
      ))
      .orderBy(asc(trades.date), asc(trades.entryTime), asc(trades.id));

    if (opens.length === 0) {
      return Response.json(
        { error: `No open ${positionDirection} position found for ${symbol}` },
        { status: 400 },
      );
    }

    const coverInputs: CoverOpenInput[] = opens.map((o) => ({
      id: o.id,
      totalQuantity: o.totalQuantity,
      avgEntryPrice: o.avgEntryPrice,
      commission: o.commission ?? 0,
      fees: o.fees ?? 0,
    }));

    const { matches, flipQty } = computeCover(positionDirection, price, qty, coverInputs);
    const affectedIds: string[] = [];

    await db.transaction(async (tx) => {
      for (const match of matches) {
        const open = opens.find((o) => o.id === match.id)!;

        if (match.remainingQty === 0) {
          await tx.update(trades).set({
            avgExitPrice: price,
            exitTime: time,
            grossPnl: match.grossPnl,
            netPnl: match.netPnl,
            pnl: match.netPnl,
            isOpen: false,
            closedAt: sql`now()`,
            remainingQty: 0,
          }).where(and(eq(trades.id, open.id), eq(trades.userId, authState.user.id)));
          affectedIds.push(open.id);
        } else {
          const keepRatio = open.totalQuantity > 0 ? match.remainingQty / open.totalQuantity : 0;
          await tx.update(trades).set({
            totalQuantity: match.remainingQty,
            remainingQty: match.remainingQty,
            commission: (open.commission ?? 0) * keepRatio,
            fees: (open.fees ?? 0) * keepRatio,
          }).where(and(eq(trades.id, open.id), eq(trades.userId, authState.user.id)));
          affectedIds.push(open.id);

          const closedId = `cover|${randomUUID().slice(0, 8)}|${symbol}|${positionDirection}`;
          await tx.insert(trades).values({
            id: closedId,
            userId: authState.user.id,
            date: open.date,
            sortKey: open.sortKey,
            symbol,
            direction: positionDirection,
            avgEntryPrice: open.avgEntryPrice,
            avgExitPrice: price,
            totalQuantity: match.matchedQty,
            grossPnl: match.grossPnl,
            netPnl: match.netPnl,
            entryTime: open.entryTime,
            exitTime: time,
            executionCount: 1,
            pnl: match.netPnl,
            executions: 1,
            initialRisk: open.initialRisk,
            commission: match.matchedCommission,
            fees: match.matchedFees,
            isOpen: false,
            closedAt: sql`now()`,
            remainingQty: 0,
          });
          affectedIds.push(closedId);
        }
      }

      if (flipQty > 0) {
        const flipId = `${sortKey}|${symbol}|${coverDirection}|cover-${randomUUID().slice(0, 4)}`;
        await tx.insert(trades).values({
          id: flipId,
          userId: authState.user.id,
          date,
          sortKey,
          symbol,
          direction: coverDirection,
          avgEntryPrice: price,
          avgExitPrice: 0,
          totalQuantity: flipQty,
          grossPnl: 0,
          netPnl: 0,
          entryTime: time,
          exitTime: '',
          executionCount: 1,
          pnl: 0,
          executions: 1,
          isOpen: true,
          remainingQty: flipQty,
        });
        affectedIds.push(flipId);
      }
    });

    const rows = await db.select().from(trades)
      .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, affectedIds)));
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, affectedIds);

    return Response.json({
      affected: rows.map((row) => toTrade(row, tagMap.get(row.id) ?? [])),
    });
  } catch (error) {
    logRouteError('trades.cover.post', error);
    return internalServerError();
  }
}
```

Notes:
- `trades.date` and `trades.sortKey` are `text` columns (stored as strings), so insert the `date`/`sortKey` strings directly — do NOT wrap in `new Date()`.
- The partial-close `closedId` and the `flipId` use the same id-collision-safe pattern as the merge route (`randomUUID().slice`).
- The flip insert intentionally omits `initialRisk`, `commission`, `fees`, `mfe`, `mae`, etc. — they are nullable or DB-defaulted (commission/fees default 0). It's a fresh open position; do NOT add defensive fields.
- Known minor gap (acceptable, do not "fix"): a flipped new open row does not inherit the user's default risk (`withDefaultRisk` is only applied to `handleCreateManualTrade`). Flips are rare; the user can set risk manually.

Acceptance:
- [ ] Route authenticates via `requireUser()` and uses `getPoolDb()` + `dbUnavailable()`.
- [ ] Returns `400` with a clear message when no matching open position exists.
- [ ] Full close updates the open row in place; partial close reduces the open and inserts a closed portion; flip inserts a new open row.
- [ ] Returns `{ affected: Trade[] }` (serialized via `toTrade`).

---

#### 5. File: `hooks/use-trades.ts` — Action: MODIFY

5a. Import the type. In the import from `@/lib/validations/trades` (or add one if none exists), import `CoverPositionInput` as a type. If `use-trades.ts` has no import from that module yet, add: `import type { CoverPositionInput } from '@/lib/validations/trades';` with the other `import type` lines.

5b. After `handleCreateManualTrade` (ends ~line 125), add:

```ts
  const handleCoverPosition = (input: CoverPositionInput) => {
    withErrorToast('Failed to close position', async () => {
      const result = await apiRequest<{ affected: ApiTrade[] }>('/api/trades/cover', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const affected = result.affected.map(fromApiTrade);
      const affectedIds = new Set(affected.map((trade) => trade.id));
      setTrades((prev) => sortTrades([...affected, ...prev.filter((trade) => !affectedIds.has(trade.id))]));
    });
  };
```

5c. Add `handleCoverPosition` to the hook's returned object (the same return block that exposes `handleCreateManualTrade`, ~line 418 area).

Acceptance:
- [ ] `handleCoverPosition` is exported from `useTrades` and merges `affected` rows into state by id.

---

#### 6. File: `app/page.tsx` — Action: MODIFY

6a. Add `handleCoverPosition` to the destructure from `useTrades()` (the block around lines 93-108, next to `handleCreateManualTrade`).

6b. Update the `NewTradeDialog` call (line ~260) to pass open positions and the cover handler:

```tsx
<NewTradeDialog
  open={isManualTradeOpen}
  onOpenChange={setIsManualTradeOpen}
  onCreateTrade={handleCreateManualTrade}
  openPositions={trades.filter((trade) => trade.isOpen)}
  onCoverPosition={handleCoverPosition}
/>
```

`trades` is already in scope (destructured at line 63).

Acceptance:
- [ ] Dialog receives `openPositions` and `onCoverPosition`.

---

#### 7. File: `components/trading/NewTradeDialog.tsx` — Action: MODIFY

7a. Add imports near the top:
```ts
import { useState } from 'react';
import type { CoverPositionInput } from '@/lib/validations/trades';
```
(If `react` is already imported for other hooks, add `useState` to that import.)

7b. Extend `NewTradeDialogProps`:
```ts
interface NewTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTrade: (trade: Trade) => Promise<void> | void;
  openPositions: Trade[];
  onCoverPosition: (input: CoverPositionInput) => Promise<void> | void;
}
```
Destructure the two new props in the component signature. Keep the existing `export default function NewTradeDialog(...)` — do not change the export style. No imports beyond `useState` + `CoverPositionInput` (7a) are needed; `calculatePnL`, `format`, `parseISO`, and `Trade` are already imported.

7c. Add confirm state inside the component. Store the *inputs* needed to rebuild the fallback trade lazily (so a cover entered as a closed trade with no exit price still reaches the confirm — see 7e note):
```ts
const [pendingCover, setPendingCover] = useState<{
  openDirection: 'LONG' | 'SHORT';
  openQty: number;
  coverInput: CoverPositionInput;
  build: { values: TradeFormValues; id: string; sortKey: string; date: Date; initialRisk: number | undefined };
} | null>(null);
```

7d. Extract the trade-object construction. Currently `handleSubmit` builds `trade` inline (the `if (values.isOpenPosition) { ... } else { ... }` block, ~lines 76-132). Move that construction into a local helper inside the component so it can be reused by both the no-offset path and the decline path:

```ts
const buildTrade = (
  values: TradeFormValues,
  id: string,
  sortKey: string,
  date: Date,
  initialRisk: number | undefined,
): Trade => {
  if (values.isOpenPosition) {
    return { /* ...the existing open-position trade object... */ };
  }
  const exitPrice = values.exitPrice;
  if (!exitPrice || exitPrice <= 0) {
    throw new Error('Exit price is required for closed trades');
  }
  const netPnl = calculatePnL(values.direction, values.entryPrice, exitPrice, values.quantity);
  return { /* ...the existing closed trade object... */ };
};
```
(Keep the two object literals exactly as they are today — just relocated into this helper. Two callers justify the helper; do not add anything else.)

7e. Rewrite `handleSubmit` so detection runs *before* building/validating the trade:

```ts
const handleSubmit = form.handleSubmit(async (rawValues) => {
  try {
    const values: TradeFormValues = tradeFormSchema.parse(rawValues);
    const date = parseISO(values.date);
    const sortKey = format(date, 'yyyy-MM-dd');
    const timeOfDay = values.entryTime?.trim()
      ? values.entryTime.trim().replace(/:/g, '')
      : format(new Date(), 'HHmmss');
    const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    const id = `${sortKey}|${values.symbol}|${values.direction}|${timeOfDay}-${suffix}`;
    const initialRisk = values.initialRisk?.trim() ? Number(values.initialRisk) : undefined;
    if (initialRisk !== undefined && (!Number.isFinite(initialRisk) || initialRisk <= 0)) {
      throw new Error('Invalid initial risk');
    }

    const offsetting = openPositions.filter(
      (p) => p.isOpen && p.symbol === values.symbol && p.direction !== values.direction,
    );
    if (offsetting.length > 0) {
      const openQty = offsetting.reduce((sum, p) => sum + p.totalQuantity, 0);
      setPendingCover({
        openDirection: offsetting[0].direction,
        openQty,
        coverInput: {
          symbol: values.symbol,
          coverDirection: values.direction,
          price: values.entryPrice,
          qty: values.quantity,
          time: values.entryTime?.trim() || format(new Date(), 'HH:mm:ss'),
          date: values.date,
          sortKey,
        },
        build: { values, id, sortKey, date, initialRisk },
      });
      return;
    }

    await onCreateTrade(buildTrade(values, id, sortKey, date, initialRisk));
    resetForm();
    onOpenChange(false);
    toast.success(values.isOpenPosition ? 'Open position recorded' : 'Trade added');
  } catch (error) {
    console.error(error);
    toast.error(error instanceof Error ? error.message : 'Failed to add trade');
  }
});
```

**Important (why `build` is stored, not a pre-built `fallbackTrade`):** a cover is naturally entered as a *closed* trade with the cover price in the **Entry Price** field and no exit price. If we eagerly called `buildTrade(...)` here, it would throw `"Exit price is required for closed trades"` *before* `setPendingCover` runs, so the confirm dialog would never appear for the most common cover. Detection must happen with no exit-price requirement; the fallback trade is built only if the user *declines* (7f). Extract the existing `form.reset({...})` into a local `resetForm()` (the same default-values object used in `defaultValues`) since it's now needed in several places.

7f. Confirm handlers. `confirmCover` closes the open position; `declineCover` builds the fallback trade lazily (so its exit-price requirement only applies when the user explicitly chooses "log as new trade"):
```ts
const confirmCover = async () => {
  if (!pendingCover) return;
  try {
    await onCoverPosition(pendingCover.coverInput);
    setPendingCover(null);
    resetForm();
    onOpenChange(false);
    toast.success('Open position closed');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to close position');
  }
};

const declineCover = async () => {
  if (!pendingCover) return;
  const { values, id, sortKey, date, initialRisk } = pendingCover.build;
  try {
    await onCreateTrade(buildTrade(values, id, sortKey, date, initialRisk));
    setPendingCover(null);
    resetForm();
    onOpenChange(false);
    toast.success(values.isOpenPosition ? 'Open position recorded' : 'Trade added');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to add trade');
  }
};
```

7g. Render the confirm view. Inside `DialogContent`, when `pendingCover` is set, render the confirmation block **instead of** the `<form>` (conditional). Match the existing dialog styling (`bg-card border-border text-foreground`, button classes already used in the footer). Content:
- Title stays "New Manual Trade" (or swap to "Close Open Position" when `pendingCover` is set).
- Message: `You hold an open {openDirection} position in {symbol} of {openQty} shares. Close it at ${price} instead of logging a new {coverDirection} trade?`
- A qty hint line:
  - if `coverInput.qty < openQty`: `Closes {qty} of {openQty}; {openQty - qty} stays open.`
  - if `coverInput.qty > openQty`: `Closes all {openQty}; the remaining {qty - openQty} opens a new {coverDirection} position.`
  - else: `This fully closes the position.`
- Footer buttons: primary "Close position" → `confirmCover`; secondary "No, log as new trade" → `declineCover`. Reuse the existing button class names from the form footer for visual consistency.

7h. Reset `pendingCover` to `null` whenever the dialog closes, so reopening starts clean. In the existing `onOpenChange` wiring (the `<Dialog open={open} onOpenChange={onOpenChange}>`), wrap to also clear: `onOpenChange={(next) => { if (!next) setPendingCover(null); onOpenChange(next); }}`.

Acceptance:
- [ ] Logging an opposite-direction trade on a symbol with an open position shows the confirm view (not an immediate create).
- [ ] "Close position" calls `onCoverPosition`; "No, log as new trade" creates the trade as entered.
- [ ] No open opposite position → form behaves exactly as before.
- [ ] Dialog visuals match the existing design system (frontend-design skill: card bg, border, button styles).

---

### Part B — Import (raw CSV) side resolution

The only fix is to **seed the existing resolver with open positions**. No changes to `import-raw/route.ts` or `position-matcher.ts` — they already close matched open positions correctly once the cover is labeled `B`.

Define `OpenPositionSeed` once in `lib/parsers/types.ts` and import it everywhere it's used (avoids a circular import, since `utils.ts` already imports from `types.ts`). **Do not** add `OpenPositionSeed` to the `lib/parsers/index.ts` barrel — every consumer imports it directly from the type module (`./types` or `@/lib/parsers/types`).

---

#### B1. File: `lib/parsers/types.ts` — Action: MODIFY

Add the seed type (near `NormalizedExecution`):
```ts
export interface OpenPositionSeed {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  qty: number;
}
```

Extend the optional `buildContext` signature on `BrokerParserConfig`:
```ts
buildContext?: (rows: Record<string, unknown>[], openPositions?: OpenPositionSeed[]) => Record<string, unknown>;
```

Acceptance:
- [ ] `OpenPositionSeed` exported; `buildContext` accepts an optional second `openPositions` arg.

---

#### B2. File: `lib/parsers/utils.ts` — Action: MODIFY

Import the type: add `OpenPositionSeed` to the existing `import type { NormalizedExecution } from './types';` line.

Change `resolveSidesByPositionState` to accept a `seed` param, and **populate the existing `stateBySymbol` map** before the row loop. The map is already declared today (`const stateBySymbol = new Map<...>()`, currently line 111) — **do NOT re-declare it**; only add the seed-population loop immediately after that existing declaration:

```ts
export function resolveSidesByPositionState(
  rows: PositionResolverRow[],
  seed: OpenPositionSeed[] = [],   // <-- add this param
): PositionResolverResult {
  // ...existing `ordered` sort stays as-is...

  const stateBySymbol = new Map<string, { longQty: number; shortQty: number }>();  // <-- EXISTING line, keep it

  // <-- ADD this loop right after the existing declaration above:
  for (const pos of seed) {
    const state = stateBySymbol.get(pos.symbol) ?? { longQty: 0, shortQty: 0 };
    if (pos.direction === 'LONG') state.longQty += pos.qty;
    else state.shortQty += pos.qty;
    stateBySymbol.set(pos.symbol, state);
  }

  // ...rest unchanged — the existing `for (const row of ordered)` loop already reads
  // stateBySymbol.get(row.symbol) ?? {...}, so it picks up the seeded state.
}
```

Acceptance:
- [ ] With a seed of `{ symbol: 'ARM', direction: 'SHORT', qty: 500 }` and a single `B` row of 500, the row resolves to `'B'` (cover), not `'MARGIN'`.
- [ ] With no seed, behavior is identical to today (existing parser tests still pass).

---

#### B3. File: `lib/parsers/default.ts` — Action: MODIFY

Import `OpenPositionSeed` from `./types`. Change `buildContext` to thread the seed through:
```ts
buildContext: (rawRows, openPositions) => {
  // ...existing inputs build...
  return resolveSidesByPositionState(inputs, openPositions);
},
```

Acceptance:
- [ ] `buildContext` forwards `openPositions` to `resolveSidesByPositionState`.

---

#### B4. File: `lib/parsers/das-trader.ts` — Action: MODIFY

Same change as B3:
```ts
buildContext: (rows, openPositions) => {
  // ...existing inputs build...
  return resolveSidesByPositionState(inputs, openPositions);
},
```

Acceptance:
- [ ] `buildContext` forwards `openPositions` to `resolveSidesByPositionState`.

---

#### B5. File: `lib/csv-parser.ts` — Action: MODIFY

Import `OpenPositionSeed` (from `@/lib/parsers/types`). Add the param to `extractRawExecutions` and pass it to `buildContext`:
```ts
export const extractRawExecutions = (
  data: Record<string, string>[],
  parser?: BrokerParserConfig,
  openPositions: OpenPositionSeed[] = [],
): ExtractRawResult => {
  // ...
  const parserContext = activeParser.buildContext?.(data as Record<string, unknown>[], openPositions);
  // ...
};
```
Do NOT change `processCsvData` (out of scope per the section note).

Acceptance:
- [ ] `extractRawExecutions` accepts `openPositions` (default `[]`) and forwards it to `buildContext`.

---

#### B6. File: `lib/trade-utils.ts` — Action: MODIFY

Import `OpenPositionSeed` (from `@/lib/parsers/types`). Add it to `CollectImportedTradesOptions`:
```ts
type CollectImportedTradesOptions = {
  includeFile?: (file: File) => boolean;
  resolveParser: (file: File, rows: Record<string, string>[]) => BrokerParserConfig | null;
  openPositions?: OpenPositionSeed[];
};
```
In `collectRawExecutions`, pass it through:
```ts
const extracted = extractRawExecutions(rows, parser ?? undefined, options.openPositions ?? []);
```

Acceptance:
- [ ] `collectRawExecutions` forwards `options.openPositions` to `extractRawExecutions`.

---

#### B7. File: `hooks/use-trades.ts` — Action: MODIFY

In `processImportFiles`, build the seed from the current open trades and pass it to `collectRawExecutions`:
```ts
const openPositions = tradesRef.current
  .filter((trade) => trade.isOpen)
  .map((trade) => ({
    symbol: trade.symbol,
    direction: trade.direction,
    qty: trade.remainingQty > 0 ? trade.remainingQty : trade.totalQuantity,
  }));

const { batches, warnings } = await collectRawExecutions(files, {
  includeFile: options.includeFile,
  resolveParser: options.resolveParser,
  openPositions,
});
```
`tradesRef` is already used in this function (line ~281). No type import needed if the inline object satisfies `OpenPositionSeed` structurally; if TS complains, import the type.

Acceptance:
- [ ] Imports seed the resolver with currently-open positions; importing a later-day cover CSV closes the carried-over open short instead of creating a new open long.

---

#### Part B — Known limitations (document, do not over-engineer around these)

These are inherent to seeding a chronological resolver with the client's pre-import open positions. They are acceptable for this tool; the executor should NOT add complexity to solve them. They are listed so the behavior is understood and the coworkers know the supported workflow.

1. **Multi-batch / folder import in one action.** The seed is captured once from `tradesRef.current` *before* the batch loop and is not refreshed between batches (`hooks/use-trades.ts:281-304`). So if a short is opened by an *earlier-day CSV in the same folder import* and covered by a *later-day CSV in the same import*, the cover batch's seed will not yet contain that short (it's only in the DB after the earlier batch POSTs) → the cover is still mislabeled. **Supported workflow:** import the day(s) that open a position, then import the cover day as a *separate* import action. Single-file imports (the common case) are unaffected.

2. **Same-symbol intraday round-trip while holding a carried-over position.** If the user holds an open short carried from a prior day and, in an imported file, does an intraday round-trip *on the same symbol* (e.g. buy 200 then sell 200), the seeded short makes the buy resolve as a partial cover and the sell as an unmatched long-exit. This is a pre-existing limitation of the chronological resolver (it can't distinguish "buy to cover" from "buy to open" once a short is open on that symbol); seeding only makes it reachable across days. Different-symbol intraday activity is unaffected. The Part B manual tests cover both the working (unrelated-symbol) case and assert this same-symbol edge so it isn't a surprise.

---

### Files Changed Summary

| File | Action | ~LOC | Risk | Part |
| --- | --- | --- | --- | --- |
| `lib/cover-position.ts` | CREATE | +60 | Low (pure fn) | A |
| `__tests__/cover-position.test.ts` | CREATE | +45 | Low | A |
| `lib/validations/trades.ts` | MODIFY | +12 | Low | A |
| `app/api/trades/cover/route.ts` | CREATE | +150 | Med (DB transaction, FIFO writes) | A |
| `hooks/use-trades.ts` | MODIFY | +20 | Low | A + B |
| `app/page.tsx` | MODIFY | +3 | Low | A |
| `components/trading/NewTradeDialog.tsx` | MODIFY | +90/-30 | Med (form flow + confirm UI) | A |
| `lib/parsers/types.ts` | MODIFY | +6 | Low | B |
| `lib/parsers/utils.ts` | MODIFY | +10 | Low | B |
| `lib/parsers/default.ts` | MODIFY | +2 | Low | B |
| `lib/parsers/das-trader.ts` | MODIFY | +2 | Low | B |
| `lib/csv-parser.ts` | MODIFY | +3 | Low | B |
| `lib/trade-utils.ts` | MODIFY | +3 | Low | B |

### Verification Steps

Automated (from repo root):
- [x] `npm run lint` — passed.
- [x] `npx tsc --noEmit` — passed.
- [x] `npm run typecheck:services` — skipped; no `services/` files touched.
- [x] `npm test` — passed (93 files, 677 tests).
- [x] `npm run workflow:audit` — passed after `HANDOFF.md` status update.

Manual (browser) — Part A (manual entry):
- [ ] Reproduce coworker's case: log open SHORT ARM 300 (day 1) and open SHORT ARM 200 (day 2). Then log a LONG ARM 500 at the cover price → confirm dialog appears → "Close position" → both shorts become closed shorts with correct PnL `(entry − cover) × qty`, no orphan long created.
- [ ] Select the two resulting closed shorts → Merge → one closed swing short.
- [ ] Partial: open SHORT 500, log LONG 300 → confirm → 300 closes, 200 remains open.
- [ ] Flip: open SHORT 500, log LONG 700 → confirm → 500 closes, new open LONG 200 appears.
- [ ] Decline path: with an open short present, log LONG and click "No, log as new trade" → a new trade is created as entered (today's behavior).
- [ ] No open position on the symbol → no confirm, form works as before.

Manual (browser) — Part B (import):
- [ ] Import a CSV that opens a short (e.g. ARM SS 500) so an open short exists. Then import a *separate, later-day* CSV containing only the cover (ARM B 500) → the open short closes with correct PnL; no new open long is created.
- [ ] Import a day where, while an unrelated open short exists, the file contains a genuine intraday round-trip long (buy then sell same day) → the intraday long is recorded as its own closed long and the open short is untouched (resolver chronology still correct).
- [ ] Re-importing the same file is still deduped by `batchKey` (no duplicates).

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
