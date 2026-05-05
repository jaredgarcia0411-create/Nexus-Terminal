# Nexus Terminal — HANDOFF.md

> Updated: 2026-05-05
> Purpose: active execution spec plus compact recent context. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

> Generated: 2026-05-05 | Agent: Claude (`nexus-handoff`)
> Status: IMPLEMENTED — final validation passed 2026-05-05

# Build Spec — MDR Scanner Expansion

Goal: stop missing MDR-eligible names. Currently both Day 1 and MDR tables on the dashboard consume the same `/api/tradingview/gainers` feed, which filters on `premarket_change > 20%`. A name that meets the Python `d2_mdr` criteria (the canonical reference at `/mnt/c/Users/jared/Downloads/mdr swing scan.py:493`) but doesn't have a 20% PM gap never reaches the eligibility check. This spec splits the feeds, adds a dedicated MDR TV scan, persists triggers in a new DB table populated by a nightly cron, and surfaces names for 20 trading days from their trigger date with a -10% red-day invalidation.

## Codex Constraints (read first)

- **DB safety:** This adds a new table. Run `npm run db:migrate` (the safe wrapper) — never `db:push`. Generate the SQL with `npx drizzle-kit generate`, inspect the file, then migrate.
- **Order:** Steps 1 and 2 are independent and can be done in any order. Step 3 must finish before Step 4. Step 4 must finish before Steps 5 and 6. Step 7 depends on Steps 2 and 6.
- **Validate after every step:** `npm run lint && npx tsc --noEmit`. Fix breakage before moving on.
- **Final validation:** `npm run lint && npx tsc --noEmit && npm run typecheck:services && npm test`. All must exit 0.
- **Auth:** cron route uses `requireCronSecret(request)`. User-facing routes use `requireUser()`.
- **No new ESLint disables.** Refactor instead of suppressing.
- **No new abstractions** beyond what this spec specifies.

---

## Step 1 — Tighten Day 1 gainers feed (volume floor)

**File:** `app/api/tradingview/gainers/route.ts`
**Action:** MODIFY

Goal: add a 2M volume floor so D1 stops showing trash-volume gappers.

Instructions:

1. In `SCAN_BODY.filter` (lines 28-32), insert one new filter entry between the `premarket_change` filter and the `exchange` filter so the array reads:
   ```ts
   filter: [
     { left: 'close', operation: 'egreater', right: 0.9 },
     { left: 'premarket_change', operation: 'greater', right: 20 },
     { left: 'volume', operation: 'egreater', right: 2_000_000 },
     { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE'] },
   ],
   ```

**Why:** TV's `volume` column is session-dependent (regular hours = today's accumulating regular vol, PM/closed = yesterday's regular vol). During pre-market the 2M floor effectively gates on "had ≥ 2M shares yesterday," which removes illiquid PM gappers without affecting the rest of the feed.

**Acceptance criteria:**
- [ ] `SCAN_BODY.filter` array has 4 entries in the order shown above.
- [ ] No other behavior in this route changes.
- [ ] `npm run lint && npx tsc --noEmit` pass.

---

## Step 2 — New live MDR-candidates TV scan

**File:** `app/api/tradingview/mdr-candidates/route.ts`
**Action:** CREATE

Goal: a separate TV scanner call dedicated to the MDR criteria (mirrors the Python `d2_mdr` precondition stack: `close >= $1`, `volume >= 10M`, `change >= 20%`). Top 100 results sorted by regular-session change desc.

Instructions:

1. Create the file with this exact content (modeled on `app/api/tradingview/gainers/route.ts`):

   ```ts
   import { internalServerError, logRouteError } from '@/lib/api-route-utils';
   import { requireUser } from '@/lib/server-db-utils';

   export const dynamic = 'force-dynamic';

   const COLUMNS = [
     'name',
     'close',
     'change',
     'volume',
     'average_volume_90d_calc',
     'market_cap_basic',
     'sector',
     'premarket_close',
     'premarket_change',
     'premarket_volume',
   ];

   // MDR-aligned filter set — mirrors the Python d2_mdr precondition stack
   // (close >= $1, vol >= 10M, regular-session change >= 20%) so anything
   // passing the Python scan also passes this gate.
   const SCAN_BODY = {
     columns: COLUMNS,
     filter: [
       { left: 'close', operation: 'egreater', right: 1 },
       { left: 'volume', operation: 'egreater', right: 10_000_000 },
       { left: 'change', operation: 'egreater', right: 20 },
       { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE'] },
     ],
     sort: { sortBy: 'change', sortOrder: 'desc' },
     range: [0, 100],
   };

   export interface MdrCandidate {
     ticker: string;
     price: number;
     change: number;
     volume: number;
     avgVolume90d: number | null;
     marketCap: number | null;
     sector: string | null;
     preMarketPrice: number | null;
     preMarketChange: number | null;
     preMarketVolume: number | null;
   }

   export async function GET() {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';

     try {
       const response = await fetch('https://scanner.tradingview.com/america/scan', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           ...(sessionId ? { Cookie: `sessionid=${sessionId}` } : {}),
           'User-Agent': 'Mozilla/5.0',
           Origin: 'https://www.tradingview.com',
           Referer: 'https://www.tradingview.com/',
         },
         body: JSON.stringify(SCAN_BODY),
         cache: 'no-store',
       });

       if (!response.ok) {
         return Response.json(
           { error: `TradingView scanner returned ${response.status}` },
           { status: 502 },
         );
       }

       const payload = (await response.json()) as {
         totalCount?: number;
         data?: Array<{ s: string; d: unknown[] }>;
       };

       const raw = payload.data ?? [];

       const candidates: MdrCandidate[] = raw.flatMap((row) => {
         const ticker = (row.s ?? '').split(':')[1];
         if (!ticker) return [];

         const d = row.d;
         const price = Number(d[1]);
         const change = Number(d[2]);
         const volume = Number(d[3]);
         if (!Number.isFinite(price) || !Number.isFinite(change) || !Number.isFinite(volume)) return [];

         const toNum = (idx: number) =>
           d[idx] != null && Number.isFinite(Number(d[idx])) ? Number(d[idx]) : null;

         return [{
           ticker,
           price,
           change,
           volume,
           avgVolume90d: toNum(4),
           marketCap: toNum(5),
           sector: typeof d[6] === 'string' && d[6].trim() ? d[6].trim() : null,
           preMarketPrice: toNum(7),
           preMarketChange: toNum(8),
           preMarketVolume: toNum(9),
         }];
       });

       return Response.json({
         candidates,
         count: candidates.length,
         totalCount: payload.totalCount ?? candidates.length,
         isRealtime: Boolean(sessionId),
         fetchedAt: new Date().toISOString(),
       });
     } catch (error) {
       logRouteError('tradingview-mdr-candidates', error);
       return internalServerError();
     }
   }
   ```

2. The response key is `candidates` (not `gainers`) so the two endpoints stay distinguishable in network logs.

**Acceptance criteria:**
- [ ] `GET /api/tradingview/mdr-candidates` returns `{ candidates: MdrCandidate[], count, totalCount, isRealtime, fetchedAt }` for an authenticated user.
- [ ] Returns the same auth response shape as `mdr-eligibility/route.ts` for unauthenticated requests.
- [ ] Filter order: `close > 1`, `volume > 10M`, `change > 20`, `exchange in NASDAQ/NYSE`.
- [ ] Sort by `change` desc; range `[0, 100]`.
- [ ] `npm run lint && npx tsc --noEmit` pass.

---

## Step 3 — `mdr_triggers` Drizzle table + migration

**File:** `lib/db/schema.ts`
**Action:** MODIFY

Goal: add a shared table to record MDR trigger events from the nightly cron.

Instructions:

1. Append the following table definition to the bottom of `lib/db/schema.ts` (after `backtestActions` at line 522-541):

   ```ts
   // MDR scanner triggers — one row per ticker per trigger date.
   // Populated by the nightly cron (/api/cron/mdr-sweep) and read by
   // /api/scanner/mdr-recent. Shared across all users; no userId.
   //
   // invalidated_at is set by the cron when a single -10% red day fires
   // after the trigger date. The dashboard filters out invalidated rows.
   //
   // PK is (ticker, trigger_date) so a ticker that re-triggers on a later
   // day gets a new row.
   export const mdrTriggers = pgTable('mdr_triggers', {
     ticker: text('ticker').notNull(),
     triggerDate: date('trigger_date').notNull(),
     triggerClose: doublePrecision('trigger_close').notNull(),
     payload: jsonb('payload').notNull(),
     invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
   }, (t) => [
     primaryKey({ columns: [t.ticker, t.triggerDate] }),
     index('mdr_triggers_trigger_date_idx').on(t.triggerDate),
     index('mdr_triggers_active_idx').on(t.invalidatedAt, t.triggerDate),
   ]);
   ```

   Notes:
   - `triggerClose` is the close price on the trigger day (kept for diagnostics).
   - `payload` jsonb stores `{ open, high, low, close, volume, priorHigh20, priorLow20, priorBigDayDate }` from the trigger evaluation.
   - The invalidation rule is `today.close / prev.close - 1 <= -0.10` (single -10% red day vs. the **immediately-preceding** bar — NOT vs. trigger close).

2. Generate the migration:
   ```bash
   npx drizzle-kit generate
   ```
   This creates a new file in `drizzle/` (e.g., `0029_*.sql`). Open it and confirm it ONLY creates `mdr_triggers` with the primary key + two indexes. **If drizzle-kit emits any DDL for existing tables, stop and ask.**

3. Apply:
   ```bash
   npm run db:migrate
   ```

**Acceptance criteria:**
- [ ] `mdrTriggers` is exported from `lib/db/schema.ts`.
- [ ] A new file `drizzle/00XX_*.sql` exists creating `mdr_triggers`, primary key, and both indexes — and nothing else.
- [ ] `npm run db:migrate` exits 0.
- [ ] `npm run lint && npx tsc --noEmit` pass.

---

## Step 4 — Massive grouped-aggs helper + d2_mdr evaluator

**File:** `lib/massive-market.ts`
**Action:** MODIFY

Goal: add three exported helpers — (a) grouped-daily fetch, (b) full d2_mdr evaluator, (c) -10% invalidation predicate.

Instructions:

1. Append the following block at the bottom of `lib/massive-market.ts` (after `computeMdrEligibility` ends at line 399):

   ```ts
   // ============================================================
   // MDR cron helpers
   // ============================================================

   export interface GroupedDailyBar {
     ticker: string;
     open: number;
     high: number;
     low: number;
     close: number;
     volume: number;
     vwap: number | null;
     timestamp: number;
   }

   /**
    * Pull every US stock's daily bar for `date` from Massive's grouped
    * aggregates endpoint. Returns [] for non-trading days (Massive returns
    * no results for weekends/holidays).
    */
   export async function fetchGroupedDailyAggregates(date: string): Promise<GroupedDailyBar[]> {
     const response = await fetchMassiveJson<{
       results?: Array<{
         T?: string;
         o?: number | null;
         h?: number | null;
         l?: number | null;
         c?: number | null;
         v?: number | null;
         vw?: number | null;
         t?: number | null;
       }>;
     }>(
       `/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(date)}`,
       { adjusted: 'true' },
     );

     return (response.results ?? []).flatMap((bar) => {
       const ticker = (bar.T ?? '').trim().toUpperCase();
       const open = Number(bar.o ?? NaN);
       const high = Number(bar.h ?? NaN);
       const low = Number(bar.l ?? NaN);
       const close = Number(bar.c ?? NaN);
       const volume = Number(bar.v ?? NaN);
       if (!ticker) return [];
       if (![open, high, low, close, volume].every(Number.isFinite)) return [];

       return [{
         ticker,
         open,
         high,
         low,
         close,
         volume,
         vwap: Number.isFinite(Number(bar.vw)) ? Number(bar.vw) : null,
         timestamp: Number(bar.t ?? 0),
       }];
     });
   }

   export interface D2MdrTriggerResult {
     triggered: boolean;
     reason?: string;
     priorHigh20: number | null;
     priorLow20: number | null;
     priorBigDayDate: string | null;
   }

   /**
    * Full d2_mdr evaluator. Mirrors the Python at
    * /mnt/c/Users/jared/Downloads/mdr swing scan.py:493.
    *
    * `priorBars` MUST be oldest-first and contain at least 20 bars. The
    * 20-day lookback uses the most-recent 20 bars in `priorBars`. The
    * "prior big day" search walks the same 20-day window and requires
    * each candidate bar to have a predecessor (so it can compare highs).
    *
    * All conditions must pass for `triggered: true`:
    *   1. (today.close / prevClose - 1) >= 0.20
    *   2. today.close >= 1
    *   3. today.volume >= 10_000_000
    *   4. today.high > prevHigh
    *   5. today.close > today.open
    *   6. today.high > max(20 prior highs)
    *   7. (today.high / min(20 prior lows)) - 1 >= 3
    *   8. there exists a "prior big day" in the last 20 prior bars where:
    *      change >= 20% AND dollar_vol >= $100M AND close > open AND high > prev.high
    */
   export function evaluateD2MdrTrigger(
     today: GroupedDailyBar,
     priorBars: GroupedDailyBar[],
   ): D2MdrTriggerResult {
     if (priorBars.length < 20) {
       return { triggered: false, reason: 'insufficient_history', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
     }

     const lookback = priorBars.slice(-20);
     const lastPrior = lookback[lookback.length - 1];

     const changePct = today.close / lastPrior.close - 1;
     if (changePct < 0.2) return { triggered: false, reason: 'change_below_20pct', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
     if (today.close < 1) return { triggered: false, reason: 'close_below_1', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
     if (today.volume < 10_000_000) return { triggered: false, reason: 'volume_below_10m', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
     if (today.high <= lastPrior.high) return { triggered: false, reason: 'did_not_break_prior_high', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
     if (today.close <= today.open) return { triggered: false, reason: 'not_green', priorHigh20: null, priorLow20: null, priorBigDayDate: null };

     const priorHigh20 = Math.max(...lookback.map((b) => b.high));
     const priorLow20 = Math.min(...lookback.map((b) => b.low));
     if (today.high <= priorHigh20) return { triggered: false, reason: 'not_new_20d_high', priorHigh20, priorLow20, priorBigDayDate: null };
     if (priorLow20 <= 0) return { triggered: false, reason: 'invalid_prior_low', priorHigh20, priorLow20, priorBigDayDate: null };
     if (today.high / priorLow20 - 1 < 3) return { triggered: false, reason: 'not_up_3x_from_base', priorHigh20, priorLow20, priorBigDayDate: null };

     // Prior big day: walk the last 20 prior bars; each candidate needs a
     // predecessor (priorBars[i-1]) for the prevHigh comparison.
     let priorBigDayDate: string | null = null;
     const lookbackStartIdx = priorBars.length - 20;
     for (let i = lookbackStartIdx; i < priorBars.length; i += 1) {
       const bar = priorBars[i];
       const prev = priorBars[i - 1];
       if (!prev) continue;
       const bigChange = bar.close / prev.close - 1;
       const dollarVol = bar.close * bar.volume;
       const isGreen = bar.close > bar.open;
       const brokeHigh = bar.high > prev.high;
       if (bigChange >= 0.2 && dollarVol >= 100_000_000 && isGreen && brokeHigh) {
         priorBigDayDate = bar.timestamp > 0
           ? new Date(bar.timestamp).toISOString().split('T')[0]!
           : null;
         break;
       }
     }
     if (priorBigDayDate === null) return { triggered: false, reason: 'no_prior_big_day', priorHigh20, priorLow20, priorBigDayDate: null };

     return { triggered: true, priorHigh20, priorLow20, priorBigDayDate };
   }

   /** True if today.close <= 0.90 * prev.close (single -10% red day). */
   export function isInvalidationDay(today: GroupedDailyBar, prev: GroupedDailyBar): boolean {
     if (prev.close <= 0) return false;
     return today.close / prev.close - 1 <= -0.10;
   }
   ```

2. **No changes** to existing functions in this file.

**Acceptance criteria:**
- [ ] `fetchGroupedDailyAggregates`, `evaluateD2MdrTrigger`, `isInvalidationDay`, `GroupedDailyBar`, `D2MdrTriggerResult` are all exported.
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] No edits to existing functions in `lib/massive-market.ts`.

---

## Step 5 — Nightly cron + backfill mode

**File:** `app/api/cron/mdr-sweep/route.ts`
**Action:** CREATE

Goal: nightly route that walks one or more trading days back, evaluates `d2_mdr` per ticker, writes triggers, and runs the -10% red-day invalidation pass on non-invalidated rows. `?days=N` enables backfill (Codex defaults to N=1 for nightly; the user runs `?days=20` once at deploy to seed history).

Instructions:

1. Create the file with:

   ```ts
   import { and, eq, gte, isNull } from 'drizzle-orm';
   import { logRouteError } from '@/lib/api-route-utils';
   import { getDb } from '@/lib/db';
   import { mdrTriggers } from '@/lib/db/schema';
   import {
     fetchDailyAggregates,
     fetchGroupedDailyAggregates,
     evaluateD2MdrTrigger,
     isInvalidationDay,
     type GroupedDailyBar,
   } from '@/lib/massive-market';
   import { dbUnavailable, requireCronSecret } from '@/lib/server-db-utils';

   export const dynamic = 'force-dynamic';
   export const maxDuration = 300;
   export const runtime = 'nodejs';

   /**
    * GET /api/cron/mdr-sweep
    *
    * Nightly cron — evaluates yesterday's grouped daily bars against the
    * d2_mdr criteria, writes triggers to mdr_triggers, and runs the -10%
    * red-day invalidation pass on non-invalidated rows.
    *
    * Query params:
    *   - days (1..30, default 1): number of trading days back to evaluate.
    *     Pass `?days=20` once at deploy to backfill the lookback window.
    *
    * Authenticated via CRON_SECRET (Authorization: Bearer ...).
    */
   export async function GET(request: Request) {
     const authError = requireCronSecret(request);
     if (authError) return authError;

     const db = getDb();
     if (!db) return dbUnavailable();

     const url = new URL(request.url);
     const daysParam = Number(url.searchParams.get('days') ?? '1');
     const days = Number.isFinite(daysParam) && daysParam >= 1 && daysParam <= 30
       ? Math.floor(daysParam)
       : 1;

     const summary = {
       evaluatedDates: [] as string[],
       triggersInserted: 0,
       invalidationsApplied: 0,
       skippedNonTradingDays: 0,
       errors: [] as Array<{ stage: string; message: string }>,
     };

     // Walk back from yesterday in calendar order. `days * 2` calendar days
     // is more than enough to cover N trading days even with weekends and
     // holidays interleaved.
     const calendarDates = collectCalendarDates(days * 2 + 5);

     let tradingDaysEvaluated = 0;
     for (const dateStr of calendarDates) {
       if (tradingDaysEvaluated >= days) break;
       try {
         const inserted = await sweepOneDay(db, dateStr, summary);
         if (inserted === null) {
           summary.skippedNonTradingDays += 1;
           continue;
         }
         summary.evaluatedDates.push(dateStr);
         summary.triggersInserted += inserted;
         tradingDaysEvaluated += 1;
       } catch (error) {
         summary.errors.push({
           stage: `sweep:${dateStr}`,
           message: error instanceof Error ? error.message : String(error),
         });
         logRouteError(`mdr-sweep:${dateStr}`, error);
       }
     }

     try {
       summary.invalidationsApplied = await applyInvalidations(db);
     } catch (error) {
       summary.errors.push({
         stage: 'invalidation',
         message: error instanceof Error ? error.message : String(error),
       });
       logRouteError('mdr-sweep:invalidation', error);
     }

     return Response.json(summary);
   }

   /** Calendar dates yesterday-back, most-recent-first, as YYYY-MM-DD. */
   function collectCalendarDates(maxDays: number): string[] {
     const out: string[] = [];
     const yesterdayMs = nyMidnightMs() - 24 * 60 * 60 * 1000;
     for (let i = 0; i < maxDays; i += 1) {
       const ts = yesterdayMs - i * 24 * 60 * 60 * 1000;
       out.push(new Date(ts).toISOString().split('T')[0]!);
     }
     return out;
   }

   /** Midnight today in America/New_York, as ms-since-epoch. */
   function nyMidnightMs(): number {
     const fmt = new Intl.DateTimeFormat('en-CA', {
       timeZone: 'America/New_York',
       year: 'numeric', month: '2-digit', day: '2-digit',
     });
     const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
     return Date.UTC(y!, (m! - 1), d!);
   }

   /**
    * Runs the d2_mdr sweep for one date. Returns the number of triggers
    * inserted, or null if `dateStr` was a non-trading day (grouped agg
    * empty).
    */
   async function sweepOneDay(
     db: NonNullable<ReturnType<typeof getDb>>,
     dateStr: string,
     summary: { errors: Array<{ stage: string; message: string }> },
   ): Promise<number | null> {
     const grouped = await fetchGroupedDailyAggregates(dateStr);
     if (grouped.length === 0) return null;

     // Pre-filter so we only fetch history for ~50-200 candidates instead
     // of all 7000+ stocks. The single-bar conditions evaluable from
     // grouped aggs alone:
     const candidates = grouped.filter((bar) =>
       bar.close >= 1
       && bar.volume >= 10_000_000
       && bar.close * bar.volume >= 20_000_000
       && bar.close > bar.open
     );

     let inserted = 0;
     for (const candidate of candidates) {
       try {
         // fetchDailyAggregates returns the most recent N bars ending today
         // (in the API's clock). Filter to bars on or before `dateStr` so
         // the as-of evaluation works for backfill.
         const history = await fetchDailyAggregates(candidate.ticker, 30);
         const historyAsOf = history.filter((b) => b.date <= dateStr);
         if (historyAsOf.length < 21) continue;

         const todayBarIdx = historyAsOf.findIndex((b) => b.date === dateStr);
         if (todayBarIdx < 20) continue;

         const todayHistoric = historyAsOf[todayBarIdx];
         const priorBars: GroupedDailyBar[] = historyAsOf.slice(0, todayBarIdx).map((b) => ({
           ticker: candidate.ticker,
           open: b.open, high: b.high, low: b.low, close: b.close,
           volume: b.volume, vwap: b.vwap, timestamp: 0,
         }));
         const todayBar: GroupedDailyBar = {
           ticker: candidate.ticker,
           open: todayHistoric.open, high: todayHistoric.high, low: todayHistoric.low,
           close: todayHistoric.close, volume: todayHistoric.volume, vwap: todayHistoric.vwap,
           timestamp: 0,
         };

         const result = evaluateD2MdrTrigger(todayBar, priorBars);
         if (!result.triggered) continue;

         await db.insert(mdrTriggers).values({
           ticker: candidate.ticker,
           triggerDate: dateStr,
           triggerClose: todayBar.close,
           payload: {
             open: todayBar.open,
             high: todayBar.high,
             low: todayBar.low,
             close: todayBar.close,
             volume: todayBar.volume,
             priorHigh20: result.priorHigh20,
             priorLow20: result.priorLow20,
             priorBigDayDate: result.priorBigDayDate,
           },
         }).onConflictDoNothing();

         inserted += 1;
       } catch (error) {
         summary.errors.push({
           stage: `sweep:${dateStr}:${candidate.ticker}`,
           message: error instanceof Error ? error.message : String(error),
         });
       }
     }

     return inserted;
   }

   /**
    * Walks every non-invalidated trigger row whose trigger_date is within
    * the last 25 calendar days. For each, fetches 30-day daily history and
    * checks if any post-trigger bar satisfies isInvalidationDay vs. its
    * predecessor. If yes, sets invalidatedAt on that row.
    */
   async function applyInvalidations(db: NonNullable<ReturnType<typeof getDb>>): Promise<number> {
     const cutoff = new Date(nyMidnightMs() - 25 * 24 * 60 * 60 * 1000)
       .toISOString().split('T')[0]!;

     const active = await db
       .select({ ticker: mdrTriggers.ticker, triggerDate: mdrTriggers.triggerDate })
       .from(mdrTriggers)
       .where(and(
         isNull(mdrTriggers.invalidatedAt),
         gte(mdrTriggers.triggerDate, cutoff),
       ));

     let invalidated = 0;
     for (const row of active) {
       try {
         const history = await fetchDailyAggregates(row.ticker, 30);
         const fromTrigger = history.filter((b) => b.date >= row.triggerDate);
         if (fromTrigger.length < 2) continue;

         let hit = false;
         for (let i = 1; i < fromTrigger.length; i += 1) {
           const prev = fromTrigger[i - 1];
           const today = fromTrigger[i];
           if (isInvalidationDay(
             { ticker: row.ticker, open: today.open, high: today.high, low: today.low, close: today.close, volume: today.volume, vwap: today.vwap, timestamp: 0 },
             { ticker: row.ticker, open: prev.open, high: prev.high, low: prev.low, close: prev.close, volume: prev.volume, vwap: prev.vwap, timestamp: 0 },
           )) {
             hit = true;
             break;
           }
         }
         if (!hit) continue;

         await db.update(mdrTriggers)
           .set({ invalidatedAt: new Date() })
           .where(and(
             eq(mdrTriggers.ticker, row.ticker),
             eq(mdrTriggers.triggerDate, row.triggerDate),
           ));
         invalidated += 1;
       } catch (error) {
         logRouteError(`mdr-sweep:invalidate:${row.ticker}`, error);
       }
     }

     return invalidated;
   }
   ```

2. **Add cron entry** in `vercel.json` — append to the `crons` array:
   ```json
   {
     "path": "/api/cron/mdr-sweep",
     "schedule": "0 22 * * 1-5"
   }
   ```
   `0 22 * * 1-5` = 22:00 UTC weekdays = 6pm EDT / 5pm EST. Always after market close in either DST mode.

3. **Backfill is a deploy-time op the user runs manually** — Codex does NOT run the backfill. Document in the commit message that after deploy, the user runs:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "$DEPLOY_URL/api/cron/mdr-sweep?days=20"
   ```

**Acceptance criteria:**
- [ ] `GET /api/cron/mdr-sweep` returns the `requireCronSecret` auth response without the auth header.
- [ ] With auth, default behavior evaluates the most recent trading day before today.
- [ ] `?days=20` walks 20 trading days backward, skipping non-trading days.
- [ ] Inserts use `.onConflictDoNothing()` so re-running for the same date is idempotent.
- [ ] Invalidation step runs after the sweep and returns a count.
- [ ] `vercel.json` has a new cron entry: `0 22 * * 1-5`.
- [ ] `npm run lint && npx tsc --noEmit && npm run typecheck:services` pass.

---

## Step 6 — User-facing read endpoint for recent triggers

**File:** `app/api/scanner/mdr-recent/route.ts`
**Action:** CREATE

Goal: dashboard reads the last ~20 trading days of non-invalidated triggers and gets live mark/PDC for each via Massive's unified snapshot.

Instructions:

1. Create the file with:

   ```ts
   import { and, gte, isNull, sql } from 'drizzle-orm';
   import { internalServerError, logRouteError } from '@/lib/api-route-utils';
   import { getDb } from '@/lib/db';
   import { mdrTriggers } from '@/lib/db/schema';
   import { fetchUnifiedSnapshot } from '@/lib/massive-market';
   import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

   export const dynamic = 'force-dynamic';

   export interface MdrRecentRow {
     ticker: string;
     triggerDate: string;
     triggerClose: number;
     mark: number | null;
     pdc: number | null;
     change: number | null;
     volume: number | null;
   }

   export async function GET() {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     const db = getDb();
     if (!db) return dbUnavailable();

     try {
       // Over-fetch by calendar days (28 ≈ 20 trading days). The query DB
       // index `mdr_triggers_active_idx` covers the (invalidated_at, trigger_date)
       // pair so this stays cheap even at 20+ rows.
       const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
         .toISOString().split('T')[0]!;
       const rows = await db
         .select({
           ticker: mdrTriggers.ticker,
           triggerDate: mdrTriggers.triggerDate,
           triggerClose: mdrTriggers.triggerClose,
         })
         .from(mdrTriggers)
         .where(and(
           gte(mdrTriggers.triggerDate, cutoff),
           isNull(mdrTriggers.invalidatedAt),
         ))
         .orderBy(sql`${mdrTriggers.triggerDate} desc`);

       const tickers = rows.map((r) => r.ticker);
       if (tickers.length === 0) {
         return Response.json({ rows: [] as MdrRecentRow[], fetchedAt: new Date().toISOString() });
       }

       // Massive unified snapshot supports up to 250 tickers per call.
       const snapshotByTicker = new Map<string, { mark: number | null; pdc: number | null; change: number | null; volume: number | null }>();
       for (let i = 0; i < tickers.length; i += 250) {
         const chunk = await fetchUnifiedSnapshot(tickers.slice(i, i + 250));
         for (const r of chunk.results ?? []) {
           if (!r.ticker) continue;
           const close = typeof r.session?.close === 'number' && Number.isFinite(r.session.close) ? r.session.close : null;
           const prev = typeof r.session?.previous_close === 'number' && Number.isFinite(r.session.previous_close) ? r.session.previous_close : null;
           const change = typeof r.session?.change_percent === 'number' && Number.isFinite(r.session.change_percent) ? r.session.change_percent : null;
           const volume = typeof r.session?.volume === 'number' && Number.isFinite(r.session.volume) ? r.session.volume : null;
           snapshotByTicker.set(r.ticker.toUpperCase(), { mark: close, pdc: prev, change, volume });
         }
       }

       const out: MdrRecentRow[] = rows.map((r) => {
         const snap = snapshotByTicker.get(r.ticker);
         return {
           ticker: r.ticker,
           triggerDate: r.triggerDate,
           triggerClose: r.triggerClose,
           mark: snap?.mark ?? null,
           pdc: snap?.pdc ?? null,
           change: snap?.change ?? null,
           volume: snap?.volume ?? null,
         };
       });

       return Response.json({ rows: out, fetchedAt: new Date().toISOString() });
     } catch (error) {
       logRouteError('scanner-mdr-recent', error);
       return internalServerError();
     }
   }
   ```

**Acceptance criteria:**
- [ ] `GET /api/scanner/mdr-recent` returns the standard auth response for unauthenticated requests.
- [ ] Returns `{ rows: MdrRecentRow[], fetchedAt }` with one row per non-invalidated trigger from the last ~28 calendar days, ordered by `triggerDate` desc.
- [ ] Each row's `mark`/`pdc`/`change`/`volume` are populated from `fetchUnifiedSnapshot` (or `null` if Massive didn't return that ticker).
- [ ] `npm run lint && npx tsc --noEmit` pass.

---

## Step 7 — Wire the dashboard into two source feeds

**File:** `components/trading/DashboardScannerTable.tsx`
**Action:** MODIFY

Goal: split the Day 1 and MDR feeds. Day 1 keeps `/api/tradingview/gainers`. MDR consumes `/api/tradingview/mdr-candidates` (live) + `/api/scanner/mdr-recent` (DB) merged + deduped by ticker. The current logic that runs eligibility off the gainers feed (lines 399-445) goes away — the cron now drives MDR persistence.

Instructions:

1. **Add new interfaces** alongside the existing `MdrEligibility` interface (around lines 28-38):

   ```ts
   interface MdrCandidate extends TradingViewGainer {}

   interface MdrRecentRow {
     ticker: string;
     triggerDate: string;
     triggerClose: number;
     mark: number | null;
     pdc: number | null;
     change: number | null;
     volume: number | null;
   }
   ```

2. **Delete obsolete state and helpers.** Remove all of:
   - `DashboardMdrLatchState` type (line 47-49)
   - `DASHBOARD_MDR_LATCH_STORAGE_KEY` constant (line 52)
   - `emptyMdrLatchState` function (lines 126-128)
   - `isMdrEligibility` function (lines 142-151)
   - `normalizeEligibilityByTicker` function (lines 164-173)
   - `loadDashboardMdrLatch` function (lines 198-224)
   - `sortMdrRows` function (lines 271-284)
   - `MdrEligibility` interface (lines 28-38) — no longer needed in this file
   - `mdrLatch` and `setMdrLatch` state (line 319)
   - `requestedEligibilityRef` ref (line 323)
   - The `setMdrLatch(...)` block inside `fetchGainers` (lines 342-354)
   - The `requestedEligibilityRef.current = new Set()` line (line 355)
   - The `useEffect` at lines 373-375 that persists `mdrLatch`
   - The entire MDR eligibility `useEffect` at lines 399-445

3. **Add new state** (replacing the deleted `mdrLatch` line):
   ```ts
   const [mdrLive, setMdrLive] = useState<MdrCandidate[]>([]);
   const [mdrRecent, setMdrRecent] = useState<MdrRecentRow[]>([]);
   ```

4. **Add two new fetchers** alongside `fetchGainers` (after line 361):

   ```ts
   const fetchMdrLive = useCallback(async () => {
     try {
       const res = await fetch('/api/tradingview/mdr-candidates');
       if (!res.ok) return;
       const data = (await res.json()) as { candidates: MdrCandidate[] };
       setMdrLive(data.candidates ?? []);
     } catch {
       // Keep last good list on transient failures.
     }
   }, []);

   const fetchMdrRecent = useCallback(async () => {
     try {
       const res = await fetch('/api/scanner/mdr-recent');
       if (!res.ok) return;
       const data = (await res.json()) as { rows: MdrRecentRow[] };
       setMdrRecent(data.rows ?? []);
     } catch {
       // Keep last good list on transient failures.
     }
   }, []);
   ```

5. **Update the polling `useEffect`** (lines 363-367) to fire all three fetchers:

   ```ts
   useEffect(() => {
     void fetchGainers();
     void fetchMdrLive();
     void fetchMdrRecent();
     const interval = setInterval(() => {
       void fetchGainers();
       void fetchMdrLive();
       void fetchMdrRecent();
     }, 10_000);
     return () => clearInterval(interval);
   }, [fetchGainers, fetchMdrLive, fetchMdrRecent]);
   ```

6. **Add a `mdrRows` `useMemo`** before the JSX return:

   ```ts
   const mdrRows = useMemo(() => {
     const session = getMarketSession();
     const byTicker = new Map<string, { ticker: string; pdc: number; mark: number; chg: number }>();

     // Live candidates first — TV's `change` is regular-session % change.
     // Back-compute pdc from price + change so the table stays consistent
     // with the existing format. During PM, mark falls back to preMarketPrice.
     for (const c of mdrLive) {
       const mark = sessionMark(c, session);
       const chg = c.change;
       const pdc = chg !== 0 ? c.price / (1 + chg / 100) : c.price;
       byTicker.set(c.ticker, { ticker: c.ticker, pdc, mark, chg });
     }

     // DB rows fill in any ticker not already in the live set. They have
     // proper mark + pdc from Massive's unified snapshot.
     for (const r of mdrRecent) {
       if (byTicker.has(r.ticker)) continue;
       const mark = r.mark ?? r.triggerClose;
       const pdc = r.pdc ?? r.triggerClose;
       const chg = pdc > 0 ? (mark / pdc - 1) * 100 : 0;
       byTicker.set(r.ticker, { ticker: r.ticker, pdc, mark, chg });
     }

     return Array.from(byTicker.values()).sort((a, b) => b.chg - a.chg);
   }, [mdrLive, mdrRecent]);
   ```

7. **Replace the MDR table body**. Lines 595-645 contain `{(() => { const session = getMarketSession(); const mdrGainers = sortMdrRows(...); ... })()}`. Replace that entire IIFE block with:

   ```tsx
   {mdrRows.length === 0 ? (
     <tr>
       <td colSpan={7} className="px-4 py-6 text-center text-sm text-zinc-500">
         No MDR setups detected.
       </td>
     </tr>
   ) : (
     mdrRows.map((row) => (
       <tr
         key={row.ticker}
         className={bodyRow}
         onClick={() => onNavigateToResearch(row.ticker)}
         onKeyDown={(event) => handleRowKeyDown(event, row.ticker)}
         role="button"
         tabIndex={0}
         title={`Open ${row.ticker} in Research`}
       >
         <TD>
           <span className="text-zinc-100">{row.ticker}</span>
         </TD>
         <TD right>${row.pdc.toFixed(3)}</TD>
         <TD right>${row.mark.toFixed(3)}</TD>
         <TD right>
           <span className={row.chg >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
             {row.chg >= 0 ? '+' : ''}{row.chg.toFixed(2)}%
           </span>
         </TD>
         {/* MDR threshold formulas — see HANDOFF.md follow-up. */}
         <TD right className="text-zinc-600">—</TD>
         <TD right className="text-zinc-600">—</TD>
         <TD right className="text-zinc-600">—</TD>
       </tr>
     ))
   )}
   ```

8. **Verify `useMemo` is imported.** The existing import at line 3 already covers `useMemo`. No change needed.

9. **Run `__tests__/dashboard-scanner-table.test.tsx`** — `npm test -- dashboard-scanner-table`. The test likely asserts the old MDR latch behavior. Update assertions to match the new merged-feed architecture (mock both new endpoints; assert that names from `mdrRecent` show up in the rendered table; assert localStorage is no longer touched for MDR). Do not delete the test.

**Acceptance criteria:**
- [ ] D1 table consumes `/api/tradingview/gainers` and shows market-cap-< $300M names with the new 2M volume gate active.
- [ ] MDR table consumes the merged feed: live `/api/tradingview/mdr-candidates` + DB `/api/scanner/mdr-recent`, deduped by ticker (live wins on collision).
- [ ] No `/api/scanner/mdr-eligibility` requests fire from the dashboard during normal polling (verify with the network tab).
- [ ] localStorage no longer carries an `nexus-dashboard-mdr-latched` key.
- [ ] The 3 placeholder columns still render `—`.
- [ ] `npm run lint && npx tsc --noEmit && npm test` pass.

---

## Step 8 — Update HANDOFF.md follow-ups

**File:** `HANDOFF.md`
**Action:** MODIFY

Goal: replace the old placeholder follow-up note with one that points to the Python source.

Instructions:

1. In the "Open Follow-Ups Carried Forward" section near the bottom of `HANDOFF.md`, replace the line:
   ```
   - MDR setup entry-trigger columns remain deferred; `PM Price Needed`, `Opening Gap Needed`, and `Intraday Price Needed` still render placeholders.
   ```
   with:
   ```
   - MDR threshold formulas (`PM Price Needed`, `Opening Gap Needed`, `Intraday Price Needed`) remain placeholders. Next pass: port the ATR-based formulas from `/mnt/c/Users/jared/Downloads/mdr swing scan.py` lines 527-563 (`sc_*_min_price`). Requires ATR added to the per-ticker daily-aggregate fetch + a per-ticker effect to populate the three columns from the formulas (uses the trigger row's ATR + close + 20d high/low).
   ```

**Acceptance criteria:**
- [ ] Follow-up note in HANDOFF.md cites the Python file path + line range.

---

## Files Changed Summary

| File | Action | Lines (rough) | Risk |
|---|---|---|---|
| `app/api/tradingview/gainers/route.ts` | MODIFY | +1 | LOW |
| `app/api/tradingview/mdr-candidates/route.ts` | CREATE | +110 | LOW |
| `lib/db/schema.ts` | MODIFY | +20 | LOW |
| `drizzle/00XX_*.sql` | CREATE (drizzle-kit) | auto | LOW |
| `lib/massive-market.ts` | MODIFY | +130 | MED — new helpers, no edits to existing |
| `app/api/cron/mdr-sweep/route.ts` | CREATE | +210 | HIGH — new cron + DB writes |
| `vercel.json` | MODIFY | +4 | LOW |
| `app/api/scanner/mdr-recent/route.ts` | CREATE | +90 | MED — DB join + Massive snapshot |
| `components/trading/DashboardScannerTable.tsx` | MODIFY | +60 / -110 | MED — refactor MDR feed |
| `__tests__/dashboard-scanner-table.test.tsx` | MODIFY | varies | LOW — adapt assertions |
| `HANDOFF.md` | MODIFY | +2 / -1 | LOW |

---

## Verification Steps

After all steps:

```
npm run lint
npx tsc --noEmit
npm run typecheck:services
npm test
```

All four must exit 0.

DB validation (after Step 3):
```
npx drizzle-kit generate    # inspect generated SQL
npm run db:migrate          # apply
```

Manual smoke:

1. Hit `/api/tradingview/gainers` (authenticated). Confirm every returned ticker has `volume >= 2_000_000`.
2. Hit `/api/tradingview/mdr-candidates` (authenticated). Confirm response shape `{ candidates, count, totalCount, isRealtime, fetchedAt }` and that all candidates have `volume >= 10_000_000`, `change >= 20`, `price >= 1`.
3. Hit `/api/scanner/mdr-recent` (authenticated). With an empty DB, confirm `{ rows: [], fetchedAt }`.
4. Hit `/api/cron/mdr-sweep?days=1` with `Authorization: Bearer $CRON_SECRET`. Confirm response includes `evaluatedDates`, `triggersInserted`, `invalidationsApplied`, `errors`.
5. Verify `mdr_triggers` table now has rows. Spot-check one ticker against the Python reference scan output.
6. Open dashboard in browser (logged-in). D1 table populated; MDR table populated (after the cron has run at least once).
7. Verify `localStorage.getItem('nexus-dashboard-mdr-latched')` returns `null`.

Backfill (deploy-time, user runs manually — Codex does NOT run this):
```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$DEPLOY_URL/api/cron/mdr-sweep?days=20"
```

---

## Open Assumptions (Codex must verify before writing code)

1. **`fetchUnifiedSnapshot` field shape** — assuming `r.session.close`, `r.session.previous_close`, `r.session.change_percent`, `r.session.volume` per `MassiveSnapshotResult` at `lib/massive-market.ts:6-23`. If a live call returns differently shaped data, adjust `mdr-recent/route.ts` accordingly.
2. **`fetchDailyAggregates` date alignment** — the function pulls "the most recent N trading days" ending today. The cron's backfill mode filters returned bars by `b.date <= dateStr`. Verify the date string format from the function's output (`"YYYY-MM-DD"` per line 277 in current code) matches the format used in `dateStr` (also `"YYYY-MM-DD"`). They should match; sanity-check during the first cron run.
3. **`requireUser` return shape** — pattern `if ('error' in authState) return authState.error` matches `app/api/scanner/mdr-eligibility/route.ts:21`. Use the same pattern.
4. **Drizzle `onConflictDoNothing`** — supported in Drizzle pg dialect. If the version in this repo doesn't accept it bare, use `.onConflictDoNothing({ target: [mdrTriggers.ticker, mdrTriggers.triggerDate] })`.
5. **Polygon/Massive grouped-aggs cost** — the daily grouped endpoint is one HTTP call per date. The pre-filter trims candidates to ~50-200 per day before per-ticker history fetches. Backfill of 20 days should complete inside the 5-minute `maxDuration`. If it times out, run `?days=10` then `?days=10` again.
6. **Test file `__tests__/scanner-mdr-eligibility-route.test.ts`** — the eligibility route remains in place (untouched by this spec) for ad-hoc lookups. The test should still pass without changes. If it references the dashboard wiring, it does not — confirm by reading it.

---

## Commit Message

```
MDR scanner: split Day 1 / MDR feeds, add nightly d2_mdr cron with -10% invalidation
```

---

## Recent Completed Context

- 2026-05-04: Backtesting UI refinements + grid layout + sample-set sidebar (`b03fa38`, `82bfa46`, `10e1071`, `82cca14`, `36a410b`).
- 2026-05-03: Phase C drawings/indicators (`82cbb55`).
- 2026-05-03: Phase B drawings + indicators persist with reviews (`88a4da4`).
- 2026-05-03: Phase A review save flow + chart expand persisted (`6513e40`).
- 2026-05-01: Backtest Manager landing page shipped — schema, API, manager + stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- MDR threshold formulas (`PM Price Needed`, `Opening Gap Needed`, `Intraday Price Needed`) remain placeholders. Next pass: port the ATR-based formulas from `/mnt/c/Users/jared/Downloads/mdr swing scan.py` lines 527-563 (`sc_*_min_price`). Requires ATR added to the per-ticker daily-aggregate fetch + a per-ticker effect to populate the three columns from the formulas (uses the trigger row's ATR + close + 20d high/low).
- Backtest Manager — `broke_premarket_high` filter deferred. Data not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
