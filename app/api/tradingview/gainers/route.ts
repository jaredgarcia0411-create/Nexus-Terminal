import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

// TradingView screener columns returned in order — index matches d[] array.
// `close`, `change`, `volume` are session-dependent (during pre-market they reflect
// yesterday's regular session; during regular hours they reflect today's live values).
// The `premarket_*` columns reflect today's pre-market session.
// The `postmarket_*` columns reflect the most recent after-hours session — that's
// yesterday's AH (4–8 PM yesterday) until today's AH starts at 4 PM, at which
// point they switch to today's AH. For Day 1 qualification we want yesterday's
// AH (the gap heading into today's regular open), which is what `postmarket_*`
// returns from PM through to today's regular session close.
const COLUMNS = [
  'name', // 0 — ticker symbol
  'close', // 1 — TV close (session-dependent)
  'change', // 2 — % change of `close` vs prior session close
  'volume', // 3 — TV volume (session-dependent)
  'average_volume_90d_calc', // 4 — 90-day avg volume
  'market_cap_basic', // 5 — market cap
  'sector', // 6 — sector
  'premarket_close', // 7 — pre-market last price
  'premarket_change', // 8 — pre-market % change vs prior regular close
  'premarket_volume', // 9 — pre-market volume
  'postmarket_close', // 10 — most recent after-hours close
  'postmarket_change', // 11 — after-hours % change
  'postmarket_volume', // 12 — after-hours volume
];

// Day 1 qualification rules (per user spec):
//   - market cap < $300M
//   - close >= $0.90  (defensive penny-stock floor; existing behavior)
//   - NASDAQ or NYSE listed
//   - PM gap >= 40% with PM volume >= 2M  OR  AH gap >= 40% with AH volume >= 2M
//
// Once a name passes server-side here it gets latched on the dashboard for the
// rest of the day, even if the criteria stop holding (sticky semantics).
//
// `filter` is the legacy AND-only filter list. `filter2` is TradingView's
// nested boolean syntax — we use it here to express the OR between the PM and
// AH qualification branches.
const PM_GAP_THRESHOLD = 40;
const AH_GAP_THRESHOLD = 40;
const SESSION_VOLUME_FLOOR = 2_000_000;

const SCAN_BODY = {
  columns: COLUMNS,
  filter: [
    { left: 'close', operation: 'egreater', right: 0.9 },
    { left: 'market_cap_basic', operation: 'eless', right: 300_000_000 },
    { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE'] },
  ],
  filter2: {
    operator: 'and',
    operands: [
      {
        operation: {
          operator: 'or',
          operands: [
            {
              operation: {
                operator: 'and',
                operands: [
                  { expression: { left: 'premarket_change', operation: 'egreater', right: PM_GAP_THRESHOLD } },
                  { expression: { left: 'premarket_volume', operation: 'egreater', right: SESSION_VOLUME_FLOOR } },
                ],
              },
            },
            {
              operation: {
                operator: 'and',
                operands: [
                  { expression: { left: 'postmarket_change', operation: 'egreater', right: AH_GAP_THRESHOLD } },
                  { expression: { left: 'postmarket_volume', operation: 'egreater', right: SESSION_VOLUME_FLOOR } },
                ],
              },
            },
          ],
        },
      },
    ],
  },
  sort: { sortBy: 'premarket_change', sortOrder: 'desc' },
  range: [0, 100],
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
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketVolume: number | null;
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
        postMarketPrice: toNum(10),
        postMarketChange: toNum(11),
        postMarketVolume: toNum(12),
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
