import { describe, expect, it } from 'vitest';
import { runBacktest, type BacktestConfig } from '@/lib/backtesting/engine';
import type { OHLCData } from '@/lib/indicators';

function makeCandles(closes: number[]): OHLCData[] {
  return closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

function makeConfig(overrides: Partial<BacktestConfig>): BacktestConfig {
  return {
    initialCapital: 10000,
    positionSizePct: 0.1,
    entryCondition: () => null,
    exitCondition: () => false,
    params: {},
    ...overrides,
  };
}

describe('runBacktest', () => {
  it('runs a deterministic long trade with expected equity and stats', () => {
    const candles = makeCandles([100, 105, 110]);
    const config = makeConfig({
      entryCondition: (_candles, index) => (index === 0 ? 'LONG' : null),
      exitCondition: (_candles, index) => index === 2,
    });

    const result = runBacktest(candles, config);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: 'LONG',
      entryTime: 1,
      exitTime: 3,
      entryPrice: 100,
      exitPrice: 110,
      qty: 10,
      pnl: 100,
    });

    expect(result.equityCurve).toEqual([
      { time: 1, equity: 10000 },
      { time: 2, equity: 10050 },
      { time: 3, equity: 10100 },
    ]);

    expect(result.stats).toMatchObject({
      totalTrades: 1,
      winningTrades: 1,
      losingTrades: 0,
      winRate: 1,
      totalPnl: 100,
      avgWin: 100,
      avgLoss: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      initialCapital: 10000,
      finalEquity: 10100,
    });
    expect(result.stats.profitFactor).toBe(Infinity);
  });

  it('runs a deterministic short trade', () => {
    const candles = makeCandles([50, 45]);
    const config = makeConfig({
      initialCapital: 5000,
      positionSizePct: 0.2,
      entryCondition: (_candles, index) => (index === 0 ? 'SHORT' : null),
      exitCondition: (_candles, index) => index === 1,
    });

    const result = runBacktest(candles, config);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: 'SHORT',
      entryPrice: 50,
      exitPrice: 45,
      qty: 20,
      pnl: 100,
    });
    expect(result.stats.finalEquity).toBe(5100);
    expect(result.stats.totalPnl).toBe(100);
  });

  it('force-closes an open position at the last candle', () => {
    const candles = makeCandles([10, 12, 13]);
    const config = makeConfig({
      initialCapital: 1000,
      positionSizePct: 0.5,
      entryCondition: (_candles, index) => (index === 0 ? 'LONG' : null),
      exitCondition: () => false,
    });

    const result = runBacktest(candles, config);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      entryTime: 1,
      exitTime: 3,
      entryPrice: 10,
      exitPrice: 13,
      qty: 50,
      pnl: 150,
    });
    expect(result.stats.finalEquity).toBe(1150);
  });

  it('does not open positions when floored position size is zero', () => {
    const candles = makeCandles([1000, 1100]);
    const config = makeConfig({
      initialCapital: 500,
      positionSizePct: 0.1,
      entryCondition: () => 'LONG',
      exitCondition: () => true,
    });

    const result = runBacktest(candles, config);

    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toEqual([
      { time: 1, equity: 500 },
      { time: 2, equity: 500 },
    ]);
    expect(result.stats).toMatchObject({
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      initialCapital: 500,
      finalEquity: 500,
    });
  });

  it('computes drawdown and aggregate stats across win/loss trades', () => {
    const candles = makeCandles([100, 90, 95, 105]);
    const config = makeConfig({
      entryCondition: (_candles, index) => {
        if (index === 0 || index === 2) return 'LONG';
        return null;
      },
      exitCondition: (_candles, index) => index === 1 || index === 3,
    });

    const result = runBacktest(candles, config);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].pnl).toBe(-100);
    expect(result.trades[1].pnl).toBe(100);

    expect(result.stats).toMatchObject({
      totalTrades: 2,
      winningTrades: 1,
      losingTrades: 1,
      winRate: 0.5,
      totalPnl: 0,
      avgWin: 100,
      avgLoss: 100,
      profitFactor: 1,
      maxDrawdown: 100,
      maxDrawdownPct: 0.01,
      initialCapital: 10000,
      finalEquity: 10000,
    });
  });
});
