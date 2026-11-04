import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import {
  fetchMassiveAggregateBars,
  isMassiveConfigured,
  MassiveRequestError,
  type MassiveAggregateBar,
} from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

// Massive ticker symbols: equities plus prefixed forms like C:EURUSD / I:SPX.
const SYMBOL_REGEX = /^[A-Z0-9.\-^:]{1,20}$/;
const FREQUENCY_TYPES = new Set(['minute', 'daily', 'weekly', 'monthly']);
const PERIOD_TYPES = new Set(['day', 'month', 'year']);
// Intraday bar size in minutes. Massive accepts any positive multiplier; a day
// is the sane upper bound for a minute timespan.
const MAX_MINUTE_MULTIPLIER = 1440;

function parseMinuteMultiplier(raw: string): string | null {
  if (!/^\d{1,4}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 && value <= MAX_MINUTE_MULTIPLIER ? String(value) : null;
}

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
  const value = Math.min(1000, Math.max(1, Math.floor(Number(period)) || 1));

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
    if (!SYMBOL_REGEX.test(symbol)) {
      return Response.json({ error: 'Invalid symbol' }, { status: 400 });
    }

    if (!isMassiveConfigured()) {
      return Response.json({ error: 'Market data provider not configured' }, { status: 503 });
    }

    const periodType = searchParams.get('periodType') ?? 'day';
    const period = searchParams.get('period') ?? '1';
    const frequencyType = searchParams.get('frequencyType') ?? 'minute';
    const frequencyRaw = searchParams.get('frequency') ?? '5';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    // includePrePost is accepted for backward compatibility but not forwarded.
    void searchParams.get('includePrePost');

    // These values become path segments of the upstream Massive URL. Only a
    // known timespan and a small integer bar size may reach the provider.
    if (!FREQUENCY_TYPES.has(frequencyType) || !PERIOD_TYPES.has(periodType)) {
      return Response.json({ error: 'Invalid frequencyType or periodType' }, { status: 400 });
    }
    const frequency = frequencyType === 'minute' ? parseMinuteMultiplier(frequencyRaw) : '1';
    if (!frequency) {
      return Response.json({ error: 'frequency must be a whole number of minutes' }, { status: 400 });
    }

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

    let bars: MassiveAggregateBar[];
    try {
      bars = await fetchMassiveAggregateBars({
        ticker: symbol,
        multiplier,
        timespan,
        from,
        to,
      });
    } catch (error) {
      if (error instanceof MassiveRequestError) {
        return Response.json({ error: 'Failed to fetch market data' }, { status: error.status || 502 });
      }
      console.error('[api:market-data] upstream request failed', { symbol, error: String(error) });
      return Response.json({ error: 'Market data provider unavailable' }, { status: 502 });
    }

    if (bars.length === 0) {
      return Response.json({ symbol, candles: [] });
    }

    const candles = bars.flatMap((bar) => {
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
