import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { realtimeQuotes } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

const SORTABLE_COLUMNS = {
  symbol: realtimeQuotes.symbol,
  lastPrice: realtimeQuotes.lastPrice,
  netChange: realtimeQuotes.netChange,
  netChangePercent: realtimeQuotes.netChangePercent,
  totalVolume: realtimeQuotes.totalVolume,
} as const;

type SortableKey = keyof typeof SORTABLE_COLUMNS;

function isSortableKey(value: string): value is SortableKey {
  return value in SORTABLE_COLUMNS;
}

const VALID_ASSET_TYPES = ['equity', 'etf', 'future', 'forex', 'index', 'crypto'] as const;

function toNumberOrUndefined(value: string | null): number | undefined {
  if (value == null) {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) {
      return authState.error;
    }

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);

    const minPrice = toNumberOrUndefined(searchParams.get('minPrice'));
    const maxPrice = toNumberOrUndefined(searchParams.get('maxPrice'));
    const minChangePercent = toNumberOrUndefined(searchParams.get('minChangePercent'));
    const maxChangePercent = toNumberOrUndefined(searchParams.get('maxChangePercent'));
    const minVolume = toNumberOrUndefined(searchParams.get('minVolume'));
    const assetTypeParam = searchParams.get('assetType');
    const assetType =
      assetTypeParam && VALID_ASSET_TYPES.includes(assetTypeParam as (typeof VALID_ASSET_TYPES)[number])
        ? (assetTypeParam as (typeof VALID_ASSET_TYPES)[number])
        : undefined;

    const sortByParam = searchParams.get('sortBy') ?? 'netChangePercent';
    const sortBy = isSortableKey(sortByParam) ? sortByParam : 'netChangePercent';
    const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

    const limitParam = toNumberOrUndefined(searchParams.get('limit'));
    const limit = Math.min(Math.max(limitParam ?? 100, 1), 500);

    const conditions = [];
    conditions.push(sql`${realtimeQuotes.lastPrice} IS NOT NULL`);

    if (minPrice !== undefined) {
      conditions.push(gte(realtimeQuotes.lastPrice, minPrice));
    }
    if (maxPrice !== undefined) {
      conditions.push(lte(realtimeQuotes.lastPrice, maxPrice));
    }
    if (minChangePercent !== undefined) {
      conditions.push(gte(realtimeQuotes.netChangePercent, minChangePercent));
    }
    if (maxChangePercent !== undefined) {
      conditions.push(lte(realtimeQuotes.netChangePercent, maxChangePercent));
    }
    if (minVolume !== undefined) {
      conditions.push(gte(realtimeQuotes.totalVolume, minVolume));
    }
    if (assetType !== undefined) {
      conditions.push(eq(realtimeQuotes.assetType, assetType));
    }

    const sortColumn = SORTABLE_COLUMNS[sortBy];
    const orderFn = sortDir === 'asc' ? asc : desc;

    const rows = await db
      .select({
        symbol: realtimeQuotes.symbol,
        assetType: realtimeQuotes.assetType,
        lastPrice: realtimeQuotes.lastPrice,
        netChange: realtimeQuotes.netChange,
        netChangePercent: realtimeQuotes.netChangePercent,
        totalVolume: realtimeQuotes.totalVolume,
        updatedAt: realtimeQuotes.updatedAt,
      })
      .from(realtimeQuotes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderFn(sortColumn))
      .limit(limit);

    return Response.json({
      results: rows,
      count: rows.length,
      filters: { minPrice, maxPrice, minChangePercent, maxChangePercent, minVolume, assetType },
      sort: { sortBy, sortDir },
    });
  } catch (error) {
    logRouteError('scanner.get', error);
    return internalServerError();
  }
}
