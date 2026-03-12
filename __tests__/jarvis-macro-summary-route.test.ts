import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { callJarvisMock, fetchPageTextMock, getDbMock, requireUserMock, ensureUserMock } = vi.hoisted(() => ({
  callJarvisMock: vi.fn(),
  fetchPageTextMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/jarvis/client', () => ({ callJarvis: callJarvisMock }));
vi.mock('@/lib/jarvis/scrape-lite', () => ({ fetchPageText: fetchPageTextMock }));
vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, ensureUser: ensureUserMock }));

import { GET as cronGet } from '@/app/api/jarvis/cron/macro-summary/route';
import { GET as latestGet } from '@/app/api/jarvis/macro-summary/latest/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) {
    throw new Error('Expected response');
  }

  return response;
}

describe('jarvis cron macro-summary route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T11:00:00.000Z'));
    process.env.CRON_SECRET = 'cron-secret';
    ensureUserMock.mockResolvedValue(undefined);
    fetchPageTextMock.mockResolvedValue('sample page text');
    callJarvisMock.mockResolvedValue({
      content: '{"headline":"Markets stable","key_themes":[],"risk_flags":[],"watchlist_notes":[]}',
      modelUsed: 'jarvis-mock',
    });
    getDbMock.mockReturnValue({
      insert: vi.fn(() => ({
        values: vi.fn(async () => undefined),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires valid cron secret', async () => {
    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
    }));

    expect(ensureResponse(response).status).toBe(401);
  });

  it('returns 503 when jarvis provider is not configured', async () => {
    callJarvisMock.mockRejectedValue(new Error('JARVIS_API_KEY (or NVIDIA_API_KEY) is not configured'));

    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    }));

    const json = await ensureResponse(response).json();
    expect(ensureResponse(response).status).toBe(503);
    expect(json).toMatchObject({
      error: 'Jarvis provider is not configured',
      stage: 'llm',
    });
  });

  it('skips run outside 6 AM New York window', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));

    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    }));

    const json = await ensureResponse(response).json();
    expect(ensureResponse(response).status).toBe(202);
    expect(json).toMatchObject({
      success: false,
      skipped: true,
      reason: 'outside_6am_new_york_window',
    });
    expect(fetchPageTextMock).not.toHaveBeenCalled();
    expect(callJarvisMock).not.toHaveBeenCalled();
  });

  it('returns 502 when all macro sources fail to fetch', async () => {
    fetchPageTextMock.mockRejectedValue(new Error('source unavailable'));

    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    }));

    const json = await ensureResponse(response).json();
    expect(ensureResponse(response).status).toBe(502);
    expect(json).toMatchObject({
      error: 'Macro source fetch failed',
      stage: 'scrape',
      attemptedSources: 6,
    });
    expect(callJarvisMock).not.toHaveBeenCalled();
  });

  it('returns 500 when db write fails after summary generation', async () => {
    getDbMock.mockReturnValueOnce({
      insert: vi.fn(() => ({
        values: vi.fn(async () => {
          throw new Error('db unavailable');
        }),
      })),
    });

    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    }));

    const json = await ensureResponse(response).json();
    expect(ensureResponse(response).status).toBe(500);
    expect(json).toMatchObject({
      error: 'Macro summary persistence failed',
      stage: 'db',
    });
  });

  it('runs and stores macro summary when cron secret is valid', async () => {
    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    }));

    const json = await ensureResponse(response).json();
    expect(ensureResponse(response).status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      sources: [
        'https://www.federalreserve.gov/',
        'https://home.treasury.gov/',
        'https://www.cboe.com/',
        'https://www.google.com/finance/',
        'https://www.cnn.com/business',
        'https://www.reuters.com/markets/',
      ],
      summary: {
        headline: 'Markets stable',
      },
    });
    expect(callJarvisMock).toHaveBeenCalledTimes(1);
    expect(fetchPageTextMock).toHaveBeenCalledTimes(6);
  });

  it('returns success with warnings when some sources fail', async () => {
    fetchPageTextMock
      .mockResolvedValueOnce('source one')
      .mockRejectedValueOnce(new Error('source down'))
      .mockResolvedValue('source ok');

    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    }));

    const json = await ensureResponse(response).json();
    expect(ensureResponse(response).status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      warnings: ['1 macro source fetches failed'],
    });
    expect(json.sources).toHaveLength(5);
  });
});

describe('jarvis macro-summary latest endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'test@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => [{ summaryJson: { date: '2026-03-11', overallSentiment: 'bullish', regions: [], keyRisks: [] } }]),
          })),
        })),
      })),
    });
  });

  it('blocks anonymous access', async () => {
    requireUserMock.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const response = await latestGet();
    expect(ensureResponse(response).status).toBe(401);
  });

  it('returns latest summary for authenticated user', async () => {
    const response = await latestGet();
    const json = await ensureResponse(response).json();

    expect(ensureResponse(response).status).toBe(200);
    expect(ensureUserMock).toHaveBeenCalledTimes(1);
    expect(json).toEqual({ latest: { date: '2026-03-11', overallSentiment: 'bullish', regions: [], keyRisks: [] } });
  });
});
