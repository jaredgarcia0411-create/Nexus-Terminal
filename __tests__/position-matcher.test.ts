import { describe, expect, it } from 'vitest';

import { matchExecutions, normalizeSide } from '@/lib/position-matcher';
import type { MatcherExecution, OpenPositionInput } from '@/lib/position-matcher';

function exec(
  symbol: string,
  side: MatcherExecution['side'],
  qty: number,
  price: number,
  time: string,
  commission = 0,
  fees = 0,
): MatcherExecution {
  return { symbol, side, qty, price, time, commission, fees };
}

function openPos(
  id: string,
  symbol: string,
  direction: 'LONG' | 'SHORT',
  totalQuantity: number,
  avgEntryPrice: number,
  entryTime: string,
  entryDate: Date,
  commission = 0,
  fees = 0,
): OpenPositionInput {
  return { id, symbol, direction, totalQuantity, avgEntryPrice, entryTime, entryDate, commission, fees };
}

describe('normalizeSide', () => {
  it('maps MARGIN and BUY to LONG_ENTRY', () => {
    expect(normalizeSide('MARGIN')).toBe('LONG_ENTRY');
    expect(normalizeSide('BUY')).toBe('LONG_ENTRY');
  });

  it('maps S and SELL to LONG_EXIT', () => {
    expect(normalizeSide('S')).toBe('LONG_EXIT');
    expect(normalizeSide('SELL')).toBe('LONG_EXIT');
  });

  it('maps SS and SHORT to SHORT_ENTRY', () => {
    expect(normalizeSide('SS')).toBe('SHORT_ENTRY');
    expect(normalizeSide('SHORT')).toBe('SHORT_ENTRY');
  });

  it('maps B and COVER to SHORT_EXIT', () => {
    expect(normalizeSide('B')).toBe('SHORT_EXIT');
    expect(normalizeSide('COVER')).toBe('SHORT_EXIT');
  });

  it('returns null for unknown side', () => {
    expect(normalizeSide('UNKNOWN')).toBeNull();
  });
});

describe('matchExecutions - LONG round-trip', () => {
  it('pairs a single buy and sell into one trade', () => {
    const result = matchExecutions([
      exec('AAPL', 'LONG_ENTRY', 100, 150, '09:30:00'),
      exec('AAPL', 'LONG_EXIT', 100, 155, '10:00:00'),
    ]);

    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.symbol).toBe('AAPL');
    expect(trade.direction).toBe('LONG');
    expect(trade.totalQuantity).toBe(100);
    expect(trade.avgEntryPrice).toBeCloseTo(150);
    expect(trade.avgExitPrice).toBeCloseTo(155);
    expect(trade.grossPnl).toBeCloseTo(500);
    expect(trade.netPnl).toBeCloseTo(500);
    expect(trade.entryTime).toBe('09:30:00');
    expect(trade.exitTime).toBe('10:00:00');
    expect(trade.rawExecutions).toEqual([
      expect.objectContaining({ side: 'LONG_ENTRY', qty: 100, price: 150, time: '09:30:00' }),
      expect.objectContaining({ side: 'LONG_EXIT', qty: 100, price: 155, time: '10:00:00' }),
    ]);
  });
});

describe('matchExecutions - SHORT round-trip', () => {
  it('pairs a single short sell and cover into one trade', () => {
    const result = matchExecutions([
      exec('TSLA', 'SHORT_ENTRY', 50, 200, '09:31:00'),
      exec('TSLA', 'SHORT_EXIT', 50, 195, '09:45:00'),
    ]);

    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.direction).toBe('SHORT');
    expect(trade.grossPnl).toBeCloseTo(250);
  });
});

describe('matchExecutions - unmatched entry becomes a new open position', () => {
  it('emits a new open position for unmatched long entry with no warning', () => {
    const result = matchExecutions([
      exec('NVDA', 'LONG_ENTRY', 200, 100, '09:30:00'),
    ]);

    expect(result.trades).toHaveLength(0);
    expect(result.newOpenPositions).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    const open = result.newOpenPositions[0];
    expect(open.symbol).toBe('NVDA');
    expect(open.direction).toBe('LONG');
    expect(open.totalQuantity).toBe(200);
    expect(open.avgEntryPrice).toBeCloseTo(100);
    expect(open.isOpen).toBe(true);
    expect(open.remainingQty).toBe(200);
    expect(open.rawExecutions).toEqual([
      expect.objectContaining({ side: 'LONG_ENTRY', qty: 200, price: 100, time: '09:30:00' }),
    ]);
  });
});

describe('matchExecutions - unmatched exit', () => {
  it('produces a warning for unmatched long exit', () => {
    const result = matchExecutions([
      exec('AMD', 'LONG_EXIT', 100, 50, '09:35:00'),
    ]);

    expect(result.trades).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/AMD/);
  });
});

describe('matchExecutions - multi-symbol', () => {
  it('produces separate trades for different symbols', () => {
    const result = matchExecutions([
      exec('AAPL', 'LONG_ENTRY', 100, 150, '09:30:00'),
      exec('AAPL', 'LONG_EXIT', 100, 155, '10:00:00'),
      exec('MSFT', 'SHORT_ENTRY', 50, 300, '09:31:00'),
      exec('MSFT', 'SHORT_EXIT', 50, 290, '10:05:00'),
    ]);

    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(2);
    const symbols = result.trades.map((trade) => trade.symbol).sort();
    expect(symbols).toEqual(['AAPL', 'MSFT']);
  });
});

describe('matchExecutions - commission and fees propagate', () => {
  it('deducts commission and fees from netPnl', () => {
    const result = matchExecutions([
      exec('X', 'LONG_ENTRY', 100, 10, '09:30:00', 2, 0.5),
      exec('X', 'LONG_EXIT', 100, 11, '10:00:00', 2, 0.5),
    ]);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.grossPnl).toBeCloseTo(100);
    expect(trade.commission).toBeCloseTo(4);
    expect(trade.fees).toBeCloseTo(1);
    expect(trade.netPnl).toBeCloseTo(95);
  });
});

describe('matchExecutions - cross-day full close', () => {
  it('closes a prior-day open long with same-symbol sells', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 100, 160, '10:00:00'),
    ], opens);

    expect(result.trades).toHaveLength(0);
    expect(result.newOpenPositions).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.closingFills).toHaveLength(1);
    const fill = result.closingFills[0];
    expect(fill.openPositionId).toBe('open1');
    expect(fill.matchedQty).toBe(100);
    expect(fill.exitPrice).toBeCloseTo(160);
    expect(fill.grossPnl).toBeCloseTo(1000);
    expect(fill.netPnl).toBeCloseTo(1000);
  });
});

describe('matchExecutions - cross-day partial close', () => {
  it('partially closes a prior-day open long', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 40, 160, '10:00:00'),
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    const fill = result.closingFills[0];
    expect(fill.matchedQty).toBe(40);
    expect(fill.grossPnl).toBeCloseTo(400);
    expect(result.newOpenPositions).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('matchExecutions - cross-day FIFO across multiple opens', () => {
  it('consumes the older open position first', () => {
    const opens = [
      openPos('open-newer', 'AAPL', 'LONG', 100, 160, '09:30:00', new Date('2026-05-16')),
      openPos('open-older', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15')),
    ];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 100, 170, '10:00:00'),
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    expect(result.closingFills[0].openPositionId).toBe('open-older');
    expect(result.closingFills[0].grossPnl).toBeCloseTo(2000);
  });
});

describe('matchExecutions - mixed same-day round-trip and cross-day close', () => {
  it('closes the open position first, then matches leftover same-day pairs', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 100, 160, '09:31:00'),
      exec('AAPL', 'LONG_ENTRY', 50, 161, '09:35:00'),
      exec('AAPL', 'LONG_EXIT', 50, 165, '09:45:00'),
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    expect(result.closingFills[0].matchedQty).toBe(100);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].totalQuantity).toBe(50);
    expect(result.trades[0].grossPnl).toBeCloseTo(200);
  });
});

describe('matchExecutions - opposite-direction open position is not consumed', () => {
  it('does not match a long exit against a short open position', () => {
    const opens = [openPos('open-short', 'AAPL', 'SHORT', 100, 150, '09:30:00', new Date('2026-05-15'))];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 100, 160, '10:00:00'),
    ], opens);

    expect(result.closingFills).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/AAPL/);
    expect(result.warnings[0]).toMatch(/unmatched/i);
  });
});

describe('matchExecutions - proportional commission allocation on partial close', () => {
  it('splits the open position commission and fees proportionally', () => {
    const opens = [openPos('open1', 'AAPL', 'LONG', 100, 150, '09:30:00', new Date('2026-05-15'), 10, 2)];
    const result = matchExecutions([
      exec('AAPL', 'LONG_EXIT', 40, 160, '10:00:00', 4, 1),
    ], opens);

    expect(result.closingFills).toHaveLength(1);
    const fill = result.closingFills[0];
    expect(fill.entryCommissionAllocated).toBeCloseTo(4);
    expect(fill.entryFeesAllocated).toBeCloseTo(0.8);
    expect(fill.exitCommission).toBeCloseTo(4);
    expect(fill.exitFees).toBeCloseTo(1);
    expect(fill.netPnl).toBeCloseTo(390.2);
  });
});

describe('matchExecutions - cross-day scale-in folds into the open position', () => {
  it('emits an addition instead of a second open position', () => {
    const open = openPos('t1', 'SPCX', 'SHORT', 150, 142.92, '09:35', new Date('2026-09-01'));
    const result = matchExecutions([exec('SPCX', 'SHORT_ENTRY', 85, 139.74, '10:15')], [open]);

    expect(result.newOpenPositions).toHaveLength(0);
    expect(result.additions).toHaveLength(1);
    expect(result.additions[0].openPositionId).toBe('t1');
    expect(result.additions[0].addedQty).toBe(85);
    expect(result.additions[0].addedValueSum).toBeCloseTo(85 * 139.74, 6);
    expect(result.warnings).toHaveLength(0);
  });

  it('folds into the oldest surviving position when several are open', () => {
    const older = openPos('t1', 'SPCX', 'SHORT', 100, 142.92, '09:35', new Date('2026-09-01'));
    const newer = openPos('t2', 'SPCX', 'SHORT', 50, 141.0, '09:40', new Date('2026-09-02'));
    const result = matchExecutions([exec('SPCX', 'SHORT_ENTRY', 25, 139.74, '10:15')], [older, newer]);

    expect(result.additions).toHaveLength(1);
    expect(result.additions[0].openPositionId).toBe('t1');
  });

  it('does not fold into a position the same batch fully closed', () => {
    const open = openPos('t1', 'SPCX', 'SHORT', 100, 142.92, '09:35', new Date('2026-09-01'));
    const result = matchExecutions([
      exec('SPCX', 'SHORT_EXIT', 100, 140.0, '09:45'),
      exec('SPCX', 'SHORT_ENTRY', 40, 139.0, '14:00'),
    ], [open]);

    expect(result.closingFills).toHaveLength(1);
    expect(result.additions).toHaveLength(0);
    expect(result.newOpenPositions).toHaveLength(1);
    expect(result.newOpenPositions[0].totalQuantity).toBe(40);
  });

  it('folds into a position the same batch only partially closed', () => {
    const open = openPos('t1', 'SPCX', 'SHORT', 100, 142.92, '09:35', new Date('2026-09-01'));
    const result = matchExecutions([
      exec('SPCX', 'SHORT_EXIT', 30, 140.0, '09:45'),
      exec('SPCX', 'SHORT_ENTRY', 40, 139.0, '14:00'),
    ], [open]);

    expect(result.closingFills).toHaveLength(1);
    expect(result.closingFills[0].matchedQty).toBe(30);
    expect(result.additions).toHaveLength(1);
    expect(result.additions[0].addedQty).toBe(40);
    expect(result.newOpenPositions).toHaveLength(0);
  });

  it('does not fold across opposite directions', () => {
    const open = openPos('t1', 'SPCX', 'SHORT', 100, 142.92, '09:35', new Date('2026-09-01'));
    const result = matchExecutions([exec('SPCX', 'LONG_ENTRY', 40, 139.0, '10:00')], [open]);

    expect(result.additions).toHaveLength(0);
    expect(result.newOpenPositions).toHaveLength(1);
    expect(result.newOpenPositions[0].direction).toBe('LONG');
  });
});
