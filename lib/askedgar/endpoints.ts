import { toNumberValue, toRecord } from '@/lib/askedgar-utils';
import { fetchEodhdNews } from '@/lib/eodhd';
import { getHistoricalOutstanding } from '@/lib/sec/companyfacts';
import { getResearchFilings } from '@/lib/sec/submissions';
import { getRateLimitedUntil, setRateLimited } from '@/lib/askedgar/runtime-state';
import type { AskEdgarResponse } from '@/lib/askedgar/types';

export const SEC_BACKED_ENDPOINT_KEYS = new Set<string>([
  'historical-float-pro',
  'sec-filings',
]);

const ASKEDGAR_BASE_URL = 'https://eapi.askedgar.io';
const REQUEST_TIMEOUT_MS = 15_000;
const TICKER_REGEX = /^[A-Z0-9.\-^]+$/;

function getApiKey() {
  return process.env.ASKEDGAR_API_KEY?.trim() ?? '';
}

export function toErrorResponse<T>(error: string): AskEdgarResponse<T> {
  return { status: 'error', count: 0, results: [], error };
}

export function responseHasData(response: AskEdgarResponse<unknown>): boolean {
  return response.status !== 'error' && Array.isArray(response.results) && response.results.length > 0;
}

export function isRateLimitError(error?: string): boolean {
  return typeof error === 'string' && error.toLowerCase().includes('rate limited');
}

export function extractRetryAfterSeconds(error?: string): number | null {
  if (!error) return null;

  const retryAfterMatch = error.match(/retry after\s+(\d+)s/i);
  if (retryAfterMatch) {
    const parsed = Number.parseInt(retryAfterMatch[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (/waiting for retry window/i.test(error) && Date.now() < getRateLimitedUntil()) {
    return Math.max(1, Math.ceil((getRateLimitedUntil() - Date.now()) / 1000));
  }

  return null;
}

function ensureTicker(ticker: string): string | null {
  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return null;
  }
  return ticker;
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getPositiveNumberValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

interface AskEdgarRateLimitDetails {
  retryAfterSeconds: number;
  code: string | null;
  message: string | null;
}

function extractRateLimitDetails(payload: unknown): AskEdgarRateLimitDetails | null {
  const error = toRecord(toRecord(payload).error);
  if (Object.keys(error).length === 0) return null;

  const details = toRecord(error.details);

  return {
    retryAfterSeconds: getPositiveNumberValue(error.retry_after)
      ?? getPositiveNumberValue(details.retry_after)
      ?? 60,
    code: getStringValue(error.code),
    message: getStringValue(error.message),
  };
}

function formatRateLimitError(details: AskEdgarRateLimitDetails): string {
  const metadata = [details.message, details.code ? `code=${details.code}` : null]
    .filter((value): value is string => Boolean(value));

  return metadata.length > 0
    ? `Rate limited — retry after ${details.retryAfterSeconds}s (${metadata.join(', ')})`
    : `Rate limited — retry after ${details.retryAfterSeconds}s`;
}

export function replaceRetryAfterSeconds(message: string, retryAfterSeconds: number): string {
  if (/retry after\s+\d+s/i.test(message)) {
    return message.replace(/retry after\s+\d+s/i, `retry after ${retryAfterSeconds}s`);
  }

  if (/waiting for retry window/i.test(message) || isRateLimitError(message)) {
    return `Rate limited — retry after ${retryAfterSeconds}s`;
  }

  return message;
}

function toErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    const error = rec.error;
    if (typeof error === 'string') return `${status} ${error}`;
    if (error && typeof error === 'object') {
      const nested = error as Record<string, unknown>;
      if (typeof nested.message === 'string') return `${status} ${nested.message}`;
    }
  }
  return `${status} Request failed`;
}

export async function requestAskEdgar<T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<AskEdgarResponse<T>> {
  const apiKey = getApiKey();
  if (!apiKey) return toErrorResponse<T>('ASKEDGAR_API_KEY not configured');

  // If we recently got a 429, don't waste a call — fail fast
  if (Date.now() < getRateLimitedUntil()) return toErrorResponse<T>('Rate limited — waiting for retry window');

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ASKEDGAR_BASE_URL}${path}?${params.toString()}`, {
      method: 'GET',
      headers: { 'API-KEY': apiKey },
      signal: controller.signal,
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({}));

    // Handle rate limiting: record the retry window so other in-flight
    // and future requests fail fast instead of wasting API calls
    if (response.status === 429) {
      const details = extractRateLimitDetails(payload) ?? {
        retryAfterSeconds: 60,
        code: null,
        message: null,
      };

      setRateLimited(details.retryAfterSeconds);
      return toErrorResponse<T>(formatRateLimitError(details));
    }

    if (!response.ok) return toErrorResponse<T>(toErrorMessage(payload, response.status));
    if (!payload || typeof payload !== 'object') return toErrorResponse<T>('Invalid AskEdgar response payload');

    const normalized = payload as Record<string, unknown>;
    const results = Array.isArray(normalized.results) ? (normalized.results as T[]) : [];
    const usage = toRecord(normalized.usage);
    const costMicrodollars = toNumberValue(usage.cost_microdollars);
    return {
      status: typeof normalized.status === 'string' ? normalized.status : 'success',
      count: Number.isFinite(normalized.count) ? Number(normalized.count) : results.length,
      results,
      ...(costMicrodollars !== null
        ? { usage: { cost_microdollars: costMicrodollars } }
        : {}),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return toErrorResponse<T>(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    const message = error instanceof Error ? error.message : 'Unknown request error';
    return toErrorResponse<T>(message);
  } finally {
    clearTimeout(timeoutId);
  }
}


function validateTickerOrError<T>(ticker: string): string | AskEdgarResponse<T> {
  const normalized = ensureTicker(ticker);
  if (!normalized) return toErrorResponse<T>('Invalid ticker format');
  return normalized;
}


export type EndpointRunner = (ticker: string) => Promise<AskEdgarResponse<unknown>>;
export type EndpointRegistryEntry = { label: string; run: EndpointRunner };

export async function fetchScreenerByTicker(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/screener', { ticker: validated });
}

export async function fetchDilutionRating(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/dilution-rating', { ticker: validated });
}

export async function fetchDilutionData(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/dilution-data', { ticker: validated });
}

export async function fetchEquityLines(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/offerings', { ticker: validated, offering_type: 'NEW EQUITY LINE', limit: 50 });
}

export async function fetchOfferings(ticker: string, limit = 50) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/offerings', { ticker: validated, limit });
}

export async function fetchReverseSplits(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/reverse-splits', { ticker: validated });
}

export async function fetchHistoricalTickers(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/historical-tickers', { ticker: validated });
}

export async function fetchHistoricalDilutionRating(ticker: string, date: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toErrorResponse<unknown>('Invalid date format');
  return requestAskEdgar<unknown>('/v1/historical-dilution', { ticker: validated, date });
}

export async function fetchRegistrations(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  // No effective_status filter: ATMs are 424B5 prospectus supplements that ride on a
  // parent shelf and don't carry their own effective_status=true. Filtering by it
  // would strip them out before they reach the Dilution page or scanner.
  return requestAskEdgar<unknown>('/v1/registrations', { ticker: validated });
}

export async function fetchNasdaqCompliance(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/nasdaq-compliance', { ticker: validated });
}

export async function fetchGapStats(ticker: string, limit = 50) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/gap-stats', { ticker: validated, limit });
}

export const ENDPOINT_REGISTRY = {
  screener: { label: 'Screener', run: (ticker) => fetchScreenerByTicker(ticker) },
  'dilution-rating': { label: 'Dilution Rating', run: (ticker) => fetchDilutionRating(ticker) },
  'dilution-data': { label: 'Dilution Data', run: (ticker) => fetchDilutionData(ticker) },
  offerings: { label: 'Offerings', run: (ticker) => fetchOfferings(ticker, 50) },
  'sec-filings': { label: 'SEC Filings', run: (ticker) => getResearchFilings(ticker) },
  'equity-lines': { label: 'Equity Lines', run: (ticker) => fetchEquityLines(ticker) },
  registrations: { label: 'Registrations', run: (ticker) => fetchRegistrations(ticker) },
  news: { label: 'News', run: (ticker) => fetchEodhdNews(ticker, 50) },
  'nasdaq-compliance': { label: 'Nasdaq Compliance', run: (ticker) => fetchNasdaqCompliance(ticker) },
  'historical-float-pro': { label: 'Historical Outstanding Shares', run: (ticker) => getHistoricalOutstanding(ticker, { limit: 20 }) },
  'reverse-splits': { label: 'Reverse Splits', run: (ticker) => fetchReverseSplits(ticker) },
  'historical-tickers': { label: 'Historical Tickers', run: (ticker) => fetchHistoricalTickers(ticker) },
  'gap-stats': { label: 'Gap Stats', run: (ticker) => fetchGapStats(ticker, 50) },
} satisfies Record<string, EndpointRegistryEntry>;

export type EndpointKey = keyof typeof ENDPOINT_REGISTRY;

export const ENDPOINT_REGISTRY_LOOKUP: Partial<Record<string, EndpointRegistryEntry>> = ENDPOINT_REGISTRY;

export const ALL_ENDPOINT_KEYS = Object.keys(ENDPOINT_REGISTRY) as readonly EndpointKey[];

export const ENDPOINT_SCOPES = {
  snapshot: ALL_ENDPOINT_KEYS,
  'scanner-summary': [
    'registrations', 'dilution-rating', 'dilution-data', 'equity-lines',
  ],
  'small-cap-research': [
    'screener', 'dilution-rating', 'dilution-data', 'offerings', 'equity-lines',
    'registrations', 'news', 'nasdaq-compliance',
    'historical-float-pro', 'reverse-splits', 'sec-filings', 'historical-tickers',
    'gap-stats',
  ],
  'swing-trader-research': [
    'dilution-data', 'dilution-rating', 'offerings', 'registrations',
    'news', 'historical-float-pro', 'gap-stats',
  ],
} as const satisfies Record<string, readonly EndpointKey[]>;

export type EndpointScope = keyof typeof ENDPOINT_SCOPES;
