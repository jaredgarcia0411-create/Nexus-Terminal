const MASSIVE_BASE_URL = 'https://api.massive.com';

export type MassiveDirection = 'gainers' | 'losers';
export type EasternMarketSession = 'pre-market' | 'regular' | 'after-hours' | 'closed';

export interface MassiveSnapshotResult {
  ticker?: string;
  type?: string;
  name?: string;
  market_status?: string;
  session?: {
    close?: number;
    previous_close?: number;
    change?: number;
    change_percent?: number;
    high?: number;
    low?: number;
    open?: number;
    volume?: number;
  };
  error?: string;
  message?: string;
}

export interface MassiveUnifiedSnapshotResponse {
  status?: string;
  results?: MassiveSnapshotResult[];
}

export interface MassiveMarketMoverTicker {
  ticker?: string;
  todaysChange?: number;
  todaysChangePerc?: number;
  updated?: number;
  day?: { c?: number };
  prevDay?: { c?: number };
}

export interface MassiveTopMoversResponse {
  status?: string;
  tickers?: MassiveMarketMoverTicker[];
}

export interface MassiveDailyTickerSummaryResponse {
  symbol?: string;
  from?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  preMarket?: number;
  afterHours?: number;
  status?: string;
}

export interface MassiveBatchDailySummaryRow {
  ticker: string;
  close: number | null;
  preMarket: number | null;
  afterHours: number | null;
}

export interface DailyOhlcBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
}

export interface MassiveAggregateBar {
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  v?: number | null;
  vw?: number | null;
  t?: number | null;
  n?: number | null;
}

export interface MassiveNewsArticle {
  id?: string;
  title?: string;
  author?: string;
  description?: string;
  article_url?: string;
  published_utc?: string;
  tickers?: string[];
  keywords?: string[];
  publisher?: {
    name?: string;
  };
  insights?: Array<{
    ticker?: string;
    sentiment?: string;
    sentiment_reasoning?: string;
  }>;
}

export function normalizeMassiveTicker(raw: string) {
  return raw
    .replace(/^X:/i, '')
    .replace(/^C:/i, '')
    .replace(/^I:/i, '')
    .replace(/^\//, '')
    .trim()
    .toUpperCase();
}

export class MassiveRequestError extends Error {
  constructor(public readonly status: number) {
    super(`Massive request failed: ${status}`);
    this.name = 'MassiveRequestError';
  }
}

function toNumberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getEasternMarketSession(now = new Date()): EasternMarketSession {
  const nyDayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(now);
  if (nyDayLabel === 'Sat' || nyDayLabel === 'Sun') {
    return 'closed';
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const totalMinutes = (hour * 60) + minute;

  if (totalMinutes >= 240 && totalMinutes < 570) {
    return 'pre-market';
  }
  if (totalMinutes >= 570 && totalMinutes < 960) {
    return 'regular';
  }
  if (totalMinutes >= 960 && totalMinutes < 1200) {
    return 'after-hours';
  }
  return 'closed';
}

function getMassiveApiKey() {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('MASSIVE_API_KEY is not configured');
  }
  return apiKey;
}

export function isMassiveConfigured(): boolean {
  return Boolean(process.env.MASSIVE_API_KEY?.trim());
}

async function fetchMassiveJson<T>(path: string, searchParams: Record<string, string>): Promise<T> {
  const endpoint = new URL(path, MASSIVE_BASE_URL);
  for (const [key, value] of Object.entries(searchParams)) {
    endpoint.searchParams.set(key, value);
  }

  endpoint.searchParams.set('apiKey', getMassiveApiKey());

  const response = await fetch(endpoint.toString(), { cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new MassiveRequestError(response.status);
  }
  return payload;
}

export async function fetchUnifiedSnapshot(tickers: string[]) {
  return fetchMassiveJson<MassiveUnifiedSnapshotResponse>('/v3/snapshot', {
    'ticker.any_of': tickers.join(','),
    limit: String(Math.min(250, tickers.length || 10)),
  });
}

export interface MassiveTickerDetails {
  description: string | null;
  homepageUrl: string | null;
  sicDescription: string | null;
}

// /v3/reference/tickers/{ticker} returns company profile data. Coverage isn't universal —
// distressed/recently-renamed tickers often come back with description: null. Caller should
// treat null as "no description available" and hide the UI block.
export async function fetchTickerDetails(ticker: string): Promise<MassiveTickerDetails> {
  const normalized = normalizeMassiveTicker(ticker);
  const payload = await fetchMassiveJson<{
    results?: {
      description?: string | null;
      homepage_url?: string | null;
      sic_description?: string | null;
    };
  }>(`/v3/reference/tickers/${encodeURIComponent(normalized)}`, {});

  const results = payload.results ?? {};
  const description = typeof results.description === 'string' && results.description.trim().length > 0
    ? results.description.trim()
    : null;
  return {
    description,
    homepageUrl: typeof results.homepage_url === 'string' ? results.homepage_url : null,
    sicDescription: typeof results.sic_description === 'string' ? results.sic_description : null,
  };
}

// `date` (YYYY-MM-DD) asks the reference endpoint for shares outstanding as of
// that date, so historical sheet rows get the float that was accurate then —
// important for the low-float small-caps that dilute often. Omit it for the
// current snapshot.
export async function fetchSharesOutstanding(ticker: string, date?: string): Promise<number | null> {
  const normalized = normalizeMassiveTicker(ticker);
  const payload = await fetchMassiveJson<{
    results?: {
      weighted_shares_outstanding?: number | string | null;
      share_class_shares_outstanding?: number | string | null;
    };
  }>(`/v3/reference/tickers/${encodeURIComponent(normalized)}`, date ? { date } : {});

  const results = payload.results ?? {};
  const shares = toNumberOrNull(results.weighted_shares_outstanding)
    ?? toNumberOrNull(results.share_class_shares_outstanding);
  if (shares != null) return shares;

  console.warn(`Massive shares outstanding unavailable for ${normalized}`);
  return null;
}

export async function fetchTopMarketMovers(direction: MassiveDirection) {
  return fetchMassiveJson<MassiveTopMoversResponse>(`/v2/snapshot/locale/us/markets/stocks/${direction}`, {
    include_otc: 'false',
  });
}

export async function fetchDailyTickerSummary(ticker: string, date: string) {
  return fetchMassiveJson<MassiveDailyTickerSummaryResponse>(`/v1/open-close/${encodeURIComponent(ticker)}/${encodeURIComponent(date)}`, {
    adjusted: 'true',
  });
}

export async function fetchBatchDailyTickerSummaries(tickers: string[], date: string) {
  const settled = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const payload = await fetchDailyTickerSummary(ticker, date);
      return {
        ticker,
        close: toNumberOrNull(payload.close),
        preMarket: toNumberOrNull(payload.preMarket),
        afterHours: toNumberOrNull(payload.afterHours),
      } as MassiveBatchDailySummaryRow;
    })
  );

  const byNormalizedTicker = new Map<string, MassiveBatchDailySummaryRow>();
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    if (result.status === 'fulfilled') {
      byNormalizedTicker.set(normalizeMassiveTicker(result.value.ticker), result.value);
      continue;
    }

    const ticker = tickers[i] ?? '';
    byNormalizedTicker.set(normalizeMassiveTicker(ticker), {
      ticker,
      close: null,
      preMarket: null,
      afterHours: null,
    });
  }
  return byNormalizedTicker;
}

export async function fetchTickerNews(ticker: string, daysBack = 3): Promise<MassiveNewsArticle[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const sinceStr = since.toISOString().split('T')[0]!;
  const normalizedTicker = normalizeMassiveTicker(ticker);

  const response = await fetchMassiveJson<{
    results?: MassiveNewsArticle[];
  }>('/v2/reference/news', {
    ticker: normalizedTicker,
    'published_utc.gte': sinceStr,
    order: 'desc',
    sort: 'published_utc',
    limit: '10',
  });

  return response.results ?? [];
}

export async function fetchMassiveAggregateBars(params: {
  ticker: string;
  multiplier: string;
  timespan: string;
  from: string;
  to: string;
  limit?: number;
}): Promise<MassiveAggregateBar[]> {
  const payload = await fetchMassiveJson<{
    results?: MassiveAggregateBar[];
  }>(
    `/v2/aggs/ticker/${encodeURIComponent(params.ticker.trim().toUpperCase())}/range/${params.multiplier}/${params.timespan}/${params.from}/${params.to}`,
    { adjusted: 'true', sort: 'asc', limit: String(params.limit ?? 50000) },
  );

  return payload.results ?? [];
}

/**
 * Fetch daily OHLC bars from Massive (Polygon-compatible) aggregates API.
 * Returns the most recent `days` trading days of data.
 */
export async function fetchDailyAggregates(
  ticker: string,
  days: number = 10,
): Promise<DailyOhlcBar[]> {
  const to = new Date();
  const from = new Date();
  // Extra calendar days to account for weekends/holidays
  from.setDate(from.getDate() - Math.ceil(days * 1.6));

  const toStr = to.toISOString().split('T')[0]!;
  const fromStr = from.toISOString().split('T')[0]!;

  const bars = await fetchMassiveAggregateBars({
    ticker,
    multiplier: '1',
    timespan: 'day',
    from: fromStr,
    to: toStr,
    limit: days + 5,
  });

  return bars
    .flatMap((bar) => {
      const open = Number(bar.o ?? NaN);
      const high = Number(bar.h ?? NaN);
      const low = Number(bar.l ?? NaN);
      const close = Number(bar.c ?? NaN);
      if (![open, high, low, close].every(Number.isFinite)) return [];

      const volume = Number(bar.v ?? 0);
      const timestamp = Number(bar.t ?? 0);

      return [{
        date: timestamp > 0 ? new Date(timestamp).toISOString().split('T')[0]! : 'unknown',
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        vwap: Number.isFinite(Number(bar.vw)) ? Number(bar.vw) : null,
      }];
    })
    .slice(-days);
}

// ============================================================
// Grouped daily aggregate helpers
// ============================================================

export interface GroupedDailyBar {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  timestamp: number;
}

/**
 * Pull every US stock's daily bar for `date` from Massive's grouped
 * aggregates endpoint. Returns [] for non-trading days (Massive returns
 * no results for weekends/holidays).
 */
export async function fetchGroupedDailyAggregates(date: string, adjusted = true): Promise<GroupedDailyBar[]> {
  const response = await fetchMassiveJson<{
    results?: Array<{
      T?: string;
      o?: number | null;
      h?: number | null;
      l?: number | null;
      c?: number | null;
      v?: number | null;
      vw?: number | null;
      t?: number | null;
    }>;
  }>(
    `/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(date)}`,
    { adjusted: String(adjusted) },
  );

  return (response.results ?? []).flatMap((bar) => {
    const ticker = (bar.T ?? '').trim().toUpperCase();
    const open = Number(bar.o ?? NaN);
    const high = Number(bar.h ?? NaN);
    const low = Number(bar.l ?? NaN);
    const close = Number(bar.c ?? NaN);
    const volume = Number(bar.v ?? NaN);
    if (!ticker) return [];
    if (![open, high, low, close, volume].every(Number.isFinite)) return [];

    return [{
      ticker,
      open,
      high,
      low,
      close,
      volume,
      vwap: Number.isFinite(Number(bar.vw)) ? Number(bar.vw) : null,
      timestamp: Number(bar.t ?? 0),
    }];
  });
}
