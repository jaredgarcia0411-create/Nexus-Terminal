import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tags as tagsTable, tradeTags as tradeTagsTable } from '@/lib/db/schema';

const {
  ensureUserMock,
  getPoolDbMock,
  requireUserMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  getPoolDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getPoolDb: getPoolDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { POST } from '@/app/api/trades/bulk/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function makeDb(
  ownedRows: Array<{ id: string }>,
  txConfig: {
    deleteWhereMock?: ReturnType<typeof vi.fn>,
    updateWhereMock?: ReturnType<typeof vi.fn>,
    tagInsertValuesMock?: ReturnType<typeof vi.fn>,
    tradeTagInsertValuesMock?: ReturnType<typeof vi.fn>,
  } = {},
) {
  const deleteWhereMock = txConfig.deleteWhereMock ?? vi.fn().mockResolvedValue(undefined);
  const updateWhereMock = txConfig.updateWhereMock ?? vi.fn().mockResolvedValue(undefined);
  const tagOnConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);
  const tradeTagOnConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);
  const tagInsertValuesMock = txConfig.tagInsertValuesMock ?? vi.fn(() => ({
    onConflictDoNothing: tagOnConflictDoNothingMock,
  }));
  const tradeTagInsertValuesMock = txConfig.tradeTagInsertValuesMock ?? vi.fn(() => ({
    onConflictDoNothing: tradeTagOnConflictDoNothingMock,
  }));

  const updateSet = vi.fn(() => ({ where: updateWhereMock }));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => ownedRows),
      })),
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      await callback({
        delete: vi.fn(() => ({ where: deleteWhereMock })),
        update: vi.fn(() => ({ set: updateSet })),
        insert: vi.fn((table: unknown) => {
          if (table === tagsTable) {
            return { values: tagInsertValuesMock };
          }

          if (table === tradeTagsTable) {
            return { values: tradeTagInsertValuesMock };
          }

          return { values: vi.fn() };
        }),
      });
    }),
    _mocks: {
      deleteWhereMock,
      updateWhereMock,
      updateSet,
      tagInsertValuesMock,
      tradeTagInsertValuesMock,
      tagOnConflictDoNothingMock,
      tradeTagOnConflictDoNothingMock,
    },
  };

  return db;
}

describe('bulk trades route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'user@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('returns 401 when user is not authenticated', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', ids: ['t-1'] }),
    })));

    expect(response.status).toBe(401);
  });

  it('returns 503 when db is unavailable', async () => {
    getPoolDbMock.mockReturnValue(null);

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', ids: ['t-1'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('rejects invalid bulk payload without ids', async () => {
    const db = makeDb([]);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', ids: [] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
  });

  it('returns 400 for applyRisk when value is not valid', async () => {
    getPoolDbMock.mockReturnValue(makeDb([]));

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'applyRisk', ids: ['t-1'], value: -5 }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('value must be a positive number');
  });

  it('returns an empty owned list when no matching trades exist', async () => {
    const db = makeDb([]);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', ids: ['unknown'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, action: 'delete', ids: [] });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('deletes only owned ids on delete action', async () => {
    const db = makeDb([{ id: 'trade-1' }, { id: 'trade-2' }]);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', ids: ['trade-1', 'trade-2'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, action: 'delete', ids: ['trade-1', 'trade-2'] });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._mocks.deleteWhereMock).toHaveBeenCalledTimes(2);
  });

  it('adds tags to owned trades', async () => {
    const db = makeDb([{ id: 'trade-1' }, { id: 'trade-2' }]);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addTag', ids: [' trade-1 ', 'trade-2'], value: ' swing ' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, action: 'addTag', ids: ['trade-1', 'trade-2'] });
    expect(db._mocks.tagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', name: 'swing' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-1', tag: 'swing' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-2', tag: 'swing' });
  });

  it('adds multiple tags to owned trades', async () => {
    const db = makeDb([{ id: 'trade-1' }, { id: 'trade-2' }]);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addTags',
        assignments: [
          { tradeId: 'trade-1', tags: [' momentum ', 'gap', 'momentum'] },
          { tradeId: 'trade-2', tags: ['gap'] },
        ],
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, action: 'addTags', ids: ['trade-1', 'trade-2'] });
    expect(db._mocks.tagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', name: 'momentum' });
    expect(db._mocks.tagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', name: 'gap' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-1', tag: 'momentum' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-1', tag: 'gap' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-2', tag: 'gap' });
    expect(db._mocks.tagOnConflictDoNothingMock).toHaveBeenCalled();
    expect(db._mocks.tradeTagOnConflictDoNothingMock).toHaveBeenCalled();
  });

  it('ignores unowned addTags assignments', async () => {
    const db = makeDb([{ id: 'trade-1' }]);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addTags',
        assignments: [
          { tradeId: 'trade-1', tags: ['momentum'] },
          { tradeId: 'unowned', tags: ['gap'] },
        ],
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, action: 'addTags', ids: ['trade-1'] });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-1', tag: 'momentum' });
  });
});
