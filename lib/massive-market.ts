import { atr, ema50, type OHLCData } from '@/lib/indicators';

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

// ============================================================
// MDR cron helpers
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
export async function fetchGroupedDailyAggregates(date: string): Promise<GroupedDailyBar[]> {
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
    { adjusted: 'true' },
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

export interface D2MdrTriggerResult {
  triggered: boolean;
  reason?: string;
  priorHigh20: number | null;
  priorLow20: number | null;
  priorBigDayDate: string | null;
}

export interface MdrThresholds {
  pmPriceNeeded: number | null;
  openingGapNeededPercent: number | null;
  intradayPriceNeeded: number | null;
  basisPrice: number | null;
  atr14: number | null;
}

export interface D2MdrDailyEvaluation {
  ticker: string;
  triggered: boolean;
  reason?: string;
  todayBar: GroupedDailyBar | null;
  priorBars: GroupedDailyBar[];
  priorHigh20: number | null;
  priorLow20: number | null;
  priorBigDayDate: string | null;
  thresholds: MdrThresholds;
  atr14: number | null;
  ema50: number | null;
  fetchedAt: string;
}

/**
 * Full d2_mdr evaluator. Mirrors the Python at
 * /mnt/c/Users/jared/Downloads/mdr swing scan.py:493.
 *
 * `priorBars` MUST be oldest-first and contain at least 20 bars. The
 * 20-day lookback uses the most-recent 20 bars in `priorBars`. The
 * "prior big day" search walks the same 20-day window and requires
 * each candidate bar to have a predecessor (so it can compare highs).
 *
 * All conditions must pass for `triggered: true`:
 *   1. (today.close / prevClose - 1) >= 0.20
 *   2. today.close >= 1
 *   3. today.volume >= 10_000_000
 *   4. today.high > prevHigh
 *   5. today.close > today.open
 *   6. today.high > max(20 prior highs)
 *   7. (today.high / min(20 prior lows)) - 1 >= 3
 *   8. there exists a "prior big day" in the last 20 prior bars where:
 *      change >= 20% AND dollar_vol >= $100M AND close > open AND high > prev.high
 */
export function evaluateD2MdrTrigger(
  today: GroupedDailyBar,
  priorBars: GroupedDailyBar[],
): D2MdrTriggerResult {
  if (priorBars.length < 20) {
    return { triggered: false, reason: 'insufficient_history', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
  }

  const lookback = priorBars.slice(-20);
  const lastPrior = lookback[lookback.length - 1];

  const changePct = today.close / lastPrior.close - 1;
  if (changePct < 0.2) return { triggered: false, reason: 'change_below_20pct', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
  if (today.close < 1) return { triggered: false, reason: 'close_below_1', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
  if (today.volume < 10_000_000) return { triggered: false, reason: 'volume_below_10m', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
  if (today.high <= lastPrior.high) return { triggered: false, reason: 'did_not_break_prior_high', priorHigh20: null, priorLow20: null, priorBigDayDate: null };
  if (today.close <= today.open) return { triggered: false, reason: 'not_green', priorHigh20: null, priorLow20: null, priorBigDayDate: null };

  const priorHigh20 = Math.max(...lookback.map((b) => b.high));
  const priorLow20 = Math.min(...lookback.map((b) => b.low));
  if (today.high <= priorHigh20) return { triggered: false, reason: 'not_new_20d_high', priorHigh20, priorLow20, priorBigDayDate: null };
  if (priorLow20 <= 0) return { triggered: false, reason: 'invalid_prior_low', priorHigh20, priorLow20, priorBigDayDate: null };
  if (today.high / priorLow20 - 1 < 3) return { triggered: false, reason: 'not_up_3x_from_base', priorHigh20, priorLow20, priorBigDayDate: null };

  // Prior big day: walk the last 20 prior bars; each candidate needs a
  // predecessor (priorBars[i-1]) for the prevHigh comparison.
  let priorBigDayDate: string | null = null;
  const lookbackStartIdx = priorBars.length - 20;
  for (let i = lookbackStartIdx; i < priorBars.length; i += 1) {
    const bar = priorBars[i];
    const prev = priorBars[i - 1];
    if (!prev) continue;
    const bigChange = bar.close / prev.close - 1;
    const dollarVol = bar.close * bar.volume;
    const isGreen = bar.close > bar.open;
    const brokeHigh = bar.high > prev.high;
    if (bigChange >= 0.2 && dollarVol >= 100_000_000 && isGreen && brokeHigh) {
      priorBigDayDate = bar.timestamp > 0
        ? new Date(bar.timestamp).toISOString().split('T')[0]!
        : null;
      break;
    }
  }
  if (priorBigDayDate === null) return { triggered: false, reason: 'no_prior_big_day', priorHigh20, priorLow20, priorBigDayDate: null };

  return { triggered: true, priorHigh20, priorLow20, priorBigDayDate };
}

const NULL_MDR_THRESHOLDS: MdrThresholds = {
  pmPriceNeeded: null,
  openingGapNeededPercent: null,
  intradayPriceNeeded: null,
  basisPrice: null,
  atr14: null,
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function lastFinite(values: Array<number | null | undefined>) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function dailyBarTime(date: string) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function toGroupedDailyBar(ticker: string, bar: DailyOhlcBar): GroupedDailyBar {
  return {
    ticker,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    vwap: bar.vwap,
    timestamp: dailyBarTime(bar.date),
  };
}

function toOhlcData(bars: DailyOhlcBar[]): OHLCData[] {
  return bars.map((bar, index) => ({
    time: dailyBarTime(bar.date) || index,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

function indicatorContext(bars: DailyOhlcBar[]) {
  const ohlc = toOhlcData(bars);
  return {
    atr14: lastFinite(atr(ohlc, 14)),
    ema50: lastFinite(ema50(bars.map((bar) => bar.close))),
  };
}

export function calculateMdrThresholds(
  todayBar: Pick<GroupedDailyBar, 'open' | 'high' | 'close'> | null,
  atr14: number | null,
): MdrThresholds {
  if (
    !todayBar
    || typeof atr14 !== 'number'
    || !Number.isFinite(atr14)
    || atr14 <= 0
    || ![todayBar.open, todayBar.high, todayBar.close].every(Number.isFinite)
  ) {
    return { ...NULL_MDR_THRESHOLDS };
  }

  const highChange = todayBar.high - todayBar.open;
  const candidates = [
    Math.max(todayBar.high + atr14, todayBar.high + highChange * 0.3),
    todayBar.close + atr14,
    todayBar.close + atr14,
    Math.max(todayBar.high + atr14 * 0.5, todayBar.close + atr14),
    todayBar.close + atr14 * 3,
  ].filter(Number.isFinite);

  if (candidates.length === 0) {
    return { ...NULL_MDR_THRESHOLDS };
  }

  const basisPrice = round2(Math.min(...candidates));
  const openingGapNeededPercent = todayBar.close > 0
    ? round2((basisPrice / todayBar.close - 1) * 100)
    : null;

  return {
    pmPriceNeeded: basisPrice,
    openingGapNeededPercent,
    intradayPriceNeeded: basisPrice,
    basisPrice,
    atr14: round2(atr14),
  };
}

export function evaluateD2MdrDailySeries(
  ticker: string,
  bars: DailyOhlcBar[],
  asOfDate?: string,
): D2MdrDailyEvaluation {
  const normalizedTicker = normalizeMassiveTicker(ticker);
  const ordered = [...bars]
    .filter((bar) => !asOfDate || bar.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const todaySource = ordered[ordered.length - 1] ?? null;
  const todayBar = todaySource ? toGroupedDailyBar(normalizedTicker, todaySource) : null;
  const priorBars = ordered.slice(0, -1).map((bar) => toGroupedDailyBar(normalizedTicker, bar));
  const context = indicatorContext(ordered);
  const thresholds = calculateMdrThresholds(todayBar, context.atr14);

  if (!todayBar || priorBars.length < 20) {
    return {
      ticker: normalizedTicker,
      triggered: false,
      reason: 'insufficient_history',
      todayBar,
      priorBars,
      priorHigh20: null,
      priorLow20: null,
      priorBigDayDate: null,
      thresholds: priorBars.length < 20 ? { ...NULL_MDR_THRESHOLDS } : thresholds,
      atr14: context.atr14,
      ema50: context.ema50,
      fetchedAt: new Date().toISOString(),
    };
  }

  const result = evaluateD2MdrTrigger(todayBar, priorBars);
  return {
    ticker: normalizedTicker,
    triggered: result.triggered,
    reason: result.reason,
    todayBar,
    priorBars,
    priorHigh20: result.priorHigh20,
    priorLow20: result.priorLow20,
    priorBigDayDate: result.priorBigDayDate,
    thresholds,
    atr14: context.atr14,
    ema50: context.ema50,
    fetchedAt: new Date().toISOString(),
  };
}

export async function evaluateLatestD2MdrTrigger(
  ticker: string,
  options: { days?: number; asOfDate?: string } = {},
): Promise<D2MdrDailyEvaluation> {
  const normalizedTicker = normalizeMassiveTicker(ticker);
  const days = Math.max(60, Math.trunc(options.days ?? 80));
  const history = await fetchDailyAggregates(normalizedTicker, days);
  return evaluateD2MdrDailySeries(normalizedTicker, history, options.asOfDate);
}

/** True if today.close <= 0.90 * prev.close (single -10% red day). */
export function isInvalidationDay(today: GroupedDailyBar, prev: GroupedDailyBar): boolean {
  if (prev.close <= 0) return false;
  return today.close / prev.close - 1 <= -0.10;
}
