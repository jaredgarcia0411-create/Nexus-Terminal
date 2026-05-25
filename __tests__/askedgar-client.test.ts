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

const { getResearchFilingsMock } = vi.hoisted(() => ({
  getResearchFilingsMock: vi.fn(),
}));

vi.mock('@/lib/sec/submissions', () => ({
  getResearchFilings: getResearchFilingsMock,
}));

const { getHistoricalOutstandingMock } = vi.hoisted(() => ({
  getHistoricalOutstandingMock: vi.fn(),
}));

vi.mock('@/lib/sec/companyfacts', () => ({
  getHistoricalOutstanding: getHistoricalOutstandingMock,
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
  let rateLimitedUntil: Date | null = null;

  return {
    select(selection?: Record<string, unknown>) {
      const selectedKeys = selection ? Object.keys(selection) : [];
      return {
        from() {
          return {
            where() {
              if (selectedKeys.includes('rateLimitedUntil')) {
                return {
                  limit: async () => (rateLimitedUntil ? [{ rateLimitedUntil }] : []),
                };
              }

              return {
                limit: async (limit: number) => rows.slice(0, limit),
                then: (
                  resolve: (value: never[]) => void,
                  reject: (reason?: unknown) => void,
                ) => Promise.resolve([]).then(resolve, reject),
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(value: AskedgarCacheRow | {
          id?: string;
          rateLimitedUntil?: Date | null;
        }) {
          return {
            onConflictDoUpdate: async ({ set }: { set: Partial<AskedgarCacheRow> }) => {
              if ('rateLimitedUntil' in value && value.id === 'global') {
                rateLimitedUntil = value.rateLimitedUntil ?? null;
                return;
              }

              if (!('cacheType' in value) || typeof value.cacheType !== 'string') {
                return;
              }

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
    getRateLimitedUntil() {
      return rateLimitedUntil;
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
    getResearchFilingsMock.mockReset();
    getResearchFilingsMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        accession_number: '0001234567-26-000001',
        cik: '0001234567',
        ticker_requested: 'AAPL',
        ticker_at_ingest: 'AAPL',
        form_type: '8-K',
        filed_at: '2026-04-20',
        report_date: null,
        acceptance_datetime: null,
        headline: '8-K filing',
        url: 'https://www.sec.gov/Archives/edgar/data/0/000123456726000001/doc.htm',
        primary_document: 'doc.htm',
        primary_doc_description: null,
        items: null,
        archive_source: null,
      }],
    });
    getHistoricalOutstandingMock.mockReset();
    getHistoricalOutstandingMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{ date: '2026-01-01', outstanding: 1_000_000 }],
    });
    process.env.ASKEDGAR_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ASKEDGAR_API_KEY;
  });

  it('returns endpoint payload map from fetchTickerData', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ status: 'success', count: 1, results: [{ ticker: 'AAPL' }] })));
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('AAPL');

    expect(result.ticker).toBe('AAPL');
    expect(Object.keys(result.rawData)).toHaveLength(13);
    expect(result.dataSources).toHaveLength(13);
  });

  it('only calls explicitly requested endpoints from fetchTickerData', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('AAPL', { endpoints: ['gap-stats', 'news'] });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchCallUrls(fetchSpy).map((url) => url.pathname)).toEqual([
      '/v1/gap-stats',
      '/v1/news',
    ]);
    expect(Object.keys(result.rawData)).toEqual(['gap-stats', 'news']);
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
    expect(fetchSpy).toHaveBeenCalledTimes(11);

    fetchSpy.mockClear();
    const result = await client.getCachedTickerData('AAPL', { scope: 'swing-trader-research' });

    // News now carries a 15-minute freshness window, so back-to-back reads
    // serve every swing-scope endpoint (including news) from the cache.
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(Object.keys(result.rawData)).toEqual([...client.ENDPOINT_SCOPES['swing-trader-research']]);
    expect(cachedRawDataKeys(cacheDb)).toHaveLength(13);
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

    // 6 endpoints not yet cached (screener, equity-lines, nasdaq-compliance,
    // reverse-splits, sec-filings, historical-tickers). One is SEC-backed,
    // and news is fresh in the cache from the first call, so only 5 AskEdgar
    // fetches happen.
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(Object.keys(result.rawData)).toHaveLength(13);
    expect(cachedRawDataKeys(cacheDb)).toHaveLength(13);
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

    await client.fetchTickerData('AAPL', { endpoints: ['gap-stats', 'news'] });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('costUsd=0.0040'));
  });

  it('throws for unknown endpoint keys', async () => {
    const client = await import('@/lib/askedgar');

    await expect(client.fetchTickerData('AAPL', { endpoints: ['nope'] })).rejects.toThrow('[askedgar] Unknown endpoint key: nope');
  });

  it('routes reverse-splits through AskEdgar', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['reverse-splits'] });

    const calledUrls = fetchCallUrls(fetchSpy).map((url) => url.pathname);
    expect(calledUrls).toEqual(['/v1/reverse-splits']);
  });

  it('routes offerings through AskEdgar with the default limit', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['offerings'] });

    const [offeringsUrl] = fetchCallUrls(fetchSpy);
    expect(offeringsUrl.pathname).toBe('/v1/offerings');
    expect(offeringsUrl.searchParams.get('limit')).toBe('50');
  });

  it('routes sec-filings through getResearchFilings, not AskEdgar', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['sec-filings'] });

    expect(getResearchFilingsMock).toHaveBeenCalledWith('AAPL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes historical-tickers through AskEdgar', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['historical-tickers'] });

    const [historicalTickersUrl] = fetchCallUrls(fetchSpy);
    expect(historicalTickersUrl.pathname).toBe('/v1/historical-tickers');
  });

  it('does not send an effective_status filter when fetching registrations', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['registrations'] });

    const [registrationsUrl] = fetchCallUrls(fetchSpy);
    expect(registrationsUrl.pathname).toBe('/v1/registrations');
    expect(registrationsUrl.searchParams.get('ticker')).toBe('AAPL');
    expect(registrationsUrl.searchParams.has('effective_status')).toBe(false);
  });

  it('filters news requests to rendered form types', async () => {
    const fetchSpy = mockSuccessfulEndpointFetch();
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('AAPL', { endpoints: ['news'] });

    const [newsUrl] = fetchCallUrls(fetchSpy);
    expect(newsUrl.pathname).toBe('/v1/news');
    expect(newsUrl.searchParams.get('form_type')).toBe('news,8-K,S-1,6-K,6-K/A,S-1/A');
  });

  it('keeps restricted or expired ATM registrations in scanner summary flags', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const endpoint = url.pathname.replace('/v1/', '');

      if (endpoint === 'registrations') {
        return new Response(JSON.stringify({
          status: 'success',
          count: 1,
          results: [{
            headline: 'Expired ATM prospectus supplement',
            is_atm: true,
            effective_status: false,
            status: 'Restricted by baby shelf',
            expiration_date: '2020-01-01',
            form_type: 'S-3',
          }],
        }));
      }

      return new Response(JSON.stringify({
        status: 'success',
        count: 0,
        results: [],
      }));
    });
    const client = await import('@/lib/askedgar');

    const summary = await client.getCachedScannerSummary('AAPL');

    expect(summary.hasAtm).toBe(true);
    expect(summary.hasEl).toBe(false);
    expect(summary.hasS1).toBe(false);
  });

  it('persists AskEdgar retry windows to the DB-backed runtime state', async () => {
    const cacheDb = createAskedgarCacheDb();
    getDbMock.mockReturnValue(cacheDb);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      error: {
        code: 'rate_limit_exceeded',
        message: 'AskEdgar rate limit exceeded',
        details: { retry_after: 42 },
      },
    }), { status: 429 }));
    const client = await import('@/lib/askedgar');

    const result = await client.fetchTickerData('MSFT', { endpoints: ['gap-stats'] });
    await Promise.resolve();

    expect(result.rawData['gap-stats'].error).toContain('retry after 42s');
    expect(cacheDb.getRateLimitedUntil()).toBeInstanceOf(Date);
    expect(cacheDb.getRateLimitedUntil()?.getTime()).toBeGreaterThan(Date.now());
  });

  it('marks fully rate-limited AskEdgar snapshots as unusable', async () => {
    getResearchFilingsMock.mockResolvedValue({
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

    expect(result.hasAnyData).toBe(false);
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
    getResearchFilingsMock.mockResolvedValue({
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

    expect(fetchSpy).toHaveBeenCalledTimes(8);
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

    // 11 AskEdgar fetches for the first call's full snapshot; the second call wakes
    // from in-flight dedupe with news already inside its 15-minute freshness
    // window, so no extra news re-fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(11);
    expect(Object.keys(first.rawData)).toEqual(Object.keys(second.rawData));
    expect(second.rawData.news).toBeDefined();
  });

  it('reads header stats (market cap, outstanding, float, industry, country) from the screener endpoint', async () => {
    const client = await import('@/lib/askedgar');

    const normalized = client.normalizeAskEdgarResponse({
      screener: {
        status: 'success',
        count: 1,
        results: [{
          market_cap_final: 123000000,
          outstanding: 45000000,
          tradable_float: 12000000,
          industry: 'Biotechnology',
          country: 'United States',
        }],
      },
    }, {
      ticker: 'AAPL',
      companyName: 'Acme Biotech',
      fetchedAt: '2026-04-06T00:00:00.000Z',
      warnings: [],
    });

    expect(normalized.header).toMatchObject({
      marketCap: 123000000,
      outstandingShares: 45000000,
      float: 12000000,
      industry: 'Biotechnology',
      country: 'United States',
    });
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
