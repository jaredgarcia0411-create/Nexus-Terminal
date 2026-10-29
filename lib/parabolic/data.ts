import { fetchMassiveAggregateBars, type DailyOhlcBar } from '@/lib/massive-market';
import { epochToNySortKey, nyDateTimeToEpoch } from '@/lib/time-utils';

export function addCalendarDays(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export async function fetchDailyBars(ticker: string, from: string, to: string): Promise<DailyOhlcBar[]> {
  const bars = await fetchMassiveAggregateBars({ ticker, multiplier: '1', timespan: 'day', from, to });
  return bars.flatMap((bar) => {
    const timestamp = Number(bar.t);
    const open = Number(bar.o);
    const high = Number(bar.h);
    const low = Number(bar.l);
    const close = Number(bar.c);
    if (![timestamp, open, high, low, close].every(Number.isFinite)) return [];
    const volume = Number(bar.v ?? 0);
    return [{
      date: epochToNySortKey(timestamp),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      vwap: Number.isFinite(Number(bar.vw)) ? Number(bar.vw) : null,
    }];
  });
}

// Split-adjusted 1-minute bars from 04:00 ET up to the earlier of `untilMs` and the 09:30 open.
export async function fetchPremarketStats(
  ticker: string,
  date: string,
  untilMs: number,
): Promise<{ last: number; high: number } | null> {
  const start = nyDateTimeToEpoch(date, '04:00:00');
  const open = nyDateTimeToEpoch(date, '09:30:00');
  if (start == null || open == null) return null;

  const bars = await fetchMassiveAggregateBars({
    ticker,
    multiplier: '1',
    timespan: 'minute',
    from: String(start),
    to: String(Math.min(untilMs, open)),
  });
  const premarket = bars.filter((bar) => Number(bar.t) < open && Number.isFinite(Number(bar.c)) && Number.isFinite(Number(bar.h)));
  if (premarket.length === 0) return null;

  return {
    last: Number(premarket[premarket.length - 1].c),
    high: Math.max(...premarket.map((bar) => Number(bar.h))),
  };
}
