import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  randomIntMock,
  getDbMock,
  requireServiceClaimsMock,
  requireUserMock,
  ensureUserMock,
} = vi.hoisted(() => ({
  randomIntMock: vi.fn(),
  getDbMock: vi.fn(),
  requireServiceClaimsMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
}));

vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: randomIntMock,
  };
});

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/service-request', () => ({ requireServiceClaims: requireServiceClaimsMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { POST, PUT } from '@/app/api/discord/link/code/route';

function makeDbForPost(existingCodes: Array<{ code: string }> = []) {
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const selectLimitMock = vi.fn().mockResolvedValue(existingCodes);
  const insertValuesMock = vi.fn().mockResolvedValue(undefined);

  return {
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: selectLimitMock,
        }),
      }),
    })),
    insert: vi.fn(() => ({ values: insertValuesMock })),
    _mocks: { deleteWhereMock, selectLimitMock, insertValuesMock },
  };
}

function makeDbForPut(linkCodeResult: null | { code: string; discordUserId: string; guildId: string; expiresAt: Date }) {
  const selectLimitMock = vi.fn().mockResolvedValue(linkCodeResult ? [linkCodeResult] : []);
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));

  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: selectLimitMock,
        }),
      }),
    })),
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    insert: vi.fn(() => ({ values: insertValuesMock })),
    _mocks: { selectLimitMock, deleteWhereMock, insertValuesMock, onConflictDoUpdateMock },
  };
}

describe('POST/PUT /api/discord/link/code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST rejects service token missing discord identity claims', async () => {
    const db = makeDbForPost();
    getDbMock.mockReturnValueOnce(db);
    requireServiceClaimsMock.mockResolvedValueOnce({
      claims: { iss: 'nexus-service', aud: 'nexus-api', iat: 1, exp: 2 },
    });

    const response = await POST(new Request('http://localhost/api/discord/link/code', { method: 'POST' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Service token missing discordUserId/guildId claims' });
  });

  it('POST creates a short-lived link code', async () => {
    const db = makeDbForPost([]);
    getDbMock.mockReturnValueOnce(db);
    requireServiceClaimsMock.mockResolvedValueOnce({
      claims: {
        iss: 'nexus-service',
        aud: 'nexus-api',
        iat: 1,
        exp: 2,
        discordUserId: 'discord-1',
        guildId: 'guild-1',
      },
    });

    // Generate "AAAAAA"
    randomIntMock.mockReturnValue(0);

    const response = await POST(new Request('http://localhost/api/discord/link/code', { method: 'POST' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.code).toBe('AAAAAA');
    expect(payload.ttlMinutes).toBe(10);

    expect(db._mocks.insertValuesMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.insertValuesMock.mock.calls[0][0]).toMatchObject({
      code: 'AAAAAA',
      discordUserId: 'discord-1',
      guildId: 'guild-1',
    });
  });

  it('PUT rejects invalid or expired codes', async () => {
    const db = makeDbForPut(null);
    getDbMock.mockReturnValueOnce(db);
    requireUserMock.mockResolvedValueOnce({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValueOnce(undefined);

    const response = await PUT(new Request('http://localhost/api/discord/link/code', {
      method: 'PUT',
      body: JSON.stringify({ code: 'ABCDEF' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Invalid or expired code' });
  });

  it('PUT links account for a valid code and deletes consumed code', async () => {
    const db = makeDbForPut({
      code: 'ABCDEF',
      discordUserId: 'discord-1',
      guildId: 'guild-1',
      expiresAt: new Date(Date.now() + 60_000),
    });

    getDbMock.mockReturnValueOnce(db);
    requireUserMock.mockResolvedValueOnce({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValueOnce(undefined);

    const response = await PUT(new Request('http://localhost/api/discord/link/code', {
      method: 'PUT',
      body: JSON.stringify({ code: 'abcdef' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      linked: true,
      link: {
        discordUserId: 'discord-1',
        guildId: 'guild-1',
      },
    });

    expect(db._mocks.insertValuesMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.deleteWhereMock).toHaveBeenCalledTimes(2);
  });
});
