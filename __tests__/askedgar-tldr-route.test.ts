import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getCachedTickerDataMock,
  runResearchTldrMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getCachedTickerDataMock: vi.fn(),
  runResearchTldrMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/askedgar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/askedgar')>('@/lib/askedgar');
  return {
    ...actual,
    getCachedTickerData: getCachedTickerDataMock,
  };
});

vi.mock('@/lib/research', async () => {
  const actual = await vi.importActual<typeof import('@/lib/research')>('@/lib/research');
  return {
    ...actual,
    runResearchTldr: runResearchTldrMock,
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
    getCachedTickerDataMock.mockResolvedValue({
      ticker: 'AAPL',
      rawData: {
        screener: {
          status: 'success',
          count: 1,
          results: [{ ticker: 'AAPL' }],
        },
      },
    });
    runResearchTldrMock.mockResolvedValue({
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
    expect(getCachedTickerDataMock).not.toHaveBeenCalled();
  });

  it('returns 400 with invalid JSON body for malformed JSON', async () => {
    const response = ensureResponse(await POST(createJsonRequest('{"ticker":')));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Invalid JSON body' });
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
  });

  it('returns 200 with ticker, TLDR findings payload, and generatedAt', async () => {
    const rawData = {
      screener: {
        status: 'success',
        count: 1,
        results: [{ ticker: 'AAPL' }],
      },
    };

    getCachedTickerDataMock.mockResolvedValueOnce({ ticker: 'AAPL', rawData });
    runResearchTldrMock.mockResolvedValueOnce({
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
    expect(runResearchTldrMock).toHaveBeenCalledWith(rawData, 'AAPL');
  });

  it('returns 500 when runResearchTldr throws', async () => {
    runResearchTldrMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
  });
});
