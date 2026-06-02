import { describe, expect, it } from 'vitest';

import { aggregateDay, aggregateWeek, dailyPnlByDate, isCrossDayTrade } from '@/lib/journal-aggregates';
import type { Trade } from '@/lib/types';

// Build a Trade in local time so tests are stable regardless of host timezone.
// `new Date(year, monthIdx, day, hour, ...)` always resolves in local time,
// which matches how date-fns `format(d, 'yyyy-MM-dd')` buckets days.
function makeTrade(overrides: Partial<Trade> & { date: Date; id: string }): Trade {
  const closedAt = overrides.closedAt ?? overrides.date.toISOString();
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
    closedAt,
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

describe('dailyPnlByDate', () => {
  it('sums multiple trades into one local date key', () => {
    const trades: Trade[] = [
      makeTrade({ id: 'win', date: new Date(2026, 3, 17, 10, 0), netPnl: 175 }),
      makeTrade({ id: 'loss', date: new Date(2026, 3, 17, 14, 0), netPnl: -50 }),
      makeTrade({ id: 'next-day', date: new Date(2026, 3, 18, 9, 0), netPnl: 25 }),
    ];

    const result = dailyPnlByDate(trades);

    expect(result.get('2026-04-17')).toBe(125);
    expect(result.get('2026-04-18')).toBe(25);
  });

  it('excludes open trades', () => {
    const trades: Trade[] = [
      makeTrade({ id: 'closed', date: new Date(2026, 3, 17, 10, 0), netPnl: 100 }),
      makeTrade({ id: 'open', date: new Date(2026, 3, 17, 11, 0), netPnl: 999, isOpen: true }),
    ];

    const result = dailyPnlByDate(trades);

    expect(result.get('2026-04-17')).toBe(100);
  });

  it('buckets cross-day trades under the close date', () => {
    const entry = new Date(2026, 3, 17, 15, 30);
    const close = new Date(2026, 3, 18, 9, 45);
    const trades: Trade[] = [
      makeTrade({
        id: 'cross-day',
        date: entry,
        closedAt: close.toISOString(),
        netPnl: 220,
      }),
    ];

    const result = dailyPnlByDate(trades);

    expect(result.get('2026-04-17')).toBeUndefined();
    expect(result.get('2026-04-18')).toBe(220);
  });
});

describe('aggregateDay - closedAt-based bucketing', () => {
  it('buckets a cross-day-close trade under its close day, not its entry day', () => {
    const monEntry = new Date(2026, 4, 18, 14, 0);
    const tueClose = new Date(2026, 4, 19, 10, 0);
    const trades: Trade[] = [
      makeTrade({
        id: 'cross-day',
        date: monEntry,
        closedAt: tueClose.toISOString(),
        netPnl: 250,
        grossPnl: 250,
        initialRisk: 100,
      }),
    ];

    expect(aggregateDay(trades, '2026-05-18').netResult).toBe(0);
    expect(aggregateDay(trades, '2026-05-18').tradeIds).toEqual([]);

    const tue = aggregateDay(trades, '2026-05-19');
    expect(tue.tradeIds).toEqual(['cross-day']);
    expect(tue.netResult).toBe(250);
    expect(tue.rTotal).toBeCloseTo(2.5, 10);
  });

  it('falls back to date when closedAt is null', () => {
    const trades: Trade[] = [
      makeTrade({
        id: 'legacy',
        date: new Date(2026, 4, 18, 10, 0),
        closedAt: null,
        netPnl: 100,
        grossPnl: 100,
      }),
    ];

    expect(aggregateDay(trades, '2026-05-18').netResult).toBe(100);
    expect(aggregateDay(trades, '2026-05-18').tradeIds).toEqual(['legacy']);
  });
});

describe('aggregateWeek - closedAt-based bucketing', () => {
  it('counts a Fri-buy/Mon-sell trade against the week containing the close day', () => {
    const friEntry = new Date(2026, 4, 15, 14, 0);
    const monClose = new Date(2026, 4, 18, 10, 0);
    const trades: Trade[] = [
      makeTrade({
        id: 'span',
        date: friEntry,
        closedAt: monClose.toISOString(),
        netPnl: 400,
        grossPnl: 400,
        initialRisk: 100,
      }),
    ];

    const week1 = aggregateWeek(trades, '2026-05-11', '2026-05-15');
    expect(week1.tradeIds).toEqual([]);
    expect(week1.netResult).toBe(0);

    const week2 = aggregateWeek(trades, '2026-05-18', '2026-05-22');
    expect(week2.tradeIds).toEqual(['span']);
    expect(week2.netResult).toBe(400);
    expect(week2.perDayR.map((entry) => entry.date)).toEqual(['2026-05-18']);
    expect(week2.perDayR[0].r).toBeCloseTo(4, 10);
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

describe('isCrossDayTrade', () => {
  it('returns false for a same-day trade', () => {
    const trade = makeTrade({
      id: 'same-day',
      date: new Date(2026, 4, 18, 10, 0),
      sortKey: '2026-05-18',
    });

    expect(isCrossDayTrade(trade)).toBe(false);
  });

  it('returns true for a cross-day-close trade', () => {
    const trade = makeTrade({
      id: 'cross-day',
      date: new Date(2026, 4, 18, 14, 0),
      sortKey: '2026-05-18',
      closedAt: new Date(2026, 4, 19, 10, 0).toISOString(),
    });

    expect(isCrossDayTrade(trade)).toBe(true);
  });

  it('returns false for an open trade even if closedAt is set', () => {
    const trade = makeTrade({
      id: 'open',
      date: new Date(2026, 4, 18, 10, 0),
      sortKey: '2026-05-18',
      closedAt: new Date(2026, 4, 19, 10, 0).toISOString(),
      isOpen: true,
    });

    expect(isCrossDayTrade(trade)).toBe(false);
  });

  it('falls back to date when closedAt is null', () => {
    const trade = makeTrade({
      id: 'legacy',
      date: new Date(2026, 4, 18, 10, 0),
      sortKey: '2026-05-18',
      closedAt: null,
    });

    expect(isCrossDayTrade(trade)).toBe(false);
  });
});

describe('isCrossDayTrade - production Date construction (ISO string)', () => {
  // In production, trade.date is built via `new Date(row.date)` where row.date
  // is a "YYYY-MM-DD" text column from the DB. `new Date("YYYY-MM-DD")` parses
  // as midnight UTC. In timezones west of GMT (e.g. EST UTC-5, PST UTC-8),
  // date-fns format(d, 'yyyy-MM-dd') returns the *previous* local calendar day
  // for a midnight-UTC Date, which made the old toLocalDateKey(trade.date)
  // comparison return "2026-05-18" instead of "2026-05-19", causing
  // isCrossDayTrade to return true for every same-day trade.
  //
  // The fix compares bucketKey(trade) against trade.sortKey (never re-parsed),
  // which is tz-agnostic. These tests use the exact production construction so
  // they would fail under the old implementation on west-of-GMT hosts.
  it('returns false for a same-day trade when date is constructed from an ISO date string', () => {
    const trade = makeTrade({
      id: 'iso-same-day',
      date: new Date('2026-05-19'),
      sortKey: '2026-05-19',
      closedAt: '2026-05-19T12:00:00.000Z',
    });

    expect(isCrossDayTrade(trade)).toBe(false);
  });

  it('still returns true for a genuine cross-day trade when using ISO date string construction', () => {
    const trade = makeTrade({
      id: 'iso-cross-day',
      date: new Date('2026-05-19'),
      sortKey: '2026-05-19',
      closedAt: '2026-05-20T12:00:00.000Z',
    });

    expect(isCrossDayTrade(trade)).toBe(true);
  });
});
