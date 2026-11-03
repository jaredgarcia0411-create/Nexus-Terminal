import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMassiveAggregateBars, fetchTickerReference } from '@/lib/massive-market';

describe('Massive aggregate price basis', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    [undefined, 'true'],
    [false, 'false'],
  ])('sends adjusted=%s as %s', async (adjusted, expected) => {
    vi.stubEnv('MASSIVE_API_KEY', 'test-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ results: [] }));

    await fetchMassiveAggregateBars({
      ticker: 'AAPL', multiplier: '1', timespan: 'minute',
      from: '1780689600000', to: '1780925400000',
      ...(adjusted === undefined ? {} : { adjusted }),
    });

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get('adjusted')).toBe(expected);
  });
});

describe('Massive ticker reference', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ['Fiserv, Inc. Common Stock', 'Fiserv, Inc.'],
    ['Grab Holdings Limited Class A Ordinary Shares', 'Grab Holdings Limited'],
    ['Ethos Technologies Inc. Class A Common Stock', 'Ethos Technologies Inc.'],
    ['Defiance Daily Target 2x Short PLTR ETF', 'Defiance Daily Target 2x Short PLTR ETF'],
    [undefined, null],
  ])('trims the share-class suffix from %s', async (name, expected) => {
    vi.stubEnv('MASSIVE_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ results: { type: 'CS', name } }));

    expect(await fetchTickerReference('ABC')).toEqual({ type: 'CS', name: expected });
  });
});
