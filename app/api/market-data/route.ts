import { requireUser } from '@/lib/server-db-utils';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';

type MassiveAggResponse = {
  ticker?: string;
  adjusted?: boolean;
  queryCount?: number;
  resultsCount?: number;
  status?: string;
  results?: Array<{
    o?: number | null;
    h?: number | null;
    l?: number | null;
    c?: number | null;
    v?: number | null;
    vw?: number | null;
    t?: number | null;
    n?: number | null;
  }>;
};

function toMassiveTimespan(frequencyType: string, frequency: string) {
  if (frequencyType === 'minute') return { multiplier: frequency, timespan: 'minute' };
  if (frequencyType === 'daily') return { multiplier: '1', timespan: 'day' };
  if (frequencyType === 'weekly') return { multiplier: '1', timespan: 'week' };
  if (frequencyType === 'monthly') return { multiplier: '1', timespan: 'month' };
  return { multiplier: '1', timespan: 'day' };
}

function computeDateRange(periodType: string, period: string) {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const value = Math.max(1, Number(period) || 1);

  const past = new Date(now);
  if (periodType === 'day') {
    past.setDate(past.getDate() - value);
  } else if (periodType === 'month') {
    past.setMonth(past.getMonth() - value);
  } else if (periodType === 'year') {
    past.setFullYear(past.getFullYear() - value);
  } else {
    past.setMonth(past.getMonth() - 1);
  }

  const from = past.toISOString().split('T')[0];
  return { from, to };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireUser();
    if ('error' in auth) {
      const authError = auth.error;
      if (authError instanceof Response) {
        return authError;
      }
      return internalServerError();
    }

    const { searchParams } = new URL(request.url);

    const symbol = searchParams.get('symbol')?.trim().toUpperCase();
    if (!symbol) {
      return Response.json({ error: 'Missing symbol' }, { status: 400 });
    }

    const apiKey = process.env.MASSIVE_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'Market data provider not configured' }, { status: 503 });
    }

    const periodType = searchParams.get('periodType') ?? 'day';
    const period = searchParams.get('period') ?? '1';
    const frequencyType = searchParams.get('frequencyType') ?? 'minute';
    const frequency = searchParams.get('frequency') ?? '5';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    // includePrePost is accepted for backward compatibility but not forwarded.
    void searchParams.get('includePrePost');

    const { multiplier, timespan } = toMassiveTimespan(frequencyType, frequency);

    const startMs = startDate ? Number(startDate) : NaN;
    const endMs = endDate ? Number(endDate) : NaN;

    let from: string;
    let to: string;

    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      from = String(startMs);
      to = String(endMs);
    } else {
      const range = computeDateRange(periodType, period);
      from = range.from;
      to = range.to;
    }

    const endpoint = new URL(`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${multiplier}/${timespan}/${from}/${to}`);
    endpoint.searchParams.set('apiKey', apiKey);
    endpoint.searchParams.set('adjusted', 'true');
    endpoint.searchParams.set('sort', 'asc');
    endpoint.searchParams.set('limit', '50000');

    let res: Response;
    try {
      res = await fetch(endpoint.toString(), {
        cache: 'no-store',
      });
    } catch (error) {
      console.error('[api:market-data] upstream request failed', { symbol, error: String(error) });
      return Response.json({ error: 'Market data provider unavailable' }, { status: 502 });
    }

    const payload = (await res.json().catch(() => ({}))) as MassiveAggResponse;
    if (!res.ok) {
      return Response.json({ error: 'Failed to fetch market data' }, { status: res.status || 502 });
    }

    const results = payload.results ?? [];
    if (results.length === 0) {
      return Response.json({ symbol, candles: [] });
    }

    const candles = results.flatMap((bar) => {
      const open = Number(bar.o ?? NaN);
      const high = Number(bar.h ?? NaN);
      const low = Number(bar.l ?? NaN);
      const close = Number(bar.c ?? NaN);
      if (![open, high, low, close].every(Number.isFinite)) return [];

      const volume = Number(bar.v ?? 0);

      return [{
        datetime: bar.t ?? 0,
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
