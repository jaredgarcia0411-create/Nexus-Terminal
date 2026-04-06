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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse({
      totalCount: 12,
      data: [{
        s: 'NASDAQ:AAPL',
        d: ['AAPL', 12.34, 45.6, 123456, 789000, 250000000, 'Technology'],
      }],
    }));

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
      }],
      count: 1,
      totalCount: 12,
      isRealtime: false,
      fetchedAt: expect.any(String),
    });
  });

  it('filters out rows with invalid numeric price, change, or volume', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse({
      data: [
        { s: 'NASDAQ:BADPRICE', d: ['BADPRICE', 'oops', 50, 1000, null, null, 'Tech'] },
        { s: 'NASDAQ:BADCHANGE', d: ['BADCHANGE', 10, 'oops', 1000, null, null, 'Tech'] },
        { s: 'NASDAQ:BADVOLUME', d: ['BADVOLUME', 10, 50, 'oops', null, null, 'Tech'] },
        { s: 'NASDAQ:GOOD', d: ['GOOD', 10, 50, 1000, 500, 1000000, 'Energy'] },
      ],
    }));

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
      },
    ]);
    expect(payload.count).toBe(1);
  });

  it('returns isRealtime false when TRADINGVIEW_SESSION_ID is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse({ data: [] }));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.isRealtime).toBe(false);
  });

  it('returns isRealtime true and sends Cookie when TRADINGVIEW_SESSION_ID is set', async () => {
    process.env.TRADINGVIEW_SESSION_ID = 'live-session';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse({ data: [] }));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.isRealtime).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://scanner.tradingview.com/america/scan',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'sessionid=live-session',
        }),
      }),
    );
  });

  it('returns 502 when TradingView responds with a non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse({ error: 'nope' }, 403));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: 'TradingView scanner returned 403' });
  });

  it('returns 500 when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
  });
});
