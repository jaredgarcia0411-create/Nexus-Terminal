import { inArray, sql } from 'drizzle-orm';

import { fetchGroupedDailyAggregates, type GroupedDailyBar } from '@/lib/massive-market';
import { marketPulseDailyBars, marketPulseDailyStats } from '@/lib/db/schema';
import { computeMarketPulseStats } from './stats';
import type { Db } from '@/lib/db';
import type { MarketPulseBar, MarketPulseCaptureResult, MarketPulseDailyStats } from './types';

type MarketPulseDb = Pick<Db, 'insert' | 'select'> & Partial<Pick<Db, 'execute'>>;

type DateRow = { tradeDate: string | Date };

function unwrapRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

function formatDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeTimestamp(timestamp: number): Date | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp);
}

export function normalizeGroupedDailyBar(tradeDate: string, bar: GroupedDailyBar): MarketPulseBar | null {
  const ticker = bar.ticker.trim().toUpperCase();
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  const volume = Number(bar.volume);
  if (!ticker || ![open, high, low, close, volume].every(Number.isFinite)) return null;

  return {
    tradeDate,
    ticker,
    open,
    high,
    low,
    close,
    volume,
    vwap: Number.isFinite(Number(bar.vwap)) ? Number(bar.vwap) : null,
    dollarVolume: close * volume,
    sourceTimestamp: normalizeTimestamp(Number(bar.timestamp)),
  };
}

async function upsertBars(db: MarketPulseDb, bars: MarketPulseBar[]): Promise<number> {
  const chunkSize = 500;
  for (let i = 0; i < bars.length; i += chunkSize) {
    const chunk = bars.slice(i, i + chunkSize);
    await (db.insert(marketPulseDailyBars) as {
      values: (rows: MarketPulseBar[]) => {
        onConflictDoUpdate: (args: unknown) => Promise<unknown>;
      };
    }).values(chunk).onConflictDoUpdate({
      target: [marketPulseDailyBars.tradeDate, marketPulseDailyBars.ticker],
      set: {
        open: sql`excluded.open`,
        high: sql`excluded.high`,
        low: sql`excluded.low`,
        close: sql`excluded.close`,
        volume: sql`excluded.volume`,
        vwap: sql`excluded.vwap`,
        dollarVolume: sql`excluded.dollar_volume`,
        sourceTimestamp: sql`excluded.source_timestamp`,
        sector: sql`excluded.sector`,
        industry: sql`excluded.industry`,
        country: sql`excluded.country`,
        floatShares: sql`excluded.float_shares`,
        marketCap: sql`excluded.market_cap`,
        perf30d: sql`excluded.perf_30d`,
        updatedAt: sql`now()`,
      },
    });
  }
  return bars.length;
}

async function loadRecentTradeDates(db: MarketPulseDb, tradeDate: string): Promise<string[]> {
  if (typeof db.execute === 'function') {
    const result = await db.execute(sql`
      SELECT DISTINCT trade_date AS "tradeDate"
      FROM market_pulse_daily_bars
      WHERE trade_date <= ${tradeDate}
      ORDER BY trade_date DESC
      LIMIT 90
    `) as DateRow[] | { rows: DateRow[] };
    return unwrapRows(result)
      .map((row) => formatDate(row.tradeDate))
      .sort();
  }

  return [tradeDate];
}

async function loadBarsForDates(db: MarketPulseDb, dates: string[]): Promise<MarketPulseBar[]> {
  if (dates.length === 0) return [];
  // MarketPulseDb narrows db to a Pick<> so tests can pass a partial mock, but
  // Pick drops Drizzle's fluent builder return types — so select().from().where()
  // is typed by hand here. Accepted Drizzle/Pick limitation, not a hidden bug.
  const rows = await ((db.select() as unknown as {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<MarketPulseBar[]>;
    };
  }).from(marketPulseDailyBars).where(inArray(marketPulseDailyBars.tradeDate, dates)));
  return rows.map((row) => ({
    ...row,
    tradeDate: formatDate(row.tradeDate),
    sourceTimestamp: row.sourceTimestamp ? new Date(row.sourceTimestamp) : null,
  }));
}

export async function upsertMarketPulseStats(
  db: MarketPulseDb,
  stats: MarketPulseDailyStats,
): Promise<void> {
  // Same Drizzle/Pick limitation as loadBarsForDates: the narrowed db drops
  // insert()'s fluent builder types, so values().onConflictDoUpdate() is typed by hand.
  await (db.insert(marketPulseDailyStats) as unknown as {
    values: (row: Record<string, unknown>) => {
      onConflictDoUpdate: (args: unknown) => Promise<unknown>;
    };
  }).values({
    tradeDate: stats.tradeDate,
    tickerCount: stats.tickerCount,
    advancers: stats.advancers,
    decliners: stats.decliners,
    unchanged: stats.unchanged,
    advancerPct: stats.advancerPct,
    declinerPct: stats.declinerPct,
    upVolume: stats.upVolume,
    downVolume: stats.downVolume,
    totalVolume: stats.totalVolume,
    medianChangePct: stats.medianChangePct,
    avgChangePct: stats.avgChangePct,
    pctAbovePrevClose: stats.pctAbovePrevClose,
    pctAboveDollarVolumeFloor: stats.pctAboveDollarVolumeFloor,
    newHigh30dCount: stats.newHigh30dCount,
    newLow30dCount: stats.newLow30dCount,
    rolling30Json: stats.rolling30,
    overview90Json: stats.overview90,
  }).onConflictDoUpdate({
    target: marketPulseDailyStats.tradeDate,
    set: {
      tickerCount: sql`excluded.ticker_count`,
      advancers: sql`excluded.advancers`,
      decliners: sql`excluded.decliners`,
      unchanged: sql`excluded.unchanged`,
      advancerPct: sql`excluded.advancer_pct`,
      declinerPct: sql`excluded.decliner_pct`,
      upVolume: sql`excluded.up_volume`,
      downVolume: sql`excluded.down_volume`,
      totalVolume: sql`excluded.total_volume`,
      medianChangePct: sql`excluded.median_change_pct`,
      avgChangePct: sql`excluded.avg_change_pct`,
      pctAbovePrevClose: sql`excluded.pct_above_prev_close`,
      pctAboveDollarVolumeFloor: sql`excluded.pct_above_dollar_volume_floor`,
      newHigh30dCount: sql`excluded.new_high_30d_count`,
      newLow30dCount: sql`excluded.new_low_30d_count`,
      rolling30Json: sql`excluded.rolling_30_json`,
      overview90Json: sql`excluded.overview_90_json`,
      updatedAt: sql`now()`,
    },
  });
}

export async function captureMarketPulseForDate(
  db: MarketPulseDb,
  tradeDate: string,
): Promise<MarketPulseCaptureResult> {
  const grouped = await fetchGroupedDailyAggregates(tradeDate);
  const bars = grouped.flatMap((bar) => {
    const normalized = normalizeGroupedDailyBar(tradeDate, bar);
    return normalized ? [normalized] : [];
  });

  if (bars.length === 0) {
    return {
      tradeDate,
      skipped: true,
      barsUpserted: 0,
      statsUpserted: 0,
      stats: null,
    };
  }

  const barsUpserted = await upsertBars(db, bars);
  const dates = await loadRecentTradeDates(db, tradeDate);
  const storedBars = await loadBarsForDates(db, dates.includes(tradeDate) ? dates : [...dates, tradeDate].sort());
  const stats = computeMarketPulseStats(tradeDate, storedBars.length > 0 ? storedBars : bars);
  if (!stats) {
    return {
      tradeDate,
      skipped: false,
      barsUpserted,
      statsUpserted: 0,
      stats: null,
    };
  }

  await upsertMarketPulseStats(db, stats);
  return {
    tradeDate,
    skipped: false,
    barsUpserted,
    statsUpserted: 1,
    stats,
  };
}
