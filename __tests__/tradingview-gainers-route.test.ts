import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

import { GET } from '@/app/api/tradingview/gainers/route';

const originalTradingViewSessionId = process.env.TRADINGVIEW_SESSION_ID;

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function makeJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockTradingViewFetch(pmPayload: unknown, ahPayload: unknown = { data: [] }) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(makeJsonResponse(pmPayload))
    .mockResolvedValueOnce(makeJsonResponse(ahPayload));
}

describe('GET /api/tradingview/gainers', () => {
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

    const response = ensureResponse(await GET());

    expect(response.status).toBe(401);
  });

  it('returns 200 and normalizes valid TradingView rows into gainers', async () => {
    mockTradingViewFetch({
      totalCount: 12,
      data: [{
        s: 'NASDAQ:AAPL',
        d: [
          'AAPL',
          12.34,
          45.6,
          123456,
          789000,
          250000000,
          'Technology',
          17.9,
          45.6,
          1_100_000,
          17.4,
          41.2,
          950_000,
        ],
      }],
    });

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      gainers: [{
        ticker: 'AAPL',
        price: 12.34,
        change: 45.6,
        volume: 123456,
        avgVolume90d: 789000,
        marketCap: 250000000,
        sector: 'Technology',
        preMarketPrice: 17.9,
        preMarketChange: 45.6,
        preMarketVolume: 1100000,
        postMarketPrice: 17.4,
        postMarketChange: 41.2,
        postMarketVolume: 950000,
        extendedHoursVolume: 2050000,
        dayOneMovePercent: 45.6,
        dayOneMark: 17.9,
        dayOneMoveSource: 'pre-market',
      }],
      count: 1,
      totalCount: 12,
      isRealtime: false,
      fetchedAt: expect.any(String),
    });
  });

  it('filters out rows with invalid numeric price, change, or volume', async () => {
    mockTradingViewFetch({
      data: [
        { s: 'NASDAQ:BADPRICE', d: ['BADPRICE', 'oops', 50, 1000, null, null, 'Tech'] },
        { s: 'NASDAQ:BADCHANGE', d: ['BADCHANGE', 10, 'oops', 1000, null, null, 'Tech'] },
        { s: 'NASDAQ:BADVOLUME', d: ['BADVOLUME', 10, 50, 'oops', null, null, 'Tech'] },
        { s: 'NASDAQ:GOOD', d: ['GOOD', 10, 50, 1000, 500, 1000000, 'Energy', 15, 50, 2_000_000, null, null, null] },
      ],
    });

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.gainers).toEqual([
      {
        ticker: 'GOOD',
        price: 10,
        change: 50,
        volume: 1000,
        avgVolume90d: 500,
        marketCap: 1000000,
        sector: 'Energy',
        preMarketPrice: 15,
        preMarketChange: 50,
        preMarketVolume: 2000000,
        postMarketPrice: null,
        postMarketChange: null,
        postMarketVolume: null,
        extendedHoursVolume: 2000000,
        dayOneMovePercent: 50,
        dayOneMark: 15,
        dayOneMoveSource: 'pre-market',
      },
    ]);
    expect(payload.count).toBe(1);
  });

  it('qualifies rows on combined AH and PM volume, not one session alone', async () => {
    mockTradingViewFetch({
      data: [
        {
          s: 'NASDAQ:COMBO',
          d: ['COMBO', 1, 45, 1000, null, 100000000, null, 1.45, 45, 1_100_000, 1.42, 42, 950_000],
        },
        {
          s: 'NASDAQ:SHORT',
          d: ['SHORT', 1, 45, 1000, null, 100000000, null, 1.45, 45, 1_999_999, null, null, null],
        },
        {
          s: 'NASDAQ:NOMOVE',
          d: ['NOMOVE', 1, 15, 1000, null, 100000000, null, 1.15, 15, 2_000_000, 1.2, 20, 1_000_000],
        },
      ],
    });

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.gainers.map((row: { ticker: string }) => row.ticker)).toEqual(['COMBO']);
    expect(payload.gainers[0]).toEqual(expect.objectContaining({
      ticker: 'COMBO',
      extendedHoursVolume: 2050000,
      dayOneMovePercent: 45,
      dayOneMoveSource: 'pre-market',
    }));
  });

  it('returns isRealtime false when TRADINGVIEW_SESSION_ID is missing', async () => {
    mockTradingViewFetch({ data: [] });

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.isRealtime).toBe(false);
  });

  it('returns isRealtime true and sends Cookie when TRADINGVIEW_SESSION_ID is set', async () => {
    process.env.TRADINGVIEW_SESSION_ID = 'live-session';
    const fetchSpy = mockTradingViewFetch({ data: [] });

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.isRealtime).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'sessionid=live-session',
        }),
      }));
    }
  });

  it('returns 502 when TradingView responds with a non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeJsonResponse({ error: 'nope' }, 403))
      .mockResolvedValueOnce(makeJsonResponse({ data: [] }));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: 'TradingView scanner returned 403' });
  });

  it('returns 500 when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makeJsonResponse({ data: [] }));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
  });
});
