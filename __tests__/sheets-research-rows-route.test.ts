import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildSheetMatchesForDatesMock,
  ensureUserMock,
  getDbMock,
  requireUserMock,
} = vi.hoisted(() => ({
  buildSheetMatchesForDatesMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/sheets/trade-tags', () => ({
  buildSheetMatchesForDates: buildSheetMatchesForDatesMock,
}));

import { GET } from '@/app/api/sheets/research-rows/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('GET /api/sheets/research-rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({});
  });

  it('returns sheet research row matches for an inclusive date range', async () => {
    buildSheetMatchesForDatesMock.mockResolvedValue(new Map([
      ['AAPL|2026-06-08', { tags: ['Gapper'], reportId: 'report-1' }],
      ['MSFT|2026-06-10', { tags: ['Trend'] }],
    ]));

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/sheets/research-rows?from=2026-06-08&to=2026-06-10')),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(buildSheetMatchesForDatesMock).toHaveBeenCalledWith(
      {},
      'user-1',
      ['2026-06-08', '2026-06-09', '2026-06-10'],
    );
    expect(body).toEqual({
      rows: [
        { ticker: 'AAPL', date: '2026-06-08', reportId: 'report-1' },
        { ticker: 'MSFT', date: '2026-06-10' },
      ],
    });
  });

  it('rejects invalid date ranges', async () => {
    const response = ensureResponse(
      await GET(new Request('http://localhost/api/sheets/research-rows?from=bad&to=2026-06-10')),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('from and to must be YYYY-MM-DD with from before to');
    expect(buildSheetMatchesForDatesMock).not.toHaveBeenCalled();
  });
});
