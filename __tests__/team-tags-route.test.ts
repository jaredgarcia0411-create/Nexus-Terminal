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

import { DELETE, GET, POST } from '@/app/api/team-tags/route';
import { teamTags as teamTagsTable } from '@/lib/db/schema';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function buildTeamTagDb(tags: string[]) {
  const orderByMock = vi.fn().mockResolvedValue(tags.map((name) => ({ name })));
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: orderByMock,
      })),
    })),
    _mocks: {
      orderByMock,
    },
  };
}

function buildMutatingDb() {
  const onConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictDoNothingMock });
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);

  return {
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
    delete: vi.fn(() => ({
      where: deleteWhereMock,
    })),
    _mocks: {
      deleteWhereMock,
      insertValuesMock,
      onConflictDoNothingMock,
    },
  };
}

describe('team tags route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'user@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('returns team tags sorted by name', async () => {
    const db = buildTeamTagDb(['AAPL', 'MSFT']);
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ tags: ['AAPL', 'MSFT'] });
    expect(db.select).toHaveBeenCalledWith({ name: teamTagsTable.name });
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

  it('adds a team tag on POST', async () => {
    const db = buildMutatingDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(
      new Request('http://localhost/api/team-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'earnings' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ tag: 'earnings' });
    expect(db.insert).toHaveBeenCalledWith(teamTagsTable);
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith({ name: 'earnings' });
    expect(db._mocks.onConflictDoNothingMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes team tags on POST', async () => {
    const db = buildMutatingDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(
      new Request('http://localhost/api/team-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'earnings' }),
      }),
    ));

    expect(response.status).toBe(200);
    expect(db._mocks.onConflictDoNothingMock).toHaveBeenCalledTimes(1);
  });

  it('rejects POST when tag name is missing', async () => {
    const db = buildMutatingDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(
      new Request('http://localhost/api/team-tags', {
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

  it('deletes a team tag on DELETE without scrubbing assignments', async () => {
    const db = buildMutatingDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await DELETE(
      new Request('http://localhost/api/team-tags', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'old-tag' }),
      }),
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, name: 'old-tag' });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(teamTagsTable);
    expect(db._mocks.deleteWhereMock).toHaveBeenCalledTimes(1);
  });
});
