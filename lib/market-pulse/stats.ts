import type {
  MarketPulseBar,
  MarketPulseDailyStats,
  MarketPulseLeader,
  MarketPulseOverview90,
  MarketPulseRolling30,
} from './types';

export const MARKET_PULSE_DOLLAR_VOLUME_FLOOR = 1_000_000;

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function percentChange(current: number, previous: number): number | null {
  const ratio = safeDivide(current - previous, previous);
  return ratio === null ? null : ratio * 100;
}

export function average(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const midpoint = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) return finite[midpoint]!;
  return (finite[midpoint - 1]! + finite[midpoint]!) / 2;
}

export function percentileRank(value: number, values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(value) || finite.length === 0) return null;
  const atOrBelow = finite.filter((candidate) => candidate <= value).length;
  return (atOrBelow / finite.length) * 100;
}

function roundMetric(value: number | null, precision = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function byDateAndTicker(bars: MarketPulseBar[]): Map<string, Map<string, MarketPulseBar>> {
  const grouped = new Map<string, Map<string, MarketPulseBar>>();
  for (const bar of bars) {
    const dateRows = grouped.get(bar.tradeDate) ?? new Map<string, MarketPulseBar>();
    dateRows.set(bar.ticker, bar);
    grouped.set(bar.tradeDate, dateRows);
  }
  return grouped;
}

function getPreviousBar(
  dateIndex: number,
  dates: string[],
  grouped: Map<string, Map<string, MarketPulseBar>>,
  ticker: string,
): MarketPulseBar | null {
  for (let i = dateIndex - 1; i >= 0; i -= 1) {
    const candidate = grouped.get(dates[i]!)?.get(ticker);
    if (candidate) return candidate;
  }
  return null;
}

function getPriorTickerBars(
  dateIndex: number,
  dates: string[],
  grouped: Map<string, Map<string, MarketPulseBar>>,
  ticker: string,
  days: number,
): MarketPulseBar[] {
  const bars: MarketPulseBar[] = [];
  for (let i = dateIndex - 1; i >= 0 && bars.length < days; i -= 1) {
    const candidate = grouped.get(dates[i]!)?.get(ticker);
    if (candidate) bars.unshift(candidate);
  }
  return bars;
}

function buildLeaders(rows: Array<{ bar: MarketPulseBar; changePct: number }>, direction: 'asc' | 'desc'): MarketPulseLeader[] {
  return [...rows]
    .sort((a, b) => direction === 'desc' ? b.changePct - a.changePct : a.changePct - b.changePct)
    .slice(0, 5)
    .map(({ bar, changePct }) => ({
      ticker: bar.ticker,
      changePct: roundMetric(changePct, 2) ?? 0,
      volume: bar.volume,
      dollarVolume: bar.dollarVolume,
      sector: bar.sector ?? null,
    }));
}

function buildRolling30(stats: MarketPulseDailyStats[]): MarketPulseRolling30 {
  const window = stats.slice(-30);
  return {
    tradingDays: window.length,
    avgAdvancerPct: roundMetric(average(window.map((row) => row.advancerPct)), 2),
    medianAdvancerPct: roundMetric(median(window.map((row) => row.advancerPct)), 2),
    strongDays: window.filter((row) => row.advancerPct >= 55).length,
    weakDays: window.filter((row) => row.advancerPct <= 45).length,
    newHigh30dAvg: roundMetric(average(window.map((row) => row.newHigh30dCount)), 2),
    newLow30dAvg: roundMetric(average(window.map((row) => row.newLow30dCount)), 2),
  };
}

function buildOverview90(stats: MarketPulseDailyStats[]): MarketPulseOverview90 | null {
  const window = stats.slice(-90);
  if (window.length < 90) return null;

  const first30 = window.slice(0, 30);
  const last30 = window.slice(-30);
  const firstAvg = average(first30.map((row) => row.advancerPct));
  const lastAvg = average(last30.map((row) => row.advancerPct));
  const delta = firstAvg === null || lastAvg === null ? 0 : lastAvg - firstAvg;
  const trend = delta > 3 ? 'improving' : delta < -3 ? 'deteriorating' : 'flat';
  const strongest = [...window].sort((a, b) => b.advancerPct - a.advancerPct)[0] ?? null;
  const weakest = [...window].sort((a, b) => a.advancerPct - b.advancerPct)[0] ?? null;

  return {
    tradingDays: window.length,
    trend,
    strongestDate: strongest?.tradeDate ?? null,
    weakestDate: weakest?.tradeDate ?? null,
    note: `90-day breadth trend is ${trend} (${roundMetric(delta, 2)} point advancer-rate change).`,
  };
}

function computeOneDayStats(
  tradeDate: string,
  dateIndex: number,
  dates: string[],
  grouped: Map<string, Map<string, MarketPulseBar>>,
): Omit<MarketPulseDailyStats, 'rolling30' | 'overview90'> {
  const rows = [...(grouped.get(tradeDate)?.values() ?? [])];
  const changeRows = rows.flatMap((bar) => {
    const previous = getPreviousBar(dateIndex, dates, grouped, bar.ticker);
    const changePct = previous ? percentChange(bar.close, previous.close) : percentChange(bar.close, bar.open);
    return changePct === null ? [] : [{ bar, changePct, hasPrevious: previous !== null }];
  });

  const advancers = changeRows.filter((row) => row.changePct > 0).length;
  const decliners = changeRows.filter((row) => row.changePct < 0).length;
  const unchanged = rows.length - advancers - decliners;
  const upVolume = changeRows
    .filter((row) => row.changePct > 0)
    .reduce((sum, row) => sum + row.bar.volume, 0);
  const downVolume = changeRows
    .filter((row) => row.changePct < 0)
    .reduce((sum, row) => sum + row.bar.volume, 0);
  const totalVolume = rows.reduce((sum, bar) => sum + bar.volume, 0);
  const withPrior = changeRows.filter((row) => row.hasPrevious);
  const abovePrior = withPrior.filter((row) => row.changePct > 0).length;
  const aboveDollarFloor = rows.filter((bar) => bar.dollarVolume >= MARKET_PULSE_DOLLAR_VOLUME_FLOOR).length;

  let newHigh30dCount = 0;
  let newLow30dCount = 0;
  for (const bar of rows) {
    const priorBars = getPriorTickerBars(dateIndex, dates, grouped, bar.ticker, 29);
    if (priorBars.length === 0) continue;
    const priorHigh = Math.max(...priorBars.map((candidate) => candidate.high));
    const priorLow = Math.min(...priorBars.map((candidate) => candidate.low));
    if (bar.high >= priorHigh) newHigh30dCount += 1;
    if (bar.low <= priorLow) newLow30dCount += 1;
  }

  return {
    tradeDate,
    tickerCount: rows.length,
    advancers,
    decliners,
    unchanged,
    advancerPct: roundMetric((safeDivide(advancers, rows.length) ?? 0) * 100, 2) ?? 0,
    declinerPct: roundMetric((safeDivide(decliners, rows.length) ?? 0) * 100, 2) ?? 0,
    upVolume,
    downVolume,
    totalVolume,
    medianChangePct: roundMetric(median(changeRows.map((row) => row.changePct)), 2),
    avgChangePct: roundMetric(average(changeRows.map((row) => row.changePct)), 2),
    pctAbovePrevClose: withPrior.length === 0 ? null : roundMetric((abovePrior / withPrior.length) * 100, 2),
    pctAboveDollarVolumeFloor: roundMetric((safeDivide(aboveDollarFloor, rows.length) ?? 0) * 100, 2),
    newHigh30dCount,
    newLow30dCount,
    leaders: buildLeaders(changeRows, 'desc'),
    laggards: buildLeaders(changeRows, 'asc'),
  };
}

export function computeMarketPulseStats(
  tradeDate: string,
  storedBars: MarketPulseBar[],
): MarketPulseDailyStats | null {
  const grouped = byDateAndTicker(storedBars);
  const dates = [...grouped.keys()].sort();
  const dateIndex = dates.indexOf(tradeDate);
  if (dateIndex === -1 || (grouped.get(tradeDate)?.size ?? 0) === 0) return null;

  const statsThroughDate: MarketPulseDailyStats[] = [];
  for (let i = 0; i <= dateIndex; i += 1) {
    const dateStats = computeOneDayStats(dates[i]!, i, dates, grouped);
    const provisional = {
      ...dateStats,
      rolling30: {
        tradingDays: 0,
        avgAdvancerPct: null,
        medianAdvancerPct: null,
        strongDays: 0,
        weakDays: 0,
        newHigh30dAvg: null,
        newLow30dAvg: null,
      },
      overview90: null,
    };
    const rolling30 = buildRolling30([...statsThroughDate, provisional]);
    statsThroughDate.push({
      ...dateStats,
      rolling30,
      overview90: buildOverview90([...statsThroughDate, provisional]),
    });
  }

  return statsThroughDate[statsThroughDate.length - 1] ?? null;
}
