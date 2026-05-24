import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getDbMock,
  fetchHistoricalDilutionRatingMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getDbMock: vi.fn(),
  fetchHistoricalDilutionRatingMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server-db-utils')>('@/lib/server-db-utils');
  return {
    ...actual,
    requireUser: requireUserMock,
  };
});

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    ...actual,
    getDb: getDbMock,
  };
});

vi.mock('@/lib/askedgar/endpoints', async () => {
  const actual = await vi.importActual<typeof import('@/lib/askedgar/endpoints')>('@/lib/askedgar/endpoints');
  return {
    ...actual,
    fetchHistoricalDilutionRating: fetchHistoricalDilutionRatingMock,
  };
});

import { GET } from '@/app/api/historical-dilution-rating/route';

interface CacheRow {
  id: string;
  cacheType: string;
  ticker: string;
  dataJson: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

function authedUser() {
  requireUserMock.mockResolvedValue({
    user: { id: 'user-1', email: 'test@example.com', name: 'Test', picture: null },
  });
}

function makeRequest(ticker?: string, date?: string) {
  const params = new URLSearchParams();
  if (ticker !== undefined) params.set('ticker', ticker);
  if (date !== undefined) params.set('date', date);
  const qs = params.toString();
  return new Request(`http://localhost/api/historical-dilution-rating${qs ? `?${qs}` : ''}`);
}

function ensureResponse(response: Awaited<ReturnType<typeof GET>>) {
  if (!(response instanceof Response)) {
    throw new Error('Expected route handler to return a Response');
  }
  return response;
}

function successRating() {
  return {
    status: 'success',
    count: 1,
    results: [{
      ticker: 'TNXP',
      date: '2024-12-17',
      overall_offering_risk: 'High',
      cash_need: 'High',
    }],
    usage: { cost_microdollars: 301000 },
  };
}

function createCacheDb(initialRows: CacheRow[] = [], opts: { writeFails?: boolean } = {}) {
  const rows = [...initialRows];

  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async (limit: number) => rows
                  .filter((row) => row.cacheType === 'historical-dilution-rating' && row.expiresAt > new Date())
                  .slice(0, limit),
              };
            },
          };
        },
      };
    },
    insert() {
      if (opts.writeFails) {
        throw new Error('write failed');
      }

      return {
        values(value: CacheRow) {
          return {
            onConflictDoUpdate: async ({ set }: { set: Partial<CacheRow> }) => {
              const nextRow = { ...value, ...set };
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

describe('GET /api/historical-dilution-rating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authedUser();
    getDbMock.mockReturnValue(createCacheDb());
    fetchHistoricalDilutionRatingMock.mockResolvedValue(successRating());
  });

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValueOnce({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = ensureResponse(await GET(makeRequest('TNXP', '2024-12-17')));

    expect(response.status).toBe(401);
  });

  it('returns 400 for missing or malformed dates', async () => {
    const response = ensureResponse(await GET(makeRequest('TNXP', 'not-a-date')));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.fieldErrors.date).toContain('Invalid date format');
  });

  it('returns 400 for out-of-window dates', async () => {
    const oldResponse = ensureResponse(await GET(makeRequest('TNXP', '1900-01-01')));
    const futureResponse = ensureResponse(await GET(makeRequest('TNXP', '2099-01-01')));

    expect(oldResponse.status).toBe(400);
    expect(futureResponse.status).toBe(400);
  });

  it('returns a cache hit without calling AskEdgar', async () => {
    const payload = { ticker: 'TNXP', date: '2024-12-17', rating: successRating() };
    getDbMock.mockReturnValue(createCacheDb([{
      id: 'historical-dilution-rating-TNXP:2024-12-17',
      cacheType: 'historical-dilution-rating',
      ticker: 'TNXP:2024-12-17',
      dataJson: payload,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    }]));

    const response = ensureResponse(await GET(makeRequest('TNXP', '2024-12-17')));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(fetchHistoricalDilutionRatingMock).not.toHaveBeenCalled();
  });

  it('calls AskEdgar and writes the cache on a miss', async () => {
    const cacheDb = createCacheDb();
    getDbMock.mockReturnValue(cacheDb);

    const response = ensureResponse(await GET(makeRequest('TNXP', '2024-12-17')));

    expect(response.status).toBe(200);
    expect(fetchHistoricalDilutionRatingMock).toHaveBeenCalledWith('TNXP', '2024-12-17');
    expect(cacheDb.getRows()).toHaveLength(1);
    expect(cacheDb.getRows()[0]).toMatchObject({
      cacheType: 'historical-dilution-rating',
      ticker: 'TNXP:2024-12-17',
    });
  });

  it('shares one cache row for lowercase and uppercase tickers', async () => {
    const cacheDb = createCacheDb();
    getDbMock.mockReturnValue(cacheDb);

    const lowerResponse = ensureResponse(await GET(makeRequest('tnxp', '2024-12-17')));
    const upperResponse = ensureResponse(await GET(makeRequest('TNXP', '2024-12-17')));

    expect(lowerResponse.status).toBe(200);
    expect(upperResponse.status).toBe(200);
    expect(fetchHistoricalDilutionRatingMock).toHaveBeenCalledTimes(1);
    expect(cacheDb.getRows()).toHaveLength(1);
    expect(cacheDb.getRows()[0].ticker).toBe('TNXP:2024-12-17');
  });

  it('propagates AskEdgar rate-limit responses as 429', async () => {
    fetchHistoricalDilutionRatingMock.mockResolvedValueOnce({
      status: 'error',
      count: 0,
      results: [],
      error: 'Rate limited - retry after 42s',
    });

    const response = ensureResponse(await GET(makeRequest('TNXP', '2024-12-17')));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      retryHint: 'Retry in about 42 seconds.',
    });
  });

  it('returns 503 for non-rate-limit AskEdgar errors', async () => {
    fetchHistoricalDilutionRatingMock.mockResolvedValueOnce({
      status: 'error',
      count: 0,
      results: [],
      error: '503 upstream unavailable',
    });

    const response = ensureResponse(await GET(makeRequest('TNXP', '2024-12-17')));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: '503 upstream unavailable',
    });
  });

  it('returns the live payload when the cache write fails', async () => {
    getDbMock.mockReturnValue(createCacheDb([], { writeFails: true }));
    vi.spyOn(console, 'warn').mockImplementationOnce(() => undefined);

    const response = ensureResponse(await GET(makeRequest('TNXP', '2024-12-17')));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ticker: 'TNXP',
      date: '2024-12-17',
      rating: successRating(),
    });
  });
});
