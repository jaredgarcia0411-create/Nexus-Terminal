import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getCachedResearchTldrMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getCachedResearchTldrMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/research', async () => {
  const actual = await vi.importActual<typeof import('@/lib/research')>('@/lib/research');
  return {
    ...actual,
    getCachedResearchTldr: getCachedResearchTldrMock,
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
    expect(getCachedResearchTldrMock).not.toHaveBeenCalled();
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
  });

  it('returns 500 when getCachedResearchTldr throws', async () => {
    getCachedResearchTldrMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
  });
});
