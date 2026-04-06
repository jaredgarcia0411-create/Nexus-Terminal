import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getCachedTickerDataMock,
  fetchUnifiedSnapshotMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getCachedTickerDataMock: vi.fn(),
  fetchUnifiedSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/massive-market', () => ({
  fetchUnifiedSnapshot: fetchUnifiedSnapshotMock,
}));

vi.mock('@/lib/askedgar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/askedgar')>('@/lib/askedgar');
  return {
    ...actual,
    getCachedTickerData: getCachedTickerDataMock,
  };
});

import { GET } from '@/app/api/askedgar/lookup/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

const CACHED_RESULT = {
  ticker: 'ACME',
  fetchedAt: '2026-04-06T00:00:00.000Z',
  rawData: {
    screener: {
      status: 'success',
      count: 1,
      results: [{ ticker: 'ACME' }],
    },
  },
  dataSources: [
    { endpoint: 'screener', label: 'Screener', hasData: true },
  ],
  warnings: [],
  hasAnyData: true,
};

describe('GET /api/askedgar/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        picture: null,
      },
    });
    getCachedTickerDataMock.mockResolvedValue(CACHED_RESULT);
    fetchUnifiedSnapshotMock.mockResolvedValue({
      results: [{ name: 'Acme Biotech' }],
    });
  });

  it('returns 401 when requireUser returns an error response', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/lookup?ticker=ACME')));

    expect(response.status).toBe(401);
    expect(getCachedTickerDataMock).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing ticker', async () => {
    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/lookup')));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Valid ticker parameter required' });
    expect(getCachedTickerDataMock).not.toHaveBeenCalled();
  });

  it('returns 200 with companyName when snapshot data has a name', async () => {
    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/lookup?ticker=acme')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ...CACHED_RESULT,
      companyName: 'Acme Biotech',
    });
    expect(getCachedTickerDataMock).toHaveBeenCalledWith('ACME');
    expect(fetchUnifiedSnapshotMock).toHaveBeenCalledWith(['ACME']);
  });

  it('returns 200 with companyName null when snapshot lookup fails', async () => {
    fetchUnifiedSnapshotMock.mockRejectedValueOnce(new Error('snapshot unavailable'));

    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/lookup?ticker=acme')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ...CACHED_RESULT,
      companyName: null,
    });
  });

  it('returns 500 when getCachedTickerData throws', async () => {
    getCachedTickerDataMock.mockRejectedValueOnce(new Error('AskEdgar unavailable'));

    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/lookup?ticker=ACME')));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
  });
});
