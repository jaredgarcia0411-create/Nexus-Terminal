import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('jarvis askedgar client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env.ASKEDGAR_API_KEY = 'test-key';
    process.env.ASKEDGAR_DAILY_LIMIT = '100';
  });

  afterEach(() => {
    delete process.env.ASKEDGAR_API_KEY;
    delete process.env.ASKEDGAR_DAILY_LIMIT;
  });

  it('returns endpoint payload map from fetchTickerData', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'success', count: 1, results: [{ ticker: 'AAPL' }] })));
    const client = await import('@/lib/jarvis/askedgar');

    const result = await client.fetchTickerData('AAPL');

    expect(result.ticker).toBe('AAPL');
    expect(Object.keys(result.rawData)).toHaveLength(13);
    expect(result.dataSources).toHaveLength(13);
  });

  it('tracks daily call count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'success', count: 1, results: [{}] })));
    const client = await import('@/lib/jarvis/askedgar');

    await client.fetchTickerData('MSFT');
    expect(client.getAskEdgarCallCount()).toBe(13);
  });
});
