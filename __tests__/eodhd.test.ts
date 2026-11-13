import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchEodhdEarningsEstimates, fetchEodhdNews } from '@/lib/eodhd';

describe('fetchEodhdNews', () => {
  afterEach(() => {
    delete process.env.EODHD_API_KEY;
    vi.restoreAllMocks();
  });

  it('returns an error response when EODHD_API_KEY is missing', async () => {
    const result = await fetchEodhdNews('AAPL');

    expect(result).toEqual({
      status: 'error',
      count: 0,
      results: [],
      error: 'EODHD_API_KEY not configured',
    });
  });

  it('requests exchange-suffixed EODHD news and wraps the bare array response', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { title: 'Apple headline', date: '2026-04-15T12:00:00Z' },
    ])));

    const result = await fetchEodhdNews('aapl', 5);

    expect(result).toEqual({
      status: 'success',
      count: 1,
      results: [{ title: 'Apple headline', date: '2026-04-15T12:00:00Z' }],
    });
    const requestUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(requestUrl.origin).toBe('https://eodhd.com');
    expect(requestUrl.pathname).toBe('/api/news');
    expect(requestUrl.searchParams.get('s')).toBe('AAPL.US');
    expect(requestUrl.searchParams.get('limit')).toBe('5');
    expect(requestUrl.searchParams.get('api_token')).toBe('test-key');
    expect(requestUrl.searchParams.get('fmt')).toBe('json');
  });
  it('passes the optional news date range', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    await fetchEodhdNews('NCLH', 20, { from: '2026-10-28', to: '2026-10-29' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('from=2026-10-28&to=2026-10-29');
  });

});

describe('fetchEodhdEarningsEstimates', () => {
  afterEach(() => {
    delete process.env.EODHD_API_KEY;
    vi.restoreAllMocks();
  });

  it('returns null without fetching when EODHD_API_KEY is missing', async () => {
    delete process.env.EODHD_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchEodhdEarningsEstimates('SOFI', '2026-10-26', '2026-10-27')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('matches the report range and frozen quarter consensus', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ earnings: [
        { report_date: '2026-07-28', date: '2026-06-30', estimate: 0.1, actual: 0.11 },
        { report_date: '2026-10-27', date: '2026-09-30', estimate: 0.17, actual: 0.18 },
      ] }))
      .mockResolvedValueOnce(Response.json({ trends: [[
        { period: '+1q', date: '2026-09-30', revenueEstimateAvg: '1215262220.00', revenueEstimateNumberOfAnalysts: '16.00' },
        { period: '0q', date: '2026-09-30', revenueEstimateAvg: '1264367430.00', revenueEstimateNumberOfAnalysts: '19.00' },
      ]] }));
    expect(await fetchEodhdEarningsEstimates('sofi', '2026-10-26', '2026-10-27')).toEqual({
      quarter: '2026-09-30', epsEstimate: 0.17, epsActual: 0.18, revenueEstimate: 1264367430, revenueAnalysts: 19,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const earningsUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(earningsUrl.pathname).toBe('/api/calendar/earnings');
    expect(earningsUrl.searchParams.get('symbols')).toBe('SOFI.US');
    expect(earningsUrl.searchParams.get('from')).toBe('2026-10-26');
    expect(earningsUrl.searchParams.get('to')).toBe('2026-10-27');
    const trendsUrl = new URL(String(fetchSpy.mock.calls[1][0]));
    expect(trendsUrl.pathname).toBe('/api/calendar/trends');
    expect(trendsUrl.searchParams.get('symbols')).toBe('SOFI.US');
  });

  it.each(['0.00', 'not a number'])('ignores invalid revenue and analyst counts (%s) and keeps a null EPS actual', async (value) => {
    process.env.EODHD_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ earnings: [{ report_date: '2026-10-27', date: '2026-09-30', estimate: 0.17, actual: null }] }))
      .mockResolvedValueOnce(Response.json({ trends: [[{ period: '0q', date: '2026-09-30', revenueEstimateAvg: value, revenueEstimateNumberOfAnalysts: value }]] }));
    expect(await fetchEodhdEarningsEstimates('SOFI', '2026-10-26', '2026-10-27')).toEqual({
      quarter: '2026-09-30', epsEstimate: 0.17, epsActual: null, revenueEstimate: null, revenueAnalysts: null,
    });
  });

  it('returns null on HTTP failure without requesting trends', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
    expect(await fetchEodhdEarningsEstimates('SOFI', '2026-10-26', '2026-10-27')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('returns null on an earnings network failure', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchEodhdEarningsEstimates('SOFI', '2026-10-26', '2026-10-27')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('returns null when no report falls in the range', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ earnings: [
      { report_date: '2026-07-28', date: '2026-06-30', estimate: 0.1, actual: 0.11 },
    ] }));
    expect(await fetchEodhdEarningsEstimates('SOFI', '2026-10-26', '2026-10-27')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('keeps EPS when the trends request fails', async () => {
    process.env.EODHD_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ earnings: [{ report_date: '2026-10-27', date: '2026-09-30', estimate: 0.17, actual: 0.18 }] }))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await fetchEodhdEarningsEstimates('SOFI', '2026-10-26', '2026-10-27')).toEqual({
      quarter: '2026-09-30', epsEstimate: 0.17, epsActual: 0.18, revenueEstimate: null, revenueAnalysts: null,
    });
  });
});
