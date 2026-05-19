import {
  ENDPOINT_REGISTRY_LOOKUP,
  ENDPOINT_SCOPES,
  responseHasData,
} from '@/lib/askedgar/endpoints';
import { syncRateLimitFromDb } from '@/lib/askedgar/runtime-state';
import type { AskEdgarResponse, DilutionDataSourceCheck, TickerDataResult } from '@/lib/askedgar/types';

interface EndpointConfig {
  key: string;
  label: string;
  run: () => Promise<AskEdgarResponse<unknown>>;
}

export interface EndpointState {
  key: string;
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

export function endpointWarning(state: EndpointState): string | null {
  if (state.hasData) return null;
  if (state.response.error) return `${state.label} unavailable: ${state.response.error}`;
  return `${state.label} returned no data`;
}

function sumCostUsd(states: EndpointState[]): number {
  const micro = states.reduce(
    (sum, state) => sum + (state.response.usage?.cost_microdollars ?? 0),
    0,
  );
  return micro / 1_000_000;
}

export function toDataSource(state: EndpointState): DilutionDataSourceCheck {
  return {
    endpoint: state.key,
    label: state.label,
    hasData: state.hasData,
    error: state.response.error,
  };
}

// Build the per-endpoint timestamp map for endpoints that returned a non-error
// response (including empty success). Errors are intentionally skipped so a
// transient failure does not pin a "fresh" timestamp onto stale data.
function buildEndpointFetchedAt(states: EndpointState[]): Record<string, string> {
  const stampedAt = new Date().toISOString();
  return Object.fromEntries(
    states
      .filter((state) => state.response.status !== 'error')
      .map((state) => [state.key, stampedAt]),
  );
}

export function endpointStatesFromRawData(rawData: Record<string, AskEdgarResponse<unknown>>): EndpointState[] {
  return Object.entries(rawData).map(([key, response]) => ({
    key,
    label: ENDPOINT_REGISTRY_LOOKUP[key]?.label ?? key,
    response,
    hasData: responseHasData(response),
  }));
}

export async function fetchTickerData(
  ticker: string,
  opts?: { endpoints?: readonly string[] },
): Promise<TickerDataResult> {
  const startedAt = Date.now();
  const normalizedTicker = ticker.trim().toUpperCase();
  await syncRateLimitFromDb();

  const requested = opts?.endpoints ?? ENDPOINT_SCOPES.snapshot;
  const endpointConfigs: EndpointConfig[] = requested.map((key) => {
    const entry = ENDPOINT_REGISTRY_LOOKUP[key];
    if (!entry) {
      throw new Error(`[askedgar] Unknown endpoint key: ${key}`);
    }
    return { key, label: entry.label, run: () => entry.run(normalizedTicker) };
  });

  // Run endpoints in batches of 10 to stay well within the 150/min API rate limit.
  // The SEC-backed endpoints also use their own SEC request pacing.
  // Batching also lets the rate-limit guard kick in between batches if needed.
  const BATCH_SIZE = 10;
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

  console.log(
    `[askedgar-fanout] ticker=${normalizedTicker} requested=${requested.length} `
    + `succeeded=${endpointStates.filter((state) => state.hasData).length} `
    + `costUsd=${sumCostUsd(endpointStates).toFixed(4)} `
    + `durationMs=${Date.now() - startedAt}`,
  );

  return {
    ticker: normalizedTicker,
    fetchedAt: new Date().toISOString(),
    rawData,
    endpointFetchedAt: buildEndpointFetchedAt(endpointStates),
    dataSources: endpointStates.map(toDataSource),
    warnings,
    hasAnyData,
  };
}
