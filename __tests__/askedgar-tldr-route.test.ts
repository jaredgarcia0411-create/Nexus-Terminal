import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getDbMock,
  getCachedTickerDataMock,
  runResearchTldrMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getDbMock: vi.fn(),
  getCachedTickerDataMock: vi.fn(),
  runResearchTldrMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    ...actual,
    getDb: getDbMock,
  };
});

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

function createDb({
  summaryRows = [],
  discordRows = [],
}: {
  summaryRows?: Array<{ historicalSummary: unknown }>;
  discordRows?: Array<{ rawText: string; reportDate: Date }>;
} = {}) {
  let selectCallIndex = 0;

  return {
    select: vi.fn(() => {
      selectCallIndex += 1;

      const rows = selectCallIndex === 1 ? summaryRows : discordRows;
      const limit = vi.fn(async (count: number) => rows.slice(0, count));
      const orderBy = vi.fn(() => ({ limit }));

      return {
        from: vi.fn(() => ({
          where: vi.fn(() => (selectCallIndex === 1 ? { limit } : { orderBy })),
        })),
      };
    }),
  };
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
    getDbMock.mockReturnValue(createDb());
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
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 when getDb returns undefined', async () => {
    getDbMock.mockReturnValueOnce(undefined);

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
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

  it('returns 200 with ticker, TLDR findings payload, generatedAt, and hasHistoricalData', async () => {
    const historicalSummary = { summary: 'Two prior offerings' };
    const latestDiscordDate = new Date('2026-04-05T15:30:00.000Z');
    const latestDiscord = 'Discord report text';
    const db = createDb({
      summaryRows: [{ historicalSummary }],
      discordRows: [{ rawText: latestDiscord, reportDate: latestDiscordDate }],
    });
    const rawData = {
      screener: {
        status: 'success',
        count: 1,
        results: [{ ticker: 'AAPL' }],
      },
    };

    getDbMock.mockReturnValueOnce(db);
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
      hasHistoricalData: true,
    });
    expect(runResearchTldrMock).toHaveBeenCalledWith(rawData, 'AAPL', {
      historicalSummary,
      discordReport: {
        date: '2026-04-05',
        text: latestDiscord,
      },
    });
  });

  it('returns 500 when runResearchTldr throws', async () => {
    runResearchTldrMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
  });
});
