import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPoolDbMock,
  requireUserMock,
  ensureUserMock,
  loadTagsForTradeIdsMock,
  toTradeMock,
  toExecutionRowIdMock,
} = vi.hoisted(() => ({
  getPoolDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  loadTagsForTradeIdsMock: vi.fn(),
  toTradeMock: vi.fn(),
  toExecutionRowIdMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getPoolDb: getPoolDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  loadTagsForTradeIds: loadTagsForTradeIdsMock,
  requireUser: requireUserMock,
  toExecutionRowId: toExecutionRowIdMock,
  toTrade: toTradeMock,
}));

import { POST } from '@/app/api/trades/import/route';

function makeQueryChain(result: unknown) {
  return {
    from: () => ({
      where: () => ({
        orderBy: async () => result,
      }),
    }),
  };
}

function makeDbWithBatchState(batchAlreadyProcessed: boolean) {
  let insertCall = 0;
  const tradeInsertValuesMock = vi.fn(() => ({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  }));

  const tx = {
    insert: vi.fn(() => {
      insertCall += 1;
      if (insertCall === 1) {
        return {
          values: vi.fn(() => ({
            onConflictDoNothing: () => ({
              returning: async () => (batchAlreadyProcessed ? [] : [{ batchKey: 'batch-1' }]),
            }),
          })),
        };
      }

      return { values: tradeInsertValuesMock };
    }),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };

  const tradeRows = [{ id: 'trade-1' }];

  const db = {
    transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx)),
    select: vi.fn(() => makeQueryChain(tradeRows)),
    _mocks: {
      tx,
      tradeInsertValuesMock,
    },
  };

  return db;
}

describe('POST /api/trades/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    loadTagsForTradeIdsMock.mockResolvedValue(new Map());
    toTradeMock.mockReturnValue({ id: 'trade-1' });
    toExecutionRowIdMock.mockReturnValue('exec-row-1');
  });

  it('short-circuits import when batch key already exists', async () => {
    const db = makeDbWithBatchState(true);
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades/import', {
      method: 'POST',
      body: JSON.stringify({
        batchKey: 'batch-1',
        trades: [
          {
            id: 'trade-1',
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
            rawExecutions: [],
            pnl: 48,
            executions: 1,
            tags: [],
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.importSkipped).toBe(true);
    expect(db._mocks.tradeInsertValuesMock).not.toHaveBeenCalled();
  });

  it('imports trades when batch key is new', async () => {
    const db = makeDbWithBatchState(false);
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades/import', {
      method: 'POST',
      body: JSON.stringify({
        batchKey: 'batch-1',
        trades: [
          {
            id: 'trade-1',
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
            rawExecutions: [],
            pnl: 48,
            executions: 1,
            tags: [],
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.importSkipped).toBe(false);
    expect(db._mocks.tradeInsertValuesMock).toHaveBeenCalledTimes(1);
  });
});
