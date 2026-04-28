import { describe, expect, it } from 'vitest';

import { reduceActions, sizeForAdd, sizeForOpen } from '@/lib/backtest-math';
import type { BacktestAction } from '@/lib/types';

function makeAction(overrides: Partial<BacktestAction>): BacktestAction {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'u1',
    sessionId: overrides.sessionId ?? 's1',
    actionType: overrides.actionType ?? 'LONG',
    price: overrides.price ?? 10,
    shares: overrides.shares ?? 100,
    stopPrice: overrides.stopPrice ?? 9,
    barTime: overrides.barTime ?? '2026-04-28T14:00:00.000Z',
    sequence: overrides.sequence ?? 1,
    createdAt: overrides.createdAt ?? '2026-04-28T14:00:00.000Z',
  };
}

describe('backtest-math', () => {
  it('sizes a brand-new long position from risk', () => {
    expect(sizeForOpen(100, 10, 9, 'LONG')).toEqual({ shares: 100 });
  });

  it('sizes a long add to keep total risk at or under R', () => {
    const position = reduceActions([
      makeAction({ actionType: 'LONG', price: 10, shares: 100, stopPrice: 9, sequence: 1 }),
    ], 100);

    const result = sizeForAdd(position, 9.5, 11);

    expect(result.shares).toBe(33);
    expect(result.resultingAvgEntry).toBeCloseTo(10.2481, 4);
    expect(result.resultingTotalRisk).toBeLessThanOrEqual(100);
    expect(result.resultingTotalRisk).toBeCloseTo(99.5, 1);
  });

  it('replays a partial sell and full close back to FLAT', () => {
    const position = reduceActions([
      makeAction({ actionType: 'LONG', price: 10, shares: 100, stopPrice: 9, sequence: 1 }),
      makeAction({ actionType: 'SELL', price: 12, shares: 40, stopPrice: null, sequence: 2 }),
      makeAction({ actionType: 'SELL', price: 11, shares: 60, stopPrice: null, sequence: 3 }),
    ], 100);

    expect(position.direction).toBe('FLAT');
    expect(position.totalShares).toBe(0);
    expect(position.realizedPnl).toBeCloseTo(140);
    expect(position.closedShares).toBe(100);
    expect(position.lastExitPrice).toBe(11);
  });

  it('mirrors short-side replay behavior', () => {
    const position = reduceActions([
      makeAction({ actionType: 'SHORT', price: 10, shares: 80, stopPrice: 11, sequence: 1 }),
      makeAction({ actionType: 'SHORT_ADD', price: 9.5, shares: 20, stopPrice: 10.5, sequence: 2 }),
      makeAction({ actionType: 'COVER', price: 9, shares: 100, stopPrice: null, sequence: 3 }),
    ], 100);

    expect(position.direction).toBe('FLAT');
    expect(position.totalShares).toBe(0);
    expect(position.realizedPnl).toBeCloseTo(90);
    expect(position.totalSharesEverOpened).toBe(100);
  });

  it('throws on invalid action sequencing', () => {
    expect(() => reduceActions([
      makeAction({ actionType: 'SELL', price: 10.5, shares: 10, stopPrice: null, sequence: 1 }),
    ], 100)).toThrow(/SELL is only valid from LONG/);
  });
});
