import { atr, ema } from '@/lib/indicators';
import type { DailyOhlcBar } from '@/lib/massive-market';
import type { ScoreItem, ScoreItemStatus } from '@/lib/parabolic/scan';
import type { EarningsRead } from '@/lib/triple-beat/classify';
import type { ExtendedHoursStats } from '@/lib/triple-beat/data';

// Thresholds from the Triple Beat Earnings playbook v1.0; price, gap and market-cap floors match the coworker's thinkorswim scan.
const RULES = {
  minPrice: 3,
  minDollarVolume: 5_000_000,
  minMaxGapPct: 5,
  minCurrentGapPct: 0,
  minMarketCap: 250_000_000,
  preferredPrice: 10,
  basePeriod: 60,
  maxBaseRangePct: 40,
  runUpPeriod: 20,
  // Jul–Aug 2026 replay: stops under 0.5 ATR sat inside normal noise (71–90% stopped on day 0, −16R over 40 trades).
  minStopAtr: 0.5,
  target1R: 2,
  atrPeriod: 14,
  trailEmaPeriod: 10,
  maxSwingSessions: 60,
  outcomeWindow: 20,
};

export const MIN_HISTORY_BARS = 61;
// The old card entry rule (premarket-high break with 3x+ time-of-day RVOL), kept in the replay for comparison.
export const MIN_ENTRY_RVOL = 3;
export const RVOL_SESSIONS = 20;
export const MAX_PREMARKET_SCORE = 45;
// The card's exit since 2026-11-12: 2-minute opening range break, low-of-day stop, 3R target or the close. Trades whose
// stop is under 2% of price are skipped: in the replay, 0.1%/side slippage turned them from the edge into the loss.
export const MIN_STOP_PCT = 2;
// Trades whose stop is wider than 1.35 ATR are skipped too: in the 2026-11-13 replay they made 0R over 537 trades, while
// stops inside the range made +0.21R per trade in both periods.
export const MAX_STOP_ATR = 1.35;

export type TripleBeatGrade = 'A+' | 'A' | 'B' | 'Pass';
export type GapBucket = '<4' | '4-7.9' | '8-9.9' | '10+';

export interface TripleBeatMetrics {
  referencePrice: number;
  priorClose: number;
  gapPct: number;
  maxGapPct: number;
  holdPct: number;
  extendedVolumeRatio: number;
  avgVolume20: number;
  avgDollarVolume20: number;
  marketCap: number | null;
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
  earningsFilings: number;
  setups: Array<TripleBeatSetup & { ticker: string; plan: TripleBeatPlan; name?: string | null }>;
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
  if (score >= 40) return 'A+';
  if (score >= 34) return 'A';
  if (score >= 26) return 'B';
  return 'Pass';
}

export function gapBucket(gapPct: number): GapBucket {
  if (gapPct >= 10) return '10+';
  if (gapPct >= 8) return '8-9.9';
  if (gapPct >= 4) return '4-7.9';
  return '<4';
}

// Replay: any liquid ticker-day; the earnings-filing check and overnight gap rules run per ticker.
export function passesReplayPrefilter(bars: DailyOhlcBar[]): boolean {
  return bars.length >= 20 && mean(bars.slice(-20).map((bar) => bar.volume * bar.close)) >= RULES.minDollarVolume;
}

export function evaluateTripleBeatSetup(
  history: DailyOhlcBar[],
  extended: ExtendedHoursStats,
  earnings: EarningsRead,
  sharesOutstanding: number | null = null,
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
    maxGapPct: pctChange(prior.close, extended.high),
    holdPct: extended.high === extended.low ? 100 : ((extended.last - extended.low) / (extended.high - extended.low)) * 100,
    extendedVolumeRatio: extended.volume / avgVolume20,
    avgVolume20,
    avgDollarVolume20: mean(last20.map((bar) => bar.volume * bar.close)),
    marketCap: sharesOutstanding == null ? null : sharesOutstanding * extended.last,
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
  if (metrics.referencePrice < RULES.minPrice) failedFilters.push('Price < $3');
  if (metrics.avgDollarVolume20 < RULES.minDollarVolume) failedFilters.push('Dollar volume < $5M');
  if (metrics.marketCap != null && metrics.marketCap < RULES.minMarketCap) failedFilters.push('Market cap < $250M');
  if (metrics.maxGapPct < RULES.minMaxGapPct) failedFilters.push('Overnight high < +5%');
  if (metrics.gapPct < RULES.minCurrentGapPct) failedFilters.push('Below prior close');
  if (riskPerShare <= 0 || atr14 <= 0) failedFilters.push('No entry/stop');
  else if (riskAtr < RULES.minStopAtr) failedFilters.push('Stop < 0.5 ATR');
  const qualified = failedFilters.length === 0;

  const beat = (status: EarningsRead['epsBeat']): ScoreItemStatus => (
    status === 'yes' ? 'met' : status === 'no' ? 'not met' : 'unknown'
  );
  // Only items that separated winners from losers in the Apr, Jul and Oct 2026 replays (575 trades). Dropped for no edge
  // or a backwards one: extended-hours volume, 10%+ gap, holding near highs, run-up, $20M volume.
  const items: Array<[string, number, boolean | ScoreItemStatus]> = [
    ['EPS beat', 8, beat(earnings.epsBeat)],
    ['Revenue beat', 8, beat(earnings.revenueBeat)],
    ['Guidance raised', 9, earnings.guidance === 'raised' ? 'met' : earnings.guidance === 'unknown' ? 'unknown' : 'not met'],
    ['3-month base', 8, metrics.baseRangePct <= RULES.maxBaseRangePct],
    ['Clears 3-month high', 8, metrics.referencePrice > baseHigh],
    ['Price $10+', 4, metrics.referencePrice >= RULES.preferredPrice],
  ];
  const scoreItems = items.map(([label, maxPoints, condition]): ScoreItem => {
    const status = typeof condition === 'boolean' ? (condition ? 'met' : 'not met') : condition;
    return { label, maxPoints, status, points: status === 'met' ? maxPoints : 0 };
  });
  const score = scoreItems.reduce((sum, item) => sum + item.points, 0);
  const grade = gradeFor(score);
  const plan: TripleBeatPlan | null = !qualified ? null : {
    // Flat half size: after the consensus re-reads A+ and A beat B mostly in 2024–25 only, so grades don't change size yet.
    riskFraction: grade === 'Pass' ? 0 : 0.5,
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

// Time-of-day RVOL as known at the open of each minute after 09:30: volume since 09:30 through the previous minute ÷ the
// average over the same minutes in the prior sessions. Arrays are indexed by minutes after 09:30, with 0 for minutes that
// had no trades. Minute 0 is always 0 (nothing has traded at 09:30:00), and with no prior volume to compare against RVOL
// is 0 so the entry can't be confirmed. Using the minute's own volume would let a fill at that minute's open see volume
// that had not traded yet.
export function timeOfDayRvol(day0Volumes: number[], priorSessionVolumes: number[][]): number[] {
  let cumulative = 0;
  let priorCumulative = 0;
  return day0Volumes.map((volume, minute) => {
    const average = priorSessionVolumes.length > 0 ? priorCumulative / priorSessionVolumes.length : 0;
    const rvol = average > 0 ? cumulative / average : 0;
    cumulative += volume;
    for (const session of priorSessionVolumes) priorCumulative += session[minute] ?? 0;
    return rvol;
  });
}

export interface TripleBeatMinuteBar {
  open: number;
  high: number;
  low: number;
  rvol?: number;
}

// Day 0 is ordered by minute bars when given. With `loadMinutes`, every later day is walked in its 04:00–16:00 minute
// bars, since the stop and the 2R partial are both worked premarket: a print through either fills at that level. Without
// minute bars, a daily bar that touches the stop wins.
// A stop fills at the stop price, except when the bar (minute or daily) that first trades through it already opens below
// it: a stop order can't fill above where the stock is trading, so that bar's open is the fill. The entry minute is the
// exception, since its open came before the entry. The 2R partial always fills at the target, which understates a gap up.
// With minute bars, the entry fills on the first bar that trades at or above the premarket high while the RVOL known at
// that bar's open is at least `minRvol` (at that bar's open if it is already above). `minRvol` above 0 needs minute
// bars; without them nothing triggers.
export async function measureTripleBeatOutcome(
  history: DailyOhlcBar[],
  plan: TripleBeatPlan,
  sessions: DailyOhlcBar[],
  day0Minutes: TripleBeatMinuteBar[] = [],
  minRvol = 0,
  loadMinutes?: (date: string) => Promise<TripleBeatMinuteBar[]>,
): Promise<TripleBeatOutcome> {
  const day0 = sessions[0];
  const notTriggered: TripleBeatOutcome = {
    triggered: false, fill: null, stoppedOutDay0: null, dayR: null, hit2R: null, runnerR: null,
    totalR: null, daysHeld: null, openAtEnd: null, mfe20R: null, mae20R: null,
  };
  if (day0.high < plan.entry) return notTriggered;
  let fill = Math.max(day0.open, plan.entry);
  let entryIndex = 0;
  if (day0Minutes.length > 0) {
    entryIndex = day0Minutes.findIndex((bar) => bar.high >= plan.entry && (bar.rvol ?? Number.POSITIVE_INFINITY) >= minRvol);
    if (entryIndex === -1) return notTriggered;
    fill = Math.max(day0Minutes[entryIndex].open, plan.entry);
  } else if (minRvol > 0) {
    return notTriggered;
  }
  const risk = fill - plan.stop;
  const toR = (price: number) => (price - fill) / risk;
  const target = fill + RULES.target1R * risk;
  const window = sessions.slice(0, RULES.maxSwingSessions);
  const closes = history.map((bar) => bar.close);
  let hit2R = false;
  let exit: number | null = null;
  let daysHeld = window.length - 1;
  // A daily bar can't say whether the stop or the target came first, so without day-0 minute bars a stop touch wins.
  // Minute bars also ignore dips below the stop that happen before the entry triggers.
  let stoppedOutDay0 = day0.low <= plan.stop;
  let day0StopFill = plan.stop;
  if (day0Minutes.length > 0) {
    stoppedOutDay0 = false;
    for (const [offset, bar] of day0Minutes.slice(entryIndex).entries()) {
      if (bar.low <= plan.stop) {
        stoppedOutDay0 = true;
        day0StopFill = offset === 0 ? plan.stop : Math.min(plan.stop, bar.open);
        break;
      }
      if (bar.high >= target) hit2R = true;
    }
  }
  for (let k = 0; k < window.length; k += 1) {
    const bar = window[k];
    if (k === 0) {
      if (stoppedOutDay0) {
        exit = day0StopFill;
        daysHeld = 0;
        break;
      }
      // Day 0's daily high can come before a late entry, so with minute bars only the walk above counts on day 0.
      if (day0Minutes.length === 0 && bar.high >= target) hit2R = true;
    } else {
      const minutes = loadMinutes ? await loadMinutes(bar.date) : [];
      let stopFill: number | null = null;
      if (minutes.length > 0) {
        for (const minute of minutes) {
          // A minute that reaches both counts as stopped, since one bar can't order its own high and low.
          if (minute.low <= plan.stop) {
            stopFill = Math.min(plan.stop, minute.open);
            break;
          }
          if (minute.high >= target) hit2R = true;
        }
      } else if (bar.low <= plan.stop) {
        stopFill = Math.min(plan.stop, bar.open);
      } else if (bar.high >= target) {
        hit2R = true;
      }
      if (stopFill != null) {
        exit = stopFill;
        daysHeld = k;
        break;
      }
    }
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
    dayR: stoppedOutDay0 ? toR(day0StopFill) : toR(day0.close),
    hit2R,
    runnerR,
    totalR: hit2R ? 0.5 * RULES.target1R + 0.5 * runnerR : runnerR,
    daysHeld,
    openAtEnd: exit === null,
    mfe20R: toR(Math.max(...outcomeBars.map((bar) => bar.high))),
    mae20R: toR(Math.min(...outcomeBars.map((bar) => bar.low))),
  };
}
