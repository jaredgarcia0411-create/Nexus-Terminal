import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tradeExecutions as tradeExecutionsTable, trades as tradesTable } from '@/lib/db/schema';

const {
  getDbMock,
  requireUserMock,
  ensureUserMock,
  toTradeMock,
  toExecutionRowIdMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  toTradeMock: vi.fn(),
  toExecutionRowIdMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  loadTagsForTradeIds: vi.fn(),
  requireUser: requireUserMock,
  toExecutionRowId: toExecutionRowIdMock,
  toTrade: toTradeMock,
}));

import { POST } from '@/app/api/trades/route';

function makeDb() {
  const tradeInsertValuesMock = vi.fn(() => ({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  }));
  const executionInsertValuesMock = vi.fn().mockResolvedValue(undefined);

  const db = {
    insert: vi.fn((table: unknown) => {
      if (table === tradesTable) return { values: tradeInsertValuesMock };
      if (table === tradeExecutionsTable) return { values: executionInsertValuesMock };
      throw new Error('Unexpected table in insert mock');
    }),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{
            id: 'trade-1',
            userId: 'user-1',
            date: '2026-03-06T12:00:00.000Z',
            sortKey: '2026-03-06',
            symbol: 'AAPL',
            direction: 'LONG',
            avgEntryPrice: 100,
            avgExitPrice: 105,
            totalQuantity: 10,
            grossPnl: 50,
            netPnl: 48,
            entryTime: '09:35:00',
            exitTime: '10:00:00',
            executionCount: 1,
            pnl: 48,
            executions: 1,
            initialRisk: null,
            commission: 0,
            fees: 0,
            mfe: null,
            mae: null,
            bestExitPnl: null,
            exitEfficiency: null,
            notes: null,
          }]),
        })),
      })),
    })),
    _mocks: {
      executionInsertValuesMock,
    },
  };

  return db;
}

describe('POST /api/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    toExecutionRowIdMock.mockImplementation((_userId, _tradeId, executionId) => `exec-${executionId ?? 'generated'}`);
    toTradeMock.mockReturnValue({ id: 'trade-1' });
  });

  it('stores explicit timezone timestamps as canonical ISO', async () => {
    const db = makeDb();
    getDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'trade-1',
        date: '2026-03-06T12:00:00.000Z',
        sortKey: '2026-03-06',
        symbol: 'AAPL',
        direction: 'LONG',
        avgEntryPrice: 100,
        avgExitPrice: 105,
        totalQuantity: 10,
        pnl: 48,
        rawExecutions: [
          {
            id: 'entry-1',
            side: 'ENTRY',
            price: 100,
            qty: 5,
            time: '09:35:00',
            timestamp: '2026-03-06T09:35:00-05:00',
            commission: 0,
            fees: 0,
          },
        ],
      }),
    }));
    if (!response) throw new Error('Expected response');

    expect(response.status).toBe(200);
    expect(db._mocks.executionInsertValuesMock).toHaveBeenCalledWith([
      expect.objectContaining({ timestamp: '2026-03-06T14:35:00.000Z' }),
    ]);
  });

  it('stores ambiguous timezone-less timestamps as null', async () => {
    const db = makeDb();
    getDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'trade-1',
        date: '2026-03-06T12:00:00.000Z',
        sortKey: '2026-03-06',
        symbol: 'AAPL',
        direction: 'LONG',
        avgEntryPrice: 100,
        avgExitPrice: 105,
        totalQuantity: 10,
        pnl: 48,
        rawExecutions: [
          {
            id: 'entry-1',
            side: 'ENTRY',
            price: 100,
            qty: 5,
            time: '09:35:00',
            timestamp: '2026-03-06 09:35:00',
            commission: 0,
            fees: 0,
          },
        ],
      }),
    }));
    if (!response) throw new Error('Expected response');

    expect(response.status).toBe(200);
    expect(db._mocks.executionInsertValuesMock).toHaveBeenCalledWith([
      expect.objectContaining({ timestamp: null }),
    ]);
  });
});
