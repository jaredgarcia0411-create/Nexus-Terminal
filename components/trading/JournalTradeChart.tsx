'use client';

import { memo, useMemo } from 'react';
import type { Trade } from '@/lib/types';
import CandlestickChart from '@/components/trading/CandlestickChart';
import type { TradeMarker } from '@/lib/types';
import {
  buildTradeChartOptions,
  type TradeChartTimeframeKey,
} from '@/lib/chart-timeframes';
import { useCandleData } from '@/hooks/use-candle-data';
import { buildTradeMarkers } from '@/lib/ui-trade-utils';

interface JournalTradeChartProps {
  trade: Trade;
  timeframe: TradeChartTimeframeKey;
}

function JournalTradeChart({ trade, timeframe }: JournalTradeChartProps) {
  const chartOptions = useMemo(() => {
    return buildTradeChartOptions(trade.sortKey, timeframe);
  }, [trade.sortKey, timeframe]);

  const { candles, isLoading, error } = useCandleData(
    trade.symbol,
    chartOptions,
  );

  const tradeMarkers = useMemo<TradeMarker[]>(() => buildTradeMarkers(trade), [trade]);

  if (isLoading) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-muted-foreground">Loading chart...</div>;
  }

  if (error) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-muted-foreground">{error}</div>;
  }

  if (candles.length === 0) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-muted-foreground">No intraday candles for this trade day.</div>;
  }

  return (
    <CandlestickChart
      candles={candles}
      tradeMarkers={tradeMarkers}
      height={612}
      exactPriceMarkers
      showTimeAxis
      showSessionShading={timeframe !== '1d'}
    />
  );
}

export default memo(JournalTradeChart);
