import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

// TradingView screener columns returned in order — index matches d[] array.
// `close` and `change` here are session-dependent (during pre-market they reflect
// yesterday's regular session; during regular hours they reflect today's live values).
// The `premarket_*` columns always reflect the current pre-market session and are used
// directly for the Day 1 Setup table.
const COLUMNS = [
  'name', // 0 — ticker symbol
  'close', // 1 — TV close (session-dependent; live intraday during regular hours)
  'change', // 2 — % change of `close` vs prior session close (session-dependent)
  'volume', // 3 — TV volume (session-dependent; today's regular-session volume during/after regular hours)
  'average_volume_90d_calc', // 4 — 90-day avg volume
  'market_cap_basic', // 5 — market cap
  'sector', // 6 — sector
  'premarket_close', // 7 — pre-market last price
  'premarket_change', // 8 — pre-market % change
  'premarket_volume', // 9 — pre-market volume
];

// Preset filters: price >= $0.90, PM chg > 20%, NASDAQ + NYSE only.
// We intentionally do NOT filter on `volume` server-side. TV's `volume` column
// is session-dependent (yesterday's regular session during PM, today's
// accumulating regular vol during regular hours). A server filter on it would
// drop names from the response once today's regular-session vol fell behind,
// freezing stale entries in the dashboard latch. The 2M floor is enforced
// client-side against the live session volume instead.
const SCAN_BODY = {
  columns: COLUMNS,
  filter: [
    { left: 'close', operation: 'egreater', right: 0.9 },
    { left: 'premarket_change', operation: 'greater', right: 20 },
    { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE'] },
  ],
  sort: { sortBy: 'premarket_change', sortOrder: 'desc' },
  range: [0, 50],
};

export interface TradingViewGainer {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketVolume: number | null;
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

      const toNum = (idx: number) =>
        d[idx] != null && Number.isFinite(Number(d[idx])) ? Number(d[idx]) : null;

      return [{
        ticker,
        price,
        change,
        volume,
        avgVolume90d: toNum(4),
        marketCap: toNum(5),
        sector: typeof d[6] === 'string' && d[6].trim() ? d[6].trim() : null,
        preMarketPrice: toNum(7),
        preMarketChange: toNum(8),
        preMarketVolume: toNum(9),
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
