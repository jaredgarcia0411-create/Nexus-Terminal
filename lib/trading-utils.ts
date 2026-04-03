import { nyDateTimeToEpoch, parseAbsoluteTimestampMs } from '@/lib/time-utils';
import type { Direction, Trade, TradeMarker } from '@/lib/types';

export const formatCurrency = (value: number) => {
  const absValue = Math.abs(value);
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${absValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatR = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
};

export const calculatePnL = (direction: Direction, entry: number, exit: number, qty: number) => {
  if (direction === 'LONG') {
    return (exit - entry) * qty;
  } else {
    return (entry - exit) * qty;
  }
};

export const parsePrice = (val: any): number => {
  if (typeof val === 'number') return val;
  return parseFloat(String(val).replace(/[$,]/g, '')) || 0;
};

export const getPnLColor = (value: number) => {
  if (value > 0) return 'text-emerald-500';
  if (value < 0) return 'text-rose-500';
  return 'text-zinc-400';
};

export const getPnLHex = (value: number) => {
  if (value > 0) return '#10b981';
  if (value < 0) return '#f43f5e';
  return '#71717a';
};

// Converts a trade's executions (or entry/exit times) into candlestick chart markers.
// Filters out executions whose timestamp cannot be resolved to avoid epoch-time markers.
export function buildTradeMarkers(trade: Trade): TradeMarker[] {
  if (trade.rawExecutions.length > 0) {
    return trade.rawExecutions.flatMap((execution) => {
      const abs = parseAbsoluteTimestampMs(execution.timestamp);
      const time = abs ?? nyDateTimeToEpoch(trade.sortKey, execution.time);
      if (time == null || !Number.isFinite(time)) return [];
      const direction = execution.side === 'ENTRY'
        ? trade.direction
        : trade.direction === 'LONG' ? 'SHORT' : 'LONG';
      return [{ time, direction, price: execution.price, label: execution.side }];
    });
  }

  const markers: TradeMarker[] = [];
  const entry = nyDateTimeToEpoch(trade.sortKey, trade.entryTime);
  const exit = nyDateTimeToEpoch(trade.sortKey, trade.exitTime);
  if (entry != null) {
    markers.push({ time: entry, direction: trade.direction, price: trade.avgEntryPrice, label: 'ENTRY' });
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
}
