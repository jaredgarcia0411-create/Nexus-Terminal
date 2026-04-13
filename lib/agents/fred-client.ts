import type { FredDataPoint } from './types';

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Human-readable labels for FRED series IDs.
 * Used in the Discord embed so traders see "10-Year Treasury" instead of "DGS10".
 */
const SERIES_LABELS: Record<string, string> = {
  DGS10: '10Y Treasury',
  DGS2: '2Y Treasury',
  T10Y2Y: '10Y-2Y Spread',
  FEDFUNDS: 'Fed Funds Rate',
};

/**
 * Fetch the most recent observation for each FRED series.
 * Returns empty array if FRED_API_KEY is not set (graceful degrade).
 * Each series is fetched in parallel with independent error handling.
 */
export async function fetchFredSeries(
  seriesIds: string[],
  options?: { timeoutMs?: number },
): Promise<FredDataPoint[]> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return [];

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const settled = await Promise.allSettled(
    seriesIds.map(async (seriesId) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = new URL(FRED_BASE_URL);
        url.searchParams.set('series_id', seriesId);
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('file_type', 'json');
        url.searchParams.set('sort_order', 'desc');
        url.searchParams.set('limit', '1');

        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`FRED ${seriesId}: status ${response.status}`);
        }

        const data = (await response.json()) as {
          observations?: Array<{ date?: string; value?: string }>;
        };

        const obs = data.observations?.[0];
        const rawValue = obs?.value?.trim();
        // FRED uses "." for missing data (holidays, weekends)
        const numericValue = rawValue && rawValue !== '.' ? Number(rawValue) : null;

        return {
          seriesId,
          label: SERIES_LABELS[seriesId] ?? seriesId,
          date: obs?.date ?? 'unknown',
          value: Number.isFinite(numericValue) ? numericValue : null,
        } satisfies FredDataPoint;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return settled
    .filter((result): result is PromiseFulfilledResult<FredDataPoint> => result.status === 'fulfilled')
    .map((result) => result.value);
}
