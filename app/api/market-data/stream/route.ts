import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { marketSnapshots, realtimeQuotes, schwabLinks } from '@/lib/db/schema';
import { createSSEResponse } from '@/lib/sse';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PUSH_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SCHWAB_SCREENER_SNAPSHOT_TYPE = 'schwab_screener';

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'] as const;
const COMMODITY_SYMBOLS = [
  { ticker: 'GLD', label: 'Gold' },
  { ticker: 'SLV', label: 'Silver' },
  { ticker: 'USO', label: 'Crude Oil' },
  { ticker: 'UNG', label: 'Natural Gas' },
  { ticker: 'TLT', label: 'Treasuries' },
  { ticker: 'UUP', label: 'US Dollar' },
] as const;
const EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'TSLA', 'META', 'JPM', 'JNJ', 'V'] as const;

type ScannerSortKey = 'symbol' | 'lastPrice' | 'netChange' | 'netChangePercent' | 'totalVolume';
type ScannerSortDir = 'asc' | 'desc';

type QuoteRow = {
  symbol: string;
  assetType: 'equity' | 'etf' | 'future' | 'forex' | 'index' | 'crypto';
  lastPrice: number | null;
  netChange: number | null;
  netChangePercent: number | null;
  totalVolume: number | null;
  securityStatus: string | null;
  updatedAt: Date;
};

type ScannerParams = {
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minVolume?: number;
  assetType?: QuoteRow['assetType'];
  sortBy: ScannerSortKey;
  sortDir: ScannerSortDir;
  limit: number;
};

type MoverRow = {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  updated: number | null;
  volume: number | null;
};

function toNumberOrUndefined(value: string | null): number | undefined {
  if (value == null) return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\//g, '');
}

function parseScannerParams(request: Request): ScannerParams {
  const { searchParams } = new URL(request.url);

  const sortByRaw = searchParams.get('sortBy');
  const sortBy: ScannerSortKey =
    sortByRaw === 'symbol' ||
    sortByRaw === 'lastPrice' ||
    sortByRaw === 'netChange' ||
    sortByRaw === 'netChangePercent' ||
    sortByRaw === 'totalVolume'
      ? sortByRaw
      : 'netChangePercent';

  const sortDir: ScannerSortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(toNumberOrUndefined(searchParams.get('limit')) ?? 100, 1), 500);

  const assetTypeRaw = searchParams.get('assetType');
  const assetType: QuoteRow['assetType'] | undefined =
    assetTypeRaw === 'equity' ||
    assetTypeRaw === 'etf' ||
    assetTypeRaw === 'future' ||
    assetTypeRaw === 'forex' ||
    assetTypeRaw === 'index' ||
    assetTypeRaw === 'crypto'
      ? assetTypeRaw
      : undefined;

  return {
    minPrice: toNumberOrUndefined(searchParams.get('minPrice')),
    maxPrice: toNumberOrUndefined(searchParams.get('maxPrice')),
    minChangePercent: toNumberOrUndefined(searchParams.get('minChangePercent')),
    maxChangePercent: toNumberOrUndefined(searchParams.get('maxChangePercent')),
    minVolume: toNumberOrUndefined(searchParams.get('minVolume')),
    assetType,
    sortBy,
    sortDir,
    limit,
  };
}

function mapSnapshotFromQuotes(quotes: QuoteRow[]) {
  const quoteLookup = new Map(quotes.map((quote) => [normalizeSymbol(quote.symbol), quote]));

  const toInstrument = (symbol: string, label: string) => {
    const quote = quoteLookup.get(normalizeSymbol(symbol));
    if (!quote) {
      return {
        symbol,
        label,
        price: null,
        change: null,
        changePercent: null,
        marketStatus: null,
        quoteSession: 'snapshot' as const,
        extendedQuoteUnavailable: false,
        extendedUnavailableLabel: null,
      };
    }

    return {
      symbol,
      label,
      price: quote.lastPrice,
      change: quote.netChange,
      changePercent: quote.netChangePercent,
      marketStatus: quote.securityStatus,
      quoteSession: 'regular' as const,
      extendedQuoteUnavailable: false,
      extendedUnavailableLabel: null,
    };
  };

  return {
    indices: INDEX_SYMBOLS.map((symbol) => toInstrument(symbol, symbol)),
    commodities: COMMODITY_SYMBOLS.map((item) => toInstrument(item.ticker, item.label)),
    equities: EQUITY_SYMBOLS.map((symbol) => toInstrument(symbol, symbol)),
  };
}

function mapMovers(dataJson: unknown): { gainers: MoverRow[]; losers: MoverRow[] } {
  const data = dataJson as {
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

  const toRows = (rows: typeof data.gainers): MoverRow[] => {
    if (!rows) return [];

    return rows
      .map((row): MoverRow | null => {
        if (!row.symbol) return null;
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
      .filter((row): row is MoverRow => row !== null);
  };

  return {
    gainers: toRows(data.gainers),
    losers: toRows(data.losers),
  };
}

function applyScannerFilters(quotes: QuoteRow[], scannerParams: ScannerParams) {
  const filtered = quotes.filter((quote) => {
    if (scannerParams.minPrice !== undefined && (quote.lastPrice ?? 0) < scannerParams.minPrice) return false;
    if (scannerParams.maxPrice !== undefined && (quote.lastPrice ?? 0) > scannerParams.maxPrice) return false;
    if (scannerParams.minChangePercent !== undefined && (quote.netChangePercent ?? 0) < scannerParams.minChangePercent) return false;
    if (scannerParams.maxChangePercent !== undefined && (quote.netChangePercent ?? 0) > scannerParams.maxChangePercent) return false;
    if (scannerParams.minVolume !== undefined && (quote.totalVolume ?? 0) < scannerParams.minVolume) return false;
    if (scannerParams.assetType && quote.assetType !== scannerParams.assetType) return false;
    return quote.lastPrice != null;
  });

  const direction = scannerParams.sortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    if (scannerParams.sortBy === 'symbol') {
      return a.symbol.localeCompare(b.symbol) * direction;
    }

    const left = a[scannerParams.sortBy] ?? 0;
    const right = b[scannerParams.sortBy] ?? 0;
    return (left - right) * direction;
  });

  return filtered.slice(0, scannerParams.limit);
}

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) {
    return authState.error;
  }

  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  const [link] = await db
    .select({ id: schwabLinks.id, status: schwabLinks.status, refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt })
    .from(schwabLinks)
    .where(eq(schwabLinks.userId, authState.user.id))
    .limit(1);

  if (!link || link.status !== 'active' || link.refreshTokenExpiresAt.getTime() < Date.now()) {
    return Response.json({ error: 'realtime_unavailable' }, { status: 400 });
  }

  const scannerParams = parseScannerParams(request);

  return createSSEResponse(request.signal, (send) => {
    let running = true;

    const pushData = async () => {
      if (!running) return;

      try {
        const quotes: QuoteRow[] = await db
          .select({
            symbol: realtimeQuotes.symbol,
            assetType: realtimeQuotes.assetType,
            lastPrice: realtimeQuotes.lastPrice,
            netChange: realtimeQuotes.netChange,
            netChangePercent: realtimeQuotes.netChangePercent,
            totalVolume: realtimeQuotes.totalVolume,
            securityStatus: realtimeQuotes.securityStatus,
            updatedAt: realtimeQuotes.updatedAt,
          })
          .from(realtimeQuotes);

        const [screenerRow] = await db
          .select({ dataJson: marketSnapshots.dataJson })
          .from(marketSnapshots)
          .where(eq(marketSnapshots.snapshotType, SCHWAB_SCREENER_SNAPSHOT_TYPE))
          .orderBy(desc(marketSnapshots.fetchedAt))
          .limit(1);

        const movers = screenerRow ? mapMovers(screenerRow.dataJson) : { gainers: [], losers: [] };
        const latestQuoteTime = quotes.reduce<number>((max, quote) => {
          const ts = quote.updatedAt.getTime();
          return ts > max ? ts : max;
        }, Date.now());

        send('snapshot', {
          quotes,
          movers,
          fetchedAt: new Date(latestQuoteTime).toISOString(),
          dataSource: 'realtime',
          mappedSnapshot: {
            ...mapSnapshotFromQuotes(quotes),
            movers,
          },
        });

        send('scanner', {
          results: applyScannerFilters(quotes, scannerParams),
        });
      } catch (error) {
        console.error('[market-stream] push error', error);
        send('error', { message: 'Failed to fetch market data' });
      }
    };

    void pushData();

    const dataInterval = setInterval(() => {
      void pushData();
    }, PUSH_INTERVAL_MS);

    const heartbeatInterval = setInterval(() => {
      send('heartbeat', { ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      running = false;
      clearInterval(dataInterval);
      clearInterval(heartbeatInterval);
    };
  });
}
