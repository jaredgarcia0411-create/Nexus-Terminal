import { describe, expect, it } from 'vitest';
import { calculateMfeMae } from '@/lib/mfe-mae';
import type { CandleData } from '@/components/trading/CandlestickChart';

// January date to avoid DST ambiguity: 09:30 ET == 14:30 UTC.
const candles: CandleData[] = [
  { datetime: Date.parse('2026-01-15T14:30:00Z'), open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1000 },
  { datetime: Date.parse('2026-01-15T14:31:00Z'), open: 10.2, high: 11.2, low: 10.1, close: 11.0, volume: 1200 },
  { datetime: Date.parse('2026-01-15T14:32:00Z'), open: 11.0, high: 11.1, low: 9.5, close: 9.8, volume: 1400 },
  { datetime: Date.parse('2026-01-15T14:33:00Z'), open: 9.8, high: 10.0, low: 9.2, close: 9.4, volume: 1500 },
];

describe('calculateMfeMae', () => {
  it('calculates LONG MFE/MAE correctly', () => {
    const result = calculateMfeMae('LONG', 10, 100, '09:30:00', '09:33:00', 2, 1, 70, candles);
    expect(result).not.toBeNull();
    expect(result!.mfe).toBeCloseTo((11.2 - 10) * 100);
    expect(result!.mae).toBeCloseTo((10 - 9.2) * 100);
    expect(result!.bestExitPnl).toBeCloseTo(result!.mfe - 3);
  });

  it('calculates SHORT MFE/MAE correctly', () => {
    const result = calculateMfeMae('SHORT', 10, 100, '09:30:00', '09:33:00', 2, 1, 50, candles);
    expect(result).not.toBeNull();
    expect(result!.mfe).toBeCloseTo((10 - 9.2) * 100);
    expect(result!.mae).toBeCloseTo((11.2 - 10) * 100);
  });

  it('returns null when no candles are in the time window', () => {
    const result = calculateMfeMae('LONG', 10, 100, '12:00:00', '12:30:00', 0, 0, 0, candles);
    expect(result).toBeNull();
  });

  it('returns null when exit time is earlier than entry time', () => {
    const result = calculateMfeMae('LONG', 10, 100, '10:00:00', '09:30:00', 0, 0, 0, candles);
    expect(result).toBeNull();
  });

  it('filters candles using an NY epoch window derived from trade times', () => {
    const windowCandles: CandleData[] = [
      { datetime: Date.parse('2026-01-15T14:29:00Z'), open: 10, high: 20, low: 1, close: 10, volume: 100 }, // outside
      { datetime: Date.parse('2026-01-15T14:30:00Z'), open: 10, high: 10.5, low: 9.7, close: 10.1, volume: 100 }, // inside
      { datetime: Date.parse('2026-01-15T14:31:00Z'), open: 10.1, high: 11.5, low: 9.6, close: 11.2, volume: 120 }, // inside
      { datetime: Date.parse('2026-01-15T14:32:00Z'), open: 11.2, high: 30, low: 0.5, close: 11, volume: 130 }, // outside
    ];

    const result = calculateMfeMae('LONG', 10, 100, '09:30:00', '09:31:00', 0, 0, 80, windowCandles);
    expect(result).not.toBeNull();
    expect(result!.mfe).toBeCloseTo((11.5 - 10) * 100);
    expect(result!.mae).toBeCloseTo((10 - 9.6) * 100);
  });

  it('clamps exit efficiency to [0, 1]', () => {
    const high = calculateMfeMae('LONG', 10, 100, '09:30:00', '09:33:00', 0, 0, 2000, candles);
    const low = calculateMfeMae('LONG', 10, 100, '09:30:00', '09:33:00', 0, 0, -10, candles);
    expect(high?.exitEfficiency).toBe(1);
    expect(low?.exitEfficiency).toBe(0);
  });
});
