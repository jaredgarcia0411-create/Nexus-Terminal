import { describe, expect, it } from 'vitest';

import { matchExecutions, normalizeSide } from '@/lib/position-matcher';
import type { MatcherExecution } from '@/lib/position-matcher';

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

describe('matchExecutions - unmatched entry', () => {
  it('produces a warning for unmatched long entry', () => {
    const result = matchExecutions([
      exec('NVDA', 'LONG_ENTRY', 200, 100, '09:30:00'),
    ]);

    expect(result.trades).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/NVDA/);
    expect(result.warnings[0]).toMatch(/unmatched/i);
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
