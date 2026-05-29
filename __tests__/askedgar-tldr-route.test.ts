import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkRateLimitMock,
  getDbMock,
  requireUserMock,
  getCachedResearchTldrMock,
} = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  getCachedResearchTldrMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/research', async () => {
  const actual = await vi.importActual<typeof import('@/lib/research')>('@/lib/research');
  return {
    ...actual,
    getCachedResearchTldr: getCachedResearchTldrMock,
  };
});

vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return {
    ...actual,
    checkRateLimit: checkRateLimitMock,
  };
});

import { POST } from '@/app/api/askedgar/tldr/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createJsonRequest(body: string) {
  return new Request('http://localhost/api/askedgar/tldr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('POST /api/askedgar/tldr', () => {
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
    getDbMock.mockReturnValue({ id: 'db' });
    checkRateLimitMock.mockResolvedValue({
      limited: false,
      limit: 30,
      remaining: 30,
      resetAt: new Date('2026-05-29T15:00:00.000Z'),
      retryAfterSeconds: 0,
    });
    getCachedResearchTldrMock.mockResolvedValue({
      findings: ['Finding 1'],
      historicalContext: null,
    });
  });

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));

    expect(response.status).toBe(401);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(getCachedResearchTldrMock).not.toHaveBeenCalled();
  });

  it('returns 400 with invalid JSON body for malformed JSON', async () => {
    const response = ensureResponse(await POST(createJsonRequest('{"ticker":')));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Invalid JSON body' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(getCachedResearchTldrMock).not.toHaveBeenCalled();
  });

  it('returns 400 with validation details for an invalid ticker body', async () => {
    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'bad!' }))));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: 'Validation failed',
      details: {
        fieldErrors: {
          ticker: ['Valid ticker required'],
        },
        formErrors: [],
      },
    });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(getCachedResearchTldrMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is not configured', async () => {
    getDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(getCachedResearchTldrMock).not.toHaveBeenCalled();
  });

  it('returns 429 when the user has exceeded the TLDR limit', async () => {
    checkRateLimitMock.mockResolvedValueOnce({
      limited: true,
      limit: 30,
      remaining: 0,
      resetAt: new Date('2026-05-29T15:00:00.000Z'),
      retryAfterSeconds: 1200,
    });

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({ error: 'Rate limit exceeded. Try again later.' });
    expect(response.headers.get('Retry-After')).toBe('1200');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('30');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('X-RateLimit-Reset')).toBe('1780066800');
    expect(checkRateLimitMock).toHaveBeenCalledWith({ id: 'db' }, 'user-1', 'askedgar-tldr');
    expect(getCachedResearchTldrMock).not.toHaveBeenCalled();
  });

  it('returns 200 with ticker, TLDR findings payload, and generatedAt', async () => {
    getCachedResearchTldrMock.mockResolvedValueOnce({
      findings: ['Finding 1'],
      historicalContext: 'Risk has increased over time.',
    });

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: ' aapl ' }))));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ticker: 'AAPL',
      findings: ['Finding 1'],
      historicalContext: 'Risk has increased over time.',
      generatedAt: expect.any(String),
    });
    expect(getCachedResearchTldrMock).toHaveBeenCalledWith('AAPL');
    expect(checkRateLimitMock).toHaveBeenCalledWith({ id: 'db' }, 'user-1', 'askedgar-tldr');
  });

  it('returns 500 when getCachedResearchTldr throws', async () => {
    getCachedResearchTldrMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
  });
});
