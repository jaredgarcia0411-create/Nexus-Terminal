import { describe, expect, it } from 'vitest';

import {
  buildTradeChartOptions,
  TRADE_CHART_TIMEFRAME_CONFIG,
} from '@/lib/chart-timeframes';
import { nyDateTimeToEpoch } from '@/lib/time-utils';

describe('chart-timeframes', () => {
  it('keeps daily timeframe detached from intraday session windows', () => {
    const options = buildTradeChartOptions('2026-03-10', '1d');

    expect(options).toEqual({
      periodType: 'year',
      period: '1',
      frequencyType: 'daily',
      frequency: '1',
    });
  });

  it('adds NY pre/post session window for intraday frames', () => {
    const options = buildTradeChartOptions('2026-03-10', '5m');

    expect(options).toMatchObject({
      periodType: 'day',
      period: '1',
      frequencyType: 'minute',
      frequency: '5',
      includePrePost: true,
      startDate: String(nyDateTimeToEpoch('2026-03-09', '04:00:00')),
      endDate: String(nyDateTimeToEpoch('2026-03-10', '20:00:00')),
    });
  });

  it('normalizes weekend sort keys to prior trading session for intraday', () => {
    const options = buildTradeChartOptions('2026-03-07', '1m');

    expect(options.startDate).toBe(String(nyDateTimeToEpoch('2026-03-05', '04:00:00')));
    expect(options.endDate).toBe(String(nyDateTimeToEpoch('2026-03-06', '20:00:00')));
  });

  it('exposes expected timeframe labels for chart selectors', () => {
    expect(TRADE_CHART_TIMEFRAME_CONFIG['1m'].label).toBe('1m');
    expect(TRADE_CHART_TIMEFRAME_CONFIG['5m'].label).toBe('5m');
    expect(TRADE_CHART_TIMEFRAME_CONFIG['15m'].label).toBe('15m');
    expect(TRADE_CHART_TIMEFRAME_CONFIG['1d'].label).toBe('Daily');
  });
});
