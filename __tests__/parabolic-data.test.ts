import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMassiveAggregateBars } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars, fetchPremarketStats } from '@/lib/parabolic/data';
import { nyDateTimeToEpoch } from '@/lib/time-utils';

vi.mock('@/lib/massive-market', () => ({ fetchMassiveAggregateBars: vi.fn() }));

describe('parabolic Massive loaders', () => {
  beforeEach(() => vi.resetAllMocks());

  it('loads a historical daily range and assigns ET dates', async () => {
    vi.mocked(fetchMassiveAggregateBars).mockResolvedValue([
      { t: Date.parse('2026-04-07T04:00:00Z'), o: 10, h: 12, l: 9, c: 11, v: 1_000_000, vw: 10.5 },
      { t: Date.parse('2026-04-08T04:00:00Z'), o: 11, h: 13, l: 10, c: 12 },
      { t: Date.parse('2026-04-09T04:00:00Z'), o: NaN, h: 13, l: 10, c: 12 },
    ]);
    expect(await fetchDailyBars('TEST', '2026-04-07', '2026-04-09')).toEqual([
      { date: '2026-04-07', open: 10, high: 12, low: 9, close: 11, volume: 1_000_000, vwap: 10.5 },
      { date: '2026-04-08', open: 11, high: 13, low: 10, close: 12, volume: 0, vwap: null },
    ]);
    expect(fetchMassiveAggregateBars).toHaveBeenCalledWith({ ticker: 'TEST', multiplier: '1', timespan: 'day', from: '2026-04-07', to: '2026-04-09' });
  });

  it('caps replay at the open and excludes the opening minute', async () => {
    const open = nyDateTimeToEpoch('2026-04-07', '09:30:00')!;
    vi.mocked(fetchMassiveAggregateBars).mockResolvedValue([
      { t: open - 120_000, c: 18, h: 19 }, { t: open - 60_000, c: 18.5, h: 18.8 },
      { t: open, c: 50, h: 100 },
    ]);
    expect(await fetchPremarketStats('TEST', '2026-04-07', Infinity)).toEqual({ last: 18.5, high: 19 });
    expect(fetchMassiveAggregateBars).toHaveBeenCalledWith(expect.objectContaining({ to: String(open) }));
  });

  it('uses the live cutoff and returns null when there are no premarket bars', async () => {
    const cutoff = nyDateTimeToEpoch('2026-04-07', '09:00:00')!;
    vi.mocked(fetchMassiveAggregateBars).mockResolvedValue([]);
    expect(await fetchPremarketStats('TEST', '2026-04-07', cutoff)).toBeNull();
    expect(fetchMassiveAggregateBars).toHaveBeenCalledWith(expect.objectContaining({
      from: String(nyDateTimeToEpoch('2026-04-07', '04:00:00')), to: String(cutoff),
    }));
    expect(addCalendarDays('2026-03-08', -1)).toBe('2026-03-07');
  });
});
