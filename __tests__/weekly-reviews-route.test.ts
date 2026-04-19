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

import { DELETE as deleteWeeklyById, GET as getWeeklyById } from '@/app/api/weekly-reviews/[id]/route';
import { GET, POST } from '@/app/api/weekly-reviews/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('weekly-reviews routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', name: null, picture: null },
    });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('lists reviews in a date range on GET', async () => {
    const orderByMock = vi
      .fn()
      .mockResolvedValue([{ id: 'u1:wr:2026-04-13', weekStart: '2026-04-13', weekEnd: '2026-04-17' }]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: orderByMock,
          })),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/weekly-reviews?from=2026-01-01&to=2026-12-31')),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.reviews).toEqual([
      { id: 'u1:wr:2026-04-13', weekStart: '2026-04-13', weekEnd: '2026-04-17' },
    ]);
    expect(orderByMock).toHaveBeenCalledTimes(1);
  });

  it('upserts a weekly review on POST and returns the saved row', async () => {
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
              {
                id: 'u1:wr:2026-04-13',
                weekStart: '2026-04-13',
                weekEnd: '2026-04-17',
                reportData: { summary: 'solid' },
              },
            ]),
          })),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await POST(
        new Request('http://localhost/api/weekly-reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weekStart: '2026-04-13',
            weekEnd: '2026-04-17',
            templateId: null,
            templateSnapshot: [{ id: 'summary', label: 'Summary', type: 'text', required: false }],
            reportData: { summary: 'solid' },
            tradeIds: ['trade-1', 'trade-2'],
          }),
        }),
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.review.id).toBe('u1:wr:2026-04-13');
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an unknown weekly review id', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await getWeeklyById(new Request('http://localhost/api/weekly-reviews/u1:wr:2026-04-13'), {
        params: Promise.resolve({ id: 'u1:wr:2026-04-13' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Not found');
  });

  it('deletes a weekly review by id', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const db = {
      delete: vi.fn(() => ({
        where: whereMock,
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await deleteWeeklyById(
        new Request('http://localhost/api/weekly-reviews/u1:wr:2026-04-13', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'u1:wr:2026-04-13' }) },
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.id).toBe('u1:wr:2026-04-13');
    expect(whereMock).toHaveBeenCalledTimes(1);
  });
});
