import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getCachedScannerSummaryMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getCachedScannerSummaryMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/askedgar', () => ({
  getCachedScannerSummary: getCachedScannerSummaryMock,
}));

import { GET } from '@/app/api/askedgar/scanner-summary/route';

function makeRequest(ticker?: string): Request {
  const url = ticker
    ? `http://localhost/api/askedgar/scanner-summary?ticker=${encodeURIComponent(ticker)}`
    : 'http://localhost/api/askedgar/scanner-summary';
  return new Request(url);
}

function authedUser() {
  requireUserMock.mockResolvedValue({
    user: { id: 'user-1', email: 'test@example.com', name: 'Test', picture: null },
  });
}

describe('GET /api/askedgar/scanner-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    requireUserMock.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const res = (await GET(makeRequest('AAPL'))) as Response;

    expect(res.status).toBe(401);
  });

  it('returns 400 when ticker param is missing', async () => {
    authedUser();

    const res = (await GET(makeRequest())) as Response;

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when ticker is invalid', async () => {
    authedUser();

    const res = (await GET(makeRequest('this is bad!!'))) as Response;

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  it('returns scanner summary for a valid ticker', async () => {
    authedUser();
    const mockSummary = {
      ticker: 'ACME',
      cashOnHand: 5_000_000,
      hasAtm: true,
      hasEl: false,
      hasWarrants: true,
      hasS1: false,
      fetchedAt: '2026-04-30T00:00:00.000Z',
    };
    getCachedScannerSummaryMock.mockResolvedValue(mockSummary);

    const res = (await GET(makeRequest('acme'))) as Response;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getCachedScannerSummaryMock).toHaveBeenCalledWith('ACME');
    expect(body).toEqual(mockSummary);
  });

  it('returns 500 when getCachedScannerSummary throws', async () => {
    authedUser();
    getCachedScannerSummaryMock.mockRejectedValue(new Error('DB down'));

    const res = (await GET(makeRequest('AAPL'))) as Response;

    expect(res.status).toBe(500);
  });
});
