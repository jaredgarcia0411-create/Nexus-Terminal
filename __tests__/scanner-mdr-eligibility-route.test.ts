import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  computeMdrEligibilityMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  computeMdrEligibilityMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/massive-market', () => ({
  computeMdrEligibility: computeMdrEligibilityMock,
}));

import { GET } from '@/app/api/scanner/mdr-eligibility/route';

function makeRequest(ticker?: string, mark?: string): Request {
  const params = new URLSearchParams();
  if (ticker !== undefined) params.set('ticker', ticker);
  if (mark !== undefined) params.set('mark', mark);
  const qs = params.toString();
  return new Request(`http://localhost/api/scanner/mdr-eligibility${qs ? `?${qs}` : ''}`);
}

function authedUser() {
  requireUserMock.mockResolvedValue({
    user: { id: 'user-1', email: 'test@example.com', name: 'Test', picture: null },
  });
}

describe('GET /api/scanner/mdr-eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    requireUserMock.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = (await GET(makeRequest('AAPL', '100'))) as Response;
    expect(res.status).toBe(401);
  });

  it('returns 400 when ticker is missing', async () => {
    authedUser();
    const res = (await GET(makeRequest(undefined, '100'))) as Response;
    expect(res.status).toBe(400);
  });

  it('returns 400 when mark is missing', async () => {
    authedUser();
    const res = (await GET(makeRequest('AAPL'))) as Response;
    expect(res.status).toBe(400);
  });

  it('returns 400 when mark is not a positive number', async () => {
    authedUser();
    const res = (await GET(makeRequest('AAPL', '-1'))) as Response;
    expect(res.status).toBe(400);
  });

  it('returns eligibility result for a valid ticker', async () => {
    authedUser();
    const mockResult = {
      ticker: 'ACME',
      eligible: true,
      hadPriorBigDay: true,
      isUp3xFromBase: true,
      isNew20dHigh: true,
      priorBase20Low: 1.0,
      priorHigh20: 4.5,
      fetchedAt: '2026-04-30T00:00:00.000Z',
    };
    computeMdrEligibilityMock.mockResolvedValue(mockResult);

    const res = (await GET(makeRequest('acme', '5.00'))) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(computeMdrEligibilityMock).toHaveBeenCalledWith('ACME', 5.0);
    expect(body).toEqual(mockResult);
  });

  it('returns 500 when computeMdrEligibility throws', async () => {
    authedUser();
    computeMdrEligibilityMock.mockRejectedValue(new Error('Massive down'));
    const res = (await GET(makeRequest('AAPL', '100'))) as Response;
    expect(res.status).toBe(500);
  });
});
