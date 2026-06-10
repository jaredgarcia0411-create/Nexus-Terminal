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

export async function fetchEodhdNews(ticker: string, limit = 20): Promise<AskEdgarResponse<unknown>> {
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
