import { beforeEach, describe, expect, it, vi } from 'vitest';

import { schwabLinks, tags as tagsTable, tradeTags as tradeTagsTable } from '@/lib/db/schema';

const {
  ensureUserMock,
  encryptTokensMock,
  exchangeSchwabCodeMock,
  getDbMock,
  getSchwabAuthConfigMock,
  getSchwabAuthUrlMock,
  requireUserMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  encryptTokensMock: vi.fn(() => ({ encrypted: 'enc', iv: 'iv', tag: 'tag' })),
  exchangeSchwabCodeMock: vi.fn(),
  getDbMock: vi.fn(),
  getSchwabAuthConfigMock: vi.fn(),
  getSchwabAuthUrlMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/schwab/auth', () => ({
  exchangeSchwabCode: exchangeSchwabCodeMock,
  getSchwabAuthConfig: getSchwabAuthConfigMock,
  getSchwabAuthUrl: getSchwabAuthUrlMock,
}));

vi.mock('@/lib/schwab/crypto', () => ({
  decryptTokens: vi.fn(),
  encryptTokens: encryptTokensMock,
  typeToString: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { GET as authGet } from '@/app/api/schwab/auth/route';
import { GET as callbackGet } from '@/app/api/schwab/callback/route';
import { DELETE as statusDelete, GET as statusGet } from '@/app/api/schwab/status/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function makeDbForCallback() {
  const onConflict = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflict });
  return {
    insert: vi.fn((table: unknown) => {
      if (table === schwabLinks) {
        return { values: insertValues };
      }

      if (table === tagsTable || table === tradeTagsTable) {
        return { values: vi.fn() };
      }

      return { values: vi.fn() };
    }),
    _mocks: {
      onConflict,
      insertValues,
    },
  };
}

function makeDbForStatus(rows: Array<{ status: string; linkedAt: Date | null; refreshTokenExpiresAt: Date }>,
  update: { set: ReturnType<typeof vi.fn> } = { set: vi.fn().mockReturnThis() },
) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: update.set,
    })),
  };
}

function makeExpiredStatusRow(offsetMs: number, status = 'active') {
  return {
    status,
    linkedAt: new Date('2026-01-01T00:00:00.000Z'),
    refreshTokenExpiresAt: new Date(Date.now() + offsetMs),
  };
}

describe('schwab auth route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    getSchwabAuthConfigMock.mockReturnValue({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/api/schwab/callback' });
    getSchwabAuthUrlMock.mockResolvedValue({ authUrl: 'https://broker.example/auth?scope=trade', state: 'state-123' });
  });

  it('redirects to Schwab auth URL after writing OAuth state cookie', async () => {
    const response = ensureResponse(await authGet());
    const location = response.headers.get('location');
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(302);
    expect(location).toBe('https://broker.example/auth?scope=trade');
    expect(cookie).toBe('schwab_oauth_state=state-123; Max-Age=600; Path=/api/schwab/callback; HttpOnly; Secure; SameSite=Lax');
  });

  it('requires valid session', async () => {
    requireUserMock.mockResolvedValueOnce({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = ensureResponse(await authGet());
    expect(response.status).toBe(401);
  });

  it('returns 503 when Schwab config is missing', async () => {
    getSchwabAuthConfigMock.mockImplementationOnce(() => {
      throw new Error('missing env');
    });

    const response = ensureResponse(await authGet());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Schwab integration not configured' });
  });
});

describe('schwab callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getSchwabAuthConfigMock.mockReturnValue({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/api/schwab/callback' });
    exchangeSchwabCodeMock.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: '2026-03-18T00:00:00.000Z', refreshExpiresAt: '2026-03-25T00:00:00.000Z' });
  });

  it('blocks unauthorized users on callback', async () => {
    requireUserMock.mockResolvedValueOnce({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = ensureResponse(await callbackGet(new Request('http://localhost/api/schwab/callback?code=abc&state=xyz', {
      headers: { cookie: 'schwab_oauth_state=xyz' },
    })));

    expect(response.status).toBe(401);
  });

  it('returns csrf error when state cookie is missing', async () => {
    getDbMock.mockReturnValue(makeDbForCallback());

    const response = ensureResponse(await callbackGet(new Request('http://localhost/api/schwab/callback?code=abc&state=xyz', {
      headers: { cookie: 'other=1' },
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Invalid OAuth state - possible CSRF' });
  });

  it('returns validation error when authorization code is missing', async () => {
    getDbMock.mockReturnValue(makeDbForCallback());

    const response = ensureResponse(await callbackGet(new Request('http://localhost/api/schwab/callback?state=xyz', {
      headers: { cookie: 'schwab_oauth_state=xyz' },
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Missing authorization code' });
  });

  it('returns 503 when DB is unavailable', async () => {
    getDbMock.mockReturnValue(null);

    const response = ensureResponse(await callbackGet(new Request('http://localhost/api/schwab/callback?code=abc&state=xyz', {
      headers: { cookie: 'schwab_oauth_state=xyz' },
    })));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('links account and redirects on success', async () => {
    const db = makeDbForCallback();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await callbackGet(new Request('http://localhost/api/schwab/callback?code=abc&state=xyz', {
      headers: { cookie: 'schwab_oauth_state=xyz' },
    })));

    const setCookie = response.headers.get('set-cookie');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost/?tab=markets');
    expect(setCookie).toContain('schwab_oauth_state=; Max-Age=0; Path=/api/schwab/callback;');
    expect(exchangeSchwabCodeMock).toHaveBeenCalledWith('abc', 'xyz');
    expect(ensureUserMock).toHaveBeenCalledWith(db, { id: 'user-1', email: 'u@example.com', name: null, picture: null });
    expect(db._mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    expect(db._mocks.onConflict).toHaveBeenCalledTimes(1);
  });
});

describe('schwab status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
  });

  it('returns unauthenticated for missing session', async () => {
    requireUserMock.mockResolvedValueOnce({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = ensureResponse(await statusGet());
    expect(response.status).toBe(401);
  });

  it('returns 503 when DB is unavailable', async () => {
    getDbMock.mockReturnValue(null);

    const response = ensureResponse(await statusGet());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('reports not linked when no link record exists', async () => {
    getDbMock.mockReturnValue(makeDbForStatus([]));

    const response = ensureResponse(await statusGet());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ linked: false, status: null });
  });

  it('expires stale link and marks status as expired', async () => {
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    getDbMock.mockReturnValue(makeDbForStatus([makeExpiredStatusRow(-60_000, 'active')], { set: updateSet }));

    const response = ensureResponse(await statusGet());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ linked: false, status: 'expired' });
    expect(updateSet).toHaveBeenCalledTimes(1);
  });

  it('returns not linked when status is not active', async () => {
    getDbMock.mockReturnValue(makeDbForStatus([makeExpiredStatusRow(60_000, 'revoked')]));

    const response = ensureResponse(await statusGet());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ linked: false, status: 'revoked' });
  });

  it('returns linked true when link is active and not expired', async () => {
    getDbMock.mockReturnValue(makeDbForStatus([makeExpiredStatusRow(60_000, 'active')]));

    const response = ensureResponse(await statusGet());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.linked).toBe(true);
    expect(payload.status).toBe('active');
  });

  it('unlinks and clears record when deleting link', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    getDbMock.mockReturnValue({
      delete: vi.fn(() => ({ where: deleteWhere })),
    });

    const response = ensureResponse(await statusDelete());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ unlinked: true });
  });
});
