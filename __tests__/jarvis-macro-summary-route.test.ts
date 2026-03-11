import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callJarvisMock, fetchPageTextMock, getDbMock, requireUserMock } = vi.hoisted(() => ({
  callJarvisMock: vi.fn(),
  fetchPageTextMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/jarvis/client', () => ({ callJarvis: callJarvisMock }));
vi.mock('@/lib/jarvis/scrape-lite', () => ({ fetchPageText: fetchPageTextMock }));
vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock }));

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
    process.env.CRON_SECRET = 'cron-secret';
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

  it('requires valid cron secret', async () => {
    const response = await cronGet(new Request('http://localhost/api/jarvis/cron/macro-summary', {
      method: 'GET',
    }));

    expect(ensureResponse(response).status).toBe(401);
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
        'https://www.cnbc.com/economy/',
        'https://www.reuters.com/markets/',
        'https://www.federalreserve.gov/newsevents.htm',
        'https://www.ecb.europa.eu/press/pr/html/index.en.html',
        'https://tradingeconomics.com/calendar',
      ],
      summary: {
        headline: 'Markets stable',
      },
    });
    expect(callJarvisMock).toHaveBeenCalledTimes(1);
    expect(fetchPageTextMock).toHaveBeenCalledTimes(5);
  });
});

describe('jarvis macro-summary latest endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'test@example.com', name: null, picture: null } });
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
    expect(json).toEqual({ latest: { date: '2026-03-11', overallSentiment: 'bullish', regions: [], keyRisks: [] } });
  });
});
