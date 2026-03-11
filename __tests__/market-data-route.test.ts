import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock requireUser before importing the route
vi.mock('@/lib/server-db-utils', () => ({
  requireUser: vi.fn().mockResolvedValue({
    user: {
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
      picture: null,
    },
  }),
}));

import { GET } from '@/app/api/market-data/route';
import { requireUser } from '@/lib/server-db-utils';

function makeJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetchResponse(payload: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse(payload, status));
}

const MASSIVE_RESPONSE = {
  ticker: 'AAPL',
  resultsCount: 2,
  status: 'OK',
  results: [
    { t: 1700000000000, o: 100, h: 102, l: 99, c: 101, v: 1000, vw: 100.5, n: 50 },
    { t: 1700000060000, o: 101, h: 103, l: 100, c: 102, v: 2000, vw: 101.5, n: 75 },
  ],
};

describe('GET /api/market-data', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.MASSIVE_API_KEY = 'test-key';
  });

  beforeAll(() => {
    process.env.MASSIVE_API_KEY = 'test-key';
  });

  it('returns 400 when symbol is missing', async () => {
    const response = await GET(new Request('http://localhost/api/market-data'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Missing symbol' });
  });

  it('returns 401 when user is not authenticated', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET(new Request('http://localhost/api/market-data?symbol=AAPL'));
    expect(response.status).toBe(401);
  });

  it('returns 503 when MASSIVE_API_KEY is not set', async () => {
    delete process.env.MASSIVE_API_KEY;

    const response = await GET(new Request('http://localhost/api/market-data?symbol=AAPL'));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Market data provider not configured' });
  });

  it('returns parsed candle payload on success', async () => {
    mockFetchResponse(MASSIVE_RESPONSE);

    const response = await GET(
      new Request('http://localhost/api/market-data?symbol=aapl&startDate=1700000000000&endDate=1700000300000'),
    );
    const payload = await response.json();

    const calledUrl = new URL((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(calledUrl.origin).toBe('https://api.massive.com');
    expect(calledUrl.pathname).toContain('/v2/aggs/ticker/AAPL/range/');
    expect(calledUrl.searchParams.get('apiKey')).toBe('test-key');
    expect(calledUrl.searchParams.get('adjusted')).toBe('true');
    expect(calledUrl.searchParams.get('sort')).toBe('asc');
    expect(calledUrl.searchParams.get('limit')).toBe('50000');

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      symbol: 'AAPL',
      candles: [
        {
          datetime: 1700000000000,
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1000,
        },
        {
          datetime: 1700000060000,
          open: 101,
          high: 103,
          low: 100,
          close: 102,
          volume: 2000,
        },
      ],
    });
  });

  it('accepts includePrePost without forwarding it upstream', async () => {
    mockFetchResponse(MASSIVE_RESPONSE);

    const response = await GET(
      new Request(
        'http://localhost/api/market-data?symbol=aapl&startDate=1700000000000&endDate=1700000300000&includePrePost=true',
      ),
    );

    expect(response.status).toBe(200);
    const calledUrl = new URL((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.has('includePrePost')).toBe(false);
  });

  it('filters out invalid candles while keeping valid rows', async () => {
    mockFetchResponse({
      status: 'OK',
      resultsCount: 2,
      results: [
        { t: 1700000000000, o: 100, h: 102, l: 99, c: 101, v: 1000, vw: 100.5, n: 50 },
        { t: 1700000060000, o: null, h: 103, l: 100, c: 102, v: 2000, vw: 101.5, n: 75 },
      ],
    });

    const response = await GET(new Request('http://localhost/api/market-data?symbol=AAPL'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.candles).toEqual([
      {
        datetime: 1700000000000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
    ]);
  });

  it('returns upstream error status on provider failure', async () => {
    mockFetchResponse({ status: 'ERROR' }, 404);

    const response = await GET(new Request('http://localhost/api/market-data?symbol=ZZZZ'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'Failed to fetch market data' });
  });

  it('returns 502 when upstream fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network unavailable'));

    const response = await GET(new Request('http://localhost/api/market-data?symbol=AAPL'));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: 'Market data provider unavailable' });
  });
});
