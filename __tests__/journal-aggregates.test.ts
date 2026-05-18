import { describe, expect, it } from 'vitest';

import { aggregateDay, aggregateWeek } from '@/lib/journal-aggregates';
import type { Trade } from '@/lib/types';

// Build a Trade in local time so tests are stable regardless of host timezone.
// `new Date(year, monthIdx, day, hour, ...)` always resolves in local time,
// which matches how date-fns `format(d, 'yyyy-MM-dd')` buckets days.
function makeTrade(overrides: Partial<Trade> & { date: Date; id: string }): Trade {
  return {
    symbol: 'TEST',
    direction: 'LONG',
    avgEntryPrice: 100,
    avgExitPrice: 101,
    totalQuantity: 100,
    grossPnl: 100,
    netPnl: 100,
    entryTime: overrides.date.toISOString(),
    exitTime: overrides.date.toISOString(),
    executionCount: 1,
    rawExecutions: [],
    pnl: 100,
    executions: 1,
    tags: [],
    isOpen: overrides.isOpen ?? false,
    remainingQty: overrides.remainingQty ?? 0,
    sortKey: '2026-04-17',
    ...overrides,
  };
}

describe('aggregateDay', () => {
  it('sums gross/net/R for trades on the requested local day', () => {
    const trades: Trade[] = [
      makeTrade({
        id: 't1',
        date: new Date(2026, 3, 17, 10, 0),
        grossPnl: 150,
        netPnl: 120,
        initialRisk: 60,
      }),
      makeTrade({
        id: 't2',
        date: new Date(2026, 3, 17, 14, 0),
        grossPnl: -80,
        netPnl: -90,
        initialRisk: 45,
      }),
      makeTrade({
        id: 't3',
        date: new Date(2026, 3, 18, 9, 0),
        grossPnl: 500,
        netPnl: 480,
        initialRisk: 100,
      }),
    ];

    const result = aggregateDay(trades, '2026-04-17');

    expect(result.grossResult).toBe(70);
    expect(result.netResult).toBe(30);
    // 120/60 + -90/45 = 2 + -2 = 0
    expect(result.rTotal).toBeCloseTo(0, 10);
    expect(result.tradeIds).toEqual(['t1', 't2']);
  });

  it('skips R when initialRisk is missing or zero', () => {
    const trades: Trade[] = [
      makeTrade({ id: 't1', date: new Date(2026, 3, 17, 10, 0), netPnl: 200 }),
      makeTrade({
        id: 't2',
        date: new Date(2026, 3, 17, 11, 0),
        netPnl: 300,
        initialRisk: 0,
      }),
    ];

    const result = aggregateDay(trades, '2026-04-17');

    expect(result.rTotal).toBe(0);
    expect(result.tradeIds).toEqual(['t1', 't2']);
  });

  it('buckets a late-evening trade into the local day (not UTC next-day)', () => {
    // 2026-04-17 at 23:00 local — in UTC this is either the same day or the next,
    // depending on host TZ. Aggregate must use the local day regardless.
    const lateTrade = makeTrade({
      id: 'late',
      date: new Date(2026, 3, 17, 23, 0),
      netPnl: 50,
      initialRisk: 25,
    });

    const result = aggregateDay([lateTrade], '2026-04-17');
    expect(result.tradeIds).toEqual(['late']);
    expect(result.netResult).toBe(50);
  });

  it('returns zeros when no trades match', () => {
    const trades: Trade[] = [
      makeTrade({ id: 't1', date: new Date(2026, 3, 17, 10, 0), netPnl: 100, initialRisk: 50 }),
    ];

    const result = aggregateDay(trades, '2026-04-20');

    expect(result).toEqual({ grossResult: 0, netResult: 0, rTotal: 0, tradeIds: [] });
  });
});

describe('aggregateDay - excludes open trades', () => {
  it('does not count an open trade in netResult or tradeIds', () => {
    const trades: Trade[] = [
      makeTrade({ id: 'closed', date: new Date(2026, 3, 17, 10, 0), netPnl: 100, grossPnl: 100 }),
      makeTrade({ id: 'open', date: new Date(2026, 3, 17, 11, 0), netPnl: 0, grossPnl: 0, isOpen: true }),
    ];
    const result = aggregateDay(trades, '2026-04-17');
    expect(result.tradeIds).toEqual(['closed']);
    expect(result.netResult).toBe(100);
  });
});

describe('aggregateWeek - excludes open trades', () => {
  it('does not count open trades in weekly totals', () => {
    const trades: Trade[] = [
      makeTrade({ id: 'c1', date: new Date(2026, 3, 14, 10, 0), netPnl: 200, grossPnl: 200, initialRisk: 100 }),
      makeTrade({ id: 'o1', date: new Date(2026, 3, 15, 10, 0), netPnl: 0, grossPnl: 0, isOpen: true }),
    ];
    const result = aggregateWeek(trades, '2026-04-13', '2026-04-17');
    expect(result.tradeIds).toEqual(['c1']);
    expect(result.netResult).toBe(200);
    expect(result.rTotal).toBeCloseTo(2, 10);
  });
});

describe('aggregateWeek', () => {
  it('includes trades on both boundary days and groups perDayR in ascending date order', () => {
    const trades: Trade[] = [
      makeTrade({
        id: 'mon',
        date: new Date(2026, 3, 13, 10, 0),
        netPnl: 100,
        initialRisk: 50,
      }),
      makeTrade({
        id: 'wed',
        date: new Date(2026, 3, 15, 10, 0),
        netPnl: -50,
        initialRisk: 50,
      }),
      makeTrade({
        id: 'fri',
        date: new Date(2026, 3, 17, 10, 0),
        netPnl: 200,
        initialRisk: 40,
      }),
      makeTrade({
        id: 'next-mon',
        date: new Date(2026, 3, 20, 10, 0),
        netPnl: 999,
        initialRisk: 50,
      }),
    ];

    const result = aggregateWeek(trades, '2026-04-13', '2026-04-17');

    expect(result.tradeIds).toEqual(['mon', 'wed', 'fri']);
    expect(result.netResult).toBe(250);
    expect(result.perDayR.map((entry) => entry.date)).toEqual(['2026-04-13', '2026-04-15', '2026-04-17']);
    expect(result.perDayR[0].r).toBeCloseTo(2, 10);
    expect(result.perDayR[1].r).toBeCloseTo(-1, 10);
    expect(result.perDayR[2].r).toBeCloseTo(5, 10);
    expect(result.rTotal).toBeCloseTo(6, 10);
  });

  it('omits a day from perDayR when no trades that day carry risk', () => {
    const trades: Trade[] = [
      makeTrade({ id: 'no-risk', date: new Date(2026, 3, 14, 10, 0), netPnl: 40 }),
      makeTrade({
        id: 'with-risk',
        date: new Date(2026, 3, 15, 10, 0),
        netPnl: 100,
        initialRisk: 50,
      }),
    ];

    const result = aggregateWeek(trades, '2026-04-13', '2026-04-17');

    expect(result.tradeIds).toEqual(['no-risk', 'with-risk']);
    expect(result.perDayR.map((entry) => entry.date)).toEqual(['2026-04-15']);
    expect(result.perDayR[0].r).toBeCloseTo(2, 10);
  });
});
