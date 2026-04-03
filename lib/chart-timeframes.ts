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

export type FrameConfig = {
  label: string;
  periodType: string;
  period: string;
  frequencyType: string;
  frequency: string;
  intraday: boolean;
};

export type ChartsTabTimeframeKey = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

export const CHARTS_TAB_FRAME_CONFIG: Record<ChartsTabTimeframeKey, FrameConfig> = {
  '1m': { label: '1m', periodType: 'day', period: '5', frequencyType: 'minute', frequency: '1', intraday: true },
  '5m': { label: '5m', periodType: 'day', period: '10', frequencyType: 'minute', frequency: '5', intraday: true },
  '15m': { label: '15m', periodType: 'month', period: '1', frequencyType: 'minute', frequency: '15', intraday: true },
  '30m': { label: '30m', periodType: 'month', period: '2', frequencyType: 'minute', frequency: '30', intraday: true },
  '1h': { label: '1h', periodType: 'month', period: '3', frequencyType: 'minute', frequency: '60', intraday: true },
  '4h': { label: '4h', periodType: 'month', period: '6', frequencyType: 'minute', frequency: '240', intraday: true },
  '1d': { label: '1D', periodType: 'year', period: '2', frequencyType: 'daily', frequency: '1', intraday: false },
  '1w': { label: '1W', periodType: 'year', period: '5', frequencyType: 'weekly', frequency: '1', intraday: false },
  '1M': { label: '1M', periodType: 'year', period: '10', frequencyType: 'monthly', frequency: '1', intraday: false },
};

export type ResearchChartTimeframeKey = '1m' | '5m' | '15m' | '30m' | '1h' | '1D';

export const RESEARCH_CHART_FRAME_CONFIG: Record<ResearchChartTimeframeKey, FrameConfig> = {
  '1m': { label: '1m', periodType: 'day', period: '5', frequencyType: 'minute', frequency: '1', intraday: true },
  '5m': { label: '5m', periodType: 'day', period: '10', frequencyType: 'minute', frequency: '5', intraday: true },
  '15m': { label: '15m', periodType: 'month', period: '1', frequencyType: 'minute', frequency: '15', intraday: true },
  '30m': { label: '30m', periodType: 'month', period: '2', frequencyType: 'minute', frequency: '30', intraday: true },
  '1h': { label: '1h', periodType: 'month', period: '3', frequencyType: 'minute', frequency: '60', intraday: true },
  '1D': { label: '1D', periodType: 'year', period: '2', frequencyType: 'daily', frequency: '1', intraday: false },
};
