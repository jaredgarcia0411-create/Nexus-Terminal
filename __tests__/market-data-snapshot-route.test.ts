import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getDbMock,
  fetchUnifiedSnapshotMock,
  fetchTopMarketMoversMock,
  fetchBatchDailyTickerSummariesMock,
  getEasternMarketSessionMock,
  normalizeMassiveTickerMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getDbMock: vi.fn(),
  fetchUnifiedSnapshotMock: vi.fn(),
  fetchTopMarketMoversMock: vi.fn(),
  fetchBatchDailyTickerSummariesMock: vi.fn(),
  getEasternMarketSessionMock: vi.fn(),
  normalizeMassiveTickerMock: vi.fn((raw: string) => raw.replace(/^X:/, '').replace(/^C:/, '').replace(/^\//, '').trim().toUpperCase()),
}));

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/massive-market', () => ({
  fetchUnifiedSnapshot: fetchUnifiedSnapshotMock,
  fetchTopMarketMovers: fetchTopMarketMoversMock,
  fetchBatchDailyTickerSummaries: fetchBatchDailyTickerSummariesMock,
  getEasternMarketSession: getEasternMarketSessionMock,
  normalizeMassiveTicker: normalizeMassiveTickerMock,
}));

import { GET } from '@/app/api/market-data/snapshot/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('GET /api/market-data/snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    getDbMock.mockReturnValue(null);
    fetchUnifiedSnapshotMock.mockResolvedValue({
      results: [
        { ticker: 'SPY', session: { close: 500, change: 2, change_percent: 0.4 }, market_status: 'open' },
        { ticker: 'EURUSD', session: { close: 1.08, change: 0.01, change_percent: 0.9 }, market_status: 'open' },
        { ticker: 'BTCUSD', session: { close: 61000, change: 150, change_percent: 0.25 }, market_status: 'open' },
        { ticker: 'GC', session: { close: 2231.2, change: 4.2, change_percent: 0.19 }, market_status: 'open' },
        { ticker: 'AAPL', session: { close: 200, change: 3, change_percent: 1.52 }, market_status: 'open' },
      ],
    });
    fetchBatchDailyTickerSummariesMock.mockResolvedValue(new Map([
      ['SPY', { ticker: 'SPY', close: 500, preMarket: 501, afterHours: 499 }],
      ['AAPL', { ticker: 'AAPL', close: 200, preMarket: 202, afterHours: 201 }],
    ]));
    getEasternMarketSessionMock.mockReturnValue('pre-market');
    fetchTopMarketMoversMock
      .mockResolvedValueOnce({ tickers: [{ ticker: 'AAPL', prevDay: { c: 100 }, day: { c: 105 }, todaysChange: 5, todaysChangePerc: 5, updated: 123 }] })
      .mockResolvedValueOnce({ tickers: [{ ticker: 'PENNY', prevDay: { c: 0.5 }, day: { c: 0.7 }, todaysChange: 0.2, todaysChangePerc: 40, updated: 123 }] });
  });

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValueOnce({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const response = ensureResponse(await GET());
    expect(response.status).toBe(401);
  });

  it('returns normalized snapshot sections and filters penny movers', async () => {
    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.indices).toBeInstanceOf(Array);
    expect(payload.data.fx[0].symbol).toBe('EURUSD');
    expect(payload.data.fx[0].price).toBe(1.08);
    expect(payload.data.futures[0].price).toBe(2231.2);
    expect(payload.data.indices[0].quoteSession).toBe('pre-market');
    expect(payload.data.indices[0].price).toBe(501);
    expect(payload.data.indices[0].change).toBe(1);
    expect(payload.data.indices[0].changePercent).toBeCloseTo(0.2);
    expect(payload.data.movers.gainers).toHaveLength(1);
    expect(payload.data.movers.losers).toHaveLength(0);
    expect(payload.coverage.totalInstruments).toBeGreaterThan(0);
    expect(payload.coverage.missingPriceCount).toBeGreaterThanOrEqual(0);
    expect(payload.requestId).toEqual(expect.any(String));
  });

  it('marks extended quote as unavailable when pre-market quote missing', async () => {
    fetchBatchDailyTickerSummariesMock.mockResolvedValueOnce(new Map([
      ['SPY', { ticker: 'SPY', close: 500, preMarket: null, afterHours: 499 }],
      ['AAPL', { ticker: 'AAPL', close: 200, preMarket: null, afterHours: 201 }],
    ]));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.indices[0].quoteSession).toBe('pre-market');
    expect(payload.data.indices[0].extendedQuoteUnavailable).toBe(true);
    expect(payload.data.indices[0].extendedUnavailableLabel).toBe('Pre-market unavailable');
  });

  it('returns live-no-cache when cache table is missing', async () => {
    const dbWithMissingTable = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockRejectedValue(Object.assign(new Error('relation "market_snapshots" does not exist'), { code: '42P01' })),
            })),
          })),
        })),
      })),
      insert: vi.fn(),
    };
    getDbMock.mockReturnValueOnce(dbWithMissingTable);

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.source).toBe('live-no-cache');
    expect(payload.warning).toContain('cache unavailable');
    expect(payload.requestId).toEqual(expect.any(String));
  });

  it('returns structured error metadata on upstream failure without cache', async () => {
    fetchUnifiedSnapshotMock.mockRejectedValueOnce(new Error('Massive request failed: 429'));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe('upstream_fetch_failed');
    expect(payload.stage).toBe('upstream_fetch');
    expect(payload.requestId).toEqual(expect.any(String));
  });
});
