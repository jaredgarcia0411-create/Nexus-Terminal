import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFredSeries } from '@/lib/agents/fred-client';

describe('fetchFredSeries', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns nothing when FRED_API_KEY is not set', async () => {
    vi.stubEnv('FRED_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchFredSeries(['DGS10'])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a holiday "." row and uses the newest real value', async () => {
    vi.stubEnv('FRED_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        observations: [
          { date: '2026-11-11', value: '.' },
          { date: '2026-11-10', value: '4.18' },
        ],
      }),
    }));

    expect(await fetchFredSeries(['DGS10'])).toEqual([
      { seriesId: 'DGS10', label: '10Y Treasury', date: '2026-11-10', value: 4.18 },
    ]);
  });
});
