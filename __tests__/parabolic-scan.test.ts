import { describe, expect, it } from 'vitest';
import { evaluateParabolicSetup, measureReplayOutcome, passesLivePrefilter, passesReplayPrefilter } from '@/lib/parabolic/scan';
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

  it('uses a loose live prefilter but still requires the green streak', () => {
    const bars = fixture(20);
    expect(passesLivePrefilter(bars)).toBe(true);
    bars[bars.length - 1] = { ...bars[bars.length - 1], open: 17, close: 16.5 };
    expect(passesLivePrefilter(bars)).toBe(false);
  });

  it('applies the known opening gap in the replay prefilter', () => {
    expect(passesReplayPrefilter(fixture(20), 18)).toBe(true);
    expect(passesReplayPrefilter(fixture(20), 17.2)).toBe(false);
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
