import { describe, expect, it } from 'vitest';
import { bollingerBands, ema, macd, rsi, sma, vwap, type OHLCData } from '@/lib/indicators';

describe('sma', () => {
  it('returns null warmup slots and rolling means', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('handles edge periods and empty input', () => {
    expect(sma([], 3)).toEqual([]);
    expect(sma([1, 2, 3], 0)).toEqual([null, null, null]);
    expect(sma([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });
});

describe('ema', () => {
  it('seeds with SMA and then applies exponential smoothing', () => {
    const result = ema([10, 13, 12, 15], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(11.6666667, 6);
    expect(result[3]).toBeCloseTo(13.3333333, 6);
  });

  it('handles short series and invalid period values', () => {
    expect(ema([10, 11, 12], 10)).toEqual([null, null, null]);
    expect(ema([10, 11, 12], 0)).toEqual([null, null, null]);
    expect(ema([10, 11, 12], 1)).toEqual([10, 11, 12]);
  });
});

describe('bollingerBands', () => {
  it('matches the middle band when stddev is zero', () => {
    const result = bollingerBands([5, 5, 5, 5], 2, 2);
    expect(result.middle).toEqual([null, 5, 5, 5]);
    expect(result.upper).toEqual([null, 5, 5, 5]);
    expect(result.lower).toEqual([null, 5, 5, 5]);
  });

  it('returns empty or null arrays for edge windows', () => {
    expect(bollingerBands([], 20)).toEqual({ upper: [], middle: [], lower: [] });
    expect(bollingerBands([1, 2, 3], 0)).toEqual({
      upper: [null, null, null],
      middle: [null, null, null],
      lower: [null, null, null],
    });
    expect(bollingerBands([1, 2], 5)).toEqual({
      upper: [null, null],
      middle: [null, null],
      lower: [null, null],
    });
  });
});

describe('vwap', () => {
  it('handles zero-volume candles deterministically', () => {
    const candles: OHLCData[] = [
      { time: 1, open: 9, high: 10, low: 8, close: 9, volume: 0 },
      { time: 2, open: 11, high: 12, low: 10, close: 11, volume: 100 },
      { time: 3, open: 12, high: 15, low: 9, close: 12, volume: 50 },
    ];

    const result = vwap(candles);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(11, 8);
    expect(result[2]).toBeCloseTo(11.3333333, 6);
  });

  it('returns null for invalid candle values and keeps length', () => {
    const candles: OHLCData[] = [
      { time: 1, open: 9, high: 10, low: 8, close: 9, volume: 0 },
      { time: 2, open: 11, high: Number.NaN, low: 10, close: 11, volume: 100 },
      { time: 3, open: 12, high: 15, low: 9, close: 12, volume: 50 },
    ];

    const result = vwap(candles);

    expect(result).toEqual([null, null, 12]);
  });
});

describe('rsi', () => {
  it('returns all nulls when data is shorter than period + 1', () => {
    expect(rsi([1, 2, 3, 4], 14)).toEqual([null, null, null, null]);
  });

  it('handles invalid input values and non-positive periods', () => {
    expect(rsi([], 14)).toEqual([]);
    expect(rsi([100, 101, 102], 0)).toEqual([null, null, null]);
    expect(rsi([100, Number.NaN, 102], 2)).toEqual([null, null, null]);
  });

  it('returns deterministic high RSI for a monotonic uptrend', () => {
    const data = Array.from({ length: 16 }, (_, i) => i + 1);
    const result = rsi(data, 14);

    expect(result).toHaveLength(16);
    expect(result.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(result[14]).toBeCloseTo(99.00990099, 6);
    expect(result[15]).toBeCloseTo(99.00990099, 6);
  });
});

describe('macd', () => {
  it('aligns macd/signal/histogram null regions correctly', () => {
    const data = Array.from({ length: 40 }, (_, i) => 100 + i);
    const result = macd(data);

    expect(result.macd).toHaveLength(40);
    expect(result.signal).toHaveLength(40);
    expect(result.histogram).toHaveLength(40);

    expect(result.macd.slice(0, 25).every((value) => value === null)).toBe(true);
    expect(result.macd[25]).not.toBeNull();
    expect(result.signal.slice(0, 33).every((value) => value === null)).toBe(true);
    expect(result.signal[33]).not.toBeNull();

    for (let i = 0; i < result.macd.length; i++) {
      if (result.macd[i] !== null && result.signal[i] !== null) {
        expect(result.histogram[i]).toBeCloseTo(result.macd[i]! - result.signal[i]!, 10);
      } else {
        expect(result.histogram[i]).toBeNull();
      }
    }
  });

  it('returns null for invalid periods and short datasets', () => {
    expect(macd([], 12, 26, 9)).toEqual({
      macd: [],
      signal: [],
      histogram: [],
    });

    expect(macd([1, 2, 3], 0, 26, 9)).toEqual({
      macd: [null, null, null],
      signal: [null, null, null],
      histogram: [null, null, null],
    });

    expect(macd([1, 2, 3], 12, 26, 9)).toEqual({
      macd: [null, null, null],
      signal: [null, null, null],
      histogram: [null, null, null],
    });
  });
});
