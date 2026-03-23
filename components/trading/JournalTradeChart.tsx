'use client';

import { memo, useMemo } from 'react';
import type { Trade } from '@/lib/types';
import CandlestickChart, { type TradeMarker } from '@/components/trading/CandlestickChart';
import {
  buildTradeChartOptions,
  type TradeChartTimeframeKey,
} from '@/lib/chart-timeframes';
import { useCandleData } from '@/hooks/use-candle-data';
import { nyDateTimeToEpoch, parseAbsoluteTimestampMs } from '@/lib/time-utils';

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

  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    if (trade.rawExecutions.length > 0) {
      return trade.rawExecutions.flatMap((execution) => {
        const fromTimestamp = parseAbsoluteTimestampMs(execution.timestamp);
        const parsed = fromTimestamp ?? nyDateTimeToEpoch(trade.sortKey, execution.time);
        if (parsed == null || !Number.isFinite(parsed)) return [];

        const direction = execution.side === 'ENTRY'
          ? trade.direction
          : trade.direction === 'LONG'
            ? 'SHORT'
            : 'LONG';

        return [{
          time: parsed,
          direction,
          price: execution.price,
          label: execution.side,
        }];
      });
    }

    const entry = nyDateTimeToEpoch(trade.sortKey, trade.entryTime);
    const exit = nyDateTimeToEpoch(trade.sortKey, trade.exitTime);
    const markers: TradeMarker[] = [];

    if (entry != null) {
      markers.push({
        time: entry,
        direction: trade.direction,
        price: trade.avgEntryPrice,
        label: 'ENTRY',
      });
    }

    if (exit != null) {
      markers.push({
        time: exit,
        direction: trade.direction === 'LONG' ? 'SHORT' : 'LONG',
        price: trade.avgExitPrice,
        label: 'EXIT',
      });
    }

    return markers;
  }, [trade]);

  if (isLoading) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-zinc-400">Loading chart...</div>;
  }

  if (error) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-zinc-400">{error}</div>;
  }

  if (candles.length === 0) {
    return <div className="flex h-[612px] items-center justify-center text-sm text-zinc-500">No intraday candles for this trade day.</div>;
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
