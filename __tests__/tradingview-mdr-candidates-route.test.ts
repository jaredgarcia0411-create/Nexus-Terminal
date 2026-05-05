import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  evaluateLatestD2MdrTriggerMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  evaluateLatestD2MdrTriggerMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/massive-market', () => ({
  evaluateLatestD2MdrTrigger: evaluateLatestD2MdrTriggerMock,
}));

import { GET } from '@/app/api/tradingview/mdr-candidates/route';

const originalTradingViewSessionId = process.env.TRADINGVIEW_SESSION_ID;

function makeJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authedUser() {
  requireUserMock.mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      picture: null,
    },
  });
}

describe('GET /api/tradingview/mdr-candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authedUser();
    delete process.env.TRADINGVIEW_SESSION_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalTradingViewSessionId === undefined) {
      delete process.env.TRADINGVIEW_SESSION_ID;
      return;
    }
    process.env.TRADINGVIEW_SESSION_ID = originalTradingViewSessionId;
  });

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = (await GET()) as Response;

    expect(response.status).toBe(401);
    expect(evaluateLatestD2MdrTriggerMock).not.toHaveBeenCalled();
  });

  it('returns only candidates passing the structural d2_mdr check with thresholds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse({
      totalCount: 2,
      data: [
        { s: 'NASDAQ:KEEP', d: ['KEEP', 3, 50, 12_000_000, 1_000_000, 100_000_000, 'Health', 3.2, 55, 2_000_000] },
        { s: 'NASDAQ:DROP', d: ['DROP', 2, 35, 20_000_000, 1_000_000, 100_000_000, 'Tech', null, null, null] },
      ],
    }));
    evaluateLatestD2MdrTriggerMock.mockImplementation(async (ticker: string) => ({
      ticker,
      triggered: ticker === 'KEEP',
      reason: ticker === 'KEEP' ? undefined : 'no_prior_big_day',
      thresholds: ticker === 'KEEP'
        ? {
            pmPriceNeeded: 3.4,
            openingGapNeededPercent: 13.33,
            intradayPriceNeeded: 3.4,
            basisPrice: 3.4,
            atr14: 0.4,
          }
        : {
            pmPriceNeeded: null,
            openingGapNeededPercent: null,
            intradayPriceNeeded: null,
            basisPrice: null,
            atr14: null,
          },
    }));

    const response = (await GET()) as Response;
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(evaluateLatestD2MdrTriggerMock).toHaveBeenCalledWith('KEEP');
    expect(evaluateLatestD2MdrTriggerMock).toHaveBeenCalledWith('DROP');
    expect(payload).toEqual({
      candidates: [{
        ticker: 'KEEP',
        price: 3,
        change: 50,
        volume: 12000000,
        avgVolume90d: 1000000,
        marketCap: 100000000,
        sector: 'Health',
        preMarketPrice: 3.2,
        preMarketChange: 55,
        preMarketVolume: 2000000,
        pmPriceNeeded: 3.4,
        openingGapNeededPercent: 13.33,
        intradayPriceNeeded: 3.4,
        basisPrice: 3.4,
        atr14: 0.4,
      }],
      count: 1,
      totalCount: 2,
      isRealtime: false,
      fetchedAt: expect.any(String),
    });
  });

  it('excludes a candidate when structural evaluation fails and continues', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse({
      data: [
        { s: 'NASDAQ:FAIL', d: ['FAIL', 3, 50, 12_000_000, null, null, null, null, null, null] },
        { s: 'NASDAQ:KEEP', d: ['KEEP', 3, 50, 12_000_000, null, null, null, null, null, null] },
      ],
    }));
    evaluateLatestD2MdrTriggerMock.mockImplementation(async (ticker: string) => {
      if (ticker === 'FAIL') throw new Error('Massive unavailable');
      return {
        ticker,
        triggered: true,
        thresholds: {
          pmPriceNeeded: 3.4,
          openingGapNeededPercent: 13.33,
          intradayPriceNeeded: 3.4,
          basisPrice: 3.4,
          atr14: 0.4,
        },
      };
    });

    const response = (await GET()) as Response;
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.candidates.map((row: { ticker: string }) => row.ticker)).toEqual(['KEEP']);
    expect(console.warn).toHaveBeenCalledWith(
      '[api:tradingview-mdr-candidates] skipped structural evaluation',
      { ticker: 'FAIL', reason: 'Massive unavailable' },
    );
  });
});
