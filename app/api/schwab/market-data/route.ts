import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { getValidSchwabToken } from '@/lib/schwab';

type SchwabPriceHistoryResponse = {
  candles?: Array<{
    datetime?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  }>;
  empty?: boolean;
  error?: string;
};

const ALLOWED_PERIOD_TYPES = ['day', 'month', 'year', 'ytd'];
const ALLOWED_FREQUENCY_TYPES = ['minute', 'daily', 'weekly', 'monthly'];

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol) {
    return Response.json({ error: 'symbol is required' }, { status: 400 });
  }

  let token;
  try {
    token = await getValidSchwabToken(db, authState.user.id);
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Could not refresh Schwab token';
    return Response.json({ error: text }, { status: 502 });
  }

  if (!token) {
    return Response.json({ error: 'Schwab not connected' }, { status: 401 });
  }

  // Flexible query params with sensible defaults
  const periodType = searchParams.get('periodType') ?? 'year';
  const period = searchParams.get('period') ?? '1';
  const frequencyType = searchParams.get('frequencyType') ?? 'daily';
  const frequency = searchParams.get('frequency') ?? '1';
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!ALLOWED_PERIOD_TYPES.includes(periodType)) {
    return Response.json({ error: `Invalid periodType: ${periodType}` }, { status: 400 });
  }
  if (!ALLOWED_FREQUENCY_TYPES.includes(frequencyType)) {
    return Response.json({ error: `Invalid frequencyType: ${frequencyType}` }, { status: 400 });
  }

  const apiBase = process.env.SCHWAB_API_BASE_URL || 'https://api.schwabapi.com';
  const url = new URL('/marketdata/v1/pricehistory', apiBase);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('periodType', periodType);
  url.searchParams.set('period', period);
  url.searchParams.set('frequencyType', frequencyType);
  url.searchParams.set('frequency', frequency);
  url.searchParams.set('needExtendedHoursData', 'false');

  if (startDate) url.searchParams.set('startDate', startDate);
  if (endDate) url.searchParams.set('endDate', endDate);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => ({}))) as SchwabPriceHistoryResponse;

  if (!res.ok) {
    if (res.status === 429) {
      return Response.json({ error: 'Schwab API rate limit reached. Try again shortly.' }, { status: 429 });
    }
    if (res.status === 404 || payload.empty) {
      return Response.json({ error: `Symbol not found: ${symbol}` }, { status: 404 });
    }
    return Response.json({ error: payload.error || 'Failed to fetch Schwab market data' }, { status: 502 });
  }

  const candles = (payload.candles ?? []).map((candle) => {
    const rawDate = candle.datetime ?? 0;
    const datetime = rawDate < 1_000_000_000_000 ? rawDate * 1000 : rawDate;
    return {
      datetime,
      open: Number(candle.open ?? 0),
      high: Number(candle.high ?? 0),
      low: Number(candle.low ?? 0),
      close: Number(candle.close ?? 0),
      volume: Number(candle.volume ?? 0),
    };
  });

  return Response.json({ symbol, candles });
}
