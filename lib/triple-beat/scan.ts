import { atr, ema } from '@/lib/indicators';
import type { DailyOhlcBar } from '@/lib/massive-market';
import type { ScoreItem, ScoreItemStatus } from '@/lib/parabolic/scan';
import type { EarningsRead } from '@/lib/triple-beat/classify';
import type { ExtendedHoursStats } from '@/lib/triple-beat/data';

// Thresholds from the Triple Beat Earnings playbook v1.0. Provisional until the replay validates them.
const RULES = {
  minPrice: 5,
  minDollarVolume: 5_000_000,
  minGapPct: 4,
  bigGapPct: 10,
  preferredPrice: 10,
  preferredDollarVolume: 20_000_000,
  basePeriod: 60,
  maxBaseRangePct: 40,
  runUpPeriod: 20,
  maxRunUpPct: 20,
  minExtendedVolumeRatio: 0.25,
  minHoldPct: 65,
  maxStopAtr: 1.5,
  target1R: 2,
  atrPeriod: 14,
  trailEmaPeriod: 10,
  maxSwingSessions: 60,
  outcomeWindow: 20,
  // Loose live prefilter on the market snapshot; the exact filters run after the per-ticker fetch.
  livePrefilterMinGapPct: 3.5,
  livePrefilterMinClose: 4.5,
  livePrefilterMinDollarVolume: 1_000_000,
};

export const MIN_HISTORY_BARS = 61;
export const MAX_PREMARKET_SCORE = 90;

export type TripleBeatGrade = 'A+' | 'A' | 'B' | 'Pass';
export type GapBucket = '<4' | '4-7.9' | '8-9.9' | '10+';

export interface TripleBeatMetrics {
  referencePrice: number;
  priorClose: number;
  gapPct: number;
  holdPct: number;
  extendedVolumeRatio: number;
  avgVolume20: number;
  avgDollarVolume20: number;
  baseHigh: number;
  baseRangePct: number;
  runUpPct: number;
  atr14: number;
  ema10: number;
}

export interface TripleBeatPlan {
  riskFraction: 1 | 0.5 | 0;
  entry: number;
  stop: number;
  riskPerShare: number;
  riskAtr: number;
  target1: number;
}

export interface TripleBeatSetup {
  qualified: boolean;
  failedFilters: string[];
  grade: TripleBeatGrade;
  score: number;
  maxScore: number;
  scoreItems: ScoreItem[];
  metrics: TripleBeatMetrics;
  plan: TripleBeatPlan | null;
  earnings: EarningsRead;
  strictTripleBeat: boolean;
}

export interface TripleBeatScanReport {
  tradingDate: string;
  asOf: string;
  gappersChecked: number;
  earningsFilings: number;
  setups: Array<TripleBeatSetup & { ticker: string; plan: TripleBeatPlan }>;
}

export interface TripleBeatOutcome {
  triggered: boolean;
  fill: number | null;
  stoppedOutDay0: boolean | null;
  dayR: number | null;
  hit2R: boolean | null;
  runnerR: number | null;
  totalR: number | null;
  daysHeld: number | null;
  openAtEnd: boolean | null;
  mfe20R: number | null;
  mae20R: number | null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctChange(from: number, to: number): number {
  return (to / from - 1) * 100;
}

function gradeFor(score: number): TripleBeatGrade {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  return 'Pass';
}

export function gapBucket(gapPct: number): GapBucket {
  if (gapPct >= 10) return '10+';
  if (gapPct >= 8) return '8-9.9';
  if (gapPct >= 4) return '4-7.9';
  return '<4';
}

export function passesLivePrefilter(snapshot: { gapPct: number; priorClose: number; priorVolume: number }): boolean {
  return snapshot.gapPct >= RULES.livePrefilterMinGapPct
    && snapshot.priorClose >= RULES.livePrefilterMinClose
    && snapshot.priorClose * snapshot.priorVolume >= RULES.livePrefilterMinDollarVolume;
}

// Replay: the trade-day open is known, so apply the exact price/gap/dollar-volume floors.
export function passesReplayPrefilter(bars: DailyOhlcBar[], tradeOpen: number): boolean {
  if (bars.length < 20) return false;
  const priorClose = bars[bars.length - 1].close;
  return tradeOpen >= RULES.minPrice
    && pctChange(priorClose, tradeOpen) >= RULES.minGapPct
    && mean(bars.slice(-20).map((bar) => bar.volume * bar.close)) >= RULES.minDollarVolume;
}

export function evaluateTripleBeatSetup(
  history: DailyOhlcBar[],
  extended: ExtendedHoursStats,
  earnings: EarningsRead,
): TripleBeatSetup | null {
  const bars = history.slice(-260);
  const n = bars.length;
  if (n < MIN_HISTORY_BARS) return null;

  const prior = bars[n - 1];
  const closes = bars.map((bar) => bar.close);
  const base = bars.slice(-RULES.basePeriod);
  const baseHigh = Math.max(...base.map((bar) => bar.high));
  const baseLow = Math.min(...base.map((bar) => bar.low));
  const last20 = bars.slice(-20);
  const avgVolume20 = mean(last20.map((bar) => bar.volume));
  const atr14 = atr(bars.map((bar, index) => ({
    time: index, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
  })), RULES.atrPeriod)[n - 1] ?? 0;
  const metrics: TripleBeatMetrics = {
    referencePrice: extended.last,
    priorClose: prior.close,
    gapPct: pctChange(prior.close, extended.last),
    holdPct: extended.high === extended.low ? 100 : ((extended.last - extended.low) / (extended.high - extended.low)) * 100,
    extendedVolumeRatio: extended.volume / avgVolume20,
    avgVolume20,
    avgDollarVolume20: mean(last20.map((bar) => bar.volume * bar.close)),
    baseHigh,
    baseRangePct: pctChange(baseLow, baseHigh),
    runUpPct: pctChange(closes[n - 1 - RULES.runUpPeriod], prior.close),
    atr14,
    ema10: ema(closes, RULES.trailEmaPeriod)[n - 1] ?? prior.close,
  };
  const entry = extended.premarketHigh;
  const stop = extended.premarketLow;
  const riskPerShare = entry - stop;
  const riskAtr = atr14 > 0 ? riskPerShare / atr14 : Number.POSITIVE_INFINITY;

  const failedFilters: string[] = [];
  if (metrics.referencePrice < RULES.minPrice) failedFilters.push('Price < $5');
  if (metrics.avgDollarVolume20 < RULES.minDollarVolume) failedFilters.push('Dollar volume < $5M');
  if (metrics.gapPct < RULES.minGapPct) failedFilters.push('Gap < 4%');
  if (riskPerShare <= 0 || atr14 <= 0) failedFilters.push('No entry/stop');
  const qualified = failedFilters.length === 0;

  const beat = (status: EarningsRead['epsBeat']): ScoreItemStatus => (
    status === 'yes' ? 'met' : status === 'no' ? 'not met' : 'unknown'
  );
  const items: Array<[string, number, boolean | ScoreItemStatus]> = [
    ['EPS beat', 8, beat(earnings.epsBeat)],
    ['Revenue beat', 8, beat(earnings.revenueBeat)],
    ['Guidance raised', 9, earnings.guidance === 'raised' ? 'met' : earnings.guidance === 'unknown' ? 'unknown' : 'not met'],
    ['3-month base', 8, metrics.baseRangePct <= RULES.maxBaseRangePct],
    ['Clears 3-month high', 8, metrics.referencePrice > baseHigh],
    ['Not extended into earnings', 4, metrics.runUpPct <= RULES.maxRunUpPct],
    ['Heavy extended-hours volume', 10, metrics.extendedVolumeRatio >= RULES.minExtendedVolumeRatio],
    ['Projected RVOL 3x+', 10, 'unknown'],
    ['Gap 10%+', 8, metrics.gapPct >= RULES.bigGapPct],
    ['Holding near highs', 7, metrics.holdPct >= RULES.minHoldPct],
    ['Stop within 1.5 ATR', 10, riskPerShare > 0 && riskAtr <= RULES.maxStopAtr],
    ['Price $10+', 4, metrics.referencePrice >= RULES.preferredPrice],
    ['$20M+ dollar volume', 6, metrics.avgDollarVolume20 >= RULES.preferredDollarVolume],
  ];
  const scoreItems = items.map(([label, maxPoints, condition]): ScoreItem => {
    const status = typeof condition === 'boolean' ? (condition ? 'met' : 'not met') : condition;
    return { label, maxPoints, status, points: status === 'met' ? maxPoints : 0 };
  });
  const score = scoreItems.reduce((sum, item) => sum + item.points, 0);
  const grade = gradeFor(score);
  const plan: TripleBeatPlan | null = !qualified ? null : {
    riskFraction: riskAtr > RULES.maxStopAtr ? 0 : grade === 'A+' ? 1 : grade === 'A' ? 0.5 : 0,
    entry,
    stop,
    riskPerShare,
    riskAtr,
    target1: entry + RULES.target1R * riskPerShare,
  };
  return {
    qualified,
    failedFilters,
    grade,
    score,
    maxScore: MAX_PREMARKET_SCORE,
    scoreItems,
    metrics,
    plan,
    earnings,
    strictTripleBeat: scoreItems.slice(0, 3).every((item) => item.status === 'met'),
  };
}

// Daily bars cannot order intraday events, so any day that touches the stop counts as stopped before the target.
export function measureTripleBeatOutcome(
  history: DailyOhlcBar[],
  plan: TripleBeatPlan,
  sessions: DailyOhlcBar[],
): TripleBeatOutcome {
  const day0 = sessions[0];
  if (day0.high < plan.entry) {
    return {
      triggered: false, fill: null, stoppedOutDay0: null, dayR: null, hit2R: null, runnerR: null,
      totalR: null, daysHeld: null, openAtEnd: null, mfe20R: null, mae20R: null,
    };
  }
  const fill = Math.max(day0.open, plan.entry);
  const risk = fill - plan.stop;
  const toR = (price: number) => (price - fill) / risk;
  const stoppedOutDay0 = day0.low <= plan.stop;
  const target = fill + RULES.target1R * risk;
  const window = sessions.slice(0, RULES.maxSwingSessions);
  const closes = history.map((bar) => bar.close);
  let hit2R = false;
  let exit: number | null = null;
  let daysHeld = window.length - 1;
  for (let k = 0; k < window.length; k += 1) {
    const bar = window[k];
    if (bar.low <= plan.stop) {
      exit = plan.stop;
      daysHeld = k;
      break;
    }
    if (bar.high >= target) hit2R = true;
    closes.push(bar.close);
    const ema10 = ema(closes, RULES.trailEmaPeriod).at(-1);
    if (k > 0 && ema10 != null && bar.close < ema10) {
      exit = bar.close;
      daysHeld = k;
      break;
    }
  }
  const runnerR = toR(exit ?? window[window.length - 1].close);
  const outcomeBars = sessions.slice(0, RULES.outcomeWindow);
  return {
    triggered: true,
    fill,
    stoppedOutDay0,
    dayR: stoppedOutDay0 ? -1 : toR(day0.close),
    hit2R,
    runnerR,
    totalR: hit2R ? 0.5 * RULES.target1R + 0.5 * runnerR : runnerR,
    daysHeld,
    openAtEnd: exit === null,
    mfe20R: toR(Math.max(...outcomeBars.map((bar) => bar.high))),
    mae20R: toR(Math.min(...outcomeBars.map((bar) => bar.low))),
  };
}
