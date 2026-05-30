export interface TradingViewPriceContext {
  price: number;
  change: number | null;
  volume: number | null;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
  high1m: number | null;
  low1m: number | null;
  rsi: number | null;
  macdSignal: number | null;
  ema9: number | null;
  ema21: number | null;
}

export const TRADINGVIEW_COLUMNS = [
  'name',
  'close',
  'change',
  'volume',
  'average_volume_90d_calc',
  'market_cap_basic',
  'sector',
  'High.1M',
  'Low.1M',
  'RSI',
  'MACD.macd',
  'EMA9',
  'EMA21',
];

export type TradingViewScanPayload = {
  totalCount?: number;
  data?: Array<{ s: string; d: unknown[] }>;
};

export async function scanTradingView(body: unknown): Promise<TradingViewScanPayload> {
  const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';
  const response = await fetch('https://scanner.tradingview.com/america/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { Cookie: `sessionid=${sessionId}` } : {}),
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://www.tradingview.com',
      Referer: 'https://www.tradingview.com/',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`TradingView scanner returned ${response.status}`);
  }

  return (await response.json()) as TradingViewScanPayload;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(numeric) ? numeric : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function fetchTradingViewPriceContext(ticker: string): Promise<TradingViewPriceContext | null> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const payload = await scanTradingView({
    columns: TRADINGVIEW_COLUMNS,
    filter: [
      { left: 'name', operation: 'equal', right: normalizedTicker },
    ],
    range: [0, 1],
  });
  const row = payload.data?.find((candidate) => candidate.s?.split(':')[1] === normalizedTicker)
    ?? payload.data?.[0];
  if (!row?.d) {
    return null;
  }

  const price = toNullableNumber(row.d[1]);
  if (price === null) {
    return null;
  }

  return {
    price,
    change: toNullableNumber(row.d[2]),
    volume: toNullableNumber(row.d[3]),
    avgVolume90d: toNullableNumber(row.d[4]),
    marketCap: toNullableNumber(row.d[5]),
    sector: typeof row.d[6] === 'string' && row.d[6].trim() ? row.d[6].trim() : null,
    high1m: toNullableNumber(row.d[7]),
    low1m: toNullableNumber(row.d[8]),
    rsi: toNullableNumber(row.d[9]),
    macdSignal: toNullableNumber(row.d[10]),
    ema9: toNullableNumber(row.d[11]),
    ema21: toNullableNumber(row.d[12]),
  };
}
