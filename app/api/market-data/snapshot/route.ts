import { desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { marketSnapshots, realtimeQuotes, schwabLinks } from '@/lib/db/schema';
import {
  fetchBatchDailyTickerSummaries,
  fetchTopMarketMovers,
  fetchUnifiedSnapshot,
  getEasternMarketSession,
  normalizeMassiveTicker,
  type EasternMarketSession,
} from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

type MarketInstrument = {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketStatus: string | null;
  quoteSession: EasternMarketSession | 'snapshot';
  extendedQuoteUnavailable: boolean;
  extendedUnavailableLabel: string | null;
};

type MarketMoverRow = {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  updated: number | null;
  volume: number | null;
};

type MarketSnapshotPayload = {
  indices: MarketInstrument[];
  futures: MarketInstrument[];
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
    fx: number;
    equities: number;
  };
};

const CACHE_SNAPSHOT_TYPE = 'markets_overview';
const CACHE_TTL_MS = 2 * 60 * 1000;
const STALE_WARNING_MS = 30 * 60 * 1000;
const REALTIME_STALE_MS = 5 * 60 * 1000;
const SCHWAB_SCREENER_SNAPSHOT_TYPE = 'schwab_screener';

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
const FX_SYMBOLS = ['C:EURUSD', 'C:GBPUSD', 'C:USDJPY', 'C:USDCAD', 'C:AUDUSD'];
const EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'TSLA', 'META', 'JPM', 'JNJ', 'V'];
const EXTENDED_SESSION_SYMBOLS = [...INDEX_SYMBOLS, ...EQUITY_SYMBOLS];

function normalizeTicker(raw: string) {
  return normalizeMassiveTicker(raw);
}

function normalizeRealtimeSymbol(raw: string) {
  return normalizeTicker(raw).replace(/\//g, '');
}

function toNumberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getNyIsoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function calculateExtendedChange(price: number | null, close: number | null) {
  if (price == null || close == null || close === 0) {
    return { change: null, changePercent: null };
  }
  const change = price - close;
  return {
    change,
    changePercent: (change / close) * 100,
  };
}

function toInstrument(
  ticker: string,
  label: string,
  lookup: Map<string, { session?: Record<string, unknown>; market_status?: string }>,
  activeSession: EasternMarketSession,
  extendedSummaries?: Map<string, { close: number | null; preMarket: number | null; afterHours: number | null }>
): MarketInstrument {
  const symbol = normalizeTicker(ticker);
  const entry = lookup.get(normalizeTicker(ticker));
  const session = entry?.session ?? {};

  const defaultInstrument: MarketInstrument = {
    symbol,
    label,
    price: toNumberOrNull(session.close),
    change: toNumberOrNull(session.change),
    changePercent: toNumberOrNull(session.change_percent),
    marketStatus: typeof entry?.market_status === 'string' ? entry.market_status : null,
    quoteSession: 'snapshot',
    extendedQuoteUnavailable: false,
    extendedUnavailableLabel: null,
  };

  if (!extendedSummaries) {
    return defaultInstrument;
  }

  const extended = extendedSummaries.get(symbol);
  if (!extended) {
    return defaultInstrument;
  }

  if (activeSession === 'pre-market') {
    if (extended.preMarket != null) {
      const calculated = calculateExtendedChange(extended.preMarket, extended.close);
      return {
        ...defaultInstrument,
        price: extended.preMarket,
        change: calculated.change,
        changePercent: calculated.changePercent,
        quoteSession: 'pre-market',
      };
    }

    return {
      ...defaultInstrument,
      quoteSession: 'pre-market',
      extendedQuoteUnavailable: true,
      extendedUnavailableLabel: 'Pre-market unavailable',
    };
  }

  if (activeSession === 'after-hours' || activeSession === 'closed') {
    if (extended.afterHours != null) {
      const calculated = calculateExtendedChange(extended.afterHours, extended.close);
      return {
        ...defaultInstrument,
        price: extended.afterHours,
        change: calculated.change,
        changePercent: calculated.changePercent,
        quoteSession: 'after-hours',
      };
    }

    if (activeSession === 'after-hours') {
      return {
        ...defaultInstrument,
        quoteSession: 'after-hours',
        extendedQuoteUnavailable: true,
        extendedUnavailableLabel: 'After-hours unavailable',
      };
    }

    return {
      ...defaultInstrument,
      quoteSession: 'closed',
    };
  }

  return {
    ...defaultInstrument,
    quoteSession: 'regular',
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
      volume: null,
    }))
    .filter((row) => row.ticker.length > 0)
    .filter((row) => (row.previousClose ?? 0) >= 0.75);
}

async function fetchFreshSnapshot(): Promise<MarketSnapshotPayload> {
  const tickers = [
    ...INDEX_SYMBOLS,
    ...FUTURE_SYMBOLS.map((item) => item.ticker),
    ...FX_SYMBOLS,
    ...EQUITY_SYMBOLS,
  ];

  const activeSession = getEasternMarketSession();
  const [snapshot, gainers, losers, extendedSummaries] = await Promise.all([
    fetchUnifiedSnapshot(tickers),
    fetchTopMarketMovers('gainers'),
    fetchTopMarketMovers('losers'),
    fetchBatchDailyTickerSummaries(EXTENDED_SESSION_SYMBOLS, getNyIsoDate()),
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
    indices: INDEX_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup, activeSession, extendedSummaries)),
    futures: FUTURE_SYMBOLS.map((item) => toInstrument(item.ticker, item.label, lookup, activeSession)),
    fx: FX_SYMBOLS.map((symbol) => toInstrument(symbol, normalizeTicker(symbol), lookup, activeSession)),
    equities: EQUITY_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup, activeSession, extendedSummaries)),
    movers: {
      gainers: toMoverRows(gainers.tickers ?? []),
      losers: toMoverRows(losers.tickers ?? []),
    },
  };
}

async function getSchwabLinkStatus(db: ReturnType<typeof getDb>, userId: string) {
  if (!db) return { active: false };
  try {
    const [link] = await db
      .select({ status: schwabLinks.status, refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt })
      .from(schwabLinks)
      .where(eq(schwabLinks.userId, userId))
      .limit(1);

    if (!link) return { active: false };
    if (link.status !== 'active') return { active: false };
    if (link.refreshTokenExpiresAt.getTime() < Date.now()) return { active: false };

    return { active: true };
  } catch {
    return { active: false };
  }
}

async function fetchRealtimeSnapshot(
  db: NonNullable<ReturnType<typeof getDb>>,
): Promise<{ data: MarketSnapshotPayload; fetchedAt: Date } | null> {
  const [latestUpdate] = await db
    .select({ updatedAt: realtimeQuotes.updatedAt })
    .from(realtimeQuotes)
    .orderBy(desc(realtimeQuotes.updatedAt))
    .limit(1);

  if (!latestUpdate) {
    return null;
  }

  if (Date.now() - latestUpdate.updatedAt.getTime() > REALTIME_STALE_MS) {
    return null;
  }

  const currentSession = getEasternMarketSession();

  const quotes = await db.select().from(realtimeQuotes);
  if (quotes.length === 0) {
    return null;
  }

  const quoteLookup = new Map(quotes.map((quote) => [normalizeRealtimeSymbol(quote.symbol), quote]));

  const mapRealtimeInstrument = (symbol: string, label: string): MarketInstrument => {
    const quote = quoteLookup.get(normalizeRealtimeSymbol(symbol));
    if (!quote) {
      return {
        symbol: normalizeTicker(symbol),
        label,
        price: null,
        change: null,
        changePercent: null,
        marketStatus: null,
        quoteSession: 'snapshot',
        extendedQuoteUnavailable: false,
        extendedUnavailableLabel: null,
      };
    }

    return {
      symbol: normalizeTicker(symbol),
      label,
      price: quote.lastPrice ?? null,
      change: quote.netChange ?? null,
      changePercent: quote.netChangePercent ?? null,
      marketStatus: quote.securityStatus ?? null,
      quoteSession: currentSession,
      extendedQuoteUnavailable: false,
      extendedUnavailableLabel: null,
    };
  };

  let screenerGainers: MarketMoverRow[] = [];
  let screenerLosers: MarketMoverRow[] = [];

  try {
    const [screenerRow] = await db
      .select({ dataJson: marketSnapshots.dataJson })
      .from(marketSnapshots)
      .where(eq(marketSnapshots.snapshotType, SCHWAB_SCREENER_SNAPSHOT_TYPE))
      .limit(1);

    if (screenerRow) {
      const screenerData = screenerRow.dataJson as {
        gainers?: Array<{
          symbol?: string;
          lastPrice?: number;
          netChange?: number;
          netChangePercent?: number;
          totalVolume?: number;
        }>;
        losers?: Array<{
          symbol?: string;
          lastPrice?: number;
          netChange?: number;
          netChangePercent?: number;
          totalVolume?: number;
        }>;
      };

      const toMoverRows = (
        rows: Array<{
          symbol?: string;
          lastPrice?: number;
          netChange?: number;
          netChangePercent?: number;
          totalVolume?: number;
        }> | undefined,
      ): MarketMoverRow[] => {
        if (!rows) {
          return [];
        }

        return rows
          .map((row): MarketMoverRow | null => {
            if (!row.symbol || row.symbol.length === 0) {
              return null;
            }

            return {
              ticker: row.symbol,
              price: row.lastPrice ?? null,
              previousClose: null,
              change: row.netChange ?? null,
              changePercent: row.netChangePercent ?? null,
              updated: null,
              volume: row.totalVolume ?? null,
            };
          })
          .filter((row): row is MarketMoverRow => row !== null);
      };

      screenerGainers = toMoverRows(screenerData.gainers);
      screenerLosers = toMoverRows(screenerData.losers);
    }
  } catch {
    screenerGainers = [];
    screenerLosers = [];
  }

  return {
    data: {
      indices: INDEX_SYMBOLS.map((symbol) => mapRealtimeInstrument(symbol, symbol)),
      futures: FUTURE_SYMBOLS.map((item) => mapRealtimeInstrument(item.ticker, item.label)),
      fx: FX_SYMBOLS.map((symbol) => mapRealtimeInstrument(symbol, normalizeTicker(symbol))),
      equities: EQUITY_SYMBOLS.map((symbol) => mapRealtimeInstrument(symbol, symbol)),
      movers: {
        gainers: screenerGainers,
        losers: screenerLosers,
      },
    },
    fetchedAt: latestUpdate.updatedAt,
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
  console.info('[api:market-data.snapshot]', {
    requestId,
    stage,
    ...details,
  });
}

function countMissing(items: MarketInstrument[]) {
  return items.filter((item) => item.price == null).length;
}

function buildCoverage(data: MarketSnapshotPayload): SnapshotCoverage {
  const totalInstruments = data.indices.length + data.futures.length + data.fx.length + data.equities.length;
  const missingPriceBySection = {
    indices: countMissing(data.indices),
    futures: countMissing(data.futures),
    fx: countMissing(data.fx),
    equities: countMissing(data.equities),
  };
  const missingPriceCount =
    missingPriceBySection.indices +
    missingPriceBySection.futures +
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
    const schwabStatus = await getSchwabLinkStatus(db, auth.user.id);

    if (db && schwabStatus.active) {
      const realtimeSnapshot = await fetchRealtimeSnapshot(db);
      if (realtimeSnapshot) {
        const coverage = buildCoverage(realtimeSnapshot.data);
        return Response.json({
          data: realtimeSnapshot.data,
          fetchedAt: realtimeSnapshot.fetchedAt.toISOString(),
          warning: null,
          stale: false,
          source: 'realtime',
          coverage,
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
        warning: cached.warning ?? realtimeFallbackWarning,
        stale: ageMs > STALE_WARNING_MS,
        source: 'cache',
        coverage: buildCoverage(cachedData),
        dataSource: 'delayed',
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
        warning: cacheUnavailableWarning ?? realtimeFallbackWarning,
        stale: false,
        source: cacheAvailable ? 'live' : 'live-no-cache',
        coverage,
        dataSource: 'delayed',
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
          dataSource: 'delayed',
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
