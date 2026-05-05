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
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  return Date.UTC(y!, (m! - 1), d!);
}

/**
 * Runs the d2_mdr sweep for one date. Returns the number of triggers
 * inserted, or null if `dateStr` was a non-trading day (grouped agg
 * empty).
 *
 * Per-candidate history fetches run in chunks of CANDIDATE_CONCURRENCY so
 * a 20-day backfill stays within Vercel's 300s maxDuration. A single day
 * with ~150 candidates × ~200ms serial fetches blows past the budget;
 * parallelizing keeps it under ~5s/day.
 */
const CANDIDATE_CONCURRENCY = 10;

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

  for (let i = 0; i < candidates.length; i += CANDIDATE_CONCURRENCY) {
    const chunk = candidates.slice(i, i + CANDIDATE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((candidate) => evaluateAndInsertCandidate(db, candidate, dateStr)),
    );

    for (let j = 0; j < settled.length; j += 1) {
      const result = settled[j];
      if (result.status === 'fulfilled') {
        if (result.value) inserted += 1;
      } else {
        summary.errors.push({
          stage: `sweep:${dateStr}:${chunk[j].ticker}`,
          message: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        });
      }
    }
  }

  return inserted;
}

/**
 * Evaluate one candidate ticker for `dateStr`. Returns true if a trigger
 * row was inserted (or was already present), false otherwise. Throws on
 * unexpected fetch/db errors so the caller can surface them in `summary.errors`.
 */
async function evaluateAndInsertCandidate(
  db: NonNullable<ReturnType<typeof getDb>>,
  candidate: GroupedDailyBar,
  dateStr: string,
): Promise<boolean> {
  // 60 bars covers a 20-day backfill date plus 20 prior bars with
  // weekend/holiday buffer, so older backfill dates still have context.
  const history = await fetchDailyAggregates(candidate.ticker, 60);
  const historyAsOf = history.filter((b) => b.date <= dateStr);
  if (historyAsOf.length < 21) return false;

  const todayBarIdx = historyAsOf.findIndex((b) => b.date === dateStr);
  if (todayBarIdx < 20) return false;

  const todayHistoric = historyAsOf[todayBarIdx];
  const priorBars: GroupedDailyBar[] = historyAsOf.slice(0, todayBarIdx).map((b) => ({
    ticker: candidate.ticker,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    vwap: b.vwap,
    timestamp: Date.parse(`${b.date}T00:00:00Z`),
  }));
  const todayBar: GroupedDailyBar = {
    ticker: candidate.ticker,
    open: todayHistoric.open,
    high: todayHistoric.high,
    low: todayHistoric.low,
    close: todayHistoric.close,
    volume: todayHistoric.volume,
    vwap: todayHistoric.vwap,
    timestamp: Date.parse(`${todayHistoric.date}T00:00:00Z`),
  };

  const result = evaluateD2MdrTrigger(todayBar, priorBars);
  if (!result.triggered) return false;

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

  return true;
}

/**
 * Walks every non-invalidated trigger row whose trigger_date is within
 * the last 25 calendar days. For each, fetches 60-bar daily history and
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

  // Same chunked-parallel pattern as sweepOneDay — the invalidation pass also
  // does one history fetch per active row, so serial would blow the 300s budget
  // for any meaningful backlog of triggers.
  let invalidated = 0;

  for (let i = 0; i < active.length; i += CANDIDATE_CONCURRENCY) {
    const chunk = active.slice(i, i + CANDIDATE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((row) => evaluateInvalidation(db, row.ticker, row.triggerDate)),
    );

    for (let j = 0; j < settled.length; j += 1) {
      const result = settled[j];
      if (result.status === 'fulfilled') {
        if (result.value) invalidated += 1;
      } else {
        logRouteError(`mdr-sweep:invalidate:${chunk[j].ticker}`, result.reason);
      }
    }
  }

  return invalidated;
}

async function evaluateInvalidation(
  db: NonNullable<ReturnType<typeof getDb>>,
  ticker: string,
  triggerDate: string,
): Promise<boolean> {
  // Keep the same 60-bar buffer as sweep evaluation so the invalidation
  // window stays covered even after weekends and market holidays.
  const history = await fetchDailyAggregates(ticker, 60);
  const fromTrigger = history.filter((b) => b.date >= triggerDate);
  if (fromTrigger.length < 2) return false;

  let hit = false;
  for (let i = 1; i < fromTrigger.length; i += 1) {
    const prev = fromTrigger[i - 1];
    const today = fromTrigger[i];
    if (isInvalidationDay(
      { ticker, open: today.open, high: today.high, low: today.low, close: today.close, volume: today.volume, vwap: today.vwap, timestamp: 0 },
      { ticker, open: prev.open, high: prev.high, low: prev.low, close: prev.close, volume: prev.volume, vwap: prev.vwap, timestamp: 0 },
    )) {
      hit = true;
      break;
    }
  }
  if (!hit) return false;

  await db.update(mdrTriggers)
    .set({ invalidatedAt: new Date() })
    .where(and(
      eq(mdrTriggers.ticker, ticker),
      eq(mdrTriggers.triggerDate, triggerDate),
    ));
  return true;
}
