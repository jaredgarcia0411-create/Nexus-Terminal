import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  tags as tagsTable,
  trades as tradesTable,
  tradeExecutions as tradeExecutionsTable,
  tradeTags as tradeTagsTable,
} from '@/lib/db/schema';

const {
  dbUnavailableMock,
  ensureUserMock,
  getDbMock,
  requireUserMock,
  toTradeMock,
} = vi.hoisted(() => ({
  dbUnavailableMock: vi.fn(() => Response.json({ error: 'Database not configured' }, { status: 503 })),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  toTradeMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: dbUnavailableMock,
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
  toTrade: toTradeMock,
}));

import { DELETE as deleteTrade, GET, PATCH } from '@/app/api/trades/[id]/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function buildSelectChain(tradesRows: unknown[], tagRows: unknown[], executionRows: unknown[]) {
  return vi.fn((_selection: unknown) => ({
    from: vi.fn((table: unknown) => {
      if (table === tradesTable) {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => tradesRows),
          })),
        };
      }

      if (table === tradeTagsTable) {
        return {
          where: vi.fn(async () => tagRows),
        };
      }

      if (table === tradeExecutionsTable) {
        return {
          where: vi.fn(() => ({
            orderBy: vi.fn(async () => executionRows),
          })),
        };
      }

      return {
        from: vi.fn(),
      };
    }),
  }));
}

describe('trade-by-id route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'user@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    toTradeMock.mockImplementation((_trade, tags) => ({ id: 't-1', tags }));
  });

  it('returns 404 when GET id does not exist', async () => {
    const db = {
      select: buildSelectChain([], [], []),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET(new Request('http://localhost/api/trades/t-1'), { params: Promise.resolve({ id: 't-1' }) }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Trade not found');
    expect(toTradeMock).not.toHaveBeenCalled();
  });

  it('returns a trade with mapped tags and executions on GET', async () => {
    const tradeRow = {
      id: 't-1',
      userId: 'u1',
      date: '2026-03-17T00:00:00.000Z',
      sortKey: '2026-03-17',
      symbol: 'AAPL',
      direction: 'LONG',
      avgEntryPrice: 100,
      avgExitPrice: 110,
      totalQuantity: 2,
      grossPnl: 20,
      netPnl: 18,
      pnl: 18,
      entryTime: '09:30',
      exitTime: '10:00',
      executionCount: 1,
      executions: 1,
      initialRisk: null,
      commission: null,
      fees: null,
    };

    const tagRows = [{ tag: 'swing' }, { tag: 'tech' }];
    const executionRows = [
      {
        id: 'e1',
        side: 'ENTRY',
        price: 100,
        qty: 2,
        time: '09:30',
        timestamp: new Date('2026-03-17T13:30:00.000Z'),
        commission: null,
        fees: 1,
      },
    ];

    const db = {
      select: buildSelectChain([tradeRow], tagRows, executionRows),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET(new Request('http://localhost/api/trades/t-1'), { params: Promise.resolve({ id: 't-1' }) }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.trade).toEqual({ id: 't-1', tags: ['swing', 'tech'] });
    expect(toTradeMock).toHaveBeenCalledTimes(1);
    expect(toTradeMock).toHaveBeenCalledWith(
      tradeRow,
      ['swing', 'tech'],
      [
        {
          id: 'e1',
          side: 'ENTRY',
          price: 100,
          qty: 2,
          time: '09:30',
          timestamp: new Date('2026-03-17T13:30:00.000Z'),
          commission: 0,
          fees: 1,
        },
      ],
    );
  });

  it('returns 400 for invalid PATCH payload', async () => {
    const db = {
      select: buildSelectChain([
        {
          id: 't-1',
        },
      ], [], []),
      update: vi.fn(),
      delete: vi.fn(),
      insert: vi.fn(),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(
      new Request('http://localhost/api/trades/t-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 2 }),
      }),
      { params: Promise.resolve({ id: 't-1' }) },
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
  });

  it('updates notes and tags on PATCH', async () => {
    const tradeUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const tradeUpdateSet = vi.fn(() => ({ where: tradeUpdateWhere }));
    const tagDeleteWhere = vi.fn().mockResolvedValue(undefined);
    const tagInsertValues = vi.fn(() => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }));
    const tagsInsertValues = vi.fn(() => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }));

    const db = {
      update: vi.fn(() => ({
        set: tradeUpdateSet,
      })),
      delete: vi.fn((table: unknown) => {
        if (table === tradeTagsTable) {
          return { where: tagDeleteWhere };
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
      insert: vi.fn((table: unknown) => {
        if (table === tradeTagsTable) {
          return { values: tagInsertValues };
        }
        if (table === tagsTable) {
          return { values: tagsInsertValues };
        }
        return { values: vi.fn() };
      }),
      select: buildSelectChain(
        [{ id: 't-1' }],
        [{ tag: 'momentum' }],
        [{
          id: 'e1',
          side: 'ENTRY',
          price: 100,
          qty: 1,
          time: '09:30',
          timestamp: new Date('2026-03-17T13:30:00.000Z'),
          commission: 0,
          fees: 0,
        }],
      ),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(
      new Request('http://localhost/api/trades/t-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: 'Updated',
          initialRisk: 50,
          tags: ['momentum'],
        }),
      }),
      { params: Promise.resolve({ id: 't-1' }) },
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.trade.tags).toEqual(['momentum']);
    expect(tradeUpdateSet).toHaveBeenCalledTimes(1);
    expect(tagDeleteWhere).toHaveBeenCalledTimes(1);
    expect(tagInsertValues).toHaveBeenCalledWith({ userId: 'u1', tradeId: 't-1', tag: 'momentum' });
    expect(tagsInsertValues).toHaveBeenCalledWith({ userId: 'u1', name: 'momentum' });
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes trade on DELETE', async () => {
    const whereDelete = vi.fn().mockResolvedValue(undefined);
    const db = {
      delete: vi.fn(() => ({ where: whereDelete })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await deleteTrade(new Request('http://localhost/api/trades/t-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 't-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, id: 't-1' });
    expect(whereDelete).toHaveBeenCalledTimes(1);
  });
});
