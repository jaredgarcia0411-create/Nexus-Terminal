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

import { DELETE as deleteDailyById, GET as getDailyById } from '@/app/api/daily-reviews/[id]/route';
import { POST as appendWatchlist } from '@/app/api/daily-reviews/append-watchlist/route';
import { GET, POST } from '@/app/api/daily-reviews/route';
import { WATCHLIST_REPORT_KEY } from '@/lib/watchlist';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('daily-reviews routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', name: null, picture: null },
    });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('lists reviews in a date range on GET', async () => {
    const orderByMock = vi.fn().mockResolvedValue([{ id: 'u1:dr:2026-04-18', date: '2026-04-18' }]);
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
      await GET(new Request('http://localhost/api/daily-reviews?from=2026-01-01&to=2026-12-31')),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.reviews).toEqual([{ id: 'u1:dr:2026-04-18', date: '2026-04-18' }]);
    expect(orderByMock).toHaveBeenCalledTimes(1);
  });

  it('upserts a review on POST and returns the saved row', async () => {
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
              { id: 'u1:dr:2026-04-18', date: '2026-04-18', reportData: { grade: 'A' } },
            ]),
          })),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await POST(
        new Request('http://localhost/api/daily-reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: '2026-04-18',
            templateId: null,
            templateSnapshot: [{ id: 'grade', label: 'Grade', type: 'enum', required: false, options: ['A'] }],
            reportData: { grade: 'A' },
            tradeIds: ['trade-1'],
          }),
        }),
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.review.id).toBe('u1:dr:2026-04-18');
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('appends a bare watchlist ticker with tags to an existing review', async () => {
    const updateSetMock = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { id: 'u1:dr:2026-06-02', reportData: { notes: 'morning' } },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: updateSetMock,
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await appendWatchlist(new Request('http://localhost/api/daily-reviews/append-watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-02', ticker: 'aapl', tags: ['gap'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, reviewId: 'u1:dr:2026-06-02', duplicate: false });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      reportData: {
        notes: 'morning',
        [WATCHLIST_REPORT_KEY]: [expect.objectContaining({
          ticker: 'AAPL',
          tags: ['gap'],
          grade: '',
          notes: '',
        })],
      },
    }));
  });

  it('keeps reportId watchlist appends backward-compatible', async () => {
    const updateSetMock = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { id: 'u1:dr:2026-06-02', reportData: {} },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: updateSetMock,
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await appendWatchlist(new Request('http://localhost/api/daily-reviews/append-watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-02', ticker: 'MSFT', reportId: 'report-1' }),
    })));

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      reportData: {
        [WATCHLIST_REPORT_KEY]: [expect.objectContaining({
          ticker: 'MSFT',
          tags: [],
          reportId: 'report-1',
        })],
      },
    }));
  });

  it('dedupes bare watchlist appends by ticker', async () => {
    const updateMock = vi.fn();
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'u1:dr:2026-06-02',
                reportData: {
                  [WATCHLIST_REPORT_KEY]: [{ id: 'row-1', ticker: 'AAPL', tags: ['gap'], grade: '', notes: '' }],
                },
              },
            ]),
          })),
        })),
      })),
      update: updateMock,
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await appendWatchlist(new Request('http://localhost/api/daily-reviews/append-watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-02', ticker: 'AAPL', tags: ['gap'] }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.duplicate).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await GET(new Request('http://localhost/api/daily-reviews')));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 404 for an unknown review id', async () => {
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
      await getDailyById(new Request('http://localhost/api/daily-reviews/u1:dr:2026-04-18'), {
        params: Promise.resolve({ id: 'u1:dr:2026-04-18' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Not found');
  });

  it('deletes a review by id', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const db = {
      delete: vi.fn(() => ({
        where: whereMock,
      })),
    };
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await deleteDailyById(new Request('http://localhost/api/daily-reviews/u1:dr:2026-04-18', { method: 'DELETE' }), {
        params: Promise.resolve({ id: 'u1:dr:2026-04-18' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.id).toBe('u1:dr:2026-04-18');
    expect(whereMock).toHaveBeenCalledTimes(1);
  });
});
