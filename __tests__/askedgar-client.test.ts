import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('askedgar-client', () => {
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

  it('returns structured error when API key is missing', async () => {
    delete process.env.ASKEDGAR_API_KEY;
    const client = await import('@/lib/askedgar-client');

    const result = await client.fetchFloatOutstanding('AAPL');

    expect(result.status).toBe('error');
    expect(result.error).toContain('ASKEDGAR_API_KEY');
    expect(result.results).toEqual([]);
  });

  it('rejects invalid ticker format', async () => {
    const client = await import('@/lib/askedgar-client');

    const result = await client.fetchFloatOutstanding('aapl');

    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid ticker');
  });

  it('enforces daily call limit', async () => {
    process.env.ASKEDGAR_DAILY_LIMIT = '1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'success', count: 1, results: [{}] })));
    const client = await import('@/lib/askedgar-client');

    const first = await client.fetchFloatOutstanding('AAPL');
    const second = await client.fetchScreenerByTicker('AAPL');

    expect(first.status).toBe('success');
    expect(second.status).toBe('error');
    expect(second.error).toContain('daily limit');
  });

  it('handles network errors with structured error result', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const client = await import('@/lib/askedgar-client');

    const result = await client.fetchNews('AAPL');

    expect(result.status).toBe('error');
    expect(result.error).toContain('network down');
  });

  it('maps 401 responses to auth error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }));
    const client = await import('@/lib/askedgar-client');

    const result = await client.fetchOfferings('AAPL');

    expect(result.status).toBe('error');
    expect(result.error).toContain('401');
    expect(result.error).toContain('Invalid API key');
  });

  it('handles timeout abort errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const client = await import('@/lib/askedgar-client');

    const result = await client.fetchReverseSplits('AAPL');

    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
  });

  it('parses successful response for all endpoints', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(JSON.stringify({ status: 'success', count: 1, results: [{ ticker: 'AAPL' }] }))
    ));
    const client = await import('@/lib/askedgar-client');

    const results = await Promise.all([
      client.fetchFloatOutstanding('AAPL'),
      client.fetchScreenerByTicker('AAPL'),
      client.fetchDilutionRating('AAPL'),
      client.fetchDilutionData('AAPL'),
      client.fetchOfferings('AAPL'),
      client.fetchRegistrations('AAPL'),
      client.fetchNews('AAPL'),
      client.fetchNasdaqCompliance('AAPL'),
      client.fetchPumpAndDumpTracker('AAPL'),
      client.fetchAgreements('AAPL'),
      client.fetchHistoricalFloatPro('AAPL'),
      client.fetchReverseSplits('AAPL'),
    ]);

    expect(results.every((result) => result.status === 'success')).toBe(true);
    expect(results.every((result) => result.results.length === 1)).toBe(true);
    expect(client.getAskEdgarCallCount()).toBe(12);
  });
});
