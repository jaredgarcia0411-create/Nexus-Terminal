import { describe, expect, it } from 'vitest';
import { UNKNOWN_EARNINGS_READ } from '@/lib/triple-beat/classify';
import { evaluateTripleBeatSetup, gapBucket, measureTripleBeatOutcome, passesReplayPrefilter } from '@/lib/triple-beat/scan';
import { getPreviousTradingSession } from '@/lib/time-utils';
import type { DailyOhlcBar } from '@/lib/massive-market';
const dates: string[] = [];
let cursor = '2026-10-29';
for (let i = 0; i < 80; i += 1) { cursor = getPreviousTradingSession(cursor)!; dates.unshift(cursor); }
const history: DailyOhlcBar[] = dates.map((date) => ({ date, open: 19.9, high: 20.4, low: 19.6, close: 20, volume: 2_000_000, vwap: null }));
const extended = { last: 23, high: 23.4, low: 21.5, volume: 800000, premarketHigh: 23.4, premarketLow: 22.6 };
const STRICT = { ...UNKNOWN_EARNINGS_READ, epsBeat: 'yes' as const, revenueBeat: 'yes' as const, guidance: 'raised' as const };
const plan = evaluateTripleBeatSetup(history, extended, STRICT)!.plan!;
const day = (overrides: Partial<DailyOhlcBar>): DailyOhlcBar => ({ date: '2026-10-29', open: 23.1, high: 25.2, low: 23, close: 25, volume: 2000000, vwap: null, ...overrides });

describe('Triple Beat scoring', () => {
  it('scores a strict triple beat at 90/90 with an A+ plan', () => {
    const setup = evaluateTripleBeatSetup(history, extended, STRICT)!;
    expect(setup).toMatchObject({ qualified: true, score: 90, maxScore: 90, grade: 'A+', strictTripleBeat: true, plan: { riskFraction: 1, entry: 23.4, stop: 22.6 } });
    expect(setup.plan!.riskPerShare).toBeCloseTo(0.8);
    expect(setup.plan!.riskAtr).toBeCloseTo(1);
    expect(setup.plan!.target1).toBeCloseTo(25);
    expect(setup.scoreItems.find((item) => item.label === 'Projected RVOL 3x+')?.status).toBe('unknown');
  });
  it('limits unverified earnings to B and watch only', () => {
    const setup = evaluateTripleBeatSetup(history, extended, UNKNOWN_EARNINGS_READ)!;
    expect(setup).toMatchObject({ score: 65, grade: 'B', plan: { riskFraction: 0 } });
    expect(setup.scoreItems.slice(0, 3).map((item) => item.status)).toEqual(['unknown', 'unknown', 'unknown']);
  });
  it('forces wide stops to watch only even at grade A', () => {
    const setup = evaluateTripleBeatSetup(history, { ...extended, premarketLow: 21, low: 21 }, STRICT)!;
    expect(setup).toMatchObject({ score: 80, grade: 'A', plan: { riskFraction: 0 } });
    expect(setup.plan!.riskAtr).toBeCloseTo(3);
    expect(setup.scoreItems.find((item) => item.label === 'Stop within 1.5 ATR')?.status).toBe('not met');
  });
  it('accepts faded gaps that reached +5% overnight and remain at or above the prior close', () => {
    const faded = evaluateTripleBeatSetup(history, { ...extended, last: 20.5 }, STRICT)!;
    expect(faded).toMatchObject({ qualified: true, failedFilters: [] });
    expect(faded.plan).not.toBeNull();
    expect(evaluateTripleBeatSetup(history, { ...extended, last: 20 }, STRICT)!.qualified).toBe(true);
  });
  it('rejects prices below the prior close or overnight highs below +5%', () => {
    expect(evaluateTripleBeatSetup(history, { ...extended, last: 19.9 }, STRICT)!.failedFilters).toContain('Below prior close');
    expect(evaluateTripleBeatSetup(history, {
      ...extended, high: 20.9, low: 20.3, premarketHigh: 20.9, premarketLow: 20.3, last: 20.5,
    }, STRICT)!.failedFilters).toEqual(['Overnight high < +5%']);
    expect(evaluateTripleBeatSetup(history, {
      ...extended, high: 21, low: 20.3, premarketHigh: 21, premarketLow: 20.3, last: 20.2,
    }, STRICT)!.qualified).toBe(true);
  });
  it('disqualifies low prices, illiquidity, and absent entry/stop', () => {
    expect(evaluateTripleBeatSetup(history, { ...extended, last: 2.9 }, STRICT)!.failedFilters).toContain('Price < $3');
    expect(evaluateTripleBeatSetup(history, { ...extended, last: 3 }, STRICT)!.failedFilters).not.toContain('Price < $3');
    expect(evaluateTripleBeatSetup(history.map((bar) => ({ ...bar, volume: 1 })), extended, STRICT)!.failedFilters).toContain('Dollar volume < $5M');
    expect(evaluateTripleBeatSetup(history, { ...extended, premarketLow: extended.premarketHigh }, STRICT)!.plan).toBeNull();
    expect(evaluateTripleBeatSetup(history.map((bar) => ({ ...bar, high: 20, low: 20 })), extended, STRICT)!.plan).toBeNull();
  });
  it('applies the $250M market-cap floor only when shares are known', () => {
    expect(evaluateTripleBeatSetup(history, extended, STRICT, 10_000_000)!.failedFilters).toContain('Market cap < $250M');
    expect(evaluateTripleBeatSetup(history, extended, STRICT, 20_000_000)).toMatchObject({
      qualified: true, metrics: { marketCap: 460_000_000 },
    });
    expect(evaluateTripleBeatSetup(history, extended, STRICT, null)).toMatchObject({ qualified: true, metrics: { marketCap: null } });
  });
  it('rejects stops tighter than 0.5 ATR', () => {
    expect(evaluateTripleBeatSetup(history, { ...extended, premarketLow: 23.1 }, STRICT)).toMatchObject({
      qualified: false, failedFilters: ['Stop < 0.5 ATR'], plan: null,
    });
    expect(evaluateTripleBeatSetup(history, { ...extended, premarketLow: 23 }, STRICT)!.qualified).toBe(true);
  });
  it('requires 61 bars', () => expect(evaluateTripleBeatSetup(history.slice(-60), extended, STRICT)).toBeNull());
  it('buckets gaps and applies replay liquidity and history floors', () => {
    expect([4, 9.99, 10, 3].map(gapBucket)).toEqual(['4-7.9', '8-9.9', '10+', '<4']);
    expect(passesReplayPrefilter(history.slice(-19))).toBe(false);
    expect(passesReplayPrefilter(history.map((bar) => ({ ...bar, volume: 1 })))).toBe(false);
    expect(passesReplayPrefilter(history)).toBe(true);
  });
});
describe('Triple Beat outcomes', () => {
  it('leaves outcomes null when entry never triggers', () => {
    expect(measureTripleBeatOutcome(history, plan, [day({ high: 23.3 })])).toMatchObject({ triggered: false, fill: null, totalR: null });
  });
  it('stops before targets on day zero', () => {
    expect(measureTripleBeatOutcome(history, plan, [day({ open: 23, high: 27, low: 22.5, close: 23.2 })])).toMatchObject({ fill: 23.4, stoppedOutDay0: true, dayR: -1, runnerR: -1, totalR: -1, daysHeld: 0, hit2R: false });
  });
  it('uses day-zero minute bars to take the 2R partial before a later stop', () => {
    const outcome = measureTripleBeatOutcome(history, plan, [day({ open: 23, high: 27, low: 22.5, close: 23.2 })], [
      { high: 23.5, low: 23 }, { high: 25.1, low: 24 }, { high: 24, low: 22.5 },
    ]);
    expect(outcome).toMatchObject({ stoppedOutDay0: true, hit2R: true, dayR: -1, runnerR: -1, daysHeld: 0 });
    expect(outcome.totalR).toBeCloseTo(0.5);
  });
  it('ignores day-zero dips below the stop before the entry triggers', () => {
    const outcome = measureTripleBeatOutcome(history, plan, [day({ low: 22.5 })], [
      { high: 23.2, low: 22.5 }, { high: 23.6, low: 23.1 }, { high: 25.2, low: 24 },
    ]);
    expect(outcome).toMatchObject({ stoppedOutDay0: false, hit2R: true, openAtEnd: true });
    expect(outcome.totalR).toBeCloseTo(2);
  });
  it('takes a 2R partial and exits the runner below the EMA', () => {
    const outcome = measureTripleBeatOutcome(history, plan, [day({}), day({ open: 25, high: 26.2, low: 25.1, close: 26 }), day({ high: 27.2, low: 26.1, close: 27 }), day({ high: 28.2, low: 27.1, close: 28 }), day({ open: 24, high: 24.2, low: 23, close: 23.2 })]);
    expect(outcome).toMatchObject({ hit2R: true, daysHeld: 4, openAtEnd: false });
    expect(outcome.dayR).toBeCloseTo(2);
    expect(outcome.runnerR).toBeCloseTo(-0.25);
    expect(outcome.totalR).toBeCloseTo(0.875);
  });
  it('fills opening gaps at the open and marks an unclosed runner', () => {
    const outcome = measureTripleBeatOutcome(history, plan, [day({ open: 24, low: 23.5, high: 25, close: 24.5 })]);
    expect(outcome).toMatchObject({ fill: 24, openAtEnd: true, daysHeld: 0, hit2R: false });
    expect(outcome.dayR).toBeCloseTo(0.5 / 1.4);
  });
});
