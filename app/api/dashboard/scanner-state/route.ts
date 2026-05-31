import { and, eq, gt } from 'drizzle-orm';

import {
  fetchGainersForDashboard,
  type DashboardGainersPayload,
} from '@/app/api/tradingview/gainers/route';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { askedgarCache } from '@/lib/db/schema';
import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AggregatePayload {
  gainers: DashboardGainersPayload['gainers'];
  isRealtime: boolean;
  fetchedAt: string;
}

const TTL_MS = 8_000;
const SCANNER_CACHE_TYPE = 'dashboard-scanner-state';
const SCANNER_CACHE_KEY = 'GLOBAL'; // single shared row; ticker column reused as a fixed key

function projectAggregatePayload(payload: AggregatePayload): AggregatePayload {
  return {
    gainers: payload.gainers,
    isRealtime: payload.isRealtime,
    fetchedAt: payload.fetchedAt,
  };
}

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  try {
    const now = new Date();
    const cachedRows = await db
      .select({ dataJson: askedgarCache.dataJson })
      .from(askedgarCache)
      .where(and(
        eq(askedgarCache.cacheType, SCANNER_CACHE_TYPE),
        eq(askedgarCache.ticker, SCANNER_CACHE_KEY),
        gt(askedgarCache.expiresAt, now),
      ))
      .limit(1);
    if (cachedRows.length > 0) {
      return Response.json(projectAggregatePayload(cachedRows[0].dataJson as AggregatePayload));
    }

    const [gainersResult] = await Promise.allSettled([
      fetchGainersForDashboard(),
    ]);

    if (gainersResult.status === 'rejected') {
      console.warn('[dashboard:scanner-state] gainers fetch failed:', gainersResult.reason);
    }

    const payload: AggregatePayload = {
      gainers: gainersResult.status === 'fulfilled' ? gainersResult.value.gainers : [],
      isRealtime: gainersResult.status === 'fulfilled' ? gainersResult.value.isRealtime : false,
      fetchedAt: new Date().toISOString(),
    };

    // askedgar_cache is a generic jsonb cache; reused here for the (non-AE) scanner aggregate.
    try {
      const cacheNow = new Date();
      const cacheExpiry = new Date(cacheNow.getTime() + TTL_MS);
      await db.insert(askedgarCache).values({
        id: SCANNER_CACHE_TYPE,
        cacheType: SCANNER_CACHE_TYPE,
        ticker: SCANNER_CACHE_KEY,
        dataJson: payload,
        fetchedAt: cacheNow,
        expiresAt: cacheExpiry,
      }).onConflictDoUpdate({
        target: [askedgarCache.cacheType, askedgarCache.ticker],
        set: { dataJson: payload, fetchedAt: cacheNow, expiresAt: cacheExpiry },
      });
    } catch (error) {
      console.warn('[dashboard:scanner-state] cache write failed:', error);
    }

    return Response.json(payload);
  } catch (error) {
    logRouteError('dashboard:scanner-state', error);
    return internalServerError();
  }
}
