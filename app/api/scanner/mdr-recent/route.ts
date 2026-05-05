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
      const snap = snapshotByTicker.get(r.ticker.toUpperCase());
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
