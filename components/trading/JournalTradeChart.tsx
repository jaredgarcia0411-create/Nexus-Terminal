'use client';

import { memo, useMemo, useState } from 'react';
import type { Trade } from '@/lib/types';
import CandlestickChart, { type TradeMarker } from '@/components/trading/CandlestickChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCandleData } from '@/hooks/use-candle-data';

const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function getNyOffsetMs(atEpochMs: number) {
  const parts = NY_DATE_PARTS.formatToParts(new Date(atEpochMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - atEpochMs;
}

function parseSortKey(sortKey: string) {
  const match = sortKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseTime(time: string) {
  const match = String(time ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

function nyDateTimeToEpoch(sortKey: string, time: string) {
  const dateParts = parseSortKey(sortKey);
  const timeParts = parseTime(time);
  if (!dateParts || !timeParts) return null;

  const utcGuess = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    timeParts.seconds,
  );

  const offset = getNyOffsetMs(utcGuess);
  return utcGuess - offset;
}

function getMarketWindow(sortKey: string) {
  const start = nyDateTimeToEpoch(sortKey, '04:00:00');
  const end = nyDateTimeToEpoch(sortKey, '20:00:00');
  if (start == null || end == null) return null;
  return {
    startDate: String(start),
    endDate: String(end),
  };
}

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
  const marketWindow = useMemo(() => getMarketWindow(trade.sortKey), [trade.sortKey]);
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
        const fromTimestamp = execution.timestamp ? new Date(execution.timestamp).getTime() : NaN;
        const parsed = Number.isFinite(fromTimestamp) ? fromTimestamp : nyDateTimeToEpoch(trade.sortKey, execution.time);
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
      <CandlestickChart candles={candles} tradeMarkers={tradeMarkers} height={612} exactPriceMarkers showTimeAxis />
    </div>
  );
}

export default memo(JournalTradeChart);
