import { desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { marketSnapshots, realtimeQuotes, schwabLinks } from '@/lib/db/schema';
import { INDEX_SYMBOLS, COMMODITY_SYMBOLS, EQUITY_SYMBOLS } from '@/lib/market-symbols';
import {
  normalizeQuoteSymbol,
  quotesToSnapshot,
  schwabScreenerToMoverRows,
  type MarketMoverRow,
  type MarketSnapshotPayload,
  type SchwabScreenerItem,
} from '@/lib/quote-mappers';
import { getEasternMarketSession } from '@/lib/massive-market';
import { normalizeTicker } from '@/lib/massive-snapshot';

export type RealtimeSnapshotResult = {
  data: MarketSnapshotPayload;
  fetchedAt: Date;
};

const REALTIME_STALE_MS = 5 * 60 * 1000;
const SCHWAB_SCREENER_SNAPSHOT_TYPE = 'schwab_screener';
const REALTIME_CACHE_TTL_MS = 3_000;

// In-memory cache for realtime snapshot path.
// Since Vercel functions may cold-start, this is best-effort and per-process.
let realtimeCache: { payload: RealtimeSnapshotResult; cachedAt: number } | null = null;

function normalizeRealtimeSymbol(raw: string) {
  return normalizeQuoteSymbol(normalizeTicker(raw));
}

export async function getSchwabLinkStatus(db: ReturnType<typeof getDb>, userId: string) {
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

export async function fetchRealtimeSnapshot(
  db: NonNullable<ReturnType<typeof getDb>>,
): Promise<RealtimeSnapshotResult | null> {
  if (realtimeCache && Date.now() - realtimeCache.cachedAt < REALTIME_CACHE_TTL_MS) {
    return realtimeCache.payload;
  }

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
  const neededSymbols = [...INDEX_SYMBOLS, ...COMMODITY_SYMBOLS.map((item) => item.ticker), ...EQUITY_SYMBOLS];

  const quotes = await db
    .select({
      symbol: realtimeQuotes.symbol,
      lastPrice: realtimeQuotes.lastPrice,
      netChange: realtimeQuotes.netChange,
      netChangePercent: realtimeQuotes.netChangePercent,
      securityStatus: realtimeQuotes.securityStatus,
    })
    .from(realtimeQuotes)
    .where(inArray(realtimeQuotes.symbol, neededSymbols));

  if (quotes.length === 0) {
    return null;
  }

  const quoteLookup = new Map(quotes.map((quote) => [normalizeRealtimeSymbol(quote.symbol), quote]));
  const { indices, commodities, equities } = quotesToSnapshot(quoteLookup, currentSession);

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
        gainers?: SchwabScreenerItem[];
        losers?: SchwabScreenerItem[];
      };

      screenerGainers = schwabScreenerToMoverRows(screenerData.gainers);
      screenerLosers = schwabScreenerToMoverRows(screenerData.losers);
    }
  } catch {
    screenerGainers = [];
    screenerLosers = [];
  }

  const result: RealtimeSnapshotResult = {
    data: {
      indices,
      commodities,
      equities,
      movers: {
        gainers: screenerGainers,
        losers: screenerLosers,
      },
    },
    fetchedAt: latestUpdate.updatedAt,
  };

  realtimeCache = { payload: result, cachedAt: Date.now() };
  return result;
}
