import { atr, ema } from '@/lib/indicators';
import type { DailyOhlcBar } from '@/lib/massive-market';

// Research thresholds from the parabolic short playbook. Provisional until the replay validates them.
const RULES = {
  minPrice: 5,
  minAvgVolume: 1_000_000,
  minGreenDays: 3,
  minGapPct: 3,
  minExt10Pct: 30,
  preferredExt20Pct: 40,
  preferredAtrAbove50: 8,
  minGapUpStreak: 2,
  minExpansions: 2,
  parabolicMin3DayPct: 20,
  parabolicSteepening: 2,
  stopBufferAtr: 0.1,
  sma10Period: 10,
  sma20Period: 20,
  sma50Period: 50,
  atrPeriod: 14,
  emaPeriod: 9,
  // Loose live prefilter: a 3%+ premarket gap can still lift these over the real thresholds.
  livePrefilterMinClose: 4.5,
  livePrefilterMinSma10Ratio: 1.15,
};

export const MIN_HISTORY_BARS = 20;
export const MAX_PREMARKET_SCORE = 17;

export type ParabolicGrade = 'A' | 'B' | 'C' | 'Pass';
export type ScoreItemStatus = 'met' | 'not met' | 'unknown';

export interface ScoreItem {
  label: string;
  points: number;
  maxPoints: number;
  status: ScoreItemStatus;
}

export interface ParabolicMetrics {
  referencePrice: number;
  priorClose: number;
  avgVolume20: number;
  greenStreak: number;
  gapUpStreak: number;
  tradeDayGapPct: number;
  ext10Pct: number;
  ext20Pct: number;
  atrAbove50: number | null;
  atr14: number;
  ema9: number;
  change3Pct: number;
  change5Pct: number;
  change10Pct: number;
  rangeExpansions: number;
  volumeExpansions: number;
}

export interface ParabolicPlan {
  riskFraction: 1 | 0.5 | 0;
  entry: number;
  stop: number;
  riskPerShare: number;
  target1: number;
  target1RR: number | null;
  target2: number;
  target2RR: number | null;
}

export interface ParabolicSetup {
  qualified: boolean;
  failedFilters: string[];
  grade: ParabolicGrade;
  score: number;
  maxScore: number;
  scoreItems: ScoreItem[];
  metrics: ParabolicMetrics;
  plan: ParabolicPlan | null;
}

export interface TradeDayInput {
  referencePrice: number;
  highSoFar: number;
}

export interface ParabolicScanReport {
  tradingDate: string;
  asOf: string;
  candidatesChecked: number;
  setups: Array<ParabolicSetup & { ticker: string; plan: ParabolicPlan }>;
}

export interface ReplayOutcome {
  stoppedOutDay0: boolean;
  dayR: number;
  mfeDayR: number;
  maeDayR: number;
  mfe10R: number;
  mae10R: number;
  daysTo9Ema: number | null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctChange(from: number, to: number): number {
  return (to / from - 1) * 100;
}

function countExpansions(values: number[]): number {
  const lastFour = values.slice(-4);
  let count = 0;
  for (let i = 1; i < lastFour.length; i += 1) {
    if (lastFour[i] > lastFour[i - 1]) count += 1;
  }
  return count;
}

function hasGreenStreakAndVolume(bars: DailyOhlcBar[]): boolean {
  return bars.length >= MIN_HISTORY_BARS
    && bars.slice(-RULES.minGreenDays).every((bar) => bar.close > bar.open)
    && mean(bars.slice(-RULES.sma20Period).map((bar) => bar.volume)) >= RULES.minAvgVolume;
}

function gradeFor(score: number): ParabolicGrade {
  if (score >= 16) return 'A';
  if (score >= 12) return 'B';
  if (score >= 8) return 'C';
  return 'Pass';
}

// Live: premarket price is unknown at prefilter time, so this is intentionally looser than the real filters.
export function passesLivePrefilter(bars: DailyOhlcBar[]): boolean {
  if (!hasGreenStreakAndVolume(bars)) return false;
  const priorClose = bars[bars.length - 1].close;
  const sma10 = mean(bars.slice(-RULES.sma10Period).map((bar) => bar.close));
  return priorClose >= RULES.livePrefilterMinClose && priorClose >= sma10 * RULES.livePrefilterMinSma10Ratio;
}

// Replay: the trade-day open is known, so apply the exact mandatory price/gap/extension filters.
export function passesReplayPrefilter(bars: DailyOhlcBar[], tradeOpen: number): boolean {
  if (!hasGreenStreakAndVolume(bars)) return false;
  const priorClose = bars[bars.length - 1].close;
  const sma10 = mean(bars.slice(-RULES.sma10Period).map((bar) => bar.close));
  return tradeOpen >= RULES.minPrice
    && pctChange(priorClose, tradeOpen) >= RULES.minGapPct
    && pctChange(sma10, tradeOpen) >= RULES.minExt10Pct;
}

export function evaluateParabolicSetup(history: DailyOhlcBar[], tradeDay: TradeDayInput): ParabolicSetup | null {
  const bars = history.slice(-60);
  const n = bars.length;
  if (n < MIN_HISTORY_BARS) return null;

  const prior = bars[n - 1];
  const closes = bars.map((bar) => bar.close);
  const { referencePrice, highSoFar } = tradeDay;
  const atr14 = atr(bars.map((bar, index) => ({
    time: index, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
  })), RULES.atrPeriod)[n - 1] ?? 0;
  const ema9 = ema(closes, RULES.emaPeriod)[n - 1] ?? prior.close;
  let greenStreak = 0;
  for (let i = n - 1; i >= 0 && bars[i].close > bars[i].open; i -= 1) greenStreak += 1;
  let gapUpStreak = 0;
  for (let i = n - 1; i >= 1 && bars[i].open > bars[i - 1].close; i -= 1) gapUpStreak += 1;

  const metrics: ParabolicMetrics = {
    referencePrice,
    priorClose: prior.close,
    avgVolume20: mean(bars.slice(-RULES.sma20Period).map((bar) => bar.volume)),
    greenStreak,
    gapUpStreak,
    tradeDayGapPct: pctChange(prior.close, referencePrice),
    ext10Pct: pctChange(mean(closes.slice(-RULES.sma10Period)), referencePrice),
    ext20Pct: pctChange(mean(closes.slice(-RULES.sma20Period)), referencePrice),
    atrAbove50: n < RULES.sma50Period ? null : (referencePrice - mean(closes.slice(-RULES.sma50Period))) / atr14,
    atr14,
    ema9,
    change3Pct: pctChange(closes[n - 4], prior.close),
    change5Pct: pctChange(closes[n - 6], prior.close),
    change10Pct: pctChange(closes[n - 11], prior.close),
    rangeExpansions: countExpansions(bars.map((bar) => bar.high - bar.low)),
    volumeExpansions: countExpansions(bars.map((bar) => bar.volume)),
  };
  const failedFilters: string[] = [];
  if (referencePrice < RULES.minPrice) failedFilters.push('Price < $5');
  if (metrics.avgVolume20 < RULES.minAvgVolume) failedFilters.push('Avg volume < 1M');
  if (greenStreak < RULES.minGreenDays) failedFilters.push('< 3 green days');
  if (metrics.tradeDayGapPct < RULES.minGapPct) failedFilters.push('Gap < 3%');
  if (metrics.ext10Pct < RULES.minExt10Pct) failedFilters.push('< 30% above 10SMA');
  const qualified = failedFilters.length === 0;
  const cleanParabolic = closes.slice(-3).every((close, index) => close > closes[n - 4 + index])
    && metrics.change3Pct >= RULES.parabolicMin3DayPct
    && metrics.change3Pct >= RULES.parabolicSteepening * Math.max(pctChange(closes[n - 7], closes[n - 4]), 0);
  const maExtension: ScoreItemStatus = metrics.ext20Pct < RULES.preferredExt20Pct ? 'not met'
    : metrics.atrAbove50 === null ? 'unknown'
      : metrics.atrAbove50 >= RULES.preferredAtrAbove50 ? 'met' : 'not met';
  const items: Array<[string, number, boolean | ScoreItemStatus]> = [
    ['3+ consecutive green days', 2, greenStreak >= RULES.minGreenDays],
    ['Trade-day gap-up', 3, metrics.tradeDayGapPct >= RULES.minGapPct],
    ['2+ consecutive gap-ups', 2, gapUpStreak >= RULES.minGapUpStreak],
    ['Accelerating daily ranges', 3, metrics.rangeExpansions >= RULES.minExpansions],
    ['Increasing daily volume', 2, metrics.volumeExpansions >= RULES.minExpansions],
    ['Significant MA extension', 2, maExtension],
    ['Opening volume climax', 2, 'unknown'],
    ['Clean parabolic structure', 3, cleanParabolic],
  ];
  const scoreItems = items.map(([label, maxPoints, condition]): ScoreItem => {
    const status = typeof condition === 'boolean' ? (condition ? 'met' : 'not met') : condition;
    return { label, maxPoints, status, points: status === 'met' ? maxPoints : 0 };
  });
  const score = scoreItems.reduce((sum, item) => sum + item.points, 0);
  const grade = gradeFor(score);
  const stop = Math.max(highSoFar, referencePrice) + RULES.stopBufferAtr * atr14;
  const riskPerShare = stop - referencePrice;
  const plan: ParabolicPlan | null = !qualified || riskPerShare <= 0 ? null : {
    riskFraction: grade === 'A' ? 1 : grade === 'B' ? 0.5 : 0,
    entry: referencePrice,
    stop,
    riskPerShare,
    target1: prior.close,
    target1RR: prior.close < referencePrice ? (referencePrice - prior.close) / riskPerShare : null,
    target2: ema9,
    target2RR: ema9 < referencePrice ? (referencePrice - ema9) / riskPerShare : null,
  };
  return { qualified, failedFilters, grade, score, maxScore: MAX_PREMARKET_SCORE, scoreItems, metrics, plan };
}

export function measureReplayOutcome(history: DailyOhlcBar[], plan: ParabolicPlan, sessions: DailyOhlcBar[]): ReplayOutcome {
  const day0 = sessions[0];
  const risk = plan.riskPerShare;
  const window = sessions.slice(0, 11);
  const stoppedOutDay0 = day0.high >= plan.stop;
  // Daily bars cannot establish stop/low ordering, so a touched stop counts as -1R.
  const dayR = stoppedOutDay0 ? -1 : (plan.entry - day0.close) / risk;
  const mfeDayR = (plan.entry - day0.low) / risk;
  const maeDayR = (day0.high - plan.entry) / risk;
  const mfe10R = (plan.entry - Math.min(...window.map((bar) => bar.low))) / risk;
  const mae10R = (Math.max(...window.map((bar) => bar.high)) - plan.entry) / risk;
  const closes = history.map((bar) => bar.close);
  let daysTo9Ema: number | null = null;
  for (let k = 0; k < window.length; k += 1) {
    const ema9 = ema(closes, RULES.emaPeriod).at(-1);
    if (ema9 != null && window[k].low <= ema9) {
      daysTo9Ema = k;
      break;
    }
    closes.push(window[k].close);
  }
  return { stoppedOutDay0, dayR, mfeDayR, maeDayR, mfe10R, mae10R, daysTo9Ema };
}
