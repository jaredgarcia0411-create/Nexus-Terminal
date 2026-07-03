'use client';

import { memo, useMemo, useState } from 'react';
import type { Trade } from '@/lib/types';
import AnnotatableChart from '@/components/trading/AnnotatableChart';
import type { TradeMarker } from '@/lib/types';
import {
  buildTradeChartOptions,
  type TradeChartTimeframeKey,
} from '@/lib/chart-timeframes';
import { useCandleData } from '@/hooks/use-candle-data';
import { useTradeExecutions } from '@/hooks/use-trade-executions';
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
import { buildTradeMarkers } from '@/lib/ui-trade-utils';

interface JournalTradeChartProps {
  trade: Trade;
}

function JournalTradeChart({ trade }: JournalTradeChartProps) {
  const [timeframe, setTimeframe] = useState<TradeChartTimeframeKey>('5m');

  const chartOptions = useMemo(() => {
    return buildTradeChartOptions(
      trade.sortKey,
      timeframe,
      isCrossDayTrade(trade) ? bucketKey(trade) : undefined,
    );
  }, [trade, timeframe]);

  const { candles, isLoading, error } = useCandleData(
    trade.symbol,
    chartOptions,
  );

  const executions = useTradeExecutions(trade.id, trade.rawExecutions);
  const tradeMarkers = useMemo<TradeMarker[]>(
    () => buildTradeMarkers({ ...trade, rawExecutions: executions }),
    [trade, executions],
  );

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
    <AnnotatableChart
      candles={candles}
      tradeMarkers={tradeMarkers}
      scopeKey={`trade:${trade.id}`}
      timeframe={timeframe}
      onTimeframeChange={setTimeframe}
      baseHeight={612}
      exactPriceMarkers
      showTimeAxis
      showSessionShading={timeframe !== '1d'}
    />
  );
}

export default memo(JournalTradeChart);
