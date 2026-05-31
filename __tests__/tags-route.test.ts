import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, getPoolDbMock, requireUserMock, ensureUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getPoolDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock, getPoolDb: getPoolDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { DELETE, GET, PATCH, POST } from '@/app/api/tags/route';
import { tags as tagsTable, tradeTags as tradeTagsTable } from '@/lib/db/schema';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function buildTagDb(tags: string[]) {
  const orderByMock = vi.fn().mockResolvedValue(tags.map((name) => ({ name })));
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: orderByMock,
        })),
      })),
    })),
    _mocks: {
      orderByMock,
    },
  };
}

function buildMutatingDb() {
  const insertValuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);

  return {
    insert: vi.fn((table: unknown) => {
      if (table === tagsTable) {
        return { values: insertValuesMock };
      }
      return { values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }) };
    }),
    delete: vi.fn(() => ({
      where: deleteWhereMock,
    })),
    _mocks: {
      insertValuesMock,
      deleteWhereMock,
    },
  };
}

function buildRenameDb(tradeIds: string[]) {
  const selectWhereMock = vi.fn().mockResolvedValue(tradeIds.map((tradeId) => ({ tradeId })));
  const insertValuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  const tradeTagInsertValuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);

  return {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: selectWhereMock,
        })),
      })),
      insert: vi.fn((table: unknown) => {
        if (table === tagsTable) {
          return { values: insertValuesMock };
        }
        if (table === tradeTagsTable) {
          return { values: tradeTagInsertValuesMock };
        }
        return { values: vi.fn() };
      }),
      delete: vi.fn(() => ({ where: deleteWhereMock })),
    })),
    _mocks: {
      selectWhereMock,
      insertValuesMock,
      tradeTagInsertValuesMock,
      deleteWhereMock,
    },
  };
}

describe('tags route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'user@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getPoolDbMock.mockReset();
  });

  it('returns tags sorted for user', async () => {
    const db = buildTagDb(['AAPL', 'MSFT']);
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ tags: ['AAPL', 'MSFT'] });
    expect(db._mocks.orderByMock).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when not authenticated', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await GET());
    expect(response.status).toBe(401);
  });

  it('returns 503 when database is unavailable', async () => {
    getDbMock.mockReturnValue(null);

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('adds a tag on POST', async () => {
    const db = buildMutatingDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'earnings' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ tag: 'earnings' });
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith({ userId: 'u1', name: 'earnings' });
  });

  it('rejects POST when tag name is missing', async () => {
    const db = buildMutatingDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.name).toBeDefined();
  });

  it('deletes a tag on DELETE', async () => {
    const db = buildMutatingDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await DELETE(
      new Request('http://localhost/api/tags', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'old-tag' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, name: 'old-tag' });
    expect(db._mocks.deleteWhereMock).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenNthCalledWith(1, tagsTable);
    expect(db.delete).toHaveBeenNthCalledWith(2, tradeTagsTable);
  });

  it('renames a tag on PATCH', async () => {
    const db = buildRenameDb(['trade-1', 'trade-2']);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(
      new Request('http://localhost/api/tags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'old-tag', to: 'new-tag' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, from: 'old-tag', to: 'new-tag', affectedTradeCount: 2 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith({ userId: 'u1', name: 'new-tag' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-1', tag: 'new-tag' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-2', tag: 'new-tag' });
    expect(db._mocks.deleteWhereMock).toHaveBeenCalledTimes(2);
  });

  it('merges into an existing tag on PATCH', async () => {
    const db = buildRenameDb(['trade-1']);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(
      new Request('http://localhost/api/tags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'old-tag', to: 'existing-tag' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, from: 'old-tag', to: 'existing-tag', affectedTradeCount: 1 });
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith({ userId: 'u1', name: 'existing-tag' });
    expect(db._mocks.tradeTagInsertValuesMock).toHaveBeenCalledWith({ userId: 'u1', tradeId: 'trade-1', tag: 'existing-tag' });
  });

  it('returns a same-name no-op on PATCH', async () => {
    const db = buildRenameDb([]);
    getPoolDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(
      new Request('http://localhost/api/tags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'same-tag', to: 'same-tag' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, from: 'same-tag', to: 'same-tag', affectedTradeCount: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
