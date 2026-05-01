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

async function fetchMassiveJson<T>(path: string, searchParams: Record<string, string>): Promise<T> {
  const endpoint = new URL(path, MASSIVE_BASE_URL);
  for (const [key, value] of Object.entries(searchParams)) {
    endpoint.searchParams.set(key, value);
  }

  endpoint.searchParams.set('apiKey', getMassiveApiKey());

  const response = await fetch(endpoint.toString(), { cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new Error(`Massive request failed: ${response.status}`);
  }
  return payload;
}

export async function fetchUnifiedSnapshot(tickers: string[]) {
  return fetchMassiveJson<MassiveUnifiedSnapshotResponse>('/v3/snapshot', {
    'ticker.any_of': tickers.join(','),
    limit: String(Math.min(250, tickers.length || 10)),
  });
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

  const response = await fetchMassiveJson<{
    results?: Array<{
      o?: number | null;
      h?: number | null;
      l?: number | null;
      c?: number | null;
      v?: number | null;
      vw?: number | null;
      t?: number | null;
    }>;
  }>(
    `/v2/aggs/ticker/${encodeURIComponent(ticker.trim().toUpperCase())}/range/1/day/${fromStr}/${toStr}`,
    { adjusted: 'true', sort: 'asc', limit: String(days + 5) },
  );

  return (response.results ?? [])
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

/**
 * MDR-eligibility structural check based on prior 20 trading days plus today's mark.
 *
 * Returns true for `eligible` only when ALL of:
 *   - had a "qualifying day" in the prior 20 sessions
 *     (change >= 20% AND dollar vol >= $100M AND green close AND broke prior high)
 *   - today's mark >= 4x the 20-day low (excluding today)
 *   - today's mark > highest high of the prior 20 sessions
 *
 * Note: "today" means the most recent bar in the returned series. If the most
 * recent bar's date matches today's date in America/New_York, that bar is
 * treated as "today's bar" and excluded from the 20-day lookback.
 */
export interface MdrEligibilityResult {
  ticker: string;
  eligible: boolean;
  hadPriorBigDay: boolean;
  isUp3xFromBase: boolean;
  isNew20dHigh: boolean;
  priorBase20Low: number | null;
  priorHigh20: number | null;
  // Most recent prior session close (yesterday's close), session-independent.
  // Used by the dashboard to render a stable PDC for the MDR table.
  priorClose: number | null;
  fetchedAt: string;
}

export async function computeMdrEligibility(
  ticker: string,
  mark: number,
): Promise<MdrEligibilityResult> {
  const fetchedAt = new Date().toISOString();
  const normalizedTicker = ticker.trim().toUpperCase();

  // Pull 25 trading days as buffer; we need 20 prior bars + maybe today's bar.
  const bars = await fetchDailyAggregates(normalizedTicker, 25);

  // Determine "today" in America/New_York. If the most recent bar matches today,
  // treat it as today's bar and slice it off the lookback. Otherwise, all returned
  // bars are prior sessions.
  const todayNY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD

  const lastBar = bars[bars.length - 1];
  const priorBars = lastBar && lastBar.date === todayNY ? bars.slice(0, -1) : bars;

  const lastPriorBar = priorBars[priorBars.length - 1];
  const priorClose = lastPriorBar ? lastPriorBar.close : null;

  // Need at least 20 prior bars for a meaningful lookback. If fewer (new IPO,
  // partial history), we conservatively return ineligible.
  if (priorBars.length < 20) {
    return {
      ticker: normalizedTicker,
      eligible: false,
      hadPriorBigDay: false,
      isUp3xFromBase: false,
      isNew20dHigh: false,
      priorBase20Low: null,
      priorHigh20: null,
      priorClose,
      fetchedAt,
    };
  }

  const lookback = priorBars.slice(-20); // most recent 20 prior trading days

  // 1. Prior qualifying day check.
  // For each bar i in lookback, we need bar[i-1] for "broke prior high".
  // Build a contiguous index over priorBars and walk pairs.
  let hadPriorBigDay = false;
  for (let i = priorBars.length - 20; i < priorBars.length; i += 1) {
    const bar = priorBars[i];
    const prev = priorBars[i - 1]; // may be undefined for the very first bar
    if (!prev) continue; // can't evaluate "broke prior high" without a predecessor
    const changePct = bar.close / prev.close - 1;
    const dollarVol = bar.close * bar.volume;
    const isGreen = bar.close > bar.open;
    const brokePriorHigh = bar.high > prev.high;
    if (changePct >= 0.2 && dollarVol >= 100_000_000 && isGreen && brokePriorHigh) {
      hadPriorBigDay = true;
      break;
    }
  }

  // 2. Up >=3x from 20-day base. Lookback low excludes today by construction.
  const priorBase20Low = Math.min(...lookback.map((b) => b.low));
  const isUp3xFromBase = priorBase20Low > 0 ? mark / priorBase20Low - 1 >= 3 : false;

  // 3. New 20-day high. Lookback high excludes today by construction.
  const priorHigh20 = Math.max(...lookback.map((b) => b.high));
  const isNew20dHigh = mark > priorHigh20;

  const eligible = hadPriorBigDay && isUp3xFromBase && isNew20dHigh;

  return {
    ticker: normalizedTicker,
    eligible,
    hadPriorBigDay,
    isUp3xFromBase,
    isNew20dHigh,
    priorBase20Low,
    priorHigh20,
    priorClose,
    fetchedAt,
  };
}
