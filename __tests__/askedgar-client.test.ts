import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('askedgar client', () => {
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
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('AAPL');

    expect(result.ticker).toBe('AAPL');
    expect(Object.keys(result.rawData)).toHaveLength(16);
    expect(result.dataSources).toHaveLength(16);
  });

  it('tracks daily call count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'success', count: 1, results: [{}] })));
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('MSFT');
    expect(client.getAskEdgarCallCount()).toBe(16);
  });

  it('marks fully rate-limited AskEdgar snapshots as unusable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { retry_after: 42 } }), { status: 429 }));
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('AAPL');
    const availability = client.getAskEdgarSnapshotAvailability(result.rawData);

    expect(result.hasAnyData).toBe(false);
    expect(availability).toEqual({
      hasAnyData: false,
      hasUsableSnapshotData: false,
      failureKind: 'rate-limited',
      retryAfterSeconds: 42,
    });
  });

  it('falls back to float-outstanding header stats when screener data is sparse', async () => {
    const client = await import('@/lib/askedgar');

    const normalized = client.normalizeAskEdgarResponse({
      screener: { status: 'success', count: 1, results: [{}] },
      'float-outstanding': {
        status: 'success',
        count: 1,
        results: [{
          market_cap_final: 123000000,
          outstanding: 45000000,
          float: 12000000,
          industry: 'Biotechnology',
          country: 'United States',
        }],
      },
    }, {
      ticker: 'AAPL',
      companyName: 'Acme Biotech',
      fetchedAt: '2026-04-06T00:00:00.000Z',
      warnings: ['Screener unavailable: 503 Request failed'],
    });

    expect(normalized.header).toMatchObject({
      marketCap: 123000000,
      outstandingShares: 45000000,
      float: 12000000,
      industry: 'Biotechnology',
      country: 'United States',
    });
    expect(normalized.warnings).toEqual(['Screener unavailable: 503 Request failed']);
  });
});
