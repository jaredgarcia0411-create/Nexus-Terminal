import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, ensureUserMock, getDbMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
  dbUnavailable: () => Response.json({ error: 'DB unavailable' }, { status: 503 }),
}));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { GET as getSessionDetail } from '@/app/api/backtest/sessions/[id]/route';

type SessionRow = {
  id: string;
  userId: string;
  status: 'ACTIVE' | 'REVIEWED';
  notes: string | null;
  chartState: Record<string, unknown>;
};

function createDb(session: SessionRow | null, actions: Array<{ id: string; sessionId: string; sequence: number }>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(session ? [session] : [])),
          orderBy: vi.fn(() => Promise.resolve(actions)),
        })),
      })),
    })),
  };
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('GET /api/backtest/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'me', email: 'me@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('returns the caller\'s own active session with its actions', async () => {
    getDbMock.mockReturnValue(createDb(
      { id: 's1', userId: 'me', status: 'ACTIVE', notes: 'wip', chartState: {} },
      [{ id: 'a1', sessionId: 's1', sequence: 1 }],
    ));

    const response = ensureResponse(await getSessionDetail(new Request('http://localhost/api/backtest/sessions/s1'), {
      params: Promise.resolve({ id: 's1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.id).toBe('s1');
    expect(payload.actions).toHaveLength(1);
  });

  it('returns another user\'s saved review (reviews are shared)', async () => {
    getDbMock.mockReturnValue(createDb(
      { id: 's2', userId: 'someone-else', status: 'REVIEWED', notes: 'clean', chartState: {} },
      [],
    ));

    const response = ensureResponse(await getSessionDetail(new Request('http://localhost/api/backtest/sessions/s2'), {
      params: Promise.resolve({ id: 's2' }),
    }));

    expect(response.status).toBe(200);
  });

  it('hides another user\'s in-progress session behind a 404', async () => {
    getDbMock.mockReturnValue(createDb(
      { id: 's3', userId: 'someone-else', status: 'ACTIVE', notes: 'private thoughts', chartState: {} },
      [{ id: 'a1', sessionId: 's3', sequence: 1 }],
    ));

    const response = ensureResponse(await getSessionDetail(new Request('http://localhost/api/backtest/sessions/s3'), {
      params: Promise.resolve({ id: 's3' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'Session not found' });
    expect(JSON.stringify(payload)).not.toContain('private thoughts');
  });

  it('returns 404 for an unknown session', async () => {
    getDbMock.mockReturnValue(createDb(null, []));

    const response = ensureResponse(await getSessionDetail(new Request('http://localhost/api/backtest/sessions/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    }));

    expect(response.status).toBe(404);
  });
});
