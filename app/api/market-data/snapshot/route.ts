import { desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { marketSnapshots } from '@/lib/db/schema';
import { fetchTopMarketMovers, fetchUnifiedSnapshot } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

type MarketInstrument = {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketStatus: string | null;
};

type MarketMoverRow = {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  updated: number | null;
};

type MarketSnapshotPayload = {
  indices: MarketInstrument[];
  futures: MarketInstrument[];
  crypto: MarketInstrument[];
  fx: MarketInstrument[];
  equities: MarketInstrument[];
  movers: {
    gainers: MarketMoverRow[];
    losers: MarketMoverRow[];
  };
};

type SnapshotCoverage = {
  totalInstruments: number;
  availablePrices: number;
  missingPriceCount: number;
  missingPriceBySection: {
    indices: number;
    futures: number;
    crypto: number;
    fx: number;
    equities: number;
  };
};

const CACHE_SNAPSHOT_TYPE = 'markets_overview';
const CACHE_TTL_MS = 15 * 60 * 1000;
const STALE_WARNING_MS = 30 * 60 * 1000;

type PgLikeError = {
  code?: string;
  message?: string;
  name?: string;
};

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'];
const FUTURE_SYMBOLS = [
  { ticker: '/GC', label: 'Gold' },
  { ticker: '/SI', label: 'Silver' },
  { ticker: '/CL', label: 'Crude Oil' },
  { ticker: '/NG', label: 'Natural Gas' },
  { ticker: '/ZT', label: '2Y Note' },
  { ticker: '/ZN', label: '10Y Note' },
];
const CRYPTO_SYMBOLS = [
  { ticker: 'X:BTCUSD', symbol: 'BTC' },
  { ticker: 'X:ETHUSD', symbol: 'ETH' },
];
const FX_SYMBOLS = ['C:EURUSD', 'C:GBPUSD', 'C:USDJPY', 'C:USDCAD', 'C:AUDUSD', 'C:CNYUSD'];
const EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'TSLA', 'META', 'JPM', 'JNJ', 'V'];

function normalizeTicker(raw: string) {
  return raw.replace(/^X:/, '').replace(/^C:/, '').replace(/^I:/, '').trim().toUpperCase();
}

function toNumberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toInstrument(ticker: string, label: string, lookup: Map<string, { session?: Record<string, unknown>; market_status?: string }>): MarketInstrument {
  const entry = lookup.get(normalizeTicker(ticker));
  const session = entry?.session ?? {};
  return {
    symbol: normalizeTicker(ticker),
    label,
    price: toNumberOrNull(session.close),
    change: toNumberOrNull(session.change),
    changePercent: toNumberOrNull(session.change_percent),
    marketStatus: typeof entry?.market_status === 'string' ? entry.market_status : null,
  };
}

function toMoverRows(rows: Array<{ ticker?: string; day?: { c?: number }; prevDay?: { c?: number }; todaysChange?: number; todaysChangePerc?: number; updated?: number }>) {
  return rows
    .map((row) => ({
      ticker: row.ticker ?? '',
      price: toNumberOrNull(row.day?.c),
      previousClose: toNumberOrNull(row.prevDay?.c),
      change: toNumberOrNull(row.todaysChange),
      changePercent: toNumberOrNull(row.todaysChangePerc),
      updated: toNumberOrNull(row.updated),
    }))
    .filter((row) => row.ticker.length > 0)
    .filter((row) => (row.previousClose ?? 0) >= 0.75);
}

async function fetchFreshSnapshot(): Promise<MarketSnapshotPayload> {
  const tickers = [
    ...INDEX_SYMBOLS,
    ...FUTURE_SYMBOLS.map((item) => item.ticker),
    ...CRYPTO_SYMBOLS.map((item) => item.ticker),
    ...FX_SYMBOLS,
    ...EQUITY_SYMBOLS,
  ];

  const [snapshot, gainers, losers] = await Promise.all([
    fetchUnifiedSnapshot(tickers),
    fetchTopMarketMovers('gainers'),
    fetchTopMarketMovers('losers'),
  ]);

  const lookup = new Map<string, { session?: Record<string, unknown>; market_status?: string }>();
  for (const row of snapshot.results ?? []) {
    const ticker = typeof row.ticker === 'string' ? row.ticker : '';
    if (!ticker) continue;
    lookup.set(normalizeTicker(ticker), {
      session: (row.session ?? {}) as Record<string, unknown>,
      market_status: row.market_status,
    });
  }

  return {
    indices: INDEX_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup)),
    futures: FUTURE_SYMBOLS.map((item) => toInstrument(item.ticker, item.label, lookup)),
    crypto: CRYPTO_SYMBOLS.map((item) => toInstrument(item.ticker, item.symbol, lookup)),
    fx: FX_SYMBOLS.map((symbol) => toInstrument(symbol, normalizeTicker(symbol), lookup)),
    equities: EQUITY_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup)),
    movers: {
      gainers: toMoverRows(gainers.tickers ?? []),
      losers: toMoverRows(losers.tickers ?? []),
    },
  };
}

function isUndefinedTableError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as PgLikeError).code === '42P01';
}

function getErrorSummary(error: unknown) {
  if (error instanceof Error) {
    const pgError = error as Error & PgLikeError;
    return {
      name: pgError.name,
      message: pgError.message,
      code: pgError.code,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const pgError = error as PgLikeError;
    return {
      name: pgError.name ?? 'UnknownError',
      message: pgError.message ?? 'Unknown error object',
      code: pgError.code,
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
    code: undefined,
  };
}

function logSnapshotStage(stage: string, requestId: string, details: Record<string, unknown>) {
  console.error('[api:market-data.snapshot]', {
    requestId,
    stage,
    ...details,
  });
}

function countMissing(items: MarketInstrument[]) {
  return items.filter((item) => item.price == null).length;
}

function buildCoverage(data: MarketSnapshotPayload): SnapshotCoverage {
  const totalInstruments = data.indices.length + data.futures.length + data.crypto.length + data.fx.length + data.equities.length;
  const missingPriceBySection = {
    indices: countMissing(data.indices),
    futures: countMissing(data.futures),
    crypto: countMissing(data.crypto),
    fx: countMissing(data.fx),
    equities: countMissing(data.equities),
  };
  const missingPriceCount =
    missingPriceBySection.indices +
    missingPriceBySection.futures +
    missingPriceBySection.crypto +
    missingPriceBySection.fx +
    missingPriceBySection.equities;

  return {
    totalInstruments,
    availablePrices: totalInstruments - missingPriceCount,
    missingPriceCount,
    missingPriceBySection,
  };
}

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireUser();
    if ('error' in auth && auth.error) {
      logSnapshotStage('auth_check', requestId, {
        result: 'unauthorized',
        status: auth.error.status,
      });
      return auth.error;
    }

    const db = getDb();
    const now = new Date();
    let cacheAvailable = Boolean(db);
    let cacheUnavailableWarning: string | null = null;
    let cached: (typeof marketSnapshots.$inferSelect) | undefined;

    if (db) {
      try {
        [cached] = await db
          .select()
          .from(marketSnapshots)
          .where(eq(marketSnapshots.snapshotType, CACHE_SNAPSHOT_TYPE))
          .orderBy(desc(marketSnapshots.fetchedAt))
          .limit(1);
      } catch (error) {
        if (isUndefinedTableError(error)) {
          cacheAvailable = false;
          cacheUnavailableWarning = 'Market snapshot cache unavailable (table missing). Returning live data without cache.';
          logSnapshotStage('cache_read', requestId, {
            result: 'cache_unavailable',
            cacheTableMissing: true,
            error: getErrorSummary(error),
          });
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
        warning: cached.warning,
        stale: ageMs > STALE_WARNING_MS,
        source: 'cache',
        coverage: buildCoverage(cachedData),
      });
    }

    try {
      logSnapshotStage('upstream_fetch', requestId, {
        result: 'started',
        hasCachedData: Boolean(cached),
        cacheAvailable,
      });
      const data = await fetchFreshSnapshot();
      const coverage = buildCoverage(data);
      const fetchedAt = new Date();
      if (db && cacheAvailable) {
        try {
          await db
            .insert(marketSnapshots)
            .values({
              id: cached?.id ?? crypto.randomUUID(),
              snapshotType: CACHE_SNAPSHOT_TYPE,
              dataJson: data,
              warning: null,
              fetchedAt,
              expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
            })
            .onConflictDoUpdate({
              target: marketSnapshots.snapshotType,
              set: {
                dataJson: data,
                warning: null,
                fetchedAt,
                expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
              },
            });
        } catch (error) {
          if (isUndefinedTableError(error)) {
            cacheAvailable = false;
            cacheUnavailableWarning = 'Market snapshot cache unavailable (table missing). Returning live data without cache.';
            logSnapshotStage('cache_write', requestId, {
              result: 'cache_unavailable',
              cacheTableMissing: true,
              error: getErrorSummary(error),
            });
          } else {
            logRouteError('market-data.snapshot.get.cache-write', error);
          }
        }
      }

      return Response.json({
        data,
        fetchedAt: fetchedAt.toISOString(),
        warning: cacheUnavailableWarning,
        stale: false,
        source: cacheAvailable ? 'live' : 'live-no-cache',
        coverage,
        requestId,
      });
    } catch (error) {
      if (cached) {
        logSnapshotStage('fallback_response', requestId, {
          result: 'served_cached_data',
          reason: 'upstream_fetch_failed',
          hasCachedData: true,
          cacheAvailable,
          error: getErrorSummary(error),
        });
        const ageMs = now.getTime() - cached.fetchedAt.getTime();
        const cachedData = cached.dataJson as MarketSnapshotPayload;
        return Response.json({
          data: cachedData,
          fetchedAt: cached.fetchedAt.toISOString(),
          warning: 'Showing cached market snapshot due to upstream provider failure.',
          stale: ageMs > STALE_WARNING_MS,
          source: 'cache-fallback',
          coverage: buildCoverage(cachedData),
          requestId,
        });
      }

      if (error instanceof Error && error.message.includes('MASSIVE_API_KEY')) {
        logSnapshotStage('upstream_fetch', requestId, {
          result: 'failed',
          reason: 'provider_not_configured',
          hasCachedData: false,
          error: getErrorSummary(error),
        });
        return Response.json(
          {
            error: 'Market data provider not configured',
            code: 'provider_not_configured',
            stage: 'upstream_fetch',
            requestId,
          },
          { status: 503 }
        );
      }

      logSnapshotStage('upstream_fetch', requestId, {
        result: 'failed',
        reason: 'upstream_or_network_error',
        hasCachedData: false,
        error: getErrorSummary(error),
      });
      logRouteError('market-data.snapshot.get.fetch', error);
      return Response.json(
        {
          error: 'Failed to fetch market snapshot',
          code: 'upstream_fetch_failed',
          stage: 'upstream_fetch',
          requestId,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    logSnapshotStage('route_handler', requestId, {
      result: 'failed',
      error: getErrorSummary(error),
    });
    logRouteError('market-data.snapshot.get', error);
    return Response.json(
      {
        error: 'Internal server error',
        code: 'internal_error',
        stage: 'route_handler',
        requestId,
      },
      { status: 500 }
    );
  }
}
