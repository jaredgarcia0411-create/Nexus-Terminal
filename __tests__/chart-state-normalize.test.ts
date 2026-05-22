import { describe, expect, it } from 'vitest';

import { normalizeChartState } from '@/components/trading/BacktestChartGrid';

const validTextDrawing = {
  id: 'text-1',
  type: 'text',
  position: { time: 1, price: 10 },
  text: 'note',
};

describe('normalizeChartState', () => {
  it('normalizes legacy flat chart state into the intraday bucket', () => {
    expect(normalizeChartState({
      drawings: [validTextDrawing],
      indicators: { primary: ['VWAP'] },
    })).toEqual({
      intraday: { drawings: [validTextDrawing], indicators: { primary: ['VWAP'] } },
      higher: { drawings: [], indicators: {} },
    });
  });

  it('passes through bucketed chart state', () => {
    const higherDrawing = {
      id: 'line-1',
      type: 'horizontal',
      price: 10,
      time: 1,
      color: '#fff',
      lineWidth: 1,
    };

    expect(normalizeChartState({
      drawings: { intraday: [validTextDrawing], higher: [higherDrawing] },
      indicators: { intraday: { primary: ['VWAP'] }, higher: { daily: ['SMA50'] } },
    })).toEqual({
      intraday: { drawings: [validTextDrawing], indicators: { primary: ['VWAP'] } },
      higher: { drawings: [higherDrawing], indicators: { daily: ['SMA50'] } },
    });
  });

  it('returns empty buckets for null input', () => {
    expect(normalizeChartState(null)).toEqual({
      intraday: { drawings: [], indicators: {} },
      higher: { drawings: [], indicators: {} },
    });
  });

  it('filters malformed drawing entries', () => {
    expect(normalizeChartState({
      drawings: { intraday: [{ id: 'bad-text', type: 'text', text: 'missing position' }], higher: [] },
      indicators: { intraday: {}, higher: {} },
    })).toEqual({
      intraday: { drawings: [], indicators: {} },
      higher: { drawings: [], indicators: {} },
    });
  });
});
