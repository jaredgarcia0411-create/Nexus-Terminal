import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { marketSnapshots } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

const SCHWAB_SCREENER_SNAPSHOT_TYPE = 'schwab_screener';
const MIN_PRIOR_CLOSE = 0.75;

// Common OTC suffixes and patterns — these aren't on major exchanges
const OTC_PATTERN = /[.][A-Z]$|^[A-Z]{5,}$/;

type MoverRow = {
  symbol?: string;
  lastPrice?: number;
  netChange?: number;
  netChangePercent?: number;
  totalVolume?: number;
};

/**
 * Filter screener results:
 * 1. Exclude OTC symbols (5+ char tickers or dotted suffixes like .F, .PK)
 * 2. Require prior close >= $0.75 (calculated from price - change)
 */
function filterMovers(rows: MoverRow[]): MoverRow[] {
  return rows.filter((row) => {
    if (!row.symbol) return false;

    // Exclude likely OTC symbols
    if (OTC_PATTERN.test(row.symbol)) return false;

    // Calculate prior close and filter sub-penny / sub-$0.75 stocks
    const price = row.lastPrice;
    const change = row.netChange;
    if (price == null || change == null) return false;
    const priorClose = price - change;
    if (priorClose < MIN_PRIOR_CLOSE) return false;

    return true;
  });
}

/**
 * GET /api/market-data/movers
 *
 * Returns the latest Schwab screener gainers/losers from the DB.
 * The relay service keeps this data up-to-date in real time.
 * Filters out OTC symbols and stocks with prior close below $0.75.
 */
export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) {
    return Response.json({ gainers: [], losers: [] });
  }

  const [row] = await db
    .select({ dataJson: marketSnapshots.dataJson, fetchedAt: marketSnapshots.fetchedAt })
    .from(marketSnapshots)
    .where(eq(marketSnapshots.snapshotType, SCHWAB_SCREENER_SNAPSHOT_TYPE))
    .limit(1);

  if (!row) {
    return Response.json({ gainers: [], losers: [], fetchedAt: null });
  }

  const data = row.dataJson as {
    gainers?: MoverRow[];
    losers?: MoverRow[];
  };

  return Response.json({
    gainers: filterMovers(data.gainers ?? []),
    losers: filterMovers(data.losers ?? []),
    fetchedAt: row.fetchedAt.toISOString(),
  });
}
