'use client';

import { memo, useMemo, useState } from 'react';
import type { Trade } from '@/lib/types';
import CandlestickChart, { type TradeMarker } from '@/components/trading/CandlestickChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCandleData } from '@/hooks/use-candle-data';
import { getIntradaySessionWindow, nyDateTimeToEpoch, parseAbsoluteTimestampMs } from '@/lib/time-utils';

interface JournalTradeChartProps {
  trade: Trade;
}

type TimeframeKey = '1m' | '5m' | '15m' | '1d';

const TIMEFRAME_CONFIG: Record<
  TimeframeKey,
  { label: string; periodType: string; period: string; frequencyType: string; frequency: string }
> = {
  '1m': { label: '1m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '1' },
  '5m': { label: '5m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '5' },
  '15m': { label: '15m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '15' },
  '1d': { label: 'Daily', periodType: 'year', period: '1', frequencyType: 'daily', frequency: '1' },
};

function JournalTradeChart({ trade }: JournalTradeChartProps) {
  const [timeframe, setTimeframe] = useState<TimeframeKey>('5m');
  const marketWindow = useMemo(() => getIntradaySessionWindow(trade.sortKey, true), [trade.sortKey]);
  const chartOptions = useMemo(() => {
    const base = TIMEFRAME_CONFIG[timeframe];
    if (timeframe === '1d') {
      return base;
    }

    return {
      ...base,
      startDate: marketWindow?.startDate,
      endDate: marketWindow?.endDate,
      includePrePost: true,
    };
  }, [marketWindow, timeframe]);

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
    return <div className="flex h-[612px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-zinc-400">Loading chart...</div>;
  }

  if (error) {
    return <div className="flex h-[612px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-zinc-400">{error}</div>;
  }

  if (candles.length === 0) {
    return <div className="flex h-[612px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-zinc-500">No intraday candles for this trade day.</div>;
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex items-center justify-end">
        <Select value={timeframe} onValueChange={(value) => setTimeframe(value as TimeframeKey)}>
          <SelectTrigger className="h-8 w-28 bg-white/5 border-white/10 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#18181b] border-white/10 text-white">
            {Object.entries(TIMEFRAME_CONFIG).map(([value, cfg]) => (
              <SelectItem key={value} value={value}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <CandlestickChart
        candles={candles}
        tradeMarkers={tradeMarkers}
        height={612}
        exactPriceMarkers
        showTimeAxis
        showSessionShading={timeframe !== '1d'}
      />
    </div>
  );
}

export default memo(JournalTradeChart);
