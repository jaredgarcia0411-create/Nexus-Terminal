import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAgentAdminMock,
  getAgentDbMock,
  andMock,
  descMock,
  eqMock,
} = vi.hoisted(() => ({
  requireAgentAdminMock: vi.fn(),
  getAgentDbMock: vi.fn(),
  andMock: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  descMock: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eqMock: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    and: andMock,
    desc: descMock,
    eq: eqMock,
  };
});

vi.mock('@/lib/agents/admin', () => ({
  requireAgentAdmin: requireAgentAdminMock,
}));

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

import { DELETE, GET } from '@/app/api/agents/admin/memory/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createAwaitableQuery<T>(rows: T[], filteredRows = rows) {
  const promise = Promise.resolve(rows);

  return {
    where: vi.fn().mockResolvedValue(filteredRows),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
}

function createMemoryGetDb(rows: Array<Record<string, unknown>>, filteredRows = rows) {
  const query = createAwaitableQuery(rows, filteredRows);

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => query),
        })),
      })),
    })),
    _mocks: {
      query,
    },
  };
}

function createMemoryDeleteDb(deletedRows: Array<{ id: string }>) {
  const returningMock = vi.fn().mockResolvedValue(deletedRows);

  return {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: returningMock,
      })),
    })),
    _mocks: {
      returningMock,
    },
  };
}

describe('agent admin memory route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAgentAdminMock.mockReturnValue(null);
  });

  it('returns filtered memory rows on GET', async () => {
    const db = createMemoryGetDb(
      [
        {
          id: 'memory-1',
          userId: 'user-1',
          agentId: 'swing-trader',
          category: 'fact',
          key: 'ticker:AAPL',
        },
      ],
      [
        {
          id: 'memory-1',
          userId: 'user-1',
          agentId: 'swing-trader',
          category: 'fact',
          key: 'ticker:AAPL',
        },
      ],
    );
    getAgentDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await GET(new Request(
      'http://localhost/api/agents/admin/memory?user_id=user-1&agent_id=swing-trader&category=fact',
    )));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      memory: [
        {
          id: 'memory-1',
          user_id: 'user-1',
          agent_id: 'swing-trader',
          category: 'fact',
          key: 'ticker:AAPL',
        },
      ],
    });
    expect(andMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eq', value: 'user-1' }),
      expect.objectContaining({ type: 'eq', value: 'swing-trader' }),
      expect.objectContaining({ type: 'eq', value: 'fact' }),
    );
    expect(db._mocks.query.where).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when the memory list query is invalid', async () => {
    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/admin/memory?agent_id=not-a-real-agent')));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.agent_id).toBeTruthy();
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the memory list database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/admin/memory?user_id=user-1')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns memory rows on GET without filters', async () => {
    const db = createMemoryGetDb([
      {
        id: 'memory-1',
        userId: 'user-1',
        agentId: 'orchestrator',
        category: 'macro_fact',
        key: 'macro:rates',
      },
    ]);
    getAgentDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/admin/memory')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      memory: [
        {
          id: 'memory-1',
          user_id: 'user-1',
          agent_id: 'orchestrator',
          category: 'macro_fact',
          key: 'macro:rates',
        },
      ],
    });
    expect(db._mocks.query.where).not.toHaveBeenCalled();
  });

  it('deletes memory rows on DELETE success', async () => {
    const db = createMemoryDeleteDb([{ id: 'memory-1' }]);
    getAgentDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await DELETE(new Request('http://localhost/api/agents/admin/memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'memory-1' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ deleted: true });
  });

  it('returns 400 when DELETE payload is invalid', async () => {
    const response = ensureResponse(await DELETE(new Request('http://localhost/api/agents/admin/memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.id).toBeTruthy();
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 when DELETE database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await DELETE(new Request('http://localhost/api/agents/admin/memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'memory-1' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns 404 on DELETE when the memory row does not exist', async () => {
    const db = createMemoryDeleteDb([]);
    getAgentDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await DELETE(new Request('http://localhost/api/agents/admin/memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'missing-memory' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'memory row not found' });
  });

  it('returns 401 when the admin key is missing', async () => {
    requireAgentAdminMock.mockReturnValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/admin/memory')));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });
});
