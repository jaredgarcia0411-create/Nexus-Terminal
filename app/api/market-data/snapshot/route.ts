import { desc, eq } from 'drizzle-orm';
import { logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { marketSnapshots } from '@/lib/db/schema';
import { fetchFreshSnapshot } from '@/lib/massive-snapshot';
import { fetchRealtimeSnapshot, getSchwabLinkStatus, type RealtimeSnapshotResult } from '@/lib/realtime-snapshot';
import { type MarketInstrument, type MarketSnapshotPayload } from '@/lib/quote-mappers';
import { requireUser } from '@/lib/server-db-utils';

type SnapshotCoverage = {
  totalInstruments: number;
  availablePrices: number;
  missingPriceCount: number;
  missingPriceBySection: { indices: number; commodities: number; equities: number };
};

type PgLikeError = { code?: string; message?: string; name?: string };

const CACHE_SNAPSHOT_TYPE = 'markets_overview';
const CACHE_TTL_MS = 2 * 60 * 1000;
const STALE_WARNING_MS = 30 * 60 * 1000;

function isUndefinedTableError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as PgLikeError).code === '42P01';
}

function getErrorSummary(error: unknown) {
  if (error instanceof Error) {
    const pgError = error as Error & PgLikeError;
    return { name: pgError.name, message: pgError.message, code: pgError.code };
  }
  if (typeof error === 'object' && error !== null) {
    const pgError = error as PgLikeError;
    return { name: pgError.name ?? 'UnknownError', message: pgError.message ?? 'Unknown error object', code: pgError.code };
  }
  return { name: 'UnknownError', message: String(error), code: undefined };
}

function logSnapshotStage(stage: string, requestId: string, details: Record<string, unknown>) {
  console.info('[api:market-data.snapshot]', { requestId, stage, ...details });
}

function countMissing(items: MarketInstrument[]) {
  return items.filter((item) => item.price == null).length;
}

function buildCoverage(data: MarketSnapshotPayload): SnapshotCoverage {
  const totalInstruments = data.indices.length + data.commodities.length + data.equities.length;
  const missingPriceBySection = {
    indices: countMissing(data.indices),
    commodities: countMissing(data.commodities),
    equities: countMissing(data.equities),
  };
  const missingPriceCount = missingPriceBySection.indices + missingPriceBySection.commodities + missingPriceBySection.equities;
  return { totalInstruments, availablePrices: totalInstruments - missingPriceCount, missingPriceCount, missingPriceBySection };
}

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireUser();
    if ('error' in auth && auth.error) {
      logSnapshotStage('auth_check', requestId, { result: 'unauthorized', status: auth.error.status });
      return auth.error;
    }

    const db = getDb();
    const now = new Date();
    const schwabStatus = await getSchwabLinkStatus(db, auth.user.id);
    if (db && schwabStatus.active) {
      const realtimeSnapshot: RealtimeSnapshotResult | null = await fetchRealtimeSnapshot(db);
      if (realtimeSnapshot) {
        return Response.json({
          data: realtimeSnapshot.data,
          fetchedAt: realtimeSnapshot.fetchedAt.toISOString(),
          warning: null,
          stale: false,
          source: 'realtime',
          coverage: buildCoverage(realtimeSnapshot.data),
          dataSource: 'realtime',
          requestId,
        });
      }
    }

    let cacheAvailable = Boolean(db);
    let cacheUnavailableWarning: string | null = null;
    let realtimeFallbackWarning: string | null = null;
    if (schwabStatus.active) {
      realtimeFallbackWarning = 'Realtime quotes are unavailable or stale. Falling back to delayed Massive data.';
    }

    let cached: (typeof marketSnapshots.$inferSelect) | undefined;
    if (db) {
      try {
        [cached] = await db.select().from(marketSnapshots).where(eq(marketSnapshots.snapshotType, CACHE_SNAPSHOT_TYPE)).orderBy(desc(marketSnapshots.fetchedAt)).limit(1);
      } catch (error) {
        if (isUndefinedTableError(error)) {
          cacheAvailable = false;
          cacheUnavailableWarning = 'Market snapshot cache unavailable (table missing). Returning live data without cache.';
          logSnapshotStage('cache_read', requestId, { result: 'cache_unavailable', cacheTableMissing: true, error: getErrorSummary(error) });
        } else {
          logRouteError('market-data.snapshot.get.cache-read', error);
          throw error;
        }
      }
    } else {
      cacheAvailable = false;
      cacheUnavailableWarning = 'Market snapshot cache unavailable (database not configured). Returning live data without cache.';
    }

    if (cached && cached.expiresAt.getTime() > now.getTime()) {
      const ageMs = now.getTime() - cached.fetchedAt.getTime();
      const cachedData = cached.dataJson as MarketSnapshotPayload;
      return Response.json({
        data: cachedData,
        fetchedAt: cached.fetchedAt.toISOString(),
        warning: cached.warning ?? realtimeFallbackWarning,
        stale: ageMs > STALE_WARNING_MS,
        source: 'cache',
        coverage: buildCoverage(cachedData),
        dataSource: 'delayed',
      });
    }

    try {
      logSnapshotStage('upstream_fetch', requestId, { result: 'started', hasCachedData: Boolean(cached), cacheAvailable });
      const data = await fetchFreshSnapshot();
      const coverage = buildCoverage(data);
      const fetchedAt = new Date();

      if (db && cacheAvailable) {
        try {
          await db.insert(marketSnapshots).values({
            id: cached?.id ?? crypto.randomUUID(),
            snapshotType: CACHE_SNAPSHOT_TYPE,
            dataJson: data,
            warning: null,
            fetchedAt,
            expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
          }).onConflictDoUpdate({
            target: marketSnapshots.snapshotType,
            set: { dataJson: data, warning: null, fetchedAt, expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS) },
          });
        } catch (error) {
          if (isUndefinedTableError(error)) {
            cacheAvailable = false;
            cacheUnavailableWarning = 'Market snapshot cache unavailable (table missing). Returning live data without cache.';
            logSnapshotStage('cache_write', requestId, { result: 'cache_unavailable', cacheTableMissing: true, error: getErrorSummary(error) });
          } else {
            logRouteError('market-data.snapshot.get.cache-write', error);
          }
        }
      }

      return Response.json({
        data,
        fetchedAt: fetchedAt.toISOString(),
        warning: cacheUnavailableWarning ?? realtimeFallbackWarning,
        stale: false,
        source: cacheAvailable ? 'live' : 'live-no-cache',
        coverage,
        dataSource: 'delayed',
        requestId,
      });
    } catch (error) {
      if (cached) {
        const ageMs = now.getTime() - cached.fetchedAt.getTime();
        const cachedData = cached.dataJson as MarketSnapshotPayload;
        logSnapshotStage('fallback_response', requestId, {
          result: 'served_cached_data',
          reason: 'upstream_fetch_failed',
          hasCachedData: true,
          cacheAvailable,
          error: getErrorSummary(error),
        });
        return Response.json({
          data: cachedData,
          fetchedAt: cached.fetchedAt.toISOString(),
          warning: 'Showing cached market snapshot due to upstream provider failure.',
          stale: ageMs > STALE_WARNING_MS,
          source: 'cache-fallback',
          coverage: buildCoverage(cachedData),
          dataSource: 'delayed',
          requestId,
        });
      }

      if (error instanceof Error && error.message.includes('MASSIVE_API_KEY')) {
        logSnapshotStage('upstream_fetch', requestId, { result: 'failed', reason: 'provider_not_configured', hasCachedData: false, error: getErrorSummary(error) });
        return Response.json({ error: 'Market data provider not configured', code: 'provider_not_configured', stage: 'upstream_fetch', requestId }, { status: 503 });
      }

      logSnapshotStage('upstream_fetch', requestId, { result: 'failed', reason: 'upstream_or_network_error', hasCachedData: false, error: getErrorSummary(error) });
      logRouteError('market-data.snapshot.get.fetch', error);
      return Response.json({ error: 'Failed to fetch market snapshot', code: 'upstream_fetch_failed', stage: 'upstream_fetch', requestId }, { status: 502 });
    }
  } catch (error) {
    logSnapshotStage('route_handler', requestId, { result: 'failed', error: getErrorSummary(error) });
    logRouteError('market-data.snapshot.get', error);
    return Response.json({ error: 'Internal server error', code: 'internal_error', stage: 'route_handler', requestId }, { status: 500 });
  }
}
