import { getIntradaySessionWindow } from '@/lib/time-utils';

export type TradeChartTimeframeKey = '1m' | '5m' | '15m' | '1d';

export type TradeChartRequestOptions = {
  periodType: string;
  period: string;
  frequencyType: string;
  frequency: string;
  startDate?: string;
  endDate?: string;
  includePrePost?: boolean;
};

type TradeChartTimeframeConfig = TradeChartRequestOptions & { label: string };

export const TRADE_CHART_TIMEFRAME_CONFIG: Record<TradeChartTimeframeKey, TradeChartTimeframeConfig> = {
  '1m': { label: '1m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '1' },
  '5m': { label: '5m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '5' },
  '15m': { label: '15m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '15' },
  '1d': { label: 'Daily', periodType: 'year', period: '1', frequencyType: 'daily', frequency: '1' },
};

export function buildTradeChartOptions(sortKey: string, timeframe: TradeChartTimeframeKey): TradeChartRequestOptions {
  const base = TRADE_CHART_TIMEFRAME_CONFIG[timeframe];
  const baseOptions: TradeChartRequestOptions = {
    periodType: base.periodType,
    period: base.period,
    frequencyType: base.frequencyType,
    frequency: base.frequency,
  };

  if (timeframe === '1d') {
    return baseOptions;
  }

  const marketWindow = getIntradaySessionWindow(sortKey, true);
  return {
    ...baseOptions,
    startDate: marketWindow?.startDate,
    endDate: marketWindow?.endDate,
    includePrePost: true,
  };
}
