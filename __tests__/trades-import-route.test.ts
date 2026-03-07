import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  tradeExecutions as tradeExecutionsTable,
  tradeImportBatches as tradeImportBatchesTable,
  tradeTags as tradeTagsTable,
  trades as tradesTable,
  tags as tagsTable,
} from '@/lib/db/schema';

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

function makeDbWithBatchState(batchAlreadyProcessed: boolean) {
  const batchInsertValuesMock = vi.fn((values: unknown) => {
    return {
      onConflictDoNothing: vi.fn(() => ({
        returning: async () => (batchAlreadyProcessed ? [] : [{ batchKey: 'batch-1' }]),
      })),
    };
  });

  const tradeInsertValuesMock = vi.fn((values: unknown) => {
    return {
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };
  });

  const executionInsertValuesMock = vi.fn((values: unknown) => {
    return Promise.resolve(undefined);
  });

  const tagsInsertValuesMock = vi.fn((values: unknown) => {
    return {
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
  });

  const tradeTagsInsertValuesMock = vi.fn((values: unknown) => {
    return {
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
  });

  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === tradeImportBatchesTable) {
        return { values: batchInsertValuesMock };
      }
      if (table === tradesTable) {
        return { values: tradeInsertValuesMock };
      }
      if (table === tradeExecutionsTable) {
        return { values: executionInsertValuesMock };
      }
      if (table === tagsTable) {
        return { values: tagsInsertValuesMock };
      }
      if (table === tradeTagsTable) {
        return { values: tradeTagsInsertValuesMock };
      }

      throw new Error('Unexpected insert table in test mock');
    }),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  const db = {
    transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx)),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => [{ id: 'trade-1' }]),
        })),
      })),
    })),
    _mocks: {
      batchInsertValuesMock,
      tradeInsertValuesMock,
      executionInsertValuesMock,
      tagsInsertValuesMock,
      tradeTagsInsertValuesMock,
      tx,
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
    toExecutionRowIdMock.mockImplementation((_userId, _tradeId, executionId) => `exec-${executionId ?? 'generated'}`);
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
    expect(db._mocks.batchInsertValuesMock).toHaveBeenCalledWith({ userId: 'user-1', batchKey: 'batch-1' });
    expect(db._mocks.tradeInsertValuesMock).not.toHaveBeenCalled();
    expect(db._mocks.executionInsertValuesMock).not.toHaveBeenCalled();
  });

  it('imports and validates trade payload values, tags, and raw executions', async () => {
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
            avgEntryPrice: 100.5,
            avgExitPrice: 105.25,
            totalQuantity: 10,
            commission: 1.25,
            fees: 0.75,
            grossPnl: undefined,
            netPnl: 48.75,
            entryTime: '09:35:00',
            exitTime: '10:00:00',
            executionCount: 2,
            rawExecutions: [
              {
                id: 'entry-1',
                side: 'ENTRY',
                price: 100,
                qty: 5,
                time: '09:35:00',
                timestamp: '2026-03-06T14:35:00.000Z',
                commission: 0.5,
                fees: 0.25,
              },
              {
                id: 'exit-1',
                side: 'EXIT',
                price: 105,
                qty: 5,
                time: '10:00:00',
                timestamp: '2026-03-06T15:00:00.000Z',
                commission: 0.75,
                fees: 0.5,
              },
            ],
            pnl: 48.75,
            executions: 2,
            tags: ['day-trade', 'swing'],
            notes: 'Imported from CSV',
            initialRisk: 50,
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.importSkipped).toBe(false);
    expect(payload.trades).toEqual([{ id: 'trade-1' }]);

    expect(db._mocks.batchInsertValuesMock).toHaveBeenCalledWith({ userId: 'user-1', batchKey: 'batch-1' });
    expect(db._mocks.tradeInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trade-1',
        userId: 'user-1',
        date: '2026-03-06T12:00:00.000Z',
        symbol: 'AAPL',
        direction: 'LONG',
        avgEntryPrice: 100.5,
        avgExitPrice: 105.25,
        totalQuantity: 10,
        netPnl: 48.75,
        grossPnl: 50.75,
        commission: 1.25,
        fees: 0.75,
        executionCount: 2,
        executions: 2,
        initialRisk: 50,
        notes: 'Imported from CSV',
      }),
    );

    expect(db._mocks.executionInsertValuesMock).toHaveBeenCalledWith([
      {
        id: 'exec-entry-1',
        userId: 'user-1',
        tradeId: 'trade-1',
        side: 'ENTRY',
        price: 100,
        qty: 5,
        time: '09:35:00',
        timestamp: '2026-03-06T14:35:00.000Z',
        commission: 0.5,
        fees: 0.25,
      },
      {
        id: 'exec-exit-1',
        userId: 'user-1',
        tradeId: 'trade-1',
        side: 'EXIT',
        price: 105,
        qty: 5,
        time: '10:00:00',
        timestamp: '2026-03-06T15:00:00.000Z',
        commission: 0.75,
        fees: 0.5,
      },
    ]);

    expect(db._mocks.tagsInsertValuesMock).toHaveBeenCalledTimes(2);
    expect(db._mocks.tagsInsertValuesMock).toHaveBeenCalledWith({ userId: 'user-1', name: 'day-trade' });
    expect(db._mocks.tagsInsertValuesMock).toHaveBeenCalledWith({ userId: 'user-1', name: 'swing' });
    expect(db._mocks.tradeTagsInsertValuesMock).toHaveBeenCalledWith({ userId: 'user-1', tradeId: 'trade-1', tag: 'day-trade' });
    expect(db._mocks.tradeTagsInsertValuesMock).toHaveBeenCalledWith({ userId: 'user-1', tradeId: 'trade-1', tag: 'swing' });
  });

  it('returns 400 for malformed JSON payload', async () => {
    const db = makeDbWithBatchState(false);
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades/import', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Invalid JSON body' });
  });

  it('does not emit unhandled error logs for validation failures', async () => {
    const db = makeDbWithBatchState(false);
    getPoolDbMock.mockReturnValue(db);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(new Request('http://localhost/api/trades/import', {
      method: 'POST',
      body: JSON.stringify({
        trades: [
          {
            id: 'trade-1',
            date: '2026-03-06T12:00:00.000Z',
            sortKey: '2026-03-06',
            direction: 'LONG',
            avgEntryPrice: 100,
            avgExitPrice: 105,
            totalQuantity: 10,
            pnl: 48,
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('trades[0]');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns 400 for invalid trade payload shape', async () => {
    const db = makeDbWithBatchState(false);
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades/import', {
      method: 'POST',
      body: JSON.stringify({
        trades: [
          {
            id: 'trade-1',
            date: '2026-03-06T12:00:00.000Z',
            sortKey: '2026-03-06',
            direction: 'LONG',
            avgEntryPrice: 100,
            avgExitPrice: 105,
            totalQuantity: 10,
            pnl: 48,
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('trades[0]');
    expect(db._mocks.tradeInsertValuesMock).not.toHaveBeenCalled();
  });

  it('returns 400 when batch key is too long', async () => {
    const db = makeDbWithBatchState(false);
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades/import', {
      method: 'POST',
      body: JSON.stringify({
        batchKey: 'a'.repeat(257),
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
            pnl: 48,
            rawExecutions: [],
            tags: [],
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'batchKey must be 256 characters or fewer' });
    expect(db._mocks.tradeInsertValuesMock).not.toHaveBeenCalled();
  });

  it('returns detailed 500 payload when transaction fails unexpectedly', async () => {
    const db = {
      transaction: vi.fn().mockRejectedValue(new Error('db write failed')),
      select: vi.fn(),
    };
    getPoolDbMock.mockReturnValue(db as unknown as ReturnType<typeof makeDbWithBatchState>);

    const response = await POST(new Request('http://localhost/api/trades/import', {
      method: 'POST',
      body: JSON.stringify({
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
            pnl: 48,
            rawExecutions: [],
            tags: [],
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Import failed while saving trades');
    expect(payload.details).toBe('db write failed');
  });
});
