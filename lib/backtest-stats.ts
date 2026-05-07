import type { BacktestAction, BacktestSession } from '@/lib/types';

export type SystemTickerForStats = {
  grade: string | null;
  setupType: string | null;
  day1GapPct: number | null;
};

export type ReviewStats = {
  realizedPnl: number;
  rMultiple: number | null;
  direction: 'LONG' | 'SHORT' | null;
  holdMinutes: number | null;
  gapPct: number | null;
  grade: string | null;
  setupType: string | null;
};

export type ReviewWithStats = {
  session: BacktestSession;
  actions: BacktestAction[];
  stats: ReviewStats;
  systemTicker: SystemTickerForStats | null;
};

export type EquityPoint = {
  date: string;
  cumulativePnl: number;
};

export type AggregateStats = {
  totalReturn: number;
  totalReturnR: number | null;
  winRate: number;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdown: number;
  avgHoldMinutes: number | null;
  totalTrades: number;
  equityCurve: EquityPoint[];
};

export function computeReviewStats(
  session: BacktestSession,
  actions: BacktestAction[],
  systemTicker: SystemTickerForStats | null,
): ReviewStats {
  if (actions.length === 0) {
    return {
      realizedPnl: 0,
      rMultiple: null,
      direction: null,
      holdMinutes: null,
      gapPct: systemTicker?.day1GapPct ?? null,
      grade: systemTicker?.grade ?? null,
      setupType: systemTicker?.setupType ?? null,
    };
  }

  const firstAction = actions[0];
  const direction: 'LONG' | 'SHORT' | null =
    firstAction.actionType === 'LONG' || firstAction.actionType === 'LONG_ADD'
      ? 'LONG'
      : firstAction.actionType === 'SHORT' || firstAction.actionType === 'SHORT_ADD'
        ? 'SHORT'
        : null;

  let totalCost = 0;
  let totalShares = 0;
  let realizedPnl = 0;
  let avgEntry = 0;

  for (const action of actions) {
    if (action.actionType === 'LONG' || action.actionType === 'LONG_ADD') {
      totalCost += action.shares * action.price;
      totalShares += action.shares;
      avgEntry = totalShares > 0 ? totalCost / totalShares : 0;
      continue;
    }

    if (action.actionType === 'SELL') {
      realizedPnl += (action.price - avgEntry) * action.shares;
      totalShares -= action.shares;
      totalCost = avgEntry * totalShares;
      continue;
    }

    if (action.actionType === 'SHORT' || action.actionType === 'SHORT_ADD') {
      totalCost += action.shares * action.price;
      totalShares += action.shares;
      avgEntry = totalShares > 0 ? totalCost / totalShares : 0;
      continue;
    }

    if (action.actionType === 'COVER') {
      realizedPnl += (avgEntry - action.price) * action.shares;
      totalShares -= action.shares;
      totalCost = avgEntry * totalShares;
    }
  }

  const rMultiple = session.riskDollars > 0 ? realizedPnl / session.riskDollars : null;

  let holdMinutes: number | null = null;
  const exitActions = actions.filter((action) => action.actionType === 'SELL' || action.actionType === 'COVER');
  if (exitActions.length > 0) {
    const start = Date.parse(actions[0].barTime);
    const end = Date.parse(exitActions[exitActions.length - 1].barTime);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      holdMinutes = Math.round((end - start) / 60_000);
    }
  }

  return {
    realizedPnl,
    rMultiple,
    direction,
    holdMinutes,
    gapPct: systemTicker?.day1GapPct ?? null,
    grade: systemTicker?.grade ?? null,
    setupType: systemTicker?.setupType ?? null,
  };
}

export function computeAggregateStats(reviews: ReviewWithStats[]): AggregateStats {
  if (reviews.length === 0) {
    return {
      totalReturn: 0,
      totalReturnR: null,
      winRate: 0,
      profitFactor: null,
      expectancyR: null,
      maxDrawdown: 0,
      avgHoldMinutes: null,
      totalTrades: 0,
      equityCurve: [],
    };
  }

  const sorted = [...reviews].sort((a, b) => a.session.date.localeCompare(b.session.date));

  let cumulativePnl = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let winners = 0;
  let rMultipleSum = 0;
  let rMultipleCount = 0;
  let totalReturnRSum = 0;
  let totalReturnRCount = 0;
  let holdMinutesSum = 0;
  let holdMinutesCount = 0;

  const equityCurve: EquityPoint[] = [];

  for (const review of sorted) {
    const pnl = review.stats.realizedPnl;
    cumulativePnl += pnl;
    equityCurve.push({ date: review.session.date, cumulativePnl });

    if (pnl > 0) {
      grossWins += pnl;
      winners += 1;
    }
    if (pnl < 0) {
      grossLosses += Math.abs(pnl);
    }

    if (review.stats.rMultiple !== null) {
      rMultipleSum += review.stats.rMultiple;
      rMultipleCount += 1;
    }

    if (review.session.riskDollars > 0) {
      totalReturnRSum += pnl / review.session.riskDollars;
      totalReturnRCount += 1;
    }

    if (review.stats.holdMinutes !== null) {
      holdMinutesSum += review.stats.holdMinutes;
      holdMinutesCount += 1;
    }

    if (cumulativePnl > peak) peak = cumulativePnl;
    const drawdown = cumulativePnl - peak;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  return {
    totalReturn: cumulativePnl,
    totalReturnR: totalReturnRCount > 0 ? totalReturnRSum : null,
    winRate: winners / reviews.length,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    expectancyR: rMultipleCount > 0 ? rMultipleSum / rMultipleCount : null,
    maxDrawdown,
    avgHoldMinutes: holdMinutesCount > 0 ? holdMinutesSum / holdMinutesCount : null,
    totalTrades: reviews.length,
    equityCurve,
  };
}
