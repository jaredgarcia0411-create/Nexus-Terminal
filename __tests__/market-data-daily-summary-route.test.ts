import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  ensureUserMock,
  getDbMock,
  fetchDailyTickerSummaryMock,
  insertValuesMock,
  onConflictMock,
  limitMock,
} = vi.hoisted(() => {
  const onConflict = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflict });
  const limit = vi.fn().mockResolvedValue([]);

  return {
    requireUserMock: vi.fn(),
    ensureUserMock: vi.fn(),
    getDbMock: vi.fn(),
    fetchDailyTickerSummaryMock: vi.fn(),
    insertValuesMock: insertValues,
    onConflictMock: onConflict,
    limitMock: limit,
  };
});

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, ensureUser: ensureUserMock }));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/massive-market', () => ({ fetchDailyTickerSummary: fetchDailyTickerSummaryMock }));

import { GET, POST } from '@/app/api/market-data/daily-summary/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('market-data daily-summary route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: limitMock,
    };

    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue({ values: insertValuesMock }),
    });

    fetchDailyTickerSummaryMock.mockResolvedValue({
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 1000,
      preMarket: 101,
      afterHours: 102,
    });
  });

  it('returns 400 when ticker missing on POST', async () => {
    const response = ensureResponse(await POST(new Request('http://localhost/api/market-data/daily-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })));

    expect(response.status).toBe(400);
  });

  it('upserts ticker/date summary on POST', async () => {
    const response = ensureResponse(await POST(new Request('http://localhost/api/market-data/daily-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'AAPL', date: '2026-03-12' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchDailyTickerSummaryMock).toHaveBeenCalledWith('AAPL', '2026-03-12');
    expect(onConflictMock).toHaveBeenCalledTimes(1);
    expect(payload.ticker).toBe('AAPL');
  });

  it('returns rows on GET', async () => {
    limitMock.mockResolvedValueOnce([{ id: '1', ticker: 'AAPL', date: '2026-03-12' }]);
    const response = ensureResponse(await GET(new Request('http://localhost/api/market-data/daily-summary')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.rows).toHaveLength(1);
  });
});
