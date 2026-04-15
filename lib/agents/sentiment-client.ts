import type { SentimentDataPoint } from './types';

const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1&format=json';
const DEFAULT_TIMEOUT_MS = 8_000;

interface FngApiResponse {
  data?: Array<{
    value?: string;
    value_classification?: string;
  }>;
  metadata?: { error: null | string };
}

/**
 * Fetch the Alternative.me Fear & Greed Index.
 * Returns null on any failure - caller must handle gracefully.
 * Note: This index is crypto-derived (tracks BTC sentiment correlates).
 * Treat as a divergent/leading signal for equities, not an equities-direct reading.
 */
export async function fetchFearGreedIndex(
  options?: { timeoutMs?: number },
): Promise<SentimentDataPoint | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(FEAR_GREED_URL, {
      headers: { 'User-Agent': 'Nexus-Agent/1.0' },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = (await response.json()) as FngApiResponse;
    const entry = json.data?.[0];
    const rawValue = entry?.value?.trim();
    const classification = entry?.value_classification?.trim();

    if (!rawValue || !classification) return null;

    const score = Number(rawValue);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;

    return { score, classification, source: 'alternative.me/fng' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
