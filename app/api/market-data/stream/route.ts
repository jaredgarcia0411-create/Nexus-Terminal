import { desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, toNumberOrUndefined } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { marketSnapshots, realtimeQuotes, schwabLinks } from '@/lib/db/schema';
import { createSSEResponse } from '@/lib/sse';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PUSH_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SCHWAB_SCREENER_SNAPSHOT_TYPE = 'schwab_screener';

import type { ScannerSortDir, ScannerSortKey } from '@/lib/types';
import {
  normalizeQuoteSymbol,
  quotesToSnapshot,
  schwabScreenerToMoverRows,
  type MarketMoverRow,
  type SchwabScreenerItem,
} from '@/lib/quote-mappers';

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
  const quoteLookup = new Map(quotes.map((quote) => [normalizeQuoteSymbol(quote.symbol), quote]));
  return quotesToSnapshot(quoteLookup);
}

function mapMovers(dataJson: unknown): { gainers: MarketMoverRow[]; losers: MarketMoverRow[] } {
  const data = dataJson as {
    gainers?: SchwabScreenerItem[];
    losers?: SchwabScreenerItem[];
  };

  return {
    gainers: schwabScreenerToMoverRows(data.gainers),
    losers: schwabScreenerToMoverRows(data.losers),
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

  try {
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
  } catch (error) {
    logRouteError('market-data-stream', error);
    return internalServerError();
  }
}
