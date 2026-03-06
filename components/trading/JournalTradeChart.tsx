'use client';

import { memo, useMemo } from 'react';
import type { Trade } from '@/lib/types';
import CandlestickChart, { type IndicatorType, type TradeMarker } from '@/components/trading/CandlestickChart';
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

function JournalTradeChart({ trade }: JournalTradeChartProps) {
  const marketWindow = useMemo(() => getMarketWindow(trade.sortKey), [trade.sortKey]);

  const { candles, isLoading, error } = useCandleData(
    trade.symbol,
    marketWindow
      ? {
          periodType: 'day',
          period: '1',
          frequencyType: 'minute',
          frequency: '5',
          startDate: marketWindow.startDate,
          endDate: marketWindow.endDate,
          includePrePost: true,
        }
      : undefined,
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

  const indicators = useMemo<IndicatorType[]>(() => ['ema12', 'ema26'], []);

  if (isLoading) {
    return <div className="flex h-[408px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-zinc-400">Loading chart...</div>;
  }

  if (error) {
    return <div className="flex h-[408px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-zinc-400">{error}</div>;
  }

  if (candles.length === 0) {
    return <div className="flex h-[408px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-zinc-500">No intraday candles for this trade day.</div>;
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <CandlestickChart candles={candles} tradeMarkers={tradeMarkers} indicators={indicators} height={408} exactPriceMarkers />
    </div>
  );
}

export default memo(JournalTradeChart);
