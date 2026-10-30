import { describe, expect, it } from 'vitest';
import { evaluateParabolicSetup, measureIntradayTriggers, measureReplayOutcome, passesLivePrefilter, passesReplayPrefilter } from '@/lib/parabolic/scan';
import type { OHLCData } from '@/lib/indicators';
import type { DailyOhlcBar } from '@/lib/massive-market';

function bar(date: string, open: number, high: number, low: number, close: number, volume = 1_500_000): DailyOhlcBar {
  return { date, open, high, low, close, volume, vwap: null };
}

function fixture(count: number): DailyOhlcBar[] {
  const values = [
    ...Array.from({ length: count - 4 }, () => [10, 10.2, 9.8, 10, 1_500_000]),
    [10.1, 10.6, 10.0, 10.5, 2_000_000],
    [10.8, 11.6, 10.7, 11.5, 3_000_000],
    [12.0, 13.6, 11.9, 13.5, 5_000_000],
    [14.0, 17.2, 13.9, 17.0, 9_000_000],
  ];
  return values.map(([open, high, low, close, volume], index) =>
    bar(new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open, high, low, close, volume));
}

describe('parabolic scoring', () => {
  it('requires at least 20 completed history bars', () => {
    expect(evaluateParabolicSetup(fixture(19), { referencePrice: 18, highSoFar: 18.5 })).toBeNull();
  });

  it('scores a 20-bar setup as B while leaving unavailable measurements unknown', () => {
    const setup = evaluateParabolicSetup(fixture(20), { referencePrice: 18, highSoFar: 18.5 });
    expect(setup).toMatchObject({ qualified: true, score: 15, maxScore: 17, grade: 'B', plan: { riskFraction: 0.5 } });
    expect(setup?.scoreItems.filter((item) => item.status === 'unknown').map((item) => item.label))
      .toEqual(['Significant MA extension', 'Opening volume climax']);
    expect(setup?.metrics).toMatchObject({ greenStreak: 4, gapUpStreak: 4, rangeExpansions: 3, volumeExpansions: 3 });
  });

  it('scores a 50-bar setup as A and builds the provisional short plan', () => {
    const setup = evaluateParabolicSetup(fixture(50), { referencePrice: 18, highSoFar: 18.5 })!;
    expect(setup).toMatchObject({ qualified: true, score: 17, maxScore: 17, grade: 'A', plan: { riskFraction: 1, entry: 18, target1: 17 } });
    expect(setup.plan!.stop).toBeCloseTo(18.5 + 0.1 * setup.metrics.atr14);
    expect(setup.plan!.riskPerShare).toBeCloseTo(setup.plan!.stop - 18);
    expect(setup.plan!.target1RR).toBeCloseTo(1 / setup.plan!.riskPerShare);
  });

  it('rejects a trade-day gap below 3% and omits the plan', () => {
    expect(evaluateParabolicSetup(fixture(20), { referencePrice: 17.2, highSoFar: 18.5 }))
      .toMatchObject({ qualified: false, failedFilters: ['Gap < 3%'], plan: null });
  });

  it('uses a loose live prefilter but still requires two of the last three days green', () => {
    const bars = fixture(20);
    expect(passesLivePrefilter(bars)).toBe(true);
    bars[bars.length - 1] = { ...bars[bars.length - 1], open: 17, close: 16.5 };
    expect(passesLivePrefilter(bars)).toBe(true);
    bars[bars.length - 2] = { ...bars[bars.length - 2], open: 14, close: 13.5 };
    expect(passesLivePrefilter(bars)).toBe(false);
  });

  it('qualifies with one red bar among the last three without awarding the green-streak score', () => {
    const bars = fixture(20);
    bars[bars.length - 2] = { ...bars[bars.length - 2], open: 13.6 };
    const setup = evaluateParabolicSetup(bars, { referencePrice: 18, highSoFar: 18.5 })!;
    expect(setup.qualified).toBe(true);
    expect(setup.failedFilters).not.toContain('< 2 of last 3 green');
    expect(setup.scoreItems.find((item) => item.label === '3+ consecutive green days')?.status).toBe('not met');
  });

  it('qualifies via a five-day gain when extension above the current-price 10SMA is under 25%', () => {
    const bars = fixture(20);
    for (let i = 0; i < bars.length - 5; i += 1) {
      bars[i] = { ...bars[i], open: 17.9, high: 18.2, low: 17.8, close: 18 };
    }
    const setup = evaluateParabolicSetup(bars, { referencePrice: 18, highSoFar: 18.5 })!;
    expect(setup.qualified).toBe(true);
    expect(setup.metrics.ext10Pct).toBeCloseTo((18 / 15.25 - 1) * 100);
    expect(setup.metrics.ext10Pct).toBeLessThan(25);
    expect(setup.metrics.gain5Pct).toBeCloseTo(80);
    expect(passesReplayPrefilter(bars, 18)).toBe(true);
    expect(passesLivePrefilter(bars)).toBe(true);
  });

  it('applies the known opening gap in the replay prefilter', () => {
    expect(passesReplayPrefilter(fixture(20), 18)).toBe(true);
    expect(passesReplayPrefilter(fixture(20), 17.2)).toBe(false);
  });

  it('rejects a setup when both extension and five-day gain are below their floors', () => {
    const bars = fixture(20).map((bar) => ({ ...bar, open: 17.9, high: 18.2, low: 17.8, close: 18 }));
    expect(evaluateParabolicSetup(bars, { referencePrice: 19, highSoFar: 19.5 })).toMatchObject({
      qualified: false, failedFilters: ['< 25% above 10SMA and < 35% in 5 days'], plan: null,
    });
    expect(passesReplayPrefilter(bars, 19)).toBe(false);
  });

  it('uses only the last 60 history bars', () => {
    const history = fixture(70);
    expect(evaluateParabolicSetup(history, { referencePrice: 18, highSoFar: 18.5 }))
      .toEqual(evaluateParabolicSetup(history.slice(-60), { referencePrice: 18, highSoFar: 18.5 }));
  });
});

describe('parabolic replay outcome', () => {
  it('measures daily/forward excursions and the first touch of the preceding 9EMA', () => {
    const history = fixture(50);
    const { plan } = evaluateParabolicSetup(history, { referencePrice: 18, highSoFar: 18.5 })!;
    const sessions = [bar('2026-04-07', 18, 18.3, 15, 15.5), bar('2026-04-08', 15, 15.2, 11.5, 12)];
    const outcome = measureReplayOutcome(history, plan!, sessions);
    expect(outcome).toMatchObject({ stoppedOutDay0: false, daysTo9Ema: 1 });
    expect(outcome.dayR).toBeCloseTo(2.5 / plan!.riskPerShare);
    expect(outcome.mfeDayR).toBeCloseTo(3 / plan!.riskPerShare);
    expect(outcome.maeDayR).toBeCloseTo(0.3 / plan!.riskPerShare);
    expect(outcome.mfe10R).toBeCloseTo(6.5 / plan!.riskPerShare);
    expect(outcome.mae10R).toBeCloseTo(0.3 / plan!.riskPerShare);
    expect(measureReplayOutcome(history, plan!, [{ ...sessions[0], high: 19 }, sessions[1]]))
      .toMatchObject({ stoppedOutDay0: true, dayR: -1 });
  });
});

describe('parabolic intraday triggers', () => {
  const OPEN = Date.UTC(2026, 3, 7, 13, 30);
  const plan = { riskFraction: 1 as const, entry: 18, stop: 19, riskPerShare: 1, target1: 15, target1RR: 3, target2: 14, target2RR: 4 };
  function minute(offset: number, open: number, high: number, low: number, close: number, volume = 1000): OHLCData {
    return { time: OPEN + offset * 60_000, open, high, low, close, volume };
  }
  function repeat(from: number, to: number, open: number, high: number, low: number, close: number): OHLCData[] {
    return Array.from({ length: to - from + 1 }, (_, i) => minute(from + i, open, high, low, close));
  }

  const base = [
    minute(-60, 17, 17, 17, 17, 100_000),
    minute(0, 18, 18.6, 17.9, 18.3),
    ...repeat(1, 4, 18.2, 18.3, 18.0, 18.1),
    ...repeat(5, 9, 18.1, 18.2, 18.0, 18.1),
    minute(10, 18.1, 18.2, 17.8, 18.0),
    ...repeat(11, 14, 18.1, 18.2, 18.0, 18.1),
    ...repeat(15, 19, 18.0, 18.1, 17.9, 18.0),
    minute(20, 17.9, 18.0, 16.8, 16.9),
    ...repeat(21, 29, 16.9, 17.0, 16.7, 16.8),
  ];

  it('triggers each entry and covers at the close when no stop is touched', () => {
    const outcomes = measureIntradayTriggers(plan, 1, base, OPEN, 17);
    expect(outcomes.or5.minutesAfterOpen).toBeCloseTo(10);
    expect(outcomes.or5.entry).toBeCloseTo(17.9);
    expect(outcomes.or5.hodStop).toBeCloseTo(18.7);
    expect(outcomes.or5.hodR).toBeCloseTo(1.125);
    expect(outcomes.or5.pmR).toBeCloseTo(0.9 / 1.1);
    expect(outcomes.or15.minutesAfterOpen).toBeCloseTo(20);
    expect(outcomes.or15.entry).toBeCloseTo(17.8);
    expect(outcomes.or15.hodStop).toBeCloseTo(18.7);
    expect(outcomes.or15.hodR).toBeCloseTo(0.8 / 0.9);
    expect(outcomes.or15.pmR).toBeCloseTo(0.8 / 1.2);
    expect(outcomes.vwap.minutesAfterOpen).toBeCloseTo(20);
    expect(outcomes.vwap.entry).toBeCloseTo(16.9);
    expect(outcomes.vwap.hodStop).toBeCloseTo(18.7);
    expect(outcomes.vwap.hodR).toBeCloseTo(-0.1 / 1.8);
    expect(outcomes.vwap.pmR).toBeCloseTo(-0.1 / 2.1);
    expect(outcomes.belowVwap).toEqual(outcomes.vwap);
  });

  it('stops the HOD stop but not the premarket stop after the trigger', () => {
    const outcomes = measureIntradayTriggers(plan, 1, [...base, minute(90, 17.5, 18.75, 17.4, 17.6)], OPEN, 17);
    for (const outcome of Object.values(outcomes)) expect(outcome.hodR).toBe(-1);
    expect(outcomes.or5.pmR).toBeCloseTo(0.9 / 1.1);
    expect(outcomes.or15.pmR).toBeCloseTo(0.8 / 1.2);
    expect(outcomes.vwap.pmR).toBeCloseTo(-0.1 / 2.1);
    expect(outcomes.belowVwap.pmR).toBeCloseTo(-0.1 / 2.1);
  });

  it('ignores breaks at or after 10:30 ET', () => {
    const bars = [
      minute(-60, 17, 17, 17, 17, 100_000),
      minute(0, 18, 18.6, 17.9, 18.3),
      ...repeat(1, 59, 18.2, 18.3, 18.0, 18.1),
      minute(60, 18.0, 18.0, 16.5, 16.6),
    ];
    const outcomes = measureIntradayTriggers(plan, 1, bars, OPEN, 17);
    for (const outcome of Object.values(outcomes)) {
      expect(outcome).toEqual({ minutesAfterOpen: null, entry: null, hodStop: null, hodR: null, pmR: null });
    }
  });

  it('fires belowVwap but not vwap when the open never trades above VWAP, skipping a stop under 0.5 ATR away', () => {
    const bars = [
      minute(-60, 20, 20, 20, 20, 100_000),
      minute(0, 18, 18.6, 17.9, 18.3),
      ...repeat(1, 29, 18.2, 18.3, 18.0, 18.1),
    ];
    const outcomes = measureIntradayTriggers(plan, 1, bars, OPEN, 17);
    expect(outcomes.belowVwap.minutesAfterOpen).toBeCloseTo(0);
    expect(outcomes.belowVwap.entry).toBeCloseTo(18.3);
    expect(outcomes.belowVwap.hodStop).toBeCloseTo(18.7);
    expect(outcomes.belowVwap.hodR).toBeNull();
    expect(outcomes.belowVwap.pmR).toBeCloseTo(1.3 / 0.7);
    for (const trigger of ['or5', 'or15', 'vwap'] as const) {
      expect(outcomes[trigger]).toEqual({ minutesAfterOpen: null, entry: null, hodStop: null, hodR: null, pmR: null });
    }
  });
});
