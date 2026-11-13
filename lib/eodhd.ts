import type { AskEdgarResponse } from '@/lib/askedgar/types';

const EODHD_NEWS_URL = 'https://eodhd.com/api/news';
const REQUEST_TIMEOUT_MS = 15_000;

function getApiKey() {
  return process.env.EODHD_API_KEY?.trim() ?? '';
}

// EODHD expects an exchange-suffixed symbol (e.g. AAPL.US). Our tickers are
// plain US symbols, so append .US unless a suffix is already present.
function toEodhdSymbol(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  return upper.includes('.') ? upper : `${upper}.US`;
}

export async function fetchEodhdNews(ticker: string, limit = 20, range?: { from: string; to: string }): Promise<AskEdgarResponse<unknown>> {
  const apiKey = getApiKey();
  if (!apiKey) return { status: 'error', count: 0, results: [], error: 'EODHD_API_KEY not configured' };

  const symbol = toEodhdSymbol(ticker);
  if (!symbol) return { status: 'error', count: 0, results: [], error: 'Invalid ticker' };

  const params = new URLSearchParams({
    s: symbol,
    limit: String(limit),
    offset: '0',
    api_token: apiKey,
    fmt: 'json',
  });

  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${EODHD_NEWS_URL}?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      return { status: 'error', count: 0, results: [], error: `${response.status} EODHD news request failed` };
    }

    const payload = await response.json().catch(() => null);
    const results = Array.isArray(payload) ? payload : [];
    return { status: 'success', count: results.length, results };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'error', count: 0, results: [], error: `EODHD news timed out after ${REQUEST_TIMEOUT_MS / 1000}s` };
    }
    const message = error instanceof Error ? error.message : 'Unknown EODHD request error';
    return { status: 'error', count: 0, results: [], error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface EodhdEarningsEstimates {
  quarter: string;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueAnalysts: number | null;
}

async function fetchEodhdCalendar(path: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const query = new URLSearchParams({ ...params, api_token: apiKey, fmt: 'json' });
    const response = await fetch(`https://eodhd.com/api/calendar/${path}?${query.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// Consensus for the report released between `from` and `to` (YYYY-MM-DD, NY dates). EPS estimate and actual come
// from the earnings calendar on the same basis. Revenue consensus comes from the trends row frozen for that
// quarter ("0q" dated the quarter end), which survives the report. Null when no report falls in the range.
export async function fetchEodhdEarningsEstimates(ticker: string, from: string, to: string): Promise<EodhdEarningsEstimates | null> {
  const symbol = toEodhdSymbol(ticker);
  const calendar = await fetchEodhdCalendar('earnings', { symbols: symbol, from, to }) as {
    earnings?: Array<{ report_date?: string; date?: string; actual?: number | null; estimate?: number | null }>;
  } | null;
  const report = (calendar?.earnings ?? [])
    .filter((row) => row.date && row.report_date && row.report_date >= from && row.report_date <= to)
    .at(-1);
  if (!report?.date) return null;

  const trends = await fetchEodhdCalendar('trends', { symbols: symbol }) as {
    trends?: Array<Array<{ date?: string; period?: string; revenueEstimateAvg?: string | null; revenueEstimateNumberOfAnalysts?: string | null }>>;
  } | null;
  const quarter = (trends?.trends ?? []).flat().find((row) => row.period === '0q' && row.date === report.date);
  const revenueEstimate = Number(quarter?.revenueEstimateAvg);
  const revenueAnalysts = Number(quarter?.revenueEstimateNumberOfAnalysts);
  return {
    quarter: report.date,
    epsEstimate: typeof report.estimate === 'number' ? report.estimate : null,
    epsActual: typeof report.actual === 'number' ? report.actual : null,
    revenueEstimate: Number.isFinite(revenueEstimate) && revenueEstimate > 0 ? revenueEstimate : null,
    revenueAnalysts: Number.isFinite(revenueAnalysts) && revenueAnalysts > 0 ? revenueAnalysts : null,
  };
}
