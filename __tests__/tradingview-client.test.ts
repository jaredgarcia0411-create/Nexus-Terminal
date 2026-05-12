import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchTradingViewPriceContext, TRADINGVIEW_COLUMNS } from '@/lib/tradingview-client';

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(payload),
  } as Response);
}

describe('tradingview client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends the expected scan request and session header', async () => {
    vi.stubEnv('TRADINGVIEW_SESSION_ID', 'session-123');
    const fetchMock = vi.fn(() => jsonResponse({
      data: [{ s: 'NASDAQ:ABCD', d: ['ABCD', 1.23, 4.5, 1000, 2000, 3_000_000, 'Healthcare', 1.5, 0.9, 55, 0.1, 1.1, 1.0] }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTradingViewPriceContext('abcd');

    expect(result).toMatchObject({
      price: 1.23,
      change: 4.5,
      volume: 1000,
      sector: 'Healthcare',
    });
    expect(fetchMock).toHaveBeenCalledWith('https://scanner.tradingview.com/america/scan', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      headers: expect.objectContaining({
        Cookie: 'sessionid=session-123',
        Origin: 'https://www.tradingview.com',
      }),
    }));
    const requestInit = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1];
    const body = JSON.parse(String(requestInit.body));
    expect(body.columns).toEqual(TRADINGVIEW_COLUMNS);
    expect(body.filter).toEqual([{ left: 'name', operation: 'equal', right: 'ABCD' }]);
  });

  it('normalizes numeric strings and returns null for missing or non-numeric price rows', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({
        data: [{ s: 'NASDAQ:ABCD', d: ['ABCD', '1,234.50', '5.25%', '10,000', null, '2,000,000', 'Tech'] }],
      }))
      .mockImplementationOnce(() => jsonResponse({ data: [] }))
      .mockImplementationOnce(() => jsonResponse({ data: [{ s: 'NASDAQ:ABCD', d: ['ABCD', 'bad'] }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTradingViewPriceContext('ABCD')).resolves.toMatchObject({
      price: 1234.5,
      change: 5.25,
      volume: 10000,
      marketCap: 2000000,
    });
    await expect(fetchTradingViewPriceContext('ABCD')).resolves.toBeNull();
    await expect(fetchTradingViewPriceContext('ABCD')).resolves.toBeNull();
  });

  it('preserves non-OK scanner errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({}, false, 503)));

    await expect(fetchTradingViewPriceContext('ABCD')).rejects.toThrow('TradingView scanner returned 503');
  });
});
