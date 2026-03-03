import type { OHLCData } from '../indicators';

export interface BacktestConfig {
  initialCapital: number;
  positionSizePct: number; // % of equity per trade (e.g., 0.1 = 10%)
  entryCondition: (candles: OHLCData[], index: number, params: Record<string, number>) => 'LONG' | 'SHORT' | null;
  exitCondition: (candles: OHLCData[], index: number, position: Position, params: Record<string, number>) => boolean;
  params: Record<string, number>;
}

export interface Position {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryIndex: number;
  qty: number;
}

export interface BacktestTrade {
  direction: 'LONG' | 'SHORT';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number }[];
  stats: BacktestStats;
}

export interface BacktestStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  initialCapital: number;
  finalEquity: number;
}

export function runBacktest(candles: OHLCData[], config: BacktestConfig): BacktestResult {
  const { initialCapital, positionSizePct, entryCondition, exitCondition, params } = config;

  let equity = initialCapital;
  let position: Position | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // Check exit first
    if (position && exitCondition(candles, i, position, params)) {
      const exitPrice = candle.close;
      const pnl =
        position.direction === 'LONG'
          ? (exitPrice - position.entryPrice) * position.qty
          : (position.entryPrice - exitPrice) * position.qty;

      equity += pnl;

      trades.push({
        direction: position.direction,
        entryTime: candles[position.entryIndex].time,
        exitTime: candle.time,
        entryPrice: position.entryPrice,
        exitPrice,
        qty: position.qty,
        pnl,
      });

      position = null;
    }

    // Check entry (only if flat)
    if (!position) {
      const signal = entryCondition(candles, i, params);
      if (signal) {
        const entryPrice = candle.close;
        const positionValue = equity * positionSizePct;
        const qty = Math.floor(positionValue / entryPrice);

        if (qty > 0) {
          position = {
            direction: signal,
            entryPrice,
            entryIndex: i,
            qty,
          };
        }
      }
    }

    // Track equity (mark-to-market)
    let mtm = equity;
    if (position) {
      const unrealized =
        position.direction === 'LONG'
          ? (candle.close - position.entryPrice) * position.qty
          : (position.entryPrice - candle.close) * position.qty;
      mtm = equity + unrealized;
    }
    equityCurve.push({ time: candle.time, equity: mtm });
  }

  // Close any remaining open position at last candle
  if (position && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const pnl =
      position.direction === 'LONG'
        ? (exitPrice - position.entryPrice) * position.qty
        : (position.entryPrice - exitPrice) * position.qty;

    equity += pnl;

    trades.push({
      direction: position.direction,
      entryTime: candles[position.entryIndex].time,
      exitTime: lastCandle.time,
      entryPrice: position.entryPrice,
      exitPrice,
      qty: position.qty,
      pnl,
    });
  }

  const stats = computeStats(trades, equityCurve, initialCapital, equity);

  return { trades, equityCurve, stats };
}

function computeStats(
  trades: BacktestTrade[],
  equityCurve: { time: number; equity: number }[],
  initialCapital: number,
  finalEquity: number,
): BacktestStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak - point.equity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? dd / peak : 0;
    }
  }

  // Sharpe ratio (annualized, using daily returns approximation)
  let sharpeRatio = 0;
  if (equityCurve.length > 1) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      if (prev > 0) {
        returns.push((equityCurve[i].equity - prev) / prev);
      }
    }
    if (returns.length > 0) {
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        sharpeRatio = (mean / stdDev) * Math.sqrt(252); // Annualized
      }
    }
  }

  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    totalPnl: finalEquity - initialCapital,
    avgWin: wins.length > 0 ? totalWins / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLosses / losses.length : 0,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    initialCapital,
    finalEquity,
  };
}
