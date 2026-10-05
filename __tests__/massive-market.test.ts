import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMassiveAggregateBars } from '@/lib/massive-market';

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
