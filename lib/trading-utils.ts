import { Trade, Direction } from './types';

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
