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

describe('askedgar client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
    getDbMock.mockReset();
    getDbMock.mockReturnValue(undefined);
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
    expect(Object.keys(result.rawData)).toHaveLength(17);
    expect(result.dataSources).toHaveLength(17);
  });

  it('tracks unique ticker count', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ status: 'success', count: 1, results: [{}] })));
    const client = await import('@/lib/askedgar');

    await client.fetchTickerData('MSFT');
    await client.fetchTickerData('MSFT');
    expect(client.getAskEdgarCallCount()).toBe(1);
  });

  it('marks fully rate-limited AskEdgar snapshots as unusable', async () => {
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

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      error: {
        code: 'rate_limit_exceeded',
        message: 'AskEdgar rate limit exceeded',
        details: { retry_after: 42 },
      },
    }), { status: 429 }));

    const client = await import('@/lib/askedgar');
    await client.getCachedTickerData('AAPL');

    expect(fetchSpy).toHaveBeenCalledTimes(10);
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

    expect(fetchSpy).toHaveBeenCalledTimes(17);
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
});
