import { internalServerError, logRouteError } from '@/lib/api-route-utils';

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

function toYahooInterval(frequencyType: string, frequency: string) {
  if (frequencyType === 'minute') {
    const minute = Number(frequency);
    if ([1, 2, 5, 15, 30, 60, 90].includes(minute)) return `${minute}m`;
    return '5m';
  }

  if (frequencyType === 'daily') return '1d';
  if (frequencyType === 'weekly') return '1wk';
  if (frequencyType === 'monthly') return '1mo';
  return '1d';
}

function toYahooRange(periodType: string, period: string) {
  const value = Number(period);
  if (!Number.isFinite(value) || value <= 0) return '1mo';

  if (periodType === 'day') return `${value}d`;
  if (periodType === 'month') return `${value}mo`;
  if (periodType === 'year') return `${value}y`;
  return '1mo';
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const symbol = searchParams.get('symbol')?.trim().toUpperCase();
    if (!symbol) {
      return Response.json({ error: 'Missing symbol' }, { status: 400 });
    }

    const periodType = searchParams.get('periodType') ?? 'day';
    const period = searchParams.get('period') ?? '1';
    const frequencyType = searchParams.get('frequencyType') ?? 'minute';
    const frequency = searchParams.get('frequency') ?? '5';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const includePrePost = searchParams.get('includePrePost') === 'true';

    const interval = toYahooInterval(frequencyType, frequency);
    const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    endpoint.searchParams.set('interval', interval);
    endpoint.searchParams.set('includePrePost', includePrePost ? 'true' : 'false');

    const startMs = startDate ? Number(startDate) : NaN;
    const endMs = endDate ? Number(endDate) : NaN;

    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      endpoint.searchParams.set('period1', String(Math.floor(startMs / 1000)));
      endpoint.searchParams.set('period2', String(Math.floor(endMs / 1000)));
    } else {
      endpoint.searchParams.set('range', toYahooRange(periodType, period));
    }

    let res: Response;
    try {
      res = await fetch(endpoint.toString(), {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch (error) {
      console.error('[api:market-data] upstream request failed', { symbol, error });
      return Response.json({ error: 'Market data provider unavailable' }, { status: 502 });
    }

    const payload = (await res.json().catch(() => ({}))) as YahooChartResponse;
    if (!res.ok || payload.chart?.error) {
      const message = payload.chart?.error?.description ?? 'Failed to fetch market data';
      return Response.json({ error: message }, { status: res.status || 502 });
    }

    const result = payload.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (!quote || timestamps.length === 0) {
      return Response.json({ symbol, candles: [] });
    }

    const candles = timestamps.flatMap((ts, index) => {
      const open = Number(quote.open?.[index] ?? NaN);
      const high = Number(quote.high?.[index] ?? NaN);
      const low = Number(quote.low?.[index] ?? NaN);
      const close = Number(quote.close?.[index] ?? NaN);
      const volume = Number(quote.volume?.[index] ?? 0);
      if (![open, high, low, close].every(Number.isFinite)) return [];

      return [{
        datetime: ts * 1000,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      }];
    });

    return Response.json({ symbol, candles });
  } catch (error) {
    logRouteError('market-data.get', error);
    return internalServerError();
  }
}
