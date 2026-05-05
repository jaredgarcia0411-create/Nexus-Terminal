import { describe, expect, it } from 'vitest';

import {
  calculateMdrThresholds,
  evaluateD2MdrDailySeries,
  evaluateD2MdrTrigger,
  type DailyOhlcBar,
  type GroupedDailyBar,
} from '@/lib/massive-market';

function grouped(overrides: Partial<GroupedDailyBar> & { ticker?: string } = {}): GroupedDailyBar {
  return {
    ticker: overrides.ticker ?? 'MDR',
    open: 1.2,
    high: 1.5,
    low: 1,
    close: 1.4,
    volume: 1_000_000,
    vwap: null,
    timestamp: Date.parse('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function structuralPriorBars(): GroupedDailyBar[] {
  const bars: GroupedDailyBar[] = [];
  bars.push(grouped({
    open: 1,
    high: 1.2,
    low: 1,
    close: 1,
    timestamp: Date.parse('2026-01-01T00:00:00Z'),
  }));
  bars.push(grouped({
    open: 1.05,
    high: 1.65,
    low: 1.02,
    close: 1.45,
    volume: 80_000_000,
    timestamp: Date.parse('2026-01-02T00:00:00Z'),
  }));

  for (let i = 2; i < 20; i += 1) {
    bars.push(grouped({
      open: 1.35,
      high: 2,
      low: 1.1,
      close: 1.5,
      volume: 1_000_000,
      timestamp: Date.parse(`2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    }));
  }

  return bars;
}

function dailyBarsFromGrouped(bars: GroupedDailyBar[]): DailyOhlcBar[] {
  return bars.map((bar, index) => ({
    date: new Date(bar.timestamp || Date.parse(`2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`))
      .toISOString()
      .split('T')[0]!,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    vwap: bar.vwap,
  }));
}

describe('evaluateD2MdrTrigger', () => {
  it('returns triggered for a full structural d2_mdr setup', () => {
    const today = grouped({
      open: 2.1,
      high: 4.2,
      low: 2,
      close: 3,
      volume: 12_000_000,
      timestamp: Date.parse('2026-01-21T00:00:00Z'),
    });

    expect(evaluateD2MdrTrigger(today, structuralPriorBars())).toEqual({
      triggered: true,
      priorHigh20: 2,
      priorLow20: 1,
      priorBigDayDate: '2026-01-02',
    });
  });

  it('returns a false reason when a structural d2_mdr setup fails', () => {
    const today = grouped({
      open: 2.1,
      high: 4.2,
      low: 2,
      close: 3,
      volume: 9_999_999,
      timestamp: Date.parse('2026-01-21T00:00:00Z'),
    });

    expect(evaluateD2MdrTrigger(today, structuralPriorBars())).toEqual({
      triggered: false,
      reason: 'volume_below_10m',
      priorHigh20: null,
      priorLow20: null,
      priorBigDayDate: null,
    });
  });
});

describe('MDR thresholds', () => {
  it('calculates the D2 ATR-based threshold basis', () => {
    const thresholds = calculateMdrThresholds(
      { open: 2.1, high: 4.2, close: 3 },
      0.4,
    );

    expect(thresholds).toEqual({
      pmPriceNeeded: 3.4,
      openingGapNeededPercent: 13.33,
      intradayPriceNeeded: 3.4,
      basisPrice: 3.4,
      atr14: 0.4,
    });
  });

  it('returns null thresholds when ATR is unavailable', () => {
    expect(calculateMdrThresholds({ open: 2, high: 3, close: 2.5 }, null)).toEqual({
      pmPriceNeeded: null,
      openingGapNeededPercent: null,
      intradayPriceNeeded: null,
      basisPrice: null,
      atr14: null,
    });
  });

  it('evaluates a daily series and returns null thresholds on insufficient history', () => {
    const evaluation = evaluateD2MdrDailySeries('mdr', dailyBarsFromGrouped(structuralPriorBars().slice(0, 10)));

    expect(evaluation.triggered).toBe(false);
    expect(evaluation.reason).toBe('insufficient_history');
    expect(evaluation.thresholds).toEqual({
      pmPriceNeeded: null,
      openingGapNeededPercent: null,
      intradayPriceNeeded: null,
      basisPrice: null,
      atr14: null,
    });
  });
});
