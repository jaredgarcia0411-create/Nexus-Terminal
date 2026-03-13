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
