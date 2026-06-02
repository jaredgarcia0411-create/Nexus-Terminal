import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tradeExecutions as tradeExecutionsTable, trades as tradesTable } from '@/lib/db/schema';

const {
  ensureUserMock,
  getPoolDbMock,
  applyWatchlistTagsForDateMock,
  loadTagsForTradeIdsMock,
  requireUserMock,
  toTradeMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  getPoolDbMock: vi.fn(),
  applyWatchlistTagsForDateMock: vi.fn(),
  loadTagsForTradeIdsMock: vi.fn(),
  requireUserMock: vi.fn(),
  toTradeMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getPoolDb: getPoolDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  loadTagsForTradeIds: loadTagsForTradeIdsMock,
  requireUser: requireUserMock,
  toTrade: toTradeMock,
}));
vi.mock('@/lib/watchlist-server', () => ({
  applyWatchlistTagsForDate: applyWatchlistTagsForDateMock,
}));

import { POST } from '@/app/api/trades/import-raw/route';

function makeDb() {
  const tradeInsertValuesMock = vi.fn(() => ({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  }));
  const executionInsertValuesMock = vi.fn().mockResolvedValue(undefined);
  const executionDeleteWhereMock = vi.fn().mockResolvedValue(undefined);

  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === tradesTable) return { values: tradeInsertValuesMock };
      if (table === tradeExecutionsTable) return { values: executionInsertValuesMock };
      throw new Error('Unexpected insert table in test mock');
    }),
    delete: vi.fn((table: unknown) => {
      if (table === tradeExecutionsTable) return { where: executionDeleteWhereMock };
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  };

  const whereResult = {
    orderBy: vi.fn(async () => [{ id: '2026-05-19|AAPL|LONG' }]),
    then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject),
  };

  const db = {
    transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx)),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => whereResult),
      })),
    })),
    _mocks: {
      executionDeleteWhereMock,
      executionInsertValuesMock,
      tradeInsertValuesMock,
    },
  };

  return db;
}

describe('POST /api/trades/import-raw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    loadTagsForTradeIdsMock.mockResolvedValue(new Map());
    toTradeMock.mockReturnValue({ id: '2026-05-19|AAPL|LONG' });
  });

  it('stores matched same-day executions for Trade Details', async () => {
    const db = makeDb();
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades/import-raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-05-19',
        executions: [
          { symbol: 'AAPL', side: 'LONG_ENTRY', qty: 100, price: 10, time: '09:31:00', commission: 1, fees: 0.1 },
          { symbol: 'AAPL', side: 'LONG_EXIT', qty: 100, price: 11, time: '10:15:00', commission: 1, fees: 0.1 },
        ],
      }),
    }));
    if (!response) throw new Error('Expected response');

    expect(response.status).toBe(200);
    expect(applyWatchlistTagsForDateMock).toHaveBeenCalledWith(db, 'user-1', '2026-05-19');
    expect(db._mocks.tradeInsertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      id: '2026-05-19|AAPL|LONG',
      executionCount: 2,
      executions: 2,
    }));
    expect(db._mocks.executionDeleteWhereMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.executionInsertValuesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'user-1',
        tradeId: '2026-05-19|AAPL|LONG',
        side: 'ENTRY',
        price: 10,
        qty: 100,
        time: '09:31:00',
        commission: 1,
        fees: 0.1,
      }),
      expect.objectContaining({
        userId: 'user-1',
        tradeId: '2026-05-19|AAPL|LONG',
        side: 'EXIT',
        price: 11,
        qty: 100,
        time: '10:15:00',
        commission: 1,
        fees: 0.1,
      }),
    ]);
  });
});
