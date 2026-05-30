import { and, gte, isNull, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { mdrTriggers } from '@/lib/db/schema';
import { evaluateLatestD2MdrTrigger, fetchUnifiedSnapshot, type MdrThresholds } from '@/lib/massive-market';

const THRESHOLD_CONCURRENCY = 10;

export interface MdrRecentRow {
  ticker: string;
  triggerDate: string;
  triggerClose: number;
  mark: number | null;
  pdc: number | null;
  change: number | null;
  volume: number | null;
  pmPriceNeeded: number | null;
  openingGapNeededPercent: number | null;
  intradayPriceNeeded: number | null;
  basisPrice: number | null;
  atr14: number | null;
}

type AppDb = NonNullable<ReturnType<typeof getDb>>;

export interface DashboardMdrRecentPayload {
  rows: MdrRecentRow[];
  fetchedAt: string;
}

const NULL_THRESHOLDS: MdrThresholds = {
  pmPriceNeeded: null,
  openingGapNeededPercent: null,
  intradayPriceNeeded: null,
  basisPrice: null,
  atr14: null,
};

function thresholdKey(ticker: string, triggerDate: string) {
  return `${ticker.toUpperCase()}|${triggerDate}`;
}

async function loadThresholdsByTrigger(rows: Array<{ ticker: string; triggerDate: string }>) {
  const thresholdsByTrigger = new Map<string, MdrThresholds>();

  for (let i = 0; i < rows.length; i += THRESHOLD_CONCURRENCY) {
    const chunk = rows.slice(i, i + THRESHOLD_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (row) => {
        const evaluation = await evaluateLatestD2MdrTrigger(row.ticker, { asOfDate: row.triggerDate });
        return { key: thresholdKey(row.ticker, row.triggerDate), thresholds: evaluation.thresholds };
      }),
    );

    for (let j = 0; j < settled.length; j += 1) {
      const result = settled[j];
      if (result.status === 'fulfilled') {
        thresholdsByTrigger.set(result.value.key, result.value.thresholds);
        continue;
      }

      console.warn('[api:scanner-mdr-recent] skipped threshold enrichment', {
        ticker: chunk[j]?.ticker ?? 'UNKNOWN',
        reason: result.reason instanceof Error ? result.reason.message : 'unknown',
      });
    }
  }

  return thresholdsByTrigger;
}

export async function fetchMdrRecentForDashboard(db: AppDb): Promise<DashboardMdrRecentPayload> {
  // Over-fetch by calendar days (28 ~= 20 trading days). The query DB
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
    return { rows: [], fetchedAt: new Date().toISOString() };
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

  const thresholdsByTrigger = await loadThresholdsByTrigger(rows);

  const out: MdrRecentRow[] = rows.map((r) => {
    const snap = snapshotByTicker.get(r.ticker.toUpperCase());
    const thresholds = thresholdsByTrigger.get(thresholdKey(r.ticker, r.triggerDate)) ?? NULL_THRESHOLDS;
    return {
      ticker: r.ticker,
      triggerDate: r.triggerDate,
      triggerClose: r.triggerClose,
      mark: snap?.mark ?? null,
      pdc: snap?.pdc ?? null,
      change: snap?.change ?? null,
      volume: snap?.volume ?? null,
      pmPriceNeeded: thresholds.pmPriceNeeded,
      openingGapNeededPercent: thresholds.openingGapNeededPercent,
      intradayPriceNeeded: thresholds.intradayPriceNeeded,
      basisPrice: thresholds.basisPrice,
      atr14: thresholds.atr14,
    };
  });

  return { rows: out, fetchedAt: new Date().toISOString() };
}
