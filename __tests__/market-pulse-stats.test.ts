import { describe, expect, it } from 'vitest';

import {
  average,
  computeMarketPulseStats,
  median,
  percentChange,
  percentileRank,
  safeDivide,
} from '@/lib/market-pulse/stats';
import type { MarketPulseBar } from '@/lib/market-pulse/types';

function bar(date: string, ticker: string, open: number, close: number, extra: Partial<MarketPulseBar> = {}): MarketPulseBar {
  return {
    tradeDate: date,
    ticker,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1_000_000,
    vwap: null,
    dollarVolume: close * 1_000_000,
    sourceTimestamp: null,
    ...extra,
  };
}

function dateAt(index: number): string {
  return new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
}

describe('market pulse stats helpers', () => {
  it('computes percent change, safe division, median, average, and percentile rank', () => {
    expect(safeDivide(4, 2)).toBe(2);
    expect(safeDivide(4, 0)).toBeNull();
    expect(percentChange(12, 10)).toBe(20);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(average([1, 2, 3])).toBe(2);
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(75);
  });

  it('computes breadth counts, averages, and leader/laggard rows', () => {
    const stats = computeMarketPulseStats('2026-01-02', [
      bar('2026-01-01', 'AAA', 10, 10),
      bar('2026-01-01', 'BBB', 10, 10),
      bar('2026-01-01', 'CCC', 10, 10),
      bar('2026-01-02', 'AAA', 10, 12),
      bar('2026-01-02', 'BBB', 10, 8),
      bar('2026-01-02', 'CCC', 10, 10),
    ]);

    expect(stats).not.toBeNull();
    expect(stats?.advancers).toBe(1);
    expect(stats?.decliners).toBe(1);
    expect(stats?.unchanged).toBe(1);
    expect(stats?.advancerPct).toBe(33.33);
    expect(stats?.medianChangePct).toBe(0);
    expect(stats?.avgChangePct).toBe(0);
    expect(stats?.pctAbovePrevClose).toBe(33.33);
    expect(stats?.leaders[0]).toMatchObject({ ticker: 'AAA', changePct: 20 });
    expect(stats?.laggards[0]).toMatchObject({ ticker: 'BBB', changePct: -20 });
  });

  it('computes rolling 30 metrics and gates overview90 until 90 trading days exist', () => {
    const first89 = Array.from({ length: 89 }, (_, i) => {
      const date = dateAt(i);
      return [
        bar(date, 'AAA', 10, i % 2 === 0 ? 11 : 9),
        bar(date, 'BBB', 10, i % 2 === 0 ? 9 : 11),
      ];
    }).flat();
    const stats89 = computeMarketPulseStats(dateAt(88), first89);
    expect(stats89?.rolling30.tradingDays).toBe(30);
    expect(stats89?.overview90).toBeNull();

    const all90 = [
      ...first89,
      bar(dateAt(89), 'AAA', 10, 12, { high: 14 }),
      bar(dateAt(89), 'BBB', 10, 11, { high: 12 }),
    ];
    const stats90 = computeMarketPulseStats(dateAt(89), all90);
    expect(stats90?.overview90?.tradingDays).toBe(90);
    expect(stats90?.overview90?.trend).toMatch(/improving|flat|deteriorating/);
    expect(stats90?.newHigh30dCount).toBeGreaterThan(0);
  });
});
