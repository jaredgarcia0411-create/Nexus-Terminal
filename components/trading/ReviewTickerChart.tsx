'use client';

import { memo, useMemo, useState } from 'react';

import AnnotatableChart from '@/components/trading/AnnotatableChart';
import { useCandleData } from '@/hooks/use-candle-data';
import { buildTradeChartOptions, type TradeChartTimeframeKey } from '@/lib/chart-timeframes';

interface ReviewTickerChartProps {
  ticker: string;
  // YYYY-MM-DD session the chart anchors to (review date, or weekly row's sourceDate).
  sortKey: string;
  // Stable key so annotations persist across reopens.
  scopeKey: string;
}

function ReviewTickerChart({ ticker, sortKey, scopeKey }: ReviewTickerChartProps) {
  const [timeframe, setTimeframe] = useState<TradeChartTimeframeKey>('5m');

  const chartOptions = useMemo(
    () => buildTradeChartOptions(sortKey, timeframe),
    [sortKey, timeframe],
  );

  const { candles, isLoading, error } = useCandleData(ticker, chartOptions);

  if (isLoading) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-muted-foreground">Loading chart...</div>;
  }
  if (error) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-muted-foreground">{error}</div>;
  }
  if (candles.length === 0) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-muted-foreground">No intraday candles for this day.</div>;
  }

  return (
    <AnnotatableChart
      candles={candles}
      tradeMarkers={[]}
      scopeKey={scopeKey}
      timeframe={timeframe}
      onTimeframeChange={setTimeframe}
      baseHeight={612}
      exactPriceMarkers
      showTimeAxis
      showSessionShading={timeframe !== '1d'}
      showVwap
    />
  );
}

export default memo(ReviewTickerChart);
