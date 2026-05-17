import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, requireUserMock, ensureUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { POST } from '@/app/api/sample-sets/from-tags/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createDbMock(rows: Array<{ ticker: string | null; date: string }>) {
  const whereMock = vi.fn(() => Promise.resolve(rows));

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: whereMock,
        })),
      })),
    })),
    _mocks: {
      whereMock,
    },
  };
}

describe('sample sets from-tags route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com', name: 'User', picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('returns deduped rows for a single tag', async () => {
    getDbMock.mockReturnValue(createDbMock([
      { ticker: 'aapl', date: '2026-05-01' },
      { ticker: 'AAPL', date: '2026-05-01' },
      { ticker: 'TSLA', date: '2026-05-02' },
    ]));

    const response = ensureResponse(await POST(new Request('http://localhost/api/sample-sets/from-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['gap'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.rows).toEqual([
      { ticker: 'AAPL', date: '2026-05-01' },
      { ticker: 'TSLA', date: '2026-05-02' },
    ]);
    expect(payload.skippedCount).toBe(1);
  });

  it('dedupes the union across multiple tags', async () => {
    getDbMock.mockReturnValue(createDbMock([
      { ticker: 'AAPL', date: '2026-05-01' },
      { ticker: 'MSFT', date: '2026-05-03' },
      { ticker: 'AAPL', date: '2026-05-01' },
    ]));

    const response = ensureResponse(await POST(new Request('http://localhost/api/sample-sets/from-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['gap', 'orb'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.rows).toEqual([
      { ticker: 'AAPL', date: '2026-05-01' },
      { ticker: 'MSFT', date: '2026-05-03' },
    ]);
    expect(payload.skippedCount).toBe(1);
  });

  it('skips trades with invalid dates', async () => {
    getDbMock.mockReturnValue(createDbMock([
      { ticker: 'AAPL', date: '2026-05-01' },
      { ticker: 'TSLA', date: '05/02/2026' },
      { ticker: null, date: '2026-05-03' },
    ]));

    const response = ensureResponse(await POST(new Request('http://localhost/api/sample-sets/from-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['gap'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.rows).toEqual([{ ticker: 'AAPL', date: '2026-05-01' }]);
    expect(payload.skippedCount).toBe(2);
  });

  it('rejects an empty tag list', async () => {
    getDbMock.mockReturnValue(createDbMock([]));

    const response = ensureResponse(await POST(new Request('http://localhost/api/sample-sets/from-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.tags).toBeDefined();
  });
});
