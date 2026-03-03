import type { OHLCData } from '../indicators';
import { sma, bollingerBands } from '../indicators';
import type { BacktestConfig, Position } from './engine';

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  params: { key: string; label: string; defaultValue: number; min: number; max: number; step: number }[];
  createConfig: (params: Record<string, number>) => Pick<BacktestConfig, 'entryCondition' | 'exitCondition' | 'params'>;
}

// Precompute indicator cache to avoid recalculating per bar
function getOrComputeSMA(cache: Map<string, (number | null)[]>, closes: number[], period: number): (number | null)[] {
  const key = `sma_${period}`;
  if (!cache.has(key)) {
    cache.set(key, sma(closes, period));
  }
  return cache.get(key)!;
}

export const smaCrossoverStrategy: StrategyDefinition = {
  id: 'sma-crossover',
  name: 'SMA Crossover',
  description: 'Go long when fast SMA crosses above slow SMA, exit when it crosses below.',
  params: [
    { key: 'fastPeriod', label: 'Fast Period', defaultValue: 10, min: 2, max: 100, step: 1 },
    { key: 'slowPeriod', label: 'Slow Period', defaultValue: 30, min: 5, max: 200, step: 1 },
  ],
  createConfig: (params) => {
    const cache = new Map<string, (number | null)[]>();
    let closesRef: number[] | null = null;

    const ensureCache = (candles: OHLCData[]) => {
      const closes = candles.map((c) => c.close);
      if (closesRef !== closes && closesRef?.length !== closes.length) {
        cache.clear();
        closesRef = closes;
      }
      return closes;
    };

    return {
      params,
      entryCondition: (candles, index, p) => {
        if (index < 1) return null;
        const closes = ensureCache(candles);
        const fast = getOrComputeSMA(cache, closes, p.fastPeriod);
        const slow = getOrComputeSMA(cache, closes, p.slowPeriod);

        const prevFast = fast[index - 1];
        const prevSlow = slow[index - 1];
        const currFast = fast[index];
        const currSlow = slow[index];

        if (prevFast === null || prevSlow === null || currFast === null || currSlow === null) return null;

        // Bullish crossover
        if (prevFast <= prevSlow && currFast > currSlow) return 'LONG';
        // Bearish crossover
        if (prevFast >= prevSlow && currFast < currSlow) return 'SHORT';

        return null;
      },
      exitCondition: (candles, index, position: Position, p) => {
        if (index < 1) return false;
        const closes = ensureCache(candles);
        const fast = getOrComputeSMA(cache, closes, p.fastPeriod);
        const slow = getOrComputeSMA(cache, closes, p.slowPeriod);

        const currFast = fast[index];
        const currSlow = slow[index];

        if (currFast === null || currSlow === null) return false;

        if (position.direction === 'LONG') return currFast < currSlow;
        return currFast > currSlow;
      },
    };
  },
};

export const meanReversionStrategy: StrategyDefinition = {
  id: 'mean-reversion',
  name: 'Mean Reversion (Bollinger Bounce)',
  description: 'Go long when price touches lower Bollinger Band, exit at middle band.',
  params: [
    { key: 'period', label: 'BB Period', defaultValue: 20, min: 5, max: 100, step: 1 },
    { key: 'stdDev', label: 'Std Dev Multiplier', defaultValue: 2, min: 1, max: 4, step: 0.5 },
  ],
  createConfig: (params) => {
    let cachedBB: ReturnType<typeof bollingerBands> | null = null;
    let lastLength = 0;

    const ensureBB = (candles: OHLCData[], p: Record<string, number>) => {
      if (!cachedBB || candles.length !== lastLength) {
        const closes = candles.map((c) => c.close);
        cachedBB = bollingerBands(closes, p.period, p.stdDev);
        lastLength = candles.length;
      }
      return cachedBB;
    };

    return {
      params,
      entryCondition: (candles, index, p) => {
        const bb = ensureBB(candles, p);
        const lower = bb.lower[index];
        if (lower === null) return null;

        if (candles[index].close <= lower) return 'LONG';
        return null;
      },
      exitCondition: (candles, index, _position: Position, p) => {
        const bb = ensureBB(candles, p);
        const middle = bb.middle[index];
        if (middle === null) return false;

        return candles[index].close >= middle;
      },
    };
  },
};

export const breakoutStrategy: StrategyDefinition = {
  id: 'breakout',
  name: 'N-Period Breakout',
  description: 'Go long on breakout above N-period high, exit on break below N-period low.',
  params: [
    { key: 'lookback', label: 'Lookback Period', defaultValue: 20, min: 5, max: 100, step: 1 },
  ],
  createConfig: (params) => {
    return {
      params,
      entryCondition: (candles, index, p) => {
        const lookback = p.lookback;
        if (index < lookback) return null;

        let high = -Infinity;
        for (let i = index - lookback; i < index; i++) {
          if (candles[i].high > high) high = candles[i].high;
        }

        if (candles[index].close > high) return 'LONG';
        return null;
      },
      exitCondition: (candles, index, _position: Position, p) => {
        const lookback = p.lookback;
        if (index < lookback) return false;

        let low = Infinity;
        for (let i = index - lookback; i < index; i++) {
          if (candles[i].low < low) low = candles[i].low;
        }

        return candles[index].close < low;
      },
    };
  },
};

export const ALL_STRATEGIES: StrategyDefinition[] = [
  smaCrossoverStrategy,
  meanReversionStrategy,
  breakoutStrategy,
];
