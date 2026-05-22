# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-22
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

---

## Active Spec: Persist Chart Drawings + Indicators to DB

### Goal

Today, chart drawings (trendlines, fib, rectangles, text, horizontal lines) and indicator presets in the Backtest / Charts surfaces are not persisted. The single `useChartDrawings` controller in `BacktestChartGrid.tsx` hardcodes `{ persist: false }` and the legacy localStorage path is dead. Drawings also only work on intraday timeframes because `BacktestChart.tsx` gates the overlay behind `frame.intraday`.

After this spec:

1. Drawings + indicators persist server-side, scoped per `(user_id, ticker, bucket)` where `bucket ∈ {'intraday','higher'}`. Intraday = 1m–4h. Higher = 1D/1W/1M.
2. Daily/Weekly/Monthly slots get the same draw-and-edit UX as intraday slots.
3. Active backtest sessions read/write the user's live library. Saved reviews read a frozen snapshot stored in `backtest_sessions.chart_state` and are permanently read-only for drawings.
4. The `chartState` JSON shape is migrated to a nested `{ intraday, higher }` shape, with backward-compatible reads of the legacy flat shape (existing snapshots are not rewritten).
5. Indicators are persisted per-slot within each bucket (e.g., `primary` slot's intraday indicators are stored separately from `secondary` slot's intraday indicators).

### Scope summary

| Surface | Reads | Writes | Whose drawings |
|---|---|---|---|
| Charts tab (no active backtest) | viewer's library | viewer's library | viewer's |
| Active backtest session (own, not REVIEWED) | viewer's library | viewer's library | viewer's |
| Saved review viewer (own or others') | `session.chartState` snapshot | nothing (read-only) | review owner's, frozen at review-save |

### Out of scope

- `JournalTradeChart` (no drawing layer).
- Any localStorage migration. Nothing was actually persisting at this surface.
- Removing the dormant `localController` branch in `ChartDrawings.tsx`.

### Implementation Status — 2026-05-22

- Server schema/API, chart-grid bucket plumbing, review snapshot normalization, and tests are implemented.
- `npm run db:migrate` applied `drizzle/0042_happy_felicia_hardy.sql` successfully.
- Automated gates passed: `npm run lint`, `npx tsc --noEmit`, and `npm test`.
- Manual smoke remains pending user-run dev-server validation.

---

## Step 1 — Database schema

### 1.1 Add `chart_drawings` table to `lib/db/schema.ts`

Place the new export immediately after the `backtestActions` table (around line 581).

```ts
export const chartDrawings = pgTable('chart_drawings', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  bucket: text('bucket', { enum: ['intraday', 'higher'] }).notNull(),
  drawings: jsonb('drawings').default([]).notNull(),
  indicators: jsonb('indicators').default({}).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.ticker, t.bucket] }),
]);
```

Use the existing `primaryKey` helper already imported in this file. If not imported, add it to the `drizzle-orm/pg-core` import at the top.

### 1.2 Generate the migration

Run:

```bash
npx drizzle-kit generate
```

This will create `drizzle/0042_<name>.sql`. **Verify the generated SQL by reading the file before applying.** Expected contents:

```sql
CREATE TABLE "chart_drawings" (
  "user_id" text NOT NULL,
  "ticker" text NOT NULL,
  "bucket" text NOT NULL,
  "drawings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "indicators" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chart_drawings_user_id_ticker_bucket_pk" PRIMARY KEY("user_id","ticker","bucket")
);
--> statement-breakpoint
ALTER TABLE "chart_drawings" ADD CONSTRAINT "chart_drawings_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
```

If Drizzle generates anything different — particularly anything that drops/recreates other tables — **stop and ask**. Do not modify the generated SQL by hand unless the bucket CHECK constraint is missing; in that case append:

```sql
ALTER TABLE "chart_drawings" ADD CONSTRAINT "chart_drawings_bucket_check"
  CHECK ("bucket" IN ('intraday','higher'));
```

### 1.3 Apply the migration

```bash
npm run db:migrate
```

**Never `npm run db:push`** — this repo has had `db:push` false-positives on composite PKs that corrupted migration history.

---

## Step 2 — Validation schema updates

### 2.1 Relax `chartStateSchema` in `lib/validations/backtest.ts`

Replace the existing `chartStateSchema` (lines 27–30) with a shape that tolerates both the legacy flat shape AND the new nested shape. The schema does runtime validation on review-save payloads only; the client normalizer (Step 4.4) handles in-app coercion.

```ts
// Drawings are validated structurally by `normalizeDrawings` on read.
// Indicators are validated by `isIndicatorKey` on read. The schema only
// enforces the outer envelope and accepts both the legacy flat shape and
// the new bucketed shape — existing snapshots predate the migration.
const drawingsField = z.union([
  z.array(z.unknown()), // legacy flat
  z.object({
    intraday: z.array(z.unknown()).optional(),
    higher: z.array(z.unknown()).optional(),
  }),
]).optional();

const indicatorsField = z.union([
  z.record(z.string(), z.array(z.string())), // legacy flat (slotId -> indicators)
  z.object({
    intraday: z.record(z.string(), z.array(z.string())).optional(),
    higher: z.record(z.string(), z.array(z.string())).optional(),
  }),
]).optional();

export const chartStateSchema = z.object({
  drawings: drawingsField,
  indicators: indicatorsField,
});

export type ChartStateBody = z.infer<typeof chartStateSchema>;
```

Notes:
- Remove the `.strict()` modifier. Snapshots are immutable archives — if future fields appear, we want forward-tolerant reads.
- Keep `backtestSessionReviewSchema` unchanged otherwise (`chartState: chartStateSchema.optional()` still works).

### 2.2 Add a new validation schema for the chart-drawings API

In a new file `lib/validations/chart-drawings.ts`:

```ts
import { z } from 'zod';

export const chartBucketSchema = z.enum(['intraday', 'higher']);
export type ChartBucket = z.infer<typeof chartBucketSchema>;

export const chartDrawingsQuerySchema = z.object({
  ticker: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()),
  bucket: chartBucketSchema,
});

export const chartDrawingsPutSchema = z.object({
  drawings: z.array(z.unknown()),
  indicators: z.record(z.string(), z.array(z.string())),
});

export type ChartDrawingsPutBody = z.infer<typeof chartDrawingsPutSchema>;
```

---

## Step 3 — API route

### 3.1 Create `app/api/chart-drawings/route.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { chartDrawings } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import {
  chartBucketSchema,
  chartDrawingsPutSchema,
  chartDrawingsQuerySchema,
} from '@/lib/validations/chart-drawings';

function parseQuery(request: Request) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const bucket = url.searchParams.get('bucket');
  return chartDrawingsQuerySchema.safeParse({ ticker, bucket });
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const tickerRaw = url.searchParams.get('ticker');
    if (!tickerRaw) {
      return Response.json({ error: 'ticker query param required' }, { status: 400 });
    }
    const ticker = tickerRaw.trim().toUpperCase();
    if (!ticker) {
      return Response.json({ error: 'ticker query param required' }, { status: 400 });
    }

    // Return BOTH buckets in one call. The grid fires this once on mount.
    const rows = await db
      .select()
      .from(chartDrawings)
      .where(and(
        eq(chartDrawings.userId, authState.user.id),
        eq(chartDrawings.ticker, ticker),
      ));

    const intraday = rows.find((r) => r.bucket === 'intraday') ?? null;
    const higher = rows.find((r) => r.bucket === 'higher') ?? null;

    return Response.json({
      intraday: {
        drawings: intraday?.drawings ?? [],
        indicators: intraday?.indicators ?? {},
      },
      higher: {
        drawings: higher?.drawings ?? [],
        indicators: higher?.indicators ?? {},
      },
    });
  } catch (error) {
    logRouteError('chart-drawings.get', error);
    return internalServerError();
  }
}

export async function PUT(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const queryState = parseQuery(request);
    if (!queryState.success) {
      return Response.json(
        { error: 'Invalid query', issues: z.flattenError(queryState.error) },
        { status: 400 },
      );
    }
    const { ticker, bucket } = queryState.data;

    const bodyState = await parseAndValidate(request, chartDrawingsPutSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const now = new Date();
    await db
      .insert(chartDrawings)
      .values({
        userId: authState.user.id,
        ticker,
        bucket,
        drawings: body.drawings,
        indicators: body.indicators,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [chartDrawings.userId, chartDrawings.ticker, chartDrawings.bucket],
        set: {
          drawings: body.drawings,
          indicators: body.indicators,
          updatedAt: now,
        },
      });

    return Response.json({ ok: true });
  } catch (error) {
    logRouteError('chart-drawings.put', error);
    return internalServerError();
  }
}
```

Conventions to match:
- `requireUser()` → auto-401 on missing session, per CLAUDE.md route rules.
- `ensureUser(db, authState.user)` → handles email-collision JWT remap, same as `backtest/sessions/[id]/review/route.ts`.
- `parseAndValidate()` + Zod for body validation, `z.flattenError` for query validation.

---

## Step 4 — Hook + client library plumbing

### 4.1 Add a server-backed helper alongside `useChartDrawings`

In `hooks/use-chart-drawings.ts`, do NOT change the existing reducer/controller. Instead, **add** a new function exported from this file that fetches and PUTs by `(ticker, bucket)`:

```ts
// Add near the bottom of the file, after the existing exports.

export type ChartBucket = 'intraday' | 'higher';

export interface ChartLibraryEntry {
  drawings: Drawing[];
  indicators: Record<string, string[]>;
}

export interface ChartLibrarySnapshot {
  intraday: ChartLibraryEntry;
  higher: ChartLibraryEntry;
}

export async function fetchChartLibrary(ticker: string): Promise<ChartLibrarySnapshot> {
  const response = await fetch(`/api/chart-drawings?ticker=${encodeURIComponent(ticker)}`);
  if (!response.ok) {
    return {
      intraday: { drawings: [], indicators: {} },
      higher: { drawings: [], indicators: {} },
    };
  }
  const data = await response.json() as {
    intraday: { drawings: unknown[]; indicators: Record<string, string[]> };
    higher: { drawings: unknown[]; indicators: Record<string, string[]> };
  };
  return {
    intraday: {
      drawings: normalizeDrawings(data.intraday.drawings),
      indicators: data.intraday.indicators ?? {},
    },
    higher: {
      drawings: normalizeDrawings(data.higher.drawings),
      indicators: data.higher.indicators ?? {},
    },
  };
}

export async function putChartLibraryEntry(
  ticker: string,
  bucket: ChartBucket,
  entry: ChartLibraryEntry,
): Promise<void> {
  await fetch(`/api/chart-drawings?ticker=${encodeURIComponent(ticker)}&bucket=${bucket}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      drawings: entry.drawings,
      indicators: entry.indicators,
    }),
  });
  // Fire-and-forget for failures. Library writes are best-effort UX state,
  // not transactional. If we want toasts later we can add them at call sites.
}
```

The existing `useChartDrawings` reducer still works fine for in-memory state; we just won't rely on its localStorage path. Leave the localStorage block (lines 413–425) untouched — `BacktestChartGrid` passes `{ persist: false }` so it stays dormant.

### 4.2 Update `BacktestChartGrid.tsx` to use two controllers + DB-backed library

Replace lines 197–250 (the single `drawingScope`, single `useChartDrawings`, hydration effect, and chartState-change effect) with the following structure.

**4.2.a — Replace the single scope with two:**

```ts
const intradayScope = ticker ? `${ticker}:intraday` : 'empty:intraday';
const higherScope = ticker ? `${ticker}:higher` : 'empty:higher';
```

**4.2.b — Replace the single controller with two:**

```ts
const intradayController = useChartDrawings(intradayScope, activeDrawingTool, '#ffffff', 1, { persist: false });
const higherController = useChartDrawings(higherScope, activeDrawingTool, '#ffffff', 1, { persist: false });
```

`activeDrawingTool` is the single grid-level tool state; both controllers receive the same tool. The user clicks a slot to draw — whichever bucket that slot is in receives the events.

**4.2.c — Load library on mount (when not read-only):**

Replace the `useEffect` at lines 229–243 with TWO effects:

```ts
// Library hydration — only when editing (not read-only review).
useEffect(() => {
  if (isReadOnly) return;
  if (!ticker) return;

  let cancelled = false;
  void (async () => {
    const snapshot = await fetchChartLibrary(ticker);
    if (cancelled) return;
    intradayController.replaceAllDrawings(snapshot.intraday.drawings);
    higherController.replaceAllDrawings(snapshot.higher.drawings);
    setLibraryIndicators({
      intraday: snapshot.intraday.indicators,
      higher: snapshot.higher.indicators,
    });
  })();

  return () => { cancelled = true; };
}, [isReadOnly, ticker, intradayController.replaceAllDrawings, higherController.replaceAllDrawings]);

// Snapshot hydration — only when read-only review viewer.
useEffect(() => {
  if (!isReadOnly) return;
  if (hydratedChartStateRef.current === loadedChartState) return;
  hydratedChartStateRef.current = loadedChartState;

  const normalized = normalizeChartState(loadedChartState);
  intradayController.replaceAllDrawings(normalized.intraday.drawings);
  higherController.replaceAllDrawings(normalized.higher.drawings);
  setLibraryIndicators({
    intraday: normalized.intraday.indicators,
    higher: normalized.higher.indicators,
  });
}, [isReadOnly, loadedChartState, intradayController.replaceAllDrawings, higherController.replaceAllDrawings]);
```

Add a new state hook near the top of the component:

```ts
const [libraryIndicators, setLibraryIndicators] = useState<{
  intraday: Record<string, string[]>;
  higher: Record<string, string[]>;
}>({ intraday: {}, higher: {} });
```

**4.2.d — Add a normalizer that handles both old + new shape:**

At the top of the file (above the component, with the other helpers), add:

```ts
function normalizeChartState(loaded: BacktestChartState | null): {
  intraday: { drawings: Drawing[]; indicators: Record<string, string[]> };
  higher: { drawings: Drawing[]; indicators: Record<string, string[]> };
} {
  const empty = { drawings: [] as Drawing[], indicators: {} as Record<string, string[]> };
  if (!loaded) return { intraday: { ...empty }, higher: { ...empty } };

  // Legacy flat shape: drawings: Drawing[], indicators: Record<SlotId, IndicatorKey[]>
  if (Array.isArray(loaded.drawings)) {
    return {
      intraday: {
        drawings: normalizeDrawings(loaded.drawings),
        indicators: (loaded.indicators as Record<string, string[]>) ?? {},
      },
      higher: { ...empty },
    };
  }

  // New bucketed shape.
  const drawings = (loaded.drawings ?? {}) as { intraday?: unknown[]; higher?: unknown[] };
  const indicators = (loaded.indicators ?? {}) as {
    intraday?: Record<string, string[]>;
    higher?: Record<string, string[]>;
  };
  return {
    intraday: {
      drawings: normalizeDrawings(drawings.intraday ?? []),
      indicators: indicators.intraday ?? {},
    },
    higher: {
      drawings: normalizeDrawings(drawings.higher ?? []),
      indicators: indicators.higher ?? {},
    },
  };
}
```

You'll need `Drawing` from `@/hooks/use-chart-drawings` in the imports.

**4.2.e — Persist drawings on user-completed events:**

We do NOT debounce on every drawing-state change. Instead, hook into the reducer's discrete completion events. The simplest insertion point is a `useEffect` that watches `drawings` arrays and PUTs after they stabilize — but because `useChartDrawings` already batches mid-drag updates internally and only commits to `drawings` on `finishDrawing` / `addCompletedDrawing` / `removeDrawing` / `clearAllDrawings` / `updateTextDrawing` / `updateDrawingEndpoint`, watching `drawings` is equivalent to watching completion events.

Add this effect after the hydration effects:

```ts
const hasHydratedLibraryRef = useRef(false);

useEffect(() => {
  if (isReadOnly) return;
  if (!ticker) return;
  if (!hasHydratedLibraryRef.current) return; // skip the initial hydrate's commit

  void putChartLibraryEntry(ticker, 'intraday', {
    drawings: intradayController.drawings,
    indicators: bucketedIndicators.intraday,
  });
}, [isReadOnly, ticker, intradayController.drawings, bucketedIndicators.intraday]);

useEffect(() => {
  if (isReadOnly) return;
  if (!ticker) return;
  if (!hasHydratedLibraryRef.current) return;

  void putChartLibraryEntry(ticker, 'higher', {
    drawings: higherController.drawings,
    indicators: bucketedIndicators.higher,
  });
}, [isReadOnly, ticker, higherController.drawings, bucketedIndicators.higher]);
```

Where `bucketedIndicators` is derived (see 4.2.f). Set `hasHydratedLibraryRef.current = true` at the END of the library-hydration effect (4.2.c) once `replaceAllDrawings` has run.

To prevent persisting during the initial hydration's `replaceAllDrawings` cascade, the `hasHydratedLibraryRef` guard skips the first effect run. When the user switches ticker, reset it to `false` in a `useEffect` keyed on `ticker`.

**4.2.f — Bucket the per-slot indicators:**

Indicators are stored per slot (existing `indicatorsBySlot`), but we now scope them to a bucket. Compute the per-bucket indicators by grouping slots by their current timeframe:

```ts
const bucketedIndicators = useMemo(() => {
  const intraday: Record<string, string[]> = {};
  const higher: Record<string, string[]> = {};
  for (const slotId of KNOWN_SLOT_IDS) {
    const timeframe = currentGridState.timeframesBySlot[slotId];
    const list = currentGridState.indicatorsBySlot[slotId] ?? [];
    if (BACKTEST_FRAME_CONFIG[timeframe].intraday) {
      intraday[slotId] = list;
    } else {
      higher[slotId] = list;
    }
  }
  return { intraday, higher };
}, [currentGridState.indicatorsBySlot, currentGridState.timeframesBySlot]);
```

**4.2.g — Seed slot indicators from library on hydrate:**

In the library-hydration effect, after `replaceAllDrawings`, also reset `indicatorsBySlot` from the library:

```ts
setGridState((prev) => {
  const nextIndicators = { ...prev.indicatorsBySlot };
  for (const slotId of KNOWN_SLOT_IDS) {
    const timeframe = prev.timeframesBySlot[slotId];
    const bucket = BACKTEST_FRAME_CONFIG[timeframe].intraday ? 'intraday' : 'higher';
    const fromLibrary = bucket === 'intraday'
      ? snapshot.intraday.indicators[slotId]
      : snapshot.higher.indicators[slotId];
    nextIndicators[slotId] = (fromLibrary && fromLibrary.every(isIndicatorKey))
      ? fromLibrary as IndicatorKey[]
      : getDefaultIndicators(timeframe);
  }
  return { ...prev, indicatorsBySlot: nextIndicators };
});
```

Do the same in the snapshot-hydration effect, using `normalized.intraday.indicators` / `normalized.higher.indicators`.

**4.2.h — Slot timeframe-switch behavior:**

In `setSlotTimeframe` (line ~278), **do not** force `activeDrawingTool` to null when switching to a non-intraday timeframe — both buckets can draw now. Also, when switching to a new timeframe, look up the slot's saved indicators for that bucket from the library; fall back to defaults if absent:

```ts
const setSlotTimeframe = (slotId: ChartSlotId, timeframe: BacktestTimeframeKey) => {
  const bucket = BACKTEST_FRAME_CONFIG[timeframe].intraday ? 'intraday' : 'higher';
  const savedForSlot = bucket === 'intraday'
    ? libraryIndicators.intraday[slotId]
    : libraryIndicators.higher[slotId];
  const indicators = (savedForSlot && savedForSlot.every(isIndicatorKey))
    ? savedForSlot as IndicatorKey[]
    : getDefaultIndicators(timeframe);

  setGridState({
    ...currentGridState,
    activeDrawingTool: currentGridState.activeDrawingTool,
    timeframesBySlot: {
      ...currentGridState.timeframesBySlot,
      [slotId]: timeframe,
    },
    indicatorsBySlot: {
      ...currentGridState.indicatorsBySlot,
      [slotId]: indicators,
    },
  });
};
```

**4.2.i — Route each slot to its bucket controller:**

In the `DEFAULT_CELLS.map` block (lines 328–358), replace:

```ts
drawingsController={isIntradayDrawingChart ? drawingsController : null}
activeDrawingTool={isIntradayDrawingChart ? activeDrawingTool : null}
onDrawingToolChange={isIntradayDrawingChart ? setActiveDrawingTool : undefined}
```

with:

```ts
drawingsController={isIntradayDrawingChart ? intradayController : higherController}
activeDrawingTool={activeDrawingTool}
onDrawingToolChange={setActiveDrawingTool}
```

(`isIntradayDrawingChart` retains its current definition: `BACKTEST_FRAME_CONFIG[timeframe].intraday`.)

**4.2.j — Update the chartState-change effect for snapshot save:**

Replace lines 245–250 with a single effect that builds the new bucketed shape:

```ts
useEffect(() => {
  onChartStateChange?.({
    drawings: {
      intraday: intradayController.drawings,
      higher: higherController.drawings,
    },
    indicators: bucketedIndicators,
  });
}, [intradayController.drawings, higherController.drawings, bucketedIndicators, onChartStateChange]);
```

This now matches the new `BacktestChartState` shape (see Step 5).

### 4.3 Drop the intraday gate in `BacktestChart.tsx`

At line 424, change:

```ts
const canDraw = frame.intraday && drawingsController != null && onDrawingToolChange != null;
```

to:

```ts
const canDraw = drawingsController != null && onDrawingToolChange != null;
```

This is the only edit in this file. Daily/Weekly/Monthly slots will now mount the `<ChartDrawings>` overlay because their controllers are no longer `null`.

### 4.4 Update `BacktestChartState` type in `lib/types.ts`

Replace lines 92–95 with:

```ts
export interface BacktestChartState {
  // Two readable shapes:
  //   Legacy flat: { drawings: Drawing[], indicators: Record<SlotId, string[]> }
  //   New bucketed: { drawings: { intraday, higher }, indicators: { intraday, higher } }
  // `normalizeChartState` in BacktestChartGrid handles coercion on read.
  // Writers (snapshot save) always emit the bucketed shape.
  drawings?: unknown[] | {
    intraday?: unknown[];
    higher?: unknown[];
  };
  indicators?: Record<string, string[]> | {
    intraday?: Record<string, string[]>;
    higher?: Record<string, string[]>;
  };
}
```

---

## Step 5 — Review-save flow

The existing `saveReview` call in `hooks/use-backtest-session.ts:381` posts whatever `chartState` is passed. With Step 4.2.j, the grid's `onChartStateChange` now produces the bucketed shape automatically. `BacktestingTab.tsx:483` already passes `handleChartStateChange` through; verify that `handleChartStateChange` simply stores the latest state and passes it into `saveReview`. **No edits needed in `use-backtest-session.ts` or the review API route** — they're shape-agnostic.

Verify in `BacktestingTab.tsx` that `handleChartStateChange` is doing the right thing — search the file for it and read 30 lines of context. If it does anything other than `setLatestChartState(state)`-style assignment, stop and flag.

---

## Step 6 — Test updates

### 6.1 Update existing tests to the new shape

| File | Change |
|---|---|
| `__tests__/backtest-sessions-route.test.ts:264` | Replace `chartState: { drawings: [{...}], indicators: { primary: ['VWAP'] } }` with the bucketed form: `chartState: { drawings: { intraday: [{...}], higher: [] }, indicators: { intraday: { primary: ['VWAP'] }, higher: {} } }`. Update the matching expectation at line 274. |
| `__tests__/backtesting-tab.test.tsx:313` | Bucket the `chartState` payload similarly. |
| `__tests__/backtest-validation.test.ts:19,31` | Add coverage for BOTH shapes: keep an existing legacy-shape test as-is (it should still pass since schema accepts it), add a new test asserting the bucketed shape also passes Zod. |

### 6.2 Add a new test for the API route

Create `__tests__/chart-drawings-route.test.ts` following the pattern of `__tests__/backtest-sessions-route.test.ts`. Cover:
- `GET /api/chart-drawings?ticker=SNDK` returns empty buckets when no rows exist.
- `PUT` then `GET` round-trips the payload.
- `PUT` upserts (second PUT with same `(user, ticker, bucket)` replaces, doesn't error on duplicate PK).
- `requireUser()` returns 401 when no session (use the existing auth-mock pattern from the sessions-route test).
- Ticker is uppercased in the response.

### 6.3 Add a back-compat normalizer test

Create `__tests__/chart-state-normalize.test.ts` (or co-locate in an existing file if there's a natural spot). Cover:
- Legacy `{ drawings: [...], indicators: { primary: [...] } }` → normalized into `intraday` bucket, `higher` empty.
- New `{ drawings: { intraday, higher }, indicators: { intraday, higher } }` → passes through.
- `null` input → empty buckets.
- Malformed drawing entries are filtered (existing `normalizeDrawings` behavior).

---

## Step 7 — Validation gates

Run from repo root, in order:

```bash
npm run lint
npx tsc --noEmit
npm run typecheck:services    # only if services/ was touched (it shouldn't be in this spec)
npm test
```

All four must pass. If `npm test` shows pre-existing failures unrelated to this change, capture them in the validation notes — do not chase them in this PR.

If any workflow assets under `AGENTS.md`, `HANDOFF.md`, `.claude/`, `.opencode/`, or `codex-skills/` changed (just `HANDOFF.md` in this spec), also run:

```bash
npm run workflow:audit
```

---

## Step 8 — Manual smoke

After validation, verify these UX paths in `npm run dev` (Charts mode + Backtest):

1. **Charts mode (no backtest):**
   - Pick SNDK, switch a slot to 1D, draw a horizontal line. Reload the page. Line is still there.
   - Switch the same slot to 5m. Draw a trendline on 5m. Switch back to 1D. The horizontal line is still there; the trendline is NOT (it's in the intraday bucket).
   - Switch to a different ticker. Drawings are different (or empty).
   - Switch back to SNDK. Drawings come back.

2. **Active backtest session:**
   - Start a new backtest on SNDK anchored to 2026-05-15. The Charts-mode SNDK lines are visible.
   - Draw a new line. End the session via "Save Review."

3. **Saved review viewer:**
   - Open the just-saved review. The drawings are visible.
   - Try to draw — tools should be inert (read-only).
   - Open a teammate's review of a different ticker. You see their snapshot, not your library.

4. **Toggle an indicator:**
   - Add EMA20 to a 5m slot. Reload. EMA20 is still on that slot.

5. **Clear all drawings:**
   - Use the Clear button. Reload. Drawings stay cleared.

If any of these fails, do not mark the spec complete. Triage and fix before reporting.

---

## Acceptance criteria

- New `chart_drawings` table exists in the DB; `npm run db:migrate` applied cleanly.
- `app/api/chart-drawings/route.ts` GET/PUT pass auth, validation, and roundtrip tests.
- `BacktestChartGrid.tsx` uses two bucket-keyed controllers; drawings persist across navigation and reload for both intraday and higher buckets, scoped by `(user, ticker)`.
- `BacktestChart.tsx:424` no longer gates draw on `frame.intraday`. Daily+ slots can draw.
- Saved reviews remain read-only for drawings and render from `chartState` snapshot.
- Old (pre-migration) saved reviews still render — back-compat normalizer covers the legacy flat shape.
- All four validation commands pass. Manual smoke (Step 8) passes.

---

## Notes for Codex

- **Per CLAUDE.md / memory:** Never `db:push`. Use `db:migrate`. Never read/grep/source `.env*` files — if env state is in question, ask the user to inspect.
- **All new routes use `requireUser()`** per the route auth rules in `.claude/CLAUDE.md`.
- **Zod v4 errors** use `z.flattenError(...)` per the same.
- This is a refactor that touches files used by Charts, Backtest Sim, and Saved Review surfaces. If a test surfaces an unexpected coupling (e.g., a chartState reader I missed), stop and flag — don't paper over.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Open Follow-Ups

- **Offerings extractors fresh-ticker smoke check**: the 2026-05-19 offerings broadening shipped, but the WNW manual smoke was inconclusive because the Research snapshot was cached. Next time Research is opened on a fresh ADS / FPI ticker whose `askedgar_cache` row has expired or does not exist, confirm Shares / Price / Amount populate for at least one priced row in Past Offerings. If every value is `--`, capture the filing URL from the row's SEC link and open a follow-up spec for the missing phrasing variant.
