import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    ...actual,
    getDb: getDbMock,
  };
});

const { getRecentFilingsMock } = vi.hoisted(() => ({
  getRecentFilingsMock: vi.fn(),
}));

vi.mock('@/lib/sec/submissions', () => ({
  getRecentFilings: getRecentFilingsMock,
}));

const { getHistoricalOutstandingMock } = vi.hoisted(() => ({
  getHistoricalOutstandingMock: vi.fn(),
}));

vi.mock('@/lib/sec/companyfacts', () => ({
  getHistoricalOutstanding: getHistoricalOutstandingMock,
}));

const { getReverseSplitsMock } = vi.hoisted(() => ({
  getReverseSplitsMock: vi.fn(),
}));

vi.mock('@/lib/sec/reverse-splits', () => ({
  getReverseSplits: getReverseSplitsMock,
}));

const { getOfferingsMock } = vi.hoisted(() => ({
  getOfferingsMock: vi.fn(),
}));

vi.mock('@/lib/sec/offerings', () => ({
  getOfferings: getOfferingsMock,
}));

interface AskedgarCacheRow {
  id: string;
  cacheType: string;
  ticker: string;
  dataJson: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

function createAskedgarCacheDb(initialRows: AskedgarCacheRow[] = []) {
  const rows = [...initialRows];

  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async (limit: number) => rows.slice(0, limit),
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(value: AskedgarCacheRow) {
          return {
            onConflictDoUpdate: async ({ set }: { set: Partial<AskedgarCacheRow> }) => {
              const nextRow = { ...value, ...set } as AskedgarCacheRow;
              const index = rows.findIndex((row) => row.cacheType === value.cacheType && row.ticker === value.ticker);
              if (index >= 0) {
                rows[index] = nextRow;
                return;
              }

              rows.push(nextRow);
            },
          };
        },
      };
    },
    getRows() {
      return rows;
    },
  };
}

function mockSuccessfulEndpointFetch(costMicrodollars = 1000) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.replace('/v1/', '');

    return new Response(JSON.stringify({
      status: 'success',
      count: 1,
      results: [{
        endpoint,
        ticker: url.searchParams.get('ticker'),
        offeringType: url.searchParams.get('offering_type'),
      }],
      usage: { cost_microdollars: costMicrodollars },
    }));
  });
}

function fetchCallUrls(fetchSpy: ReturnType<typeof mockSuccessfulEndpointFetch>) {
  return fetchSpy.mock.calls.map(([input]) => new URL(String(input)));
}

function cachedRawDataKeys(cacheDb: ReturnType<typeof createAskedgarCacheDb>) {
  const row = cacheDb.getRows()[0];
  const dataJson = row.dataJson as { rawData: Record<string, unknown> };
  return Object.keys(dataJson.rawData);
}

describe('askedgar client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
    getDbMock.mockReset();
    getDbMock.mockReturnValue(undefined);
    getRecentFilingsMock.mockReset();
    getRecentFilingsMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        accession_number: '0001234567-26-000001',
        form_type: '8-K',
        filed_at: '2026-04-20',
        headline: '8-K filing',
        url: 'https://www.sec.gov/Archives/edgar/data/0/000123456726000001/doc.htm',
        primary_doc_description: null,
      }],
    });
    getHistoricalOutstandingMock.mockReset();
    getHistoricalOutstandingMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{ date: '2026-01-01', outstanding: 1_000_000 }],
    });
    getReverseSplitsMock.mockReset();
    getReverseSplitsMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        ratio: '1-for-25',
        executionDate: '2026-04-21',
        announcementDate: '2026-04-20',
        accessionNumber: '0001234567-26-000010',
        url: 'https://www.sec.gov/Archives/edgar/data/0/000123456726000010/doc.htm',
      }],
    });
    getOfferingsMock.mockReset();
    getOfferingsMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        accessionNumber: '0001234567-26-000020',
        formType: '424B5',
        filedAt: '2026-04-20',
        url: 'https://www.sec.gov/Archives/edgar/data/0/000123456726000020/offerings.htm',
        offeringType: 'ATM USED',
        sharesAmount: 1_000_000,
        sharePrice: 1,
        offeringAmount: 1_000_000,
        warrantsAmount: null,
        isSellingStockholderResale: false,
      }],
    });
    process.env.ASKEDGAR_API_KEY = 'test-key';
    process.env.ASKEDGAR_DAILY_LIMIT = '100';
  });

  afterEach(() => {
    delete process.env.ASKEDGAR_API_KEY;
    delete process.env.ASKEDGAR_DAILY_LIMIT;
  });

  it('returns endpoint payload map from fetchTickerData', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ status: 'success', count: 1, results: [{ ticker: 'AAPL' }] })));
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('AAPL');

    expect(result.ticker).toBe('AAPL');
    expect(Object.keys(result.rawData)).toHaveLength(16);
    expect(result.dataSources).toHaveLength(16);
  });

  it('only calls explicitly requested endpoints from fetchTickerData', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('AAPL', { endpoints: ['gap-stats', 'ownership'] });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchCallUrls(fetchSpy).map((url) => url.pathname)).toEqual([
      '/v1/gap-stats',
      '/v1/ownership',
    ]);
    expect(Object.keys(result.rawData)).toEqual(['gap-stats', 'ownership']);
    expect(result.dataSources).toHaveLength(2);
  });

  it('fetches the swing-trader scope on an empty ticker cache', async () => {
    const cacheDb = createAskedgarCacheDb();
    getDbMock.mockReturnValue(cacheDb);
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    const result = await client.getCachedTickerData('AAPL', { scope: 'swing-trader-research' });

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(Object.keys(result.rawData)).toEqual([...client.ENDPOINT_SCOPES['swing-trader-research']]);
    expect(cachedRawDataKeys(cacheDb)).toEqual([...client.ENDPOINT_SCOPES['swing-trader-research']]);
  });

  it('serves a swing-trader scope from a populated snapshot cache without upstream calls', async () => {
    const cacheDb = createAskedgarCacheDb();
    getDbMock.mockReturnValue(cacheDb);
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.getCachedTickerData('AAPL');
    expect(fetchSpy).toHaveBeenCalledTimes(12);

    fetchSpy.mockClear();
    const result = await client.getCachedTickerData('AAPL', { scope: 'swing-trader-research' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Object.keys(result.rawData)).toEqual([...client.ENDPOINT_SCOPES['swing-trader-research']]);
    expect(cachedRawDataKeys(cacheDb)).toHaveLength(16);
  });

  it('merges missing snapshot endpoints after a swing-trader scope populated the cache', async () => {
    const cacheDb = createAskedgarCacheDb();
    getDbMock.mockReturnValue(cacheDb);
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.getCachedTickerData('AAPL', { scope: 'swing-trader-research' });
    expect(fetchSpy).toHaveBeenCalledTimes(6);

    fetchSpy.mockClear();
    const result = await client.getCachedTickerData('AAPL');

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(Object.keys(result.rawData)).toHaveLength(16);
    expect(cachedRawDataKeys(cacheDb)).toHaveLength(16);
  });

  it('sums AskEdgar usage cost into the fan-out log', async () => {
    const costs = [1250, 2750];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const cost = costs.shift() ?? 0;
      return new Response(JSON.stringify({
        status: 'success',
        count: 1,
        results: [{}],
        usage: { cost_microdollars: cost },
      }));
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['gap-stats', 'ownership'] });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('costUsd=0.0040'));
  });

  it('throws for unknown endpoint keys', async () => {
    const client = await import('@/lib/askedgar');

    await expect(client.fetchTickerData('AAPL', { endpoints: ['nope'] })).rejects.toThrow('[askedgar] Unknown endpoint key: nope');
  });

  it('routes filing-titles through getRecentFilings, not AskEdgar', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['filing-titles'] });

    expect(getRecentFilingsMock).toHaveBeenCalledWith('AAPL', { limit: 20 });
    expect(fetchSpy).not.toHaveBeenCalled();
    const calledUrls = fetchCallUrls(fetchSpy).map((url) => url.pathname);
    expect(calledUrls.some((path) => path.includes('filing-titles'))).toBe(false);
  });

  it('routes reverse-splits through getReverseSplits, not AskEdgar', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['reverse-splits'] });

    expect(getReverseSplitsMock).toHaveBeenCalledWith('AAPL');
    expect(fetchSpy).not.toHaveBeenCalled();
    const calledUrls = fetchCallUrls(fetchSpy).map((url) => url.pathname);
    expect(calledUrls.some((path) => path.includes('reverse-splits'))).toBe(false);
  });

  it('routes offerings through getOfferings, not AskEdgar', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['offerings'] });

    expect(getOfferingsMock).toHaveBeenCalledWith('AAPL');
    expect(fetchSpy).not.toHaveBeenCalled();
    const calledUrls = fetchCallUrls(fetchSpy).map((url) => url.pathname);
    expect(calledUrls.some((path) => path.includes('offerings'))).toBe(false);
  });

  it('tracks unique ticker count', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ status: 'success', count: 1, results: [{}] })));
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('MSFT');
    await client.fetchTickerData('MSFT');
    expect(client.getAskEdgarCallCount()).toBe(1);
  });

  it('marks fully rate-limited AskEdgar snapshots as unusable', async () => {
    getRecentFilingsMock.mockResolvedValue({
      status: 'error',
      count: 0,
      results: [],
      error: 'Rate limited — retry after 42s',
    });
    getHistoricalOutstandingMock.mockResolvedValue({
      status: 'error',
      count: 0,
      results: [],
      error: 'SEC unavailable',
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      error: {
        code: 'rate_limit_exceeded',
        message: 'AskEdgar rate limit exceeded',
        details: { retry_after: 42 },
      },
    }), { status: 429 }));
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('AAPL');
    const availability = client.getAskEdgarSnapshotAvailability(result.rawData);

    expect(result.hasAnyData).toBe(true);
    expect(availability).toEqual({
      hasAnyData: false,
      hasUsableSnapshotData: false,
      failureKind: 'rate-limited',
      retryAfterSeconds: 42,
    });
    expect(result.warnings.some((warning) => warning.includes('AskEdgar rate limit exceeded') && warning.includes('code=rate_limit_exceeded'))).toBe(true);
  });

  it('caches fully rate-limited ticker results for the retry window', async () => {
    const cacheDb = createAskedgarCacheDb();
    getDbMock.mockReturnValue(cacheDb);
    getRecentFilingsMock.mockResolvedValue({
      status: 'error',
      count: 0,
      results: [],
      error: 'Rate limited — retry after 42s',
    });
    getHistoricalOutstandingMock.mockResolvedValue({
      status: 'error',
      count: 0,
      results: [],
      error: 'SEC unavailable',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      error: {
        code: 'rate_limit_exceeded',
        message: 'AskEdgar rate limit exceeded',
        details: { retry_after: 42 },
      },
    }), { status: 429 }));

    const client = await import('@/lib/askedgar');
    await client.getCachedTickerData('AAPL');

    expect(fetchSpy).toHaveBeenCalledTimes(9);
    expect(cacheDb.getRows()).toHaveLength(1);

    vi.resetModules();
    fetchSpy.mockClear();

    const reloadedClient = await import('@/lib/askedgar');
    const cachedResult = await reloadedClient.getCachedTickerData('AAPL');
    const availability = reloadedClient.getAskEdgarSnapshotAvailability(cachedResult.rawData);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(availability.failureKind).toBe('rate-limited');
    expect(availability.retryAfterSeconds).toBeGreaterThan(0);
    expect(availability.retryAfterSeconds).toBeLessThanOrEqual(42);
  });

  it('dedupes concurrent getCachedTickerData requests for the same ticker', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ status: 'success', count: 1, results: [{ ticker: 'MSFT' }] })));
    const client = await import('@/lib/askedgar');

    const [first, second] = await Promise.all([
      client.getCachedTickerData('MSFT'),
      client.getCachedTickerData('MSFT'),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(12);
    expect(first).toEqual(second);
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

  it('maps live /v1/gap-stats response shape to ResearchSnapshotGapStat', async () => {
    // Canonical AskEdgar /v1/gap-stats row captured live from SPRC on 2026-04-24.
    const sprcRow = {
      ticker: 'SPRC',
      date: '2026-04-21',
      market_open: 6.08,
      previous_day_close: 4.23,
      gap_percentage: 43.74,
      high_price: 6.57,
      high_time: '2026-04-21T09:33:00',
      low_price: 4.68,
      low_time: '2026-04-21T13:43:00',
      market_close: 6.0,
      closed_over_vwap: false,
      premarket_vwap: 6.9595,
      premarket_dollar_volume: 72234465.08,
      premarket_volume: 10379248.0,
      volume: 4606125.857634,
      dollar_volume: 25723436.06,
      market_cap: 2392065.0,
      all_tags: ['Upcoming Events', 'Patents'],
      filing_types: ['grok', '6-K'],
      afterhours_close: 5.55,
      last_updated: '2026-04-22T00:00:03.418652',
    };

    const client = await import('@/lib/askedgar');
    const normalized = client.normalizeAskEdgarResponse({
      'gap-stats': { status: 'success', count: 1, results: [sprcRow] },
    }, {
      ticker: 'SPRC',
      companyName: 'SciSparc',
      fetchedAt: '2026-04-24T00:00:00.000Z',
      warnings: [],
    });

    expect(normalized.gapStats).toHaveLength(1);
    const row = normalized.gapStats[0];
    expect(row).toMatchObject({
      date: '2026-04-21',
      gapPercentage: 43.74,
      marketOpen: 6.08,
      marketClose: 6.0,
      intradayHigh: 6.57,
      intradayLow: 4.68,
      volume: 4606125.857634,
    });
    expect(row.tags).toEqual(['Upcoming Events', 'Patents', 'grok', '6-K']);
  });
});
