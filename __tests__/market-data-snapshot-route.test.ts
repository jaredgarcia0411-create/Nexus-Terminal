import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, getDbMock, fetchUnifiedSnapshotMock, fetchTopMarketMoversMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getDbMock: vi.fn(),
  fetchUnifiedSnapshotMock: vi.fn(),
  fetchTopMarketMoversMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/massive-market', () => ({
  fetchUnifiedSnapshot: fetchUnifiedSnapshotMock,
  fetchTopMarketMovers: fetchTopMarketMoversMock,
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
        { ticker: 'C:EURUSD', session: { close: 1.08, change: 0.01, change_percent: 0.9 }, market_status: 'open' },
      ],
    });
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
    expect(payload.data.movers.gainers).toHaveLength(1);
    expect(payload.data.movers.losers).toHaveLength(0);
  });
});
