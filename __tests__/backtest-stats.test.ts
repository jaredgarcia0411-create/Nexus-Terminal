import { describe, expect, it } from 'vitest';

import { computeAggregateStats, computeReviewStats, type ReviewWithStats } from '@/lib/backtest-stats';
import type { BacktestAction, BacktestSession } from '@/lib/types';

function makeSession(overrides: Partial<BacktestSession> = {}): BacktestSession {
  return {
    id: 's1',
    userId: 'u1',
    ticker: 'AAPL',
    date: '2024-01-02',
    status: 'REVIEWED',
    riskDollars: 100,
    label: null,
    notes: null,
    chartState: null,
    backtestId: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAction(overrides: Partial<BacktestAction>): BacktestAction {
  return {
    id: 'a1',
    userId: 'u1',
    sessionId: 's1',
    actionType: 'LONG',
    price: 100,
    shares: 10,
    stopPrice: null,
    barTime: '2024-01-02T09:30:00Z',
    sequence: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeReviewStats', () => {
  it('returns zero pnl for no actions', () => {
    const stats = computeReviewStats(makeSession(), [], null);

    expect(stats.realizedPnl).toBe(0);
    expect(stats.rMultiple).toBeNull();
  });

  it('computes LONG realized pnl correctly', () => {
    const session = makeSession({ riskDollars: 100 });
    const actions = [
      makeAction({ actionType: 'LONG', price: 100, shares: 10, barTime: '2024-01-02T09:30:00Z', sequence: 1 }),
      makeAction({ id: 'a2', actionType: 'SELL', price: 110, shares: 10, barTime: '2024-01-02T09:45:00Z', sequence: 2 }),
    ];

    const stats = computeReviewStats(session, actions, null);

    expect(stats.realizedPnl).toBeCloseTo(100);
    expect(stats.rMultiple).toBeCloseTo(1);
    expect(stats.direction).toBe('LONG');
    expect(stats.holdMinutes).toBe(15);
  });

  it('computes SHORT realized pnl correctly', () => {
    const session = makeSession({ riskDollars: 100 });
    const actions = [
      makeAction({ actionType: 'SHORT', price: 100, shares: 10, barTime: '2024-01-02T09:30:00Z', sequence: 1 }),
      makeAction({ id: 'a2', actionType: 'COVER', price: 90, shares: 10, barTime: '2024-01-02T10:00:00Z', sequence: 2 }),
    ];

    const stats = computeReviewStats(session, actions, null);

    expect(stats.realizedPnl).toBeCloseTo(100);
    expect(stats.direction).toBe('SHORT');
  });

  it('surfaces system ticker fields', () => {
    const stats = computeReviewStats(makeSession(), [], { grade: 'A', setupType: 'RVOL', day1GapPct: 5.5 });

    expect(stats.grade).toBe('A');
    expect(stats.setupType).toBe('RVOL');
    expect(stats.gapPct).toBe(5.5);
  });
});

describe('computeAggregateStats', () => {
  function makeReview(date: string, pnl: number, rMultiple: number | null = null): ReviewWithStats {
    return {
      session: makeSession({ date }),
      actions: [],
      stats: {
        realizedPnl: pnl,
        rMultiple,
        direction: 'LONG',
        holdMinutes: 10,
        gapPct: null,
        grade: null,
        setupType: null,
      },
      systemTicker: null,
    };
  }

  it('returns empty stats for no reviews', () => {
    const stats = computeAggregateStats([]);

    expect(stats.totalTrades).toBe(0);
    expect(stats.equityCurve).toHaveLength(0);
  });

  it('sorts equity curve by date ASC', () => {
    const reviews = [
      makeReview('2024-01-03', 50),
      makeReview('2024-01-01', 100),
      makeReview('2024-01-02', -30),
    ];

    const { equityCurve } = computeAggregateStats(reviews);

    expect(equityCurve[0].date).toBe('2024-01-01');
    expect(equityCurve[1].date).toBe('2024-01-02');
    expect(equityCurve[2].date).toBe('2024-01-03');
    expect(equityCurve[2].cumulativePnl).toBeCloseTo(120);
  });

  it('computes profit factor', () => {
    const reviews = [makeReview('2024-01-01', 100), makeReview('2024-01-02', -50)];
    const { profitFactor } = computeAggregateStats(reviews);

    expect(profitFactor).toBeCloseTo(2);
  });

  it('returns null profit factor when no losses', () => {
    const reviews = [makeReview('2024-01-01', 100)];
    const { profitFactor } = computeAggregateStats(reviews);

    expect(profitFactor).toBeNull();
  });

  it('computes expectancyR as mean rMultiple', () => {
    const reviews = [makeReview('2024-01-01', 100, 1), makeReview('2024-01-02', -50, -0.5)];
    const { expectancyR } = computeAggregateStats(reviews);

    expect(expectancyR).toBeCloseTo(0.25);
  });

  it('computes maxDrawdown', () => {
    const reviews = [
      makeReview('2024-01-01', 100),
      makeReview('2024-01-02', -150),
      makeReview('2024-01-03', 200),
    ];
    const { maxDrawdown } = computeAggregateStats(reviews);

    expect(maxDrawdown).toBeCloseTo(-150);
  });

  it('computes winRate', () => {
    const reviews = [makeReview('2024-01-01', 100), makeReview('2024-01-02', -50), makeReview('2024-01-03', 30)];
    const { winRate } = computeAggregateStats(reviews);

    expect(winRate).toBeCloseTo(2 / 3);
  });
});
