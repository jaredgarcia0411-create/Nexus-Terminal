import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  'name',
  'close',
  'change',
  'volume',
  'average_volume_90d_calc',
  'market_cap_basic',
  'sector',
  'premarket_close',
  'premarket_change',
  'premarket_volume',
];

// MDR-aligned filter set — mirrors the Python d2_mdr precondition stack
// (close >= $1, vol >= 10M, regular-session change >= 20%) so anything
// passing the Python scan also passes this gate.
const SCAN_BODY = {
  columns: COLUMNS,
  filter: [
    { left: 'close', operation: 'egreater', right: 1 },
    { left: 'volume', operation: 'egreater', right: 10_000_000 },
    { left: 'change', operation: 'egreater', right: 20 },
    { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE'] },
  ],
  sort: { sortBy: 'change', sortOrder: 'desc' },
  range: [0, 100],
};

export interface MdrCandidate {
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

    const candidates: MdrCandidate[] = raw.flatMap((row) => {
      const ticker = (row.s ?? '').split(':')[1];
      if (!ticker) return [];

      const d = row.d;
      const price = Number(d[1]);
      const change = Number(d[2]);
      const volume = Number(d[3]);
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
      candidates,
      count: candidates.length,
      totalCount: payload.totalCount ?? candidates.length,
      isRealtime: Boolean(sessionId),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    logRouteError('tradingview-mdr-candidates', error);
    return internalServerError();
  }
}
