import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchEodhdNews } from '@/lib/eodhd';

describe('fetchEodhdNews', () => {
  afterEach(() => {
    delete process.env.EODHD_API_KEY;
    vi.restoreAllMocks();
  });

  it('returns an error response when EODHD_API_KEY is missing', async () => {
    const result = await fetchEodhdNews('AAPL');

    expect(result).toEqual({
      status: 'error',
      count: 0,
      results: [],
      error: 'EODHD_API_KEY not configured',
    });
  });

  it('requests exchange-suffixed EODHD news and wraps the bare array response', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { title: 'Apple headline', date: '2026-04-15T12:00:00Z' },
    ])));

    const result = await fetchEodhdNews('aapl', 5);

    expect(result).toEqual({
      status: 'success',
      count: 1,
      results: [{ title: 'Apple headline', date: '2026-04-15T12:00:00Z' }],
    });
    const requestUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(requestUrl.origin).toBe('https://eodhd.com');
    expect(requestUrl.pathname).toBe('/api/news');
    expect(requestUrl.searchParams.get('s')).toBe('AAPL.US');
    expect(requestUrl.searchParams.get('limit')).toBe('5');
    expect(requestUrl.searchParams.get('api_token')).toBe('test-key');
    expect(requestUrl.searchParams.get('fmt')).toBe('json');
  });
});
