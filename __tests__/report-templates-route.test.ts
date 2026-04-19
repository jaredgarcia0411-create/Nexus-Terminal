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

import { GET, PUT } from '@/app/api/report-templates/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('report-templates route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', name: null, picture: null },
    });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('seeds and returns the daily template on first GET', async () => {
    const limitMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'u1:template:daily', type: 'daily', fields: [{ id: 'grossResult' }] },
      ]);
    const valuesMock = vi.fn(() => ({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }));
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: limitMock,
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: valuesMock,
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/report-templates?type=daily')),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.template.id).toBe('u1:template:daily');
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'u1:template:daily',
        isDefault: true,
        type: 'daily',
        userId: 'u1',
      }),
    );
  });

  it('returns the weekly template when one already exists', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { id: 'u1:template:weekly', type: 'weekly', fields: [{ id: 'perDayR' }] },
            ]),
          })),
        })),
      })),
      insert: vi.fn(),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/report-templates?type=weekly')),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.template.id).toBe('u1:template:weekly');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/report-templates?type=daily')),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('updates a template on PUT', async () => {
    const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn(() => ({
      onConflictDoUpdate: onConflictDoUpdateMock,
    }));
    const db = {
      insert: vi.fn(() => ({
        values: valuesMock,
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { id: 'u1:template:daily', type: 'daily', isDefault: false, fields: [{ id: 'notes' }] },
            ]),
          })),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await PUT(
        new Request('http://localhost/api/report-templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'daily',
            fields: [{ id: 'notes', label: 'Notes', type: 'text', required: false }],
          }),
        }),
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.template.isDefault).toBe(false);
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });
});
