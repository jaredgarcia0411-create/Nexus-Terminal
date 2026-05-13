import { and, eq, gt } from 'drizzle-orm';

import { getField, toNumberValue, toRecord } from '@/lib/askedgar-utils';
import { getDb } from '@/lib/db';
import { askedgarCache } from '@/lib/db/schema';
import {
  ENDPOINT_REGISTRY_LOOKUP,
  ENDPOINT_SCOPES,
  SEC_BACKED_ENDPOINT_KEYS,
  extractRetryAfterSeconds,
  fetchDilutionData,
  fetchDilutionRating,
  fetchEquityLines,
  fetchRegistrations,
  isRateLimitError,
  replaceRetryAfterSeconds,
  responseHasData,
} from '@/lib/askedgar/endpoints';
import { endpointWarning, fetchTickerData, toDataSource } from '@/lib/askedgar/fanout';
import { syncRateLimitFromDb } from '@/lib/askedgar/runtime-state';
import { toRegistrationRow } from '@/lib/askedgar/snapshot-normalizer';
import type { EndpointScope } from '@/lib/askedgar/endpoints';
import type { EndpointState } from '@/lib/askedgar/fanout';
import type {
  AskEdgarResponse,
  AskEdgarSnapshotAvailability,
  ScannerSummaryResult,
  TickerDataResult,
} from '@/lib/askedgar/types';

const TICKER_CACHE_TTL_MS = 16 * 60 * 60 * 1000; // 16 hours; news has its own per-endpoint freshness window inside this row
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;       // 5 minutes — news refreshes throughout the trading day, but simultaneous viewers should coalesce on one call
const inFlightTickerRequests = new Map<string, Promise<TickerDataResult>>();

export function getAskEdgarSnapshotAvailability(
  rawData: Record<string, AskEdgarResponse<unknown>>,
): AskEdgarSnapshotAvailability {
  const askEdgarResponses = Object.entries(rawData)
    .filter(([key]) => !SEC_BACKED_ENDPOINT_KEYS.has(key))
    .map(([, response]) => response);
  const responses = askEdgarResponses.length > 0 ? askEdgarResponses : Object.values(rawData);
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

// --- Cache helpers: wrap the raw fetch functions with DB-backed TTL caching ---

type AskEdgarDb = NonNullable<ReturnType<typeof getDb>>;
type CacheHitState = 'full' | 'partial' | 'miss';

function getTickerCacheExpiry(result: TickerDataResult, fetchedAt: Date): Date | null {
  const availability = getAskEdgarSnapshotAvailability(result.rawData);
  if (availability.hasAnyData) {
    return new Date(fetchedAt.getTime() + TICKER_CACHE_TTL_MS);
  }

  if (availability.failureKind !== 'rate-limited') {
    return null;
  }

  const retryAfterSeconds = availability.retryAfterSeconds ?? 60;
  return new Date(fetchedAt.getTime() + retryAfterSeconds * 1000);
}

function hydrateCachedTickerDataResult(result: TickerDataResult, expiresAt: Date): TickerDataResult {
  const availability = getAskEdgarSnapshotAvailability(result.rawData);
  if (availability.hasAnyData || availability.failureKind !== 'rate-limited') {
    return result;
  }

  const remainingSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
  const rawData = Object.fromEntries(
    Object.entries(result.rawData).map(([key, response]) => {
      if (!isRateLimitError(response.error)) {
        return [key, response];
      }

      return [
        key,
        {
          ...response,
          error: replaceRetryAfterSeconds(response.error ?? 'Rate limited — waiting for retry window', remainingSeconds),
        },
      ];
    }),
  ) as TickerDataResult['rawData'];

  return {
    ...result,
    rawData,
    dataSources: result.dataSources.map((source) => (
      source.error && isRateLimitError(source.error)
        ? { ...source, error: replaceRetryAfterSeconds(source.error, remainingSeconds) }
        : source
    )),
    warnings: result.warnings.map((warning) => (
      isRateLimitError(warning)
        ? replaceRetryAfterSeconds(warning, remainingSeconds)
        : warning
    )),
  };
}

function endpointStatesFromRawData(rawData: Record<string, AskEdgarResponse<unknown>>): EndpointState[] {
  return Object.entries(rawData).map(([key, response]) => ({
    key,
    label: ENDPOINT_REGISTRY_LOOKUP[key]?.label ?? key,
    response,
    hasData: responseHasData(response),
  }));
}

function rebuildTickerDataResult(
  result: TickerDataResult,
  rawData: Record<string, AskEdgarResponse<unknown>>,
): TickerDataResult {
  const endpointStates = endpointStatesFromRawData(rawData);

  return {
    ...result,
    rawData,
    dataSources: endpointStates.map(toDataSource),
    warnings: endpointStates.map(endpointWarning).filter((warning): warning is string => Boolean(warning)),
    hasAnyData: endpointStates.some((state) => state.hasData),
  };
}

function subsetRawData(
  rawData: Record<string, AskEdgarResponse<unknown>>,
  requested: readonly string[],
): Record<string, AskEdgarResponse<unknown>> {
  return Object.fromEntries(
    requested.flatMap((key) => {
      const response = rawData[key];
      return response ? [[key, response] as const] : [];
    }),
  );
}

function subsetEndpointFetchedAt(
  endpointFetchedAt: Record<string, string> | undefined,
  requested: readonly string[],
): Record<string, string> {
  if (!endpointFetchedAt) return {};
  return Object.fromEntries(
    requested.flatMap((key) => {
      const ts = endpointFetchedAt[key];
      return ts ? [[key, ts] as const] : [];
    }),
  );
}

function subsetTickerDataResult(
  result: TickerDataResult,
  requested: readonly string[],
): TickerDataResult {
  return rebuildTickerDataResult({
    ...result,
    endpointFetchedAt: subsetEndpointFetchedAt(result.endpointFetchedAt, requested),
  }, subsetRawData(result.rawData, requested));
}

function cachedHasFreshEndpoint(
  result: TickerDataResult | undefined,
  key: string,
): boolean {
  const entry = result?.rawData?.[key];
  if (!entry || entry.status === 'error' || !Array.isArray(entry.results)) return false;

  // News changes throughout the trading day, so we cap its freshness at
  // NEWS_CACHE_TTL_MS even though the row TTL is 16 hours. This lets
  // simultaneous viewers coalesce on a single /v1/news call (which also
  // carries filings) while still picking up new headlines within minutes.
  if (key === 'news') {
    const fetchedAtIso = result?.endpointFetchedAt?.[key];
    if (!fetchedAtIso) return false;
    const fetchedAtMs = Date.parse(fetchedAtIso);
    if (!Number.isFinite(fetchedAtMs)) return false;
    return Date.now() - fetchedAtMs < NEWS_CACHE_TTL_MS;
  }

  return true;
}

function mergeRawData(
  cached: Record<string, AskEdgarResponse<unknown>>,
  fresh: Record<string, AskEdgarResponse<unknown>>,
): Record<string, AskEdgarResponse<unknown>> {
  // Only let a fresh entry replace a cached one when the fresh entry actually
  // carries data. Without this, a transient rate-limit / network error would
  // overwrite a previously-good cached endpoint with an error response and
  // pin the broken state in cache (the news bypass would then keep refetching
  // and keep clobbering, leaving news + filings empty for hours).
  const merged: Record<string, AskEdgarResponse<unknown>> = { ...cached };
  for (const [key, freshResponse] of Object.entries(fresh)) {
    const cachedResponse = merged[key];
    if (responseHasData(freshResponse) || !cachedResponse || !responseHasData(cachedResponse)) {
      merged[key] = freshResponse;
    }
  }
  return merged;
}

function mergeEndpointFetchedAt(
  cached: Record<string, string> | undefined,
  fresh: Record<string, string> | undefined,
): Record<string, string> {
  // Fresh map only contains keys that returned non-error responses (see
  // buildEndpointFetchedAt), so we can safely overwrite. Cached timestamps for
  // endpoints not refetched this round are preserved.
  return { ...(cached ?? {}), ...(fresh ?? {}) };
}

async function writeTickerCache(
  db: AskEdgarDb,
  normalizedTicker: string,
  result: TickerDataResult,
) {
  const fetchedAt = new Date();
  const expiresAt = getTickerCacheExpiry(result, fetchedAt);
  if (!expiresAt) {
    return;
  }

  try {
    await db
      .insert(askedgarCache)
      .values({
        id: `ticker-${normalizedTicker}`,
        cacheType: 'ticker',
        ticker: normalizedTicker,
        dataJson: result,
        fetchedAt,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [askedgarCache.cacheType, askedgarCache.ticker],
        set: {
          dataJson: result,
          fetchedAt,
          expiresAt,
        },
      });
  } catch (err) {
    console.warn('[askedgar-cache] Failed to write ticker cache:', err);
  }
}

async function fetchAndCacheTickerEndpoints(
  normalizedTicker: string,
  endpoints: readonly string[],
  db: AskEdgarDb | null,
  cachedResult: TickerDataResult,
): Promise<TickerDataResult> {
  const freshResult = await fetchTickerData(normalizedTicker, { endpoints });
  const mergedRawData = mergeRawData(cachedResult.rawData, freshResult.rawData);
  const mergedResult = rebuildTickerDataResult({
    ...cachedResult,
    fetchedAt: freshResult.fetchedAt,
    endpointFetchedAt: mergeEndpointFetchedAt(cachedResult.endpointFetchedAt, freshResult.endpointFetchedAt),
  }, mergedRawData);

  if (db) {
    await writeTickerCache(db, normalizedTicker, mergedResult);
  }

  return mergedResult;
}

async function completeTickerDataForScope(
  normalizedTicker: string,
  requested: readonly string[],
  db: AskEdgarDb | null,
  seedResult: TickerDataResult,
): Promise<{ result: TickerDataResult; freshCount: number }> {
  let result = seedResult;
  let freshCount = 0;
  let missing = requested.filter((key) => !cachedHasFreshEndpoint(result, key));

  while (missing.length > 0) {
    // Scope-aware merge-on-write lets a ticker-level in-flight fetch seed later scoped reads.
    const inFlight = inFlightTickerRequests.get(normalizedTicker);
    if (inFlight) {
      const inFlightResult = await inFlight;
      result = rebuildTickerDataResult({
        ...result,
        fetchedAt: inFlightResult.fetchedAt,
        endpointFetchedAt: mergeEndpointFetchedAt(result.endpointFetchedAt, inFlightResult.endpointFetchedAt),
      }, mergeRawData(result.rawData, inFlightResult.rawData));

      const remainingAfterInFlight = requested.filter((key) => !cachedHasFreshEndpoint(result, key));
      if (remainingAfterInFlight.length === 0) {
        break;
      }

      if (remainingAfterInFlight.length < missing.length) {
        missing = remainingAfterInFlight;
        continue;
      }
    }

    const endpointsToFetch = missing;
    const request = fetchAndCacheTickerEndpoints(normalizedTicker, endpointsToFetch, db, result);
    inFlightTickerRequests.set(normalizedTicker, request);

    try {
      result = await request;
      freshCount += endpointsToFetch.length;
    } finally {
      if (inFlightTickerRequests.get(normalizedTicker) === request) {
        inFlightTickerRequests.delete(normalizedTicker);
      }
    }

    // Return endpoint errors to the caller; future calls may retry because errors
    // are not treated as fresh cache coverage.
    break;
  }

  return { result, freshCount };
}

function logTickerCacheDecision(
  normalizedTicker: string,
  scope: EndpointScope,
  cacheHit: CacheHitState,
  freshCount: number,
  requestedCount: number,
) {
  console.log(
    `[askedgar-cache] ticker=${normalizedTicker} scope=${scope} `
    + `cacheHit=${cacheHit} fetchedFresh=${freshCount}/${requestedCount}`,
  );
}

/**
 * Cached version of fetchTickerData(). Checks DB for a fresh cached response
 * before hitting Ask Edgar. Cache is shared across all users (same SEC data).
 * TTL: 16 hours (news endpoint bypasses cache and is always re-fetched).
 */
export async function getCachedTickerData(
  ticker: string,
  opts?: { scope?: EndpointScope },
): Promise<TickerDataResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const scope = opts?.scope ?? 'snapshot';
  const requested = ENDPOINT_SCOPES[scope];
  const db = getDb();

  if (db) {
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
      const cachedResult = hydrateCachedTickerDataResult(cached[0].dataJson as TickerDataResult, cached[0].expiresAt);
      const cachedAvailability = getAskEdgarSnapshotAvailability(cachedResult.rawData);
      const fullyRateLimited = !cachedAvailability.hasAnyData && cachedAvailability.failureKind === 'rate-limited';
      const missing = fullyRateLimited
        ? []
        : requested.filter((key) => !cachedHasFreshEndpoint(cachedResult, key));

      if (missing.length === 0) {
        logTickerCacheDecision(normalizedTicker, scope, 'full', 0, requested.length);
        return subsetTickerDataResult(cachedResult, requested);
      }

      const { result, freshCount } = await completeTickerDataForScope(normalizedTicker, requested, db, cachedResult);
      logTickerCacheDecision(normalizedTicker, scope, 'partial', freshCount, requested.length);
      return subsetTickerDataResult(result, requested);
    }
  }

  const emptyResult: TickerDataResult = {
    ticker: normalizedTicker,
    fetchedAt: new Date().toISOString(),
    rawData: {},
    endpointFetchedAt: {},
    dataSources: [],
    warnings: [],
    hasAnyData: false,
  };
  const { result, freshCount } = await completeTickerDataForScope(normalizedTicker, requested, db, emptyResult);
  logTickerCacheDecision(normalizedTicker, scope, 'miss', freshCount, requested.length);
  return subsetTickerDataResult(result, requested);
}

// ---------------------------------------------------------------------------
// Scanner Summary Cache - 3-hour TTL, cacheType = 'scanner-summary'
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scanner Summary Cache - 3-hour TTL, cacheType = 'scanner-summary'
// ---------------------------------------------------------------------------

async function fetchScannerSummaryRaw(ticker: string): Promise<ScannerSummaryResult> {
  const normalizedTicker = ticker.trim().toUpperCase();

  const [registrationsResp, dilutionRatingResp, dilutionDataResp, equityLinesResp] =
    await Promise.all([
      fetchRegistrations(normalizedTicker),
      fetchDilutionRating(normalizedTicker),
      fetchDilutionData(normalizedTicker),
      fetchEquityLines(normalizedTicker),
    ]);

  const dilutionRatingFirst = toRecord(dilutionRatingResp.results[0]);
  const dilutionDataFirst = toRecord(dilutionDataResp.results[0]);

  const cashRemainingMonths: number | null =
    toNumberValue(getField(dilutionRatingFirst, ['cash_remaining_months', 'cashRemainingMonths'])) ??
    toNumberValue(getField(dilutionDataFirst, ['cashRemainingMonths', 'monthsRemaining']));

  const registrationRows = registrationsResp.results.map((item, index) =>
    toRegistrationRow(toRecord(item), `Registration ${index + 1}`),
  );

  // Scanner flags should reflect Ask Edgar's surfaced data, not whether we
  // think the company can currently use the program.
  const hasAtm = registrationRows.some((row) => row.isAtm);
  const hasS1 = registrationRows.some((row) => {
    const formType = row.formType ?? '';
    return /^S-1/i.test(formType);
  });

  const hasElFromEquityLines = equityLinesResp.results.length > 0;
  const hasElFromRegistrations = registrationRows.some((row) => {
    if (row.isAtm) return false;
    const headline = row.headline.toLowerCase();
    return (
      headline.includes('equity line') ||
      headline.includes('eloc') ||
      headline.includes('purchase agreement')
    );
  });
  const hasEl = hasElFromEquityLines || hasElFromRegistrations;

  const hasWarrants = dilutionDataResp.results.some((item) => {
    const row = toRecord(item);
    const amount = toNumberValue(getField(row, ['warrants_amount']));
    return amount !== null && amount > 0;
  });

  return {
    ticker: normalizedTicker,
    cashRemainingMonths,
    hasAtm,
    hasEl,
    hasWarrants,
    hasS1,
    fetchedAt: new Date().toISOString(),
  };
}

const SCANNER_SUMMARY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedScannerSummary(ticker: string): Promise<ScannerSummaryResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  await syncRateLimitFromDb();
  const db = getDb();

  if (db) {
    const now = new Date();
    const cached = await db
      .select()
      .from(askedgarCache)
      .where(
        and(
          eq(askedgarCache.cacheType, 'scanner-summary'),
          eq(askedgarCache.ticker, normalizedTicker),
          gt(askedgarCache.expiresAt, now),
        ),
      )
      .limit(1);

    if (cached.length > 0) {
      return cached[0].dataJson as ScannerSummaryResult;
    }
  }

  const result = await fetchScannerSummaryRaw(normalizedTicker);

  if (db) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SCANNER_SUMMARY_CACHE_TTL_MS);
    try {
      await db
        .insert(askedgarCache)
        .values({
          id: `scanner-summary-${normalizedTicker}`,
          cacheType: 'scanner-summary',
          ticker: normalizedTicker,
          dataJson: result,
          fetchedAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [askedgarCache.cacheType, askedgarCache.ticker],
          set: { dataJson: result, fetchedAt: now, expiresAt },
        });
    } catch (err) {
      console.warn('[askedgar-cache] Failed to write scanner-summary cache:', err);
    }
  }

  return result;
}
