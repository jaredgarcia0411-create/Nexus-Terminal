import type { DilutionDataSourceCheck } from '@/lib/jarvis/types';

export interface AskEdgarResponse<T> {
  status: string;
  count: number;
  results: T[];
  error?: string;
}

const ASKEDGAR_BASE_URL = 'https://eapi.askedgar.io';
const DEFAULT_DAILY_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const TICKER_REGEX = /^[A-Z0-9.\-^]+$/;

let callCount = 0;
let resetDate = '';

function getCurrentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function resetCounterIfNeeded() {
  const currentDate = getCurrentUtcDate();
  if (resetDate !== currentDate) {
    resetDate = currentDate;
    callCount = 0;
  }
}

function getApiKey() {
  return process.env.ASKEDGAR_API_KEY?.trim() ?? '';
}

function toErrorResponse<T>(error: string): AskEdgarResponse<T> {
  return { status: 'error', count: 0, results: [], error };
}

function parseDailyLimit() {
  const configured = Number.parseInt(process.env.ASKEDGAR_DAILY_LIMIT ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_DAILY_LIMIT;
}

function ensureTicker(ticker: string): string | null {
  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return null;
  }
  return ticker;
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

async function requestAskEdgar<T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<AskEdgarResponse<T>> {
  const apiKey = getApiKey();
  if (!apiKey) return toErrorResponse<T>('ASKEDGAR_API_KEY not configured');

  resetCounterIfNeeded();
  const dailyLimit = parseDailyLimit();
  if (callCount >= dailyLimit) return toErrorResponse<T>(`AskEdgar daily limit reached (${dailyLimit})`);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }

  callCount += 1;
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
    if (!response.ok) return toErrorResponse<T>(toErrorMessage(payload, response.status));
    if (!payload || typeof payload !== 'object') return toErrorResponse<T>('Invalid AskEdgar response payload');

    const normalized = payload as Record<string, unknown>;
    const results = Array.isArray(normalized.results) ? (normalized.results as T[]) : [];
    return {
      status: typeof normalized.status === 'string' ? normalized.status : 'success',
      count: Number.isFinite(normalized.count) ? Number(normalized.count) : results.length,
      results,
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

type EndpointKey =
  | 'float-outstanding'
  | 'screener'
  | 'dilution-rating'
  | 'dilution-data'
  | 'offerings'
  | 'registrations'
  | 'news'
  | 'nasdaq-compliance'
  | 'pump-and-dump-tracker'
  | 'agreements'
  | 'historical-float-pro'
  | 'reverse-splits';

interface EndpointConfig {
  key: EndpointKey;
  label: string;
  run: () => Promise<AskEdgarResponse<unknown>>;
}

interface EndpointState {
  key: EndpointKey;
  label: string;
  response: AskEdgarResponse<unknown>;
  hasData: boolean;
}

function asEndpointState(result: PromiseSettledResult<AskEdgarResponse<unknown>>, config: EndpointConfig): EndpointState {
  if (result.status === 'fulfilled') {
    const hasData = result.value.status !== 'error' && Array.isArray(result.value.results) && result.value.results.length > 0;
    return {
      key: config.key,
      label: config.label,
      response: result.value,
      hasData,
    };
  }

  return {
    key: config.key,
    label: config.label,
    response: {
      status: 'error',
      count: 0,
      results: [],
      error: result.reason instanceof Error ? result.reason.message : 'Unknown AskEdgar error',
    },
    hasData: false,
  };
}

function endpointWarning(state: EndpointState): string | null {
  if (state.hasData) return null;
  if (state.response.error) return `${state.label} unavailable: ${state.response.error}`;
  return `${state.label} returned no data`;
}

function toDataSource(state: EndpointState): DilutionDataSourceCheck {
  return {
    endpoint: state.key,
    label: state.label,
    hasData: state.hasData,
    error: state.response.error,
  };
}

async function fetchFloatOutstanding(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/float-outstanding', { ticker: validated });
}

async function fetchScreenerByTicker(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/screener', { ticker: validated });
}

async function fetchDilutionRating(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/dilution-rating', { ticker: validated });
}

async function fetchDilutionData(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/dilution-data', { ticker: validated });
}

async function fetchOfferings(ticker: string, limit = 20) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/offerings', { ticker: validated, limit });
}

async function fetchRegistrations(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/registrations', { ticker: validated, effective_status: true });
}

async function fetchNews(ticker: string, limit = 20) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/news', { ticker: validated, limit });
}

async function fetchNasdaqCompliance(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/nasdaq-compliance', { ticker: validated });
}

async function fetchPumpAndDumpTracker(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/pump-and-dump-tracker', { ticker: validated });
}

async function fetchAgreements(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/agreements', { ticker: validated });
}

async function fetchHistoricalFloatPro(ticker: string, limit = 20) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/historical-float-pro', { ticker: validated, limit });
}

async function fetchReverseSplits(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/reverse-splits', { ticker: validated });
}

export async function fetchTickerData(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();

  const endpointConfigs: EndpointConfig[] = [
    { key: 'float-outstanding', label: 'Float Outstanding', run: () => fetchFloatOutstanding(normalizedTicker) },
    { key: 'screener', label: 'Screener', run: () => fetchScreenerByTicker(normalizedTicker) },
    { key: 'dilution-rating', label: 'Dilution Rating', run: () => fetchDilutionRating(normalizedTicker) },
    { key: 'dilution-data', label: 'Dilution Data', run: () => fetchDilutionData(normalizedTicker) },
    { key: 'offerings', label: 'Offerings', run: () => fetchOfferings(normalizedTicker, 20) },
    { key: 'registrations', label: 'Registrations', run: () => fetchRegistrations(normalizedTicker) },
    { key: 'news', label: 'News', run: () => fetchNews(normalizedTicker, 20) },
    { key: 'nasdaq-compliance', label: 'Nasdaq Compliance', run: () => fetchNasdaqCompliance(normalizedTicker) },
    { key: 'pump-and-dump-tracker', label: 'Pump and Dump Tracker', run: () => fetchPumpAndDumpTracker(normalizedTicker) },
    { key: 'agreements', label: 'Agreements', run: () => fetchAgreements(normalizedTicker) },
    { key: 'historical-float-pro', label: 'Historical Float', run: () => fetchHistoricalFloatPro(normalizedTicker, 20) },
    { key: 'reverse-splits', label: 'Reverse Splits', run: () => fetchReverseSplits(normalizedTicker) },
  ];

  const settledResults = await Promise.allSettled(endpointConfigs.map((config) => config.run()));
  const endpointStates = settledResults.map((result, index) => asEndpointState(result, endpointConfigs[index]));
  const warnings = endpointStates.map(endpointWarning).filter((warning): warning is string => Boolean(warning));

  const rawData = Object.fromEntries(endpointStates.map((state) => [state.key, state.response]));

  return {
    ticker: normalizedTicker,
    fetchedAt: new Date().toISOString(),
    rawData,
    dataSources: endpointStates.map(toDataSource),
    warnings,
  };
}

export function getAskEdgarCallCount() {
  resetCounterIfNeeded();
  return callCount;
}

export function getAskEdgarDailyLimit() {
  return parseDailyLimit();
}
