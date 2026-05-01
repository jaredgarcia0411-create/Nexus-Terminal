import { describe, expect, it } from 'vitest';

import { FILTER_REGISTRY, applyFilters, buildGradeFilters, buildSetupFilters } from '@/lib/backtest-filters';
import type { ReviewWithStats } from '@/lib/backtest-stats';

function makeReview(overrides: Partial<ReviewWithStats['stats']> = {}): ReviewWithStats {
  return {
    session: {
      id: 's1',
      userId: 'u1',
      ticker: 'AAPL',
      date: '2024-01-01',
      status: 'REVIEWED',
      riskDollars: 100,
      label: null,
      notes: null,
      backtestId: null,
      reviewedAt: null,
      createdAt: '',
      updatedAt: '',
    },
    actions: [],
    stats: {
      realizedPnl: 0,
      rMultiple: null,
      direction: 'LONG',
      holdMinutes: null,
      gapPct: null,
      grade: null,
      setupType: null,
      ...overrides,
    },
    systemTicker: null,
  };
}

describe('FILTER_REGISTRY predicates', () => {
  it('winners filters positive pnl', () => {
    const filterDef = FILTER_REGISTRY.find((filter) => filter.id === 'winners');

    expect(filterDef?.predicate(makeReview({ realizedPnl: 100 }))).toBe(true);
    expect(filterDef?.predicate(makeReview({ realizedPnl: -50 }))).toBe(false);
  });

  it('losers filters negative pnl', () => {
    const filterDef = FILTER_REGISTRY.find((filter) => filter.id === 'losers');

    expect(filterDef?.predicate(makeReview({ realizedPnl: -50 }))).toBe(true);
    expect(filterDef?.predicate(makeReview({ realizedPnl: 100 }))).toBe(false);
  });

  it('long filters direction', () => {
    const filterDef = FILTER_REGISTRY.find((filter) => filter.id === 'long');

    expect(filterDef?.predicate(makeReview({ direction: 'LONG' }))).toBe(true);
    expect(filterDef?.predicate(makeReview({ direction: 'SHORT' }))).toBe(false);
  });

  it('gap-up filters positive gapPct', () => {
    const filterDef = FILTER_REGISTRY.find((filter) => filter.id === 'gap-up');

    expect(filterDef?.predicate(makeReview({ gapPct: 3.5 }))).toBe(true);
    expect(filterDef?.predicate(makeReview({ gapPct: -2 }))).toBe(false);
  });
});

describe('applyFilters', () => {
  it('returns all reviews when no filters are active', () => {
    const reviews = [makeReview({ realizedPnl: 100 }), makeReview({ realizedPnl: -50 })];

    expect(applyFilters(reviews, new Set(), [])).toHaveLength(2);
  });

  it('AND-combines multiple filters', () => {
    const reviews = [
      makeReview({ realizedPnl: 100, direction: 'LONG' }),
      makeReview({ realizedPnl: 100, direction: 'SHORT' }),
      makeReview({ realizedPnl: -50, direction: 'LONG' }),
    ];

    const result = applyFilters(reviews, new Set(['winners', 'long']), []);

    expect(result).toHaveLength(1);
    expect(result[0].stats.direction).toBe('LONG');
    expect(result[0].stats.realizedPnl).toBe(100);
  });
});

describe('dynamic filter builders', () => {
  it('builds grade filters for unique grades', () => {
    const reviews = [makeReview({ grade: 'A' }), makeReview({ grade: 'B' }), makeReview({ grade: 'A' })];
    const filters = buildGradeFilters(reviews);

    expect(filters.map((filter) => filter.id)).toEqual(['grade-A', 'grade-B']);
    expect(filters[0].predicate(makeReview({ grade: 'A' }))).toBe(true);
  });

  it('builds setup filters for unique setup types', () => {
    const reviews = [
      makeReview({ setupType: 'ORB' }),
      makeReview({ setupType: 'RVOL' }),
      makeReview({ setupType: 'ORB' }),
    ];
    const filters = buildSetupFilters(reviews);

    expect(filters.map((filter) => filter.id)).toEqual(['setup-ORB', 'setup-RVOL']);
    expect(filters[1].predicate(makeReview({ setupType: 'RVOL' }))).toBe(true);
  });
});
