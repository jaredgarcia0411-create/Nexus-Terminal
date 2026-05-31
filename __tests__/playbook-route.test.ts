import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbUnavailableMock,
  ensureUserMock,
  getDbMock,
  requireUserMock,
} = vi.hoisted(() => ({
  dbUnavailableMock: vi.fn(() => Response.json({ error: 'Database not configured' }, { status: 503 })),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: dbUnavailableMock,
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { DELETE, GET, PATCH, POST } from '@/app/api/playbook/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('playbook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', name: null, picture: null },
    });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('returns strategies for the authenticated user on GET', async () => {
    const rows = [{ id: 'strategy-1', userId: 'u1', name: 'Gap Fade' }];
    const orderByMock = vi.fn().mockResolvedValue(rows);
    const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const db = {
      select: vi.fn(() => ({ from: fromMock })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.strategies).toEqual(rows);
    expect(ensureUserMock).toHaveBeenCalledWith(db, expect.objectContaining({ id: 'u1' }));
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(orderByMock).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when unauthenticated on GET', async () => {
    requireUserMock.mockResolvedValue({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 503 when the database is unavailable on GET', async () => {
    getDbMock.mockReturnValue(null);

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toBe('Database not configured');
  });

  it('validates and inserts a strategy on POST', async () => {
    const inserted = {
      id: 'generated-id',
      userId: 'u1',
      name: 'Breakout',
      description: 'High volume gap',
      tag: 'Momentum',
      sections: { overview: 'Setup' },
    };
    const returningMock = vi.fn().mockResolvedValue([inserted]);
    const valuesMock = vi.fn(() => ({ returning: returningMock }));
    const db = {
      insert: vi.fn(() => ({ values: valuesMock })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/playbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Breakout',
        description: 'High volume gap',
        tag: 'Momentum',
        sections: { overview: 'Setup' },
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.strategy).toEqual(inserted);
    expect(valuesMock).toHaveBeenCalledWith({
      id: expect.any(String),
      userId: 'u1',
      name: 'Breakout',
      description: 'High volume gap',
      tag: 'Momentum',
      sections: { overview: 'Setup' },
    });
  });

  it('returns the standard validation shape for invalid POST input', async () => {
    const db = {
      insert: vi.fn(),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/playbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'missing name', sections: {} }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.name.length).toBeGreaterThan(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns 400 when PATCH id is missing', async () => {
    const db = { update: vi.fn() };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(new Request('http://localhost/api/playbook', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('id query param is required');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates only owned strategy rows on PATCH', async () => {
    const updated = { id: 'strategy-1', userId: 'u1', name: 'Updated' };
    const returningMock = vi.fn().mockResolvedValue([updated]);
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const setMock = vi.fn(() => ({ where: whereMock }));
    const db = {
      update: vi.fn(() => ({ set: setMock })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(new Request('http://localhost/api/playbook?id=strategy-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated', sections: { overview: 'Next' } }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.strategy).toEqual(updated);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Updated',
      sections: { overview: 'Next' },
      updatedAt: expect.any(Date),
    }));
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when PATCH finds no owned row', async () => {
    const returningMock = vi.fn().mockResolvedValue([]);
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: returningMock })),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await PATCH(new Request('http://localhost/api/playbook?id=strategy-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('strategy not found');
  });

  it('returns 400 when DELETE id is missing', async () => {
    const db = { delete: vi.fn() };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await DELETE(new Request('http://localhost/api/playbook', { method: 'DELETE' })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('id query param is required');
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes only owned strategy rows on DELETE', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 'strategy-1' }]);
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const db = {
      delete: vi.fn(() => ({ where: whereMock })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await DELETE(new Request('http://localhost/api/playbook?id=strategy-1', { method: 'DELETE' })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, id: 'strategy-1' });
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(returningMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when DELETE finds no owned row', async () => {
    const db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await DELETE(new Request('http://localhost/api/playbook?id=strategy-1', { method: 'DELETE' })));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('strategy not found');
  });
});
