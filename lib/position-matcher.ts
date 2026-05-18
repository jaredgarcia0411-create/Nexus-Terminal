import type { Direction } from '@/lib/types';

export interface MatcherExecution {
  symbol: string;
  side: 'LONG_ENTRY' | 'LONG_EXIT' | 'SHORT_ENTRY' | 'SHORT_EXIT';
  qty: number;
  price: number;
  time: string;
  commission: number;
  fees: number;
}

export interface MatchedTrade {
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  commission: number;
  fees: number;
}

export interface MatcherResult {
  trades: MatchedTrade[];
  warnings: string[];
}

type RawBucket = {
  qty: number;
  price: number;
  time: string;
  commission: number;
  fees: number;
};

function compareTimes(a: string, b: string): number {
  const toSeconds = (time: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
  };
  const aSecs = toSeconds(a);
  const bSecs = toSeconds(b);
  if (aSecs != null && bSecs != null) return aSecs - bSecs;
  if (aSecs != null) return -1;
  if (bSecs != null) return 1;
  return a.localeCompare(b);
}

function remainder(exec: RawBucket, matched: number): RawBucket | null {
  const rem = exec.qty - matched;
  if (rem <= 0) return null;
  const ratio = exec.qty > 0 ? rem / exec.qty : 0;
  return { ...exec, qty: rem, commission: exec.commission * ratio, fees: exec.fees * ratio };
}

function fifoMatch(
  entries: RawBucket[],
  exits: RawBucket[],
  direction: Direction,
  symbol: string,
  warnings: string[],
): MatchedTrade[] {
  const se = [...entries].sort((a, b) => compareTimes(a.time, b.time));
  const sx = [...exits].sort((a, b) => compareTimes(a.time, b.time));
  const trades: MatchedTrade[] = [];

  let totalQty = 0;
  let entryValueSum = 0;
  let exitValueSum = 0;
  let totalGross = 0;
  let totalNet = 0;
  let totalCommission = 0;
  let totalFees = 0;
  let earliestEntry = '';
  let latestExit = '';

  while (se.length > 0 && sx.length > 0) {
    const entry = se.shift()!;
    const exit = sx.shift()!;
    const qty = Math.min(entry.qty, exit.qty);
    if (qty <= 0) {
      const entryRemainder = remainder(entry, qty);
      const exitRemainder = remainder(exit, qty);
      if (entryRemainder) se.unshift(entryRemainder);
      if (exitRemainder) sx.unshift(exitRemainder);
      continue;
    }

    const entryCommission = entry.qty > 0 ? (entry.commission / entry.qty) * qty : 0;
    const exitCommission = exit.qty > 0 ? (exit.commission / exit.qty) * qty : 0;
    const entryFees = entry.qty > 0 ? (entry.fees / entry.qty) * qty : 0;
    const exitFees = exit.qty > 0 ? (exit.fees / exit.qty) * qty : 0;
    const pairCommission = entryCommission + exitCommission;
    const pairFees = entryFees + exitFees;
    const gross = direction === 'LONG'
      ? (exit.price - entry.price) * qty
      : (entry.price - exit.price) * qty;
    const net = gross - pairCommission - pairFees;

    entryValueSum += entry.price * qty;
    exitValueSum += exit.price * qty;
    totalQty += qty;
    totalGross += gross;
    totalNet += net;
    totalCommission += pairCommission;
    totalFees += pairFees;

    if (!earliestEntry || compareTimes(entry.time, earliestEntry) < 0) earliestEntry = entry.time;
    if (!latestExit || compareTimes(exit.time, latestExit) > 0) latestExit = exit.time;

    const entryRemainder = remainder(entry, qty);
    const exitRemainder = remainder(exit, qty);
    if (entryRemainder) se.unshift(entryRemainder);
    if (exitRemainder) sx.unshift(exitRemainder);
  }

  if (totalQty > 0) {
    trades.push({
      symbol,
      direction,
      avgEntryPrice: entryValueSum / totalQty,
      avgExitPrice: exitValueSum / totalQty,
      totalQuantity: totalQty,
      grossPnl: totalGross,
      netPnl: totalNet,
      entryTime: earliestEntry,
      exitTime: latestExit,
      commission: totalCommission,
      fees: totalFees,
    });
  }

  if (se.length > 0) {
    const unmatchedQty = se.reduce((sum, exec) => sum + exec.qty, 0);
    const label = direction === 'LONG' ? 'BUY' : 'SHORT SELL';
    warnings.push(`${symbol}: ${unmatchedQty} unmatched ${label} share(s) (${se.length} fill(s)) - position may still be open; use the "Open position" checkbox to record it manually`);
  }
  if (sx.length > 0) {
    const unmatchedQty = sx.reduce((sum, exec) => sum + exec.qty, 0);
    const label = direction === 'LONG' ? 'SELL' : 'COVER BUY';
    warnings.push(`${symbol}: ${unmatchedQty} unmatched ${label} share(s) (${sx.length} fill(s)) - no matching entry fills for this day`);
  }

  return trades;
}

export function matchExecutions(executions: MatcherExecution[]): MatcherResult {
  const warnings: string[] = [];

  const longEntries: Record<string, RawBucket[]> = {};
  const longExits: Record<string, RawBucket[]> = {};
  const shortEntries: Record<string, RawBucket[]> = {};
  const shortExits: Record<string, RawBucket[]> = {};

  for (const exec of executions) {
    const { symbol, side, qty, price, time, commission, fees } = exec;
    const bucket: RawBucket = { qty, price, time, commission: commission ?? 0, fees: fees ?? 0 };
    if (side === 'LONG_ENTRY') (longEntries[symbol] ??= []).push(bucket);
    else if (side === 'LONG_EXIT') (longExits[symbol] ??= []).push(bucket);
    else if (side === 'SHORT_ENTRY') (shortEntries[symbol] ??= []).push(bucket);
    else if (side === 'SHORT_EXIT') (shortExits[symbol] ??= []).push(bucket);
  }

  const allSymbols = new Set([
    ...Object.keys(longEntries),
    ...Object.keys(longExits),
    ...Object.keys(shortEntries),
    ...Object.keys(shortExits),
  ]);

  const trades: MatchedTrade[] = [];
  for (const symbol of allSymbols) {
    trades.push(...fifoMatch(longEntries[symbol] ?? [], longExits[symbol] ?? [], 'LONG', symbol, warnings));
    trades.push(...fifoMatch(shortEntries[symbol] ?? [], shortExits[symbol] ?? [], 'SHORT', symbol, warnings));
  }

  return { trades, warnings };
}

export function normalizeSide(
  raw: string,
): 'LONG_ENTRY' | 'LONG_EXIT' | 'SHORT_ENTRY' | 'SHORT_EXIT' | null {
  switch (raw.trim().toUpperCase()) {
    case 'MARGIN':
    case 'BUY':
      return 'LONG_ENTRY';
    case 'S':
    case 'SELL':
      return 'LONG_EXIT';
    case 'SS':
    case 'SHORT':
      return 'SHORT_ENTRY';
    case 'B':
    case 'COVER':
      return 'SHORT_EXIT';
    default:
      return null;
  }
}
