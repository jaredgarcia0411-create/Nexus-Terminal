import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

// TradingView screener columns returned in order — index matches d[] array
const COLUMNS = [
  'name', // 0 — ticker symbol
  'close', // 1 — current price
  'change', // 2 — % change today
  'volume', // 3 — today's volume
  'average_volume_90d_calc', // 4 — 90-day avg volume
  'market_cap_basic', // 5 — market cap
  'sector', // 6 — sector
];

// Jared's preset filters: price > $1.12, change > 30%, market cap < $300M, major exchanges only
const SCAN_BODY = {
  columns: COLUMNS,
  filter: [
    { left: 'close', operation: 'greater', right: 1.12 },
    { left: 'change', operation: 'greater', right: 30 },
    { left: 'market_cap_basic', operation: 'less', right: 300_000_000 },
    { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'NYSE ARCA'] },
  ],
  sort: { sortBy: 'change', sortOrder: 'desc' },
  range: [0, 30],
};

export interface TradingViewGainer {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
}

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';

  try {
    const response = await fetch('https://scanner.tradingview.com/america/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Without a session cookie, TradingView returns 15-min delayed data.
        // With it, data is real-time. Either way the endpoint works.
        ...(sessionId ? { Cookie: `sessionid=${sessionId}` } : {}),
        'User-Agent': 'Mozilla/5.0',
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
      },
      body: JSON.stringify(SCAN_BODY),
      cache: 'no-store',
    });

    if (!response.ok) {
      return Response.json(
        { error: `TradingView scanner returned ${response.status}` },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as {
      totalCount?: number;
      data?: Array<{ s: string; d: unknown[] }>;
    };

    const raw = payload.data ?? [];

    const gainers: TradingViewGainer[] = raw.flatMap((row) => {
      // row.s is "EXCHANGE:TICKER" — strip the exchange prefix
      const ticker = (row.s ?? '').split(':')[1];
      if (!ticker) return [];

      const d = row.d;
      const price = Number(d[1]);
      const change = Number(d[2]);
      const volume = Number(d[3]);

      // Skip rows with bad price or change data
      if (!Number.isFinite(price) || !Number.isFinite(change) || !Number.isFinite(volume)) return [];

      return [{
        ticker,
        price,
        change,
        volume,
        avgVolume90d: d[4] != null && Number.isFinite(Number(d[4])) ? Number(d[4]) : null,
        marketCap: d[5] != null && Number.isFinite(Number(d[5])) ? Number(d[5]) : null,
        sector: typeof d[6] === 'string' && d[6].trim() ? d[6].trim() : null,
      }];
    });

    return Response.json({
      gainers,
      count: gainers.length,
      totalCount: payload.totalCount ?? gainers.length,
      isRealtime: Boolean(sessionId),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    logRouteError('tradingview-gainers', error);
    return internalServerError();
  }
}
