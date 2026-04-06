import { and, eq, gt } from 'drizzle-orm';

import { getField, toNumberValue, toRecord } from '@/lib/askedgar-utils';
import { getDb } from '@/lib/db';
import { askedgarCache } from '@/lib/db/schema';
import type {
  ResearchSnapshotFull,
  ResearchSnapshotAgreement,
  ResearchSnapshotGapStat,
  ResearchSnapshotHistoricalFloatRow,
  ResearchSnapshotNewsItem,
  ResearchSnapshotOffering,
  ResearchSnapshotOwnershipGroup,
  ResearchSnapshotOwner,
  ResearchSnapshotRegistration,
  ResearchSnapshotReverseSplit,
  ResearchSnapshotWarrant,
} from '@/lib/types';

interface DilutionDataSourceCheck {
  endpoint: string;
  label: string;
  hasData: boolean;
  error?: string;
}

export interface AskEdgarResponse<T> {
  status: string;
  count: number;
  results: T[];
  error?: string;
}

export interface AskEdgarSnapshotAvailability {
  hasAnyData: boolean;
  hasUsableSnapshotData: boolean;
  failureKind: 'rate-limited' | 'upstream-unavailable' | null;
  retryAfterSeconds: number | null;
}

const ASKEDGAR_BASE_URL = 'https://eapi.askedgar.io';
const DEFAULT_DAILY_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const TICKER_REGEX = /^[A-Z0-9.\-^]+$/;
const TICKER_CACHE_TTL_MS = 60 * 60 * 1000;    // 1 hour
const GAINERS_CACHE_TTL_MS = 15 * 60 * 1000;   // 15 minutes

let callCount = 0;
let resetDate = '';

// Rate limit tracking — when AskEdgar returns 429, we stop making requests
// until the retry window expires. This prevents wasting calls.
let rateLimitedUntil = 0; // Unix timestamp (ms) when we can resume

function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

function setRateLimited(retryAfterSeconds: number) {
  rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
}

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

function responseHasData(response: AskEdgarResponse<unknown>): boolean {
  return response.status !== 'error' && Array.isArray(response.results) && response.results.length > 0;
}

function isRateLimitError(error?: string): boolean {
  return typeof error === 'string' && error.toLowerCase().includes('rate limited');
}

function extractRetryAfterSeconds(error?: string): number | null {
  if (!error) return null;

  const retryAfterMatch = error.match(/retry after\s+(\d+)s/i);
  if (retryAfterMatch) {
    const parsed = Number.parseInt(retryAfterMatch[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (/waiting for retry window/i.test(error) && isRateLimited()) {
    return Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
  }

  return null;
}

export function getAskEdgarSnapshotAvailability(
  rawData: Record<string, AskEdgarResponse<unknown>>,
): AskEdgarSnapshotAvailability {
  const responses = Object.values(rawData);
  const hasAnyData = responses.some((response) => responseHasData(response));

  if (hasAnyData) {
    return {
      hasAnyData,
      hasUsableSnapshotData: true,
      failureKind: null,
      retryAfterSeconds: null,
    };
  }

  const rateLimitErrors = responses
    .map((response) => response.error)
    .filter((error): error is string => isRateLimitError(error));

  return {
    hasAnyData,
    hasUsableSnapshotData: false,
    failureKind: rateLimitErrors.length > 0 ? 'rate-limited' : 'upstream-unavailable',
    retryAfterSeconds: rateLimitErrors.map((error) => extractRetryAfterSeconds(error)).find((value): value is number => value !== null) ?? null,
  };
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

  // If we recently got a 429, don't waste a call — fail fast
  if (isRateLimited()) return toErrorResponse<T>('Rate limited — waiting for retry window');

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

    // Handle rate limiting: record the retry window so other in-flight
    // and future requests fail fast instead of wasting API calls
    if (response.status === 429) {
      const details = (payload as Record<string, unknown>)?.error;
      const retryAfter = typeof details === 'object' && details !== null
        ? Number((details as Record<string, unknown>).retry_after) || 60
        : 60;
      setRateLimited(retryAfter);
      return toErrorResponse<T>(`Rate limited — retry after ${retryAfter}s`);
    }

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
  | 'reverse-splits'
  | 'filing-titles'
  | 'equity-lines'
  | 'gap-stats'
  | 'ownership';

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
    const hasData = responseHasData(result.value);
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

async function fetchEquityLines(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/offerings', { ticker: validated, offering_type: 'NEW EQUITY LINE', limit: 50 });
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

async function fetchFilingTitles(ticker: string, limit = 20) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/filing-titles', { ticker: validated, limit });
}

async function fetchGapStats(ticker: string, limit = 50) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/gap-stats', { ticker: validated, limit });
}

async function fetchOwnership(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/ownership', { ticker: validated });
}

export async function fetchTickerData(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();

  const endpointConfigs: EndpointConfig[] = [
    { key: 'float-outstanding', label: 'Float Outstanding', run: () => fetchFloatOutstanding(normalizedTicker) },
    { key: 'screener', label: 'Screener', run: () => fetchScreenerByTicker(normalizedTicker) },
    { key: 'dilution-rating', label: 'Dilution Rating', run: () => fetchDilutionRating(normalizedTicker) },
    { key: 'dilution-data', label: 'Dilution Data', run: () => fetchDilutionData(normalizedTicker) },
    { key: 'offerings', label: 'Offerings', run: () => fetchOfferings(normalizedTicker, 20) },
    { key: 'equity-lines', label: 'Equity Lines', run: () => fetchEquityLines(normalizedTicker) },
    { key: 'registrations', label: 'Registrations', run: () => fetchRegistrations(normalizedTicker) },
    { key: 'news', label: 'News', run: () => fetchNews(normalizedTicker, 20) },
    { key: 'nasdaq-compliance', label: 'Nasdaq Compliance', run: () => fetchNasdaqCompliance(normalizedTicker) },
    { key: 'pump-and-dump-tracker', label: 'Pump and Dump Tracker', run: () => fetchPumpAndDumpTracker(normalizedTicker) },
    { key: 'agreements', label: 'Agreements', run: () => fetchAgreements(normalizedTicker) },
    { key: 'historical-float-pro', label: 'Historical Float', run: () => fetchHistoricalFloatPro(normalizedTicker, 20) },
    { key: 'reverse-splits', label: 'Reverse Splits', run: () => fetchReverseSplits(normalizedTicker) },
    { key: 'filing-titles', label: 'Filing Titles', run: () => fetchFilingTitles(normalizedTicker, 20) },
    { key: 'gap-stats', label: 'Gap Stats', run: () => fetchGapStats(normalizedTicker, 50) },
    { key: 'ownership', label: 'Ownership', run: () => fetchOwnership(normalizedTicker) },
  ];

  // Run endpoints in batches of 5 to avoid blowing through the 50/min rate limit.
  // 16 parallel requests would use 32% of the limit in one shot; batching spreads
  // the load and lets the rate-limit guard kick in between batches if needed.
  const BATCH_SIZE = 5;
  const settledResults: PromiseSettledResult<AskEdgarResponse<unknown>>[] = [];
  for (let i = 0; i < endpointConfigs.length; i += BATCH_SIZE) {
    const batch = endpointConfigs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((config) => config.run()));
    settledResults.push(...batchResults);
  }
  const endpointStates = settledResults.map((result, index) => asEndpointState(result, endpointConfigs[index]));
  const warnings = endpointStates.map(endpointWarning).filter((warning): warning is string => Boolean(warning));

  const rawData = Object.fromEntries(endpointStates.map((state) => [state.key, state.response]));

  // Flag when every single endpoint failed — callers use this to skip caching bad data
  const hasAnyData = endpointStates.some((state) => state.hasData);

  return {
    ticker: normalizedTicker,
    fetchedAt: new Date().toISOString(),
    rawData,
    dataSources: endpointStates.map(toDataSource),
    warnings,
    hasAnyData,
  };
}

function getEndpointResponse(rawData: Record<string, AskEdgarResponse<unknown>>, keys: string[]): AskEdgarResponse<unknown> {
  for (const key of keys) {
    if (rawData[key]) return rawData[key];
  }
  return { status: 'error', count: 0, results: [], error: 'Endpoint not returned' };
}

function firstResult(rawData: Record<string, AskEdgarResponse<unknown>>, keys: string[]) {
  return toRecord(getEndpointResponse(rawData, keys).results[0]);
}

function getStringField(record: Record<string, unknown>, keys: string[]): string | null {
  const value = getField(record, keys);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return null;
}

function getBooleanField(record: Record<string, unknown>, keys: string[]): boolean {
  const value = getField(record, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1';
  }
  return false;
}

function detectFormType(row: Record<string, unknown>): string | null {
  const formType = getStringField(row, ['form_type', 'formType']);
  if (formType) return formType.toUpperCase();
  const headline = (getStringField(row, ['headline', 'title']) ?? '').toUpperCase();
  if (headline.includes('S-1')) return 'S-1';
  if (headline.includes('S-3')) return 'S-3';
  if (headline.includes('F-3')) return 'F-3';
  return null;
}

function normalizeHeadline(row: Record<string, unknown>, fallback: string): string {
  return getStringField(row, ['headline', 'title']) ?? fallback;
}

function dedupeByHeadline<T extends { headline: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const headline = row.headline.trim().toLowerCase();
    if (!headline || seen.has(headline)) return false;
    seen.add(headline);
    return true;
  });
}

function toRegistrationRow(row: Record<string, unknown>, fallback: string): ResearchSnapshotRegistration {
  return {
    headline: normalizeHeadline(row, fallback),
    filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
    effectiveDate: getStringField(row, ['effective_date', 'effectiveDate']),
    expirationDate: getStringField(row, ['expiration_date', 'expirationDate']),
    isEffective: getBooleanField(row, ['effective_status', 'effectiveStatus']),
    offeringAmount: toNumberValue(getField(row, ['offering_amount', 'offeringAmount', 'amount'])),
    isAtm: getBooleanField(row, ['is_atm', 'isAtm']),
    bank: getStringField(row, ['bank']),
    amountRemainingAtm: toNumberValue(getField(row, ['amount_remaining_atm', 'amountRemainingAtm'])),
    totalRaised: toNumberValue(getField(row, ['total_raised', 'totalRaised'])),
    overBabyShelf: getBooleanField(row, ['over_baby_shelf', 'overBabyShelf']),
    babyShelfRaisableAmount: toNumberValue(getField(row, ['baby_shelf_raisable_amount', 'babyShelfRaisableAmount'])),
    formType: detectFormType(row),
  };
}

interface NormalizeAskEdgarOptions {
  ticker: string;
  companyName: string | null;
  fetchedAt: string;
  warnings: string[];
}

export function normalizeAskEdgarResponse(
  rawData: Record<string, AskEdgarResponse<unknown>>,
  options: NormalizeAskEdgarOptions,
): ResearchSnapshotFull {
  const screener = firstResult(rawData, ['screener']);
  const floatOutstanding = firstResult(rawData, ['float-outstanding', 'floatOutstanding']);
  const dilutionRating = firstResult(rawData, ['dilution-rating', 'dilutionRating']);
  const dilutionData = getEndpointResponse(rawData, ['dilution-data', 'dilutionData']);
  const dilutionDataFirst = toRecord(dilutionData.results[0]);
  const compliance = firstResult(rawData, ['nasdaq-compliance', 'nasdaqCompliance']);
  const pumpAndDump = firstResult(rawData, ['pump-and-dump-tracker', 'pumpAndDumpTracker']);

  const registrations = getEndpointResponse(rawData, ['registrations']).results.map((item, index) => (
    toRegistrationRow(toRecord(item), `Registration ${index + 1}`)
  ));

  const offeringEquityLines = getEndpointResponse(rawData, ['equity-lines', 'equityLines']).results.map((item, index) => {
    const row = toRecord(item);
    return toRegistrationRow(row, `Equity line ${index + 1}`);
  });

  const registrationEquityLines = registrations.filter((row) => {
    if (row.isAtm) return false;
    const headline = row.headline.toLowerCase();
    return headline.includes('equity line') || headline.includes('eloc') || headline.includes('purchase agreement');
  });

  const offerings = dedupeByHeadline(
    getEndpointResponse(rawData, ['offerings']).results
      .map((item, index) => {
        const row = toRecord(item);
        return {
          headline: normalizeHeadline(row, `Offering ${index + 1}`),
          filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
          offeringType: getStringField(row, ['offeringType', 'offering_type', 'type', 'formType']),
          sharesAmount: toNumberValue(getField(row, ['shares_amount', 'sharesAmount', 'shares'])),
          warrantsAmount: toNumberValue(getField(row, ['warrants_amount', 'warrantsAmount'])),
          sharePrice: toNumberValue(getField(row, ['share_price', 'sharePrice', 'price'])),
          offeringAmount: toNumberValue(getField(row, ['offering_amount', 'offeringAmount', 'amount'])),
        } satisfies ResearchSnapshotOffering;
      })
      .filter((row) => !String(row.offeringType ?? '').toUpperCase().includes('EQUITY LINE')),
  );

  const equityLines = dedupeByHeadline([
    ...registrationEquityLines,
    ...offeringEquityLines,
  ]);

  const news: ResearchSnapshotNewsItem[] = [
    ...getEndpointResponse(rawData, ['news']).results.map((item, index) => {
      const row = toRecord(item);
      return {
        title: normalizeHeadline(row, `News item ${index + 1}`),
        summary: getStringField(row, ['body', 'summary', 'details']) ?? '',
        filedAt: getStringField(row, ['filedAt', 'filed_at', 'date']),
        formType: getStringField(row, ['formType', 'form', 'source']) ?? 'News',
        isNews: true,
      } satisfies ResearchSnapshotNewsItem;
    }),
    ...getEndpointResponse(rawData, ['filing-titles', 'filingTitles']).results.map((item, index) => {
      const row = toRecord(item);
      return {
        title: normalizeHeadline(row, `Filing ${index + 1}`),
        summary: getStringField(row, ['body', 'summary', 'details']) ?? '',
        filedAt: getStringField(row, ['filedAt', 'filed_at', 'date']),
        formType: getStringField(row, ['formType', 'form', 'source']) ?? 'Filing',
        isNews: false,
      } satisfies ResearchSnapshotNewsItem;
    }),
  ];

  const currentPrice = toNumberValue(getField(screener, ['price']));
  const warrants: ResearchSnapshotWarrant[] = dilutionData.results.reduce<ResearchSnapshotWarrant[]>((rows, item, index) => {
    const row = toRecord(item);
    const amount = toNumberValue(getField(row, ['warrants_amount']));
    if (amount === null) return rows;

    const prefundedCost = toNumberValue(getField(row, ['prefunded_cost']));
    rows.push({
      details: getStringField(row, ['details']) ?? `Warrant ${index + 1}`,
      amount,
      remaining: toNumberValue(getField(row, ['warrants_remaining'])),
      exercisePrice: toNumberValue(getField(row, ['warrants_exercise_price'])),
      prefundedCost,
      registered: getStringField(row, ['registered']),
      exercisableDate: getStringField(row, ['exercisable_date']),
      expirationDate: getStringField(row, ['expiration_date']),
      filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
      isPrefunded: prefundedCost !== null && prefundedCost > 0,
    });
    return rows;
  }, []);

  const ownershipGroups: ResearchSnapshotOwnershipGroup[] = getEndpointResponse(rawData, ['ownership']).results
    .map((group) => {
      const groupRecord = toRecord(group);
      const owners = (Array.isArray(groupRecord.owners) ? groupRecord.owners : [])
        .map((owner) => {
          const row = toRecord(owner);
          return {
            name: getStringField(row, ['owner_name', 'ownerName']) ?? 'Unknown owner',
            role: getStringField(row, ['title', 'owner_type', 'ownerType']) ?? 'N/A',
            common: toNumberValue(getField(row, ['common_shares_amount', 'commonSharesAmount'])),
            preferred: toNumberValue(getField(row, ['preferred_shares_amount', 'preferredSharesAmount'])),
            options: toNumberValue(getField(row, ['options_amount', 'optionsAmount'])),
            warrants: toNumberValue(getField(row, ['warrants_amount', 'warrantsAmount'])),
          } satisfies ResearchSnapshotOwner;
        })
        .filter((owner) => owner.name !== 'Unknown owner' || owner.role !== 'N/A');

      return {
        reportedDate: getStringField(groupRecord, ['reported_date', 'reportedDate']),
        owners,
      } satisfies ResearchSnapshotOwnershipGroup;
    })
    .filter((group) => group.owners.length > 0);

  const historicalFloat: ResearchSnapshotHistoricalFloatRow[] = getEndpointResponse(rawData, ['historical-float-pro', 'historicalFloatPro']).results.map((item) => {
    const row = toRecord(item);
    return {
      date: getStringField(row, ['reportedDate', 'reported_date', 'date']),
      outstanding: toNumberValue(getField(row, ['outstandingShares', 'outstanding_shares', 'outstanding'])),
      float: toNumberValue(getField(row, ['float'])),
      tradableFloat: toNumberValue(getField(row, ['tradableFloat', 'tradable_float'])),
    } satisfies ResearchSnapshotHistoricalFloatRow;
  });

  const reverseSplits: ResearchSnapshotReverseSplit[] = getEndpointResponse(rawData, ['reverse-splits', 'reverseSplits']).results.map((item) => {
    const row = toRecord(item);
    const ratio = getStringField(row, ['ratio'])
      ?? `${getStringField(row, ['splitFrom', 'split_from']) ?? 'N/A'}:${getStringField(row, ['splitTo', 'split_to']) ?? 'N/A'}`;
    return {
      date: getStringField(row, ['executionDate', 'execution_date', 'date']),
      ratio,
    } satisfies ResearchSnapshotReverseSplit;
  });

  const agreements: ResearchSnapshotAgreement[] = getEndpointResponse(rawData, ['agreements']).results.map((item) => {
    const row = toRecord(item);
    return {
      type: getStringField(row, ['agreementType', 'agreement_type', 'type']),
      investor: getStringField(row, ['investorNames', 'investor_names', 'investor']),
      date: getStringField(row, ['filedAt', 'filed_at', 'date']),
      details: getStringField(row, ['details', 'summary']),
    } satisfies ResearchSnapshotAgreement;
  });

  const gapStats: ResearchSnapshotGapStat[] = getEndpointResponse(rawData, ['gap-stats', 'gapStats']).results.map((item) => {
    const row = toRecord(item);
    const tags = Array.isArray(getField(row, ['tags'])) ? (getField(row, ['tags']) as string[]) : [];
    const formTypes = Array.isArray(getField(row, ['form_types', 'formTypes'])) ? (getField(row, ['form_types', 'formTypes']) as string[]) : [];
    return {
      date: getStringField(row, ['date']),
      gapPercentage: toNumberValue(getField(row, ['gap_percentage', 'gapPercentage'])),
      marketOpen: toNumberValue(getField(row, ['market_open', 'marketOpen'])),
      marketClose: toNumberValue(getField(row, ['market_close', 'marketClose'])),
      intradayHigh: toNumberValue(getField(row, ['intraday_high', 'intradayHigh'])),
      intradayLow: toNumberValue(getField(row, ['intraday_low', 'intradayLow'])),
      vwap: toNumberValue(getField(row, ['vwap'])),
      premarketHigh: toNumberValue(getField(row, ['premarket_high', 'premarketHigh'])),
      volume: toNumberValue(getField(row, ['volume'])),
      tags: [...tags, ...formTypes],
    } satisfies ResearchSnapshotGapStat;
  });

  return {
    ticker: options.ticker,
    fetchedAt: options.fetchedAt,
    companyName: options.companyName,
    warnings: options.warnings,
    header: {
      marketCap: toNumberValue(getField(screener, ['marketCap', 'market_cap', 'market_cap_final']))
        ?? toNumberValue(getField(floatOutstanding, ['marketCap', 'market_cap', 'market_cap_final'])),
      outstandingShares: toNumberValue(getField(screener, ['outstanding', 'outstandingShares', 'outstanding_shares', 'sharesOutstanding']))
        ?? toNumberValue(getField(floatOutstanding, ['outstanding', 'outstandingShares', 'outstanding_shares', 'outstanding_shares_final', 'sharesOutstanding'])),
      float: toNumberValue(getField(screener, ['float', 'floatShares', 'tradable_float', 'float_shares']))
        ?? toNumberValue(getField(floatOutstanding, ['float', 'tradableFloat', 'tradable_float', 'floatShares', 'float_shares'])),
      exchange: getStringField(screener, ['exchange']),
      ipoDate: getStringField(screener, ['ipodate', 'ipo_date', 'ipoDate']),
      industry: getStringField(screener, ['industry'])
        ?? getStringField(floatOutstanding, ['industry', 'sector']),
      country: getStringField(screener, ['country'])
        ?? getStringField(floatOutstanding, ['country']),
      price: currentPrice,
      shortInterest: toNumberValue(getField(screener, ['shortInterest', 'short_interest'])),
      volume: toNumberValue(getField(screener, ['today_volume', 'volume', 'totalVolume'])),
    },
    dilutionRating: getStringField(dilutionRating, ['dilution', 'dilution_rating', 'rating', 'dilutionRating']),
    cashNeedRating: getStringField(dilutionRating, ['cash_need', 'cashNeed']),
    offeringFrequencyRating: getStringField(dilutionRating, ['offering_frequency', 'offeringFrequency']),
    offeringAbilityRating: getStringField(dilutionRating, ['offering_ability', 'offeringAbility']),
    warrantExerciseRating: getStringField(dilutionRating, ['warrant_exercise', 'warrantExercise']),
    overallRisk: getStringField(pumpAndDump, ['overall_risk', 'overallRisk', 'scam_risk', 'scamRisk']),
    regsho: getBooleanField(compliance, ['regsho']) || getBooleanField(pumpAndDump, ['regsho']),
    nasdaqCompliance: getStringField(compliance, ['status', 'complianceStatus', 'rating', 'nasdaq_compliance', 'nasdaqCompliance']),
    dilutionDetails: {
      cashRemainingMonths: toNumberValue(getField(dilutionRating, ['cash_remaining_months', 'cashRemainingMonths']))
        ?? toNumberValue(getField(dilutionDataFirst, ['cashRemainingMonths', 'monthsRemaining'])),
      cashBurn: toNumberValue(getField(dilutionRating, ['cash_burn', 'cashBurn']))
        ?? toNumberValue(getField(dilutionDataFirst, ['cashBurn', 'burnRate'])),
      estimatedCash: toNumberValue(getField(dilutionRating, ['estimated_cash', 'estimatedCash']))
        ?? toNumberValue(getField(dilutionDataFirst, ['estimatedCash', 'cash', 'cashOnHand'])),
      managementCommentary: getStringField(dilutionRating, ['mgmt_commentary', 'managementCommentary', 'commentary']),
      cashNeedDescription: getStringField(dilutionRating, ['cash_need_desc', 'cashNeedDesc']),
      filedAt: getStringField(dilutionRating, ['filed_at', 'filedAt', 'lastUpdated']),
      warrantInfo: getStringField(dilutionDataFirst, ['warrantExercise', 'warrantInfo', 'warrant_exercise']),
      convertibles: getStringField(dilutionDataFirst, ['convertibles', 'convertibleNotes']),
      authorizedShares: toNumberValue(getField(dilutionDataFirst, ['authorizedShares', 'authorized_shares'])),
      sharesAvailable: toNumberValue(getField(dilutionDataFirst, ['sharesAvailable', 'availableShares'])),
    },
    warrants,
    registrations,
    equityLines,
    offerings,
    news,
    ownershipGroups,
    historicalFloat,
    reverseSplits,
    agreements,
    gapStats,
    rawData,
  };
}

export function getAskEdgarCallCount() {
  resetCounterIfNeeded();
  return callCount;
}

export function getAskEdgarDailyLimit() {
  return parseDailyLimit();
}

export async function fetchTopGainers(minGainPct = 20, limit = 25) {
  return requestAskEdgar<unknown>('/v1/screener', {
    min_gain_1_day: minGainPct,
    isactivelytrading: true,
    limit,
  });
}

// --- Cache helpers: wrap the raw fetch functions with DB-backed TTL caching ---

/**
 * Cached version of fetchTickerData(). Checks DB for a fresh cached response
 * before hitting Ask Edgar. Cache is shared across all users (same SEC data).
 * TTL: 1 hour.
 */
export async function getCachedTickerData(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const db = getDb();

  // No DB available — fall back to live fetch
  if (!db) return fetchTickerData(normalizedTicker);

  // Check cache
  const now = new Date();
  const cached = await db
    .select()
    .from(askedgarCache)
    .where(
      and(
        eq(askedgarCache.cacheType, 'ticker'),
        eq(askedgarCache.ticker, normalizedTicker),
        gt(askedgarCache.expiresAt, now),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    // Cache hit — return stored data in the same shape as fetchTickerData()
    return cached[0].dataJson as ReturnType<typeof fetchTickerData> extends Promise<infer T> ? T : never;
  }

  // Cache miss — fetch fresh from Ask Edgar
  const result = await fetchTickerData(normalizedTicker);

  // Only cache if at least one endpoint returned real data.
  // This prevents caching error responses (bad API key, timeouts, etc.)
  // that would otherwise stick around for an hour.
  if (!result.hasAnyData) return result;

  // Write to cache (fire-and-forget, don't block the response)
  try {
    await db
      .insert(askedgarCache)
      .values({
        id: `ticker-${normalizedTicker}`,
        cacheType: 'ticker',
        ticker: normalizedTicker,
        dataJson: result,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + TICKER_CACHE_TTL_MS),
      })
      .onConflictDoUpdate({
        target: [askedgarCache.cacheType, askedgarCache.ticker],
        set: {
          dataJson: result,
          fetchedAt: now,
          expiresAt: new Date(now.getTime() + TICKER_CACHE_TTL_MS),
        },
      });
  } catch (err) {
    console.warn('[askedgar-cache] Failed to write ticker cache:', err);
  }

  return result;
}

/**
 * Cached version of fetchTopGainers(). Uses DB cache with 5-minute TTL.
 * Shared across all users.
 */
export async function getCachedGainers(minGainPct = 20, limit = 25) {
  const db = getDb();
  if (!db) return fetchTopGainers(minGainPct, limit);

  const now = new Date();
  const cached = await db
    .select()
    .from(askedgarCache)
    .where(
      and(
        eq(askedgarCache.cacheType, 'gainers'),
        eq(askedgarCache.ticker, '__GAINERS__'),
        gt(askedgarCache.expiresAt, now),
      ),
    )
    .limit(1);

  if (cached.length > 0) {
    return cached[0].dataJson as AskEdgarResponse<unknown>;
  }

  const result = await fetchTopGainers(minGainPct, limit);

  try {
    await db
      .insert(askedgarCache)
      .values({
        id: 'gainers',
        cacheType: 'gainers',
        ticker: '__GAINERS__',
        dataJson: result,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + GAINERS_CACHE_TTL_MS),
      })
      .onConflictDoUpdate({
        target: [askedgarCache.cacheType, askedgarCache.ticker],
        set: {
          dataJson: result,
          fetchedAt: now,
          expiresAt: new Date(now.getTime() + GAINERS_CACHE_TTL_MS),
        },
      });
  } catch (err) {
    console.warn('[askedgar-cache] Failed to write gainers cache:', err);
  }

  return result;
}
