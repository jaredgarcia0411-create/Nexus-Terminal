import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  ensureUserMock,
  getDbMock,
  insertValuesMock,
  onConflictMock,
  limitDeleteMock,
} = vi.hoisted(() => {
  const onConflict = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflict });
  const limitDelete = vi.fn().mockResolvedValue(undefined);

  return {
    requireUserMock: vi.fn(),
    ensureUserMock: vi.fn(),
    getDbMock: vi.fn(),
    insertValuesMock: insertValues,
    onConflictMock: onConflict,
    limitDeleteMock: limitDelete,
  };
});

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, ensureUser: ensureUserMock }));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { DELETE, GET, POST } from '@/app/api/saved-tickers/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('saved-tickers route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: '1', ticker: 'AAPL', category: 'watchlist', notes: null }]),
    };

    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue({ values: insertValuesMock }),
      delete: vi.fn().mockReturnValue({ where: limitDeleteMock }),
    });
  });

  it('lists saved tickers on GET', async () => {
    const response = ensureResponse(await GET(new Request('http://localhost/api/saved-tickers')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.rows).toHaveLength(1);
  });

  it('upserts ticker on POST', async () => {
    const response = ensureResponse(await POST(new Request('http://localhost/api/saved-tickers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'MSFT', notes: 'earnings watch' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(onConflictMock).toHaveBeenCalledTimes(1);
    expect(payload.ticker).toBe('MSFT');
  });

  it('deletes ticker on DELETE', async () => {
    const response = ensureResponse(await DELETE(new Request('http://localhost/api/saved-tickers?id=1', { method: 'DELETE' })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(limitDeleteMock).toHaveBeenCalledTimes(1);
  });
});
