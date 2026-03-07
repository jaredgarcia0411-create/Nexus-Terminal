import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/market-data/route';

function makeJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetchResponse(payload: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeJsonResponse(payload, status));
}

describe('GET /api/market-data', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when symbol is missing', async () => {
    const response = await GET(new Request('http://localhost/api/market-data'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Missing symbol' });
  });

  it('returns a parsed candle payload on success', async () => {
    mockFetchResponse({
      chart: {
        result: [
          {
            timestamp: [1700000000, 1700000060],
            indicators: {
              quote: [
                {
                  open: [100, 101],
                  high: [102, 103],
                  low: [99, 100],
                  close: [101, 102],
                  volume: [1000, 2000],
                },
              ],
            },
          },
        ],
      },
    });

    const response = await GET(new Request('http://localhost/api/market-data?symbol=aapl&startDate=1700000000000&endDate=1700000300000&includePrePost=true'));
    const payload = await response.json();

    const calledUrl = new URL((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(calledUrl.pathname).toContain('/v8/finance/chart/AAPL');
    expect(calledUrl.searchParams.get('includePrePost')).toBe('true');
    expect(calledUrl.searchParams.get('period1')).toBe('1700000000');

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

  it('filters out invalid candles while keeping valid rows', async () => {
    mockFetchResponse({
      chart: {
        result: [
          {
            timestamp: [1700000000, 1700000060],
            indicators: {
              quote: [
                {
                  open: [100, null],
                  high: [102, 103],
                  low: [99, 100],
                  close: [101, 102],
                  volume: [1000, 2000],
                },
              ],
            },
          },
        ],
      },
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

  it('returns 404 style errors from provider response', async () => {
    mockFetchResponse(
      {
        chart: {
          error: {
            description: 'Unknown symbol',
          },
        },
      },
      404,
    );

    const response = await GET(new Request('http://localhost/api/market-data?symbol=ZZZZ'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'Unknown symbol' });
  });

  it('returns 502 when upstream fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network unavailable'));

    const response = await GET(new Request('http://localhost/api/market-data?symbol=AAPL'));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: 'Market data provider unavailable' });
  });
});
