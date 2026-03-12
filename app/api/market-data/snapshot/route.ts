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

const CACHE_SNAPSHOT_TYPE = 'markets_overview';
const CACHE_TTL_MS = 15 * 60 * 1000;
const STALE_WARNING_MS = 30 * 60 * 1000;

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'RTY'];
const FUTURE_SYMBOLS = [
  { ticker: '/GC', label: 'Gold' },
  { ticker: '/SI', label: 'Silver' },
  { ticker: '/CL', label: 'Crude Oil' },
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

export async function GET() {
  try {
    const auth = await requireUser();
    if ('error' in auth) {
      return auth.error;
    }

    const db = getDb();
    const now = new Date();
    const [cached] = db
      ? await db.select().from(marketSnapshots).where(eq(marketSnapshots.snapshotType, CACHE_SNAPSHOT_TYPE)).orderBy(desc(marketSnapshots.fetchedAt)).limit(1)
      : [];

    if (cached && cached.expiresAt.getTime() > now.getTime()) {
      const ageMs = now.getTime() - cached.fetchedAt.getTime();
      return Response.json({
        data: cached.dataJson,
        fetchedAt: cached.fetchedAt.toISOString(),
        warning: cached.warning,
        stale: ageMs > STALE_WARNING_MS,
        source: 'cache',
      });
    }

    try {
      const data = await fetchFreshSnapshot();
      const fetchedAt = new Date();
      if (db) {
        await db.insert(marketSnapshots).values({
          id: cached?.id ?? crypto.randomUUID(),
          snapshotType: CACHE_SNAPSHOT_TYPE,
          dataJson: data,
          warning: null,
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
        }).onConflictDoUpdate({
          target: marketSnapshots.snapshotType,
          set: {
            dataJson: data,
            warning: null,
            fetchedAt,
            expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
          },
        });
      }

      return Response.json({
        data,
        fetchedAt: fetchedAt.toISOString(),
        warning: null,
        stale: false,
        source: 'live',
      });
    } catch (error) {
      if (cached) {
        const ageMs = now.getTime() - cached.fetchedAt.getTime();
        return Response.json({
          data: cached.dataJson,
          fetchedAt: cached.fetchedAt.toISOString(),
          warning: 'Showing cached market snapshot due to upstream provider failure.',
          stale: ageMs > STALE_WARNING_MS,
          source: 'cache-fallback',
        });
      }

      if (error instanceof Error && error.message.includes('MASSIVE_API_KEY')) {
        return Response.json({ error: 'Market data provider not configured' }, { status: 503 });
      }

      logRouteError('market-data.snapshot.get.fetch', error);
      return Response.json({ error: 'Failed to fetch market snapshot' }, { status: 502 });
    }
  } catch (error) {
    logRouteError('market-data.snapshot.get', error);
    return internalServerError();
  }
}
