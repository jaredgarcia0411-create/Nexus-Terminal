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
  isOpen?: boolean;
  remainingQty?: number;
  rawExecutions?: MatcherExecution[];
}

export interface OpenPositionInput {
  id: string;
  symbol: string;
  direction: Direction;
  totalQuantity: number;
  avgEntryPrice: number;
  entryTime: string;
  entryDate: Date;
  commission: number;
  fees: number;
}

export interface ClosingFill {
  openPositionId: string;
  symbol: string;
  direction: Direction;
  exitPrice: number;
  exitTime: string;
  matchedQty: number;
  grossPnl: number;
  netPnl: number;
  entryCommissionAllocated: number;
  entryFeesAllocated: number;
  exitCommission: number;
  exitFees: number;
  exitExecutions: MatcherExecution[];
}

export interface MatcherResult {
  trades: MatchedTrade[];
  newOpenPositions: MatchedTrade[];
  closingFills: ClosingFill[];
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

function toMatcherExecution(
  symbol: string,
  direction: Direction,
  side: 'ENTRY' | 'EXIT',
  exec: RawBucket,
): MatcherExecution {
  return {
    symbol,
    side: direction === 'LONG'
      ? (side === 'ENTRY' ? 'LONG_ENTRY' : 'LONG_EXIT')
      : (side === 'ENTRY' ? 'SHORT_ENTRY' : 'SHORT_EXIT'),
    qty: exec.qty,
    price: exec.price,
    time: exec.time,
    commission: exec.commission,
    fees: exec.fees,
  };
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
  const rawExecutions: MatcherExecution[] = [];

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
    const matchedEntry: RawBucket = { ...entry, qty, commission: entryCommission, fees: entryFees };
    const matchedExit: RawBucket = { ...exit, qty, commission: exitCommission, fees: exitFees };
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
    rawExecutions.push(
      toMatcherExecution(symbol, direction, 'ENTRY', matchedEntry),
      toMatcherExecution(symbol, direction, 'EXIT', matchedExit),
    );

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
      rawExecutions,
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

function matchSide(
  symbol: string,
  direction: Direction,
  entries: RawBucket[],
  exits: RawBucket[],
  opens: OpenPositionInput[],
  outTrades: MatchedTrade[],
  outNewOpen: MatchedTrade[],
  outClosing: ClosingFill[],
  warnings: string[],
): void {
  const sortedEntries = [...entries].sort((a, b) => compareTimes(a.time, b.time));
  const sortedExits = [...exits].sort((a, b) => compareTimes(a.time, b.time));

  for (const open of opens) {
    let remainingToClose = open.totalQuantity;
    const consumed: RawBucket[] = [];

    while (remainingToClose > 0 && sortedExits.length > 0) {
      const exit = sortedExits[0];
      const take = Math.min(remainingToClose, exit.qty);
      const ratio = exit.qty > 0 ? take / exit.qty : 0;
      const takeCommission = exit.commission * ratio;
      const takeFees = exit.fees * ratio;

      consumed.push({
        price: exit.price,
        qty: take,
        time: exit.time,
        commission: takeCommission,
        fees: takeFees,
      });

      if (take >= exit.qty) {
        sortedExits.shift();
      } else {
        sortedExits[0] = {
          ...exit,
          qty: exit.qty - take,
          commission: exit.commission - takeCommission,
          fees: exit.fees - takeFees,
        };
      }

      remainingToClose -= take;
    }

    const matchedQty = open.totalQuantity - remainingToClose;
    if (matchedQty <= 0) continue;

    const exitValueSum = consumed.reduce((sum, current) => sum + current.price * current.qty, 0);
    const exitPrice = matchedQty > 0 ? exitValueSum / matchedQty : 0;
    const exitTime = consumed.reduce(
      (latest, current) => (!latest || compareTimes(current.time, latest) > 0 ? current.time : latest),
      '',
    );
    const exitCommission = consumed.reduce((sum, current) => sum + current.commission, 0);
    const exitFees = consumed.reduce((sum, current) => sum + current.fees, 0);
    const entryRatio = open.totalQuantity > 0 ? matchedQty / open.totalQuantity : 0;
    const entryCommissionAllocated = open.commission * entryRatio;
    const entryFeesAllocated = open.fees * entryRatio;
    const grossPnl = direction === 'LONG'
      ? (exitPrice - open.avgEntryPrice) * matchedQty
      : (open.avgEntryPrice - exitPrice) * matchedQty;
    const netPnl = grossPnl - entryCommissionAllocated - entryFeesAllocated - exitCommission - exitFees;

    outClosing.push({
      openPositionId: open.id,
      symbol,
      direction,
      exitPrice,
      exitTime,
      matchedQty,
      grossPnl,
      netPnl,
      entryCommissionAllocated,
      entryFeesAllocated,
      exitCommission,
      exitFees,
      exitExecutions: consumed.map((current) => ({
        symbol,
        side: direction === 'LONG' ? 'LONG_EXIT' : 'SHORT_EXIT',
        qty: current.qty,
        price: current.price,
        time: current.time,
        commission: current.commission,
        fees: current.fees,
      })),
    });
  }

  let totalQty = 0;
  let entryValueSum = 0;
  let exitValueSum = 0;
  let totalGross = 0;
  let totalNet = 0;
  let totalCommission = 0;
  let totalFees = 0;
  let earliestEntry = '';
  let latestExit = '';
  const rawExecutions: MatcherExecution[] = [];

  while (sortedEntries.length > 0 && sortedExits.length > 0) {
    const entry = sortedEntries.shift()!;
    const exit = sortedExits.shift()!;
    const qty = Math.min(entry.qty, exit.qty);

    if (qty <= 0) {
      const entryRemainder = remainder(entry, qty);
      const exitRemainder = remainder(exit, qty);
      if (entryRemainder) sortedEntries.unshift(entryRemainder);
      if (exitRemainder) sortedExits.unshift(exitRemainder);
      continue;
    }

    const entryCommission = entry.qty > 0 ? (entry.commission / entry.qty) * qty : 0;
    const exitCommission = exit.qty > 0 ? (exit.commission / exit.qty) * qty : 0;
    const entryFees = entry.qty > 0 ? (entry.fees / entry.qty) * qty : 0;
    const exitFees = exit.qty > 0 ? (exit.fees / exit.qty) * qty : 0;
    const pairCommission = entryCommission + exitCommission;
    const pairFees = entryFees + exitFees;
    const matchedEntry: RawBucket = { ...entry, qty, commission: entryCommission, fees: entryFees };
    const matchedExit: RawBucket = { ...exit, qty, commission: exitCommission, fees: exitFees };
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
    rawExecutions.push(
      toMatcherExecution(symbol, direction, 'ENTRY', matchedEntry),
      toMatcherExecution(symbol, direction, 'EXIT', matchedExit),
    );

    const entryRemainder = remainder(entry, qty);
    const exitRemainder = remainder(exit, qty);
    if (entryRemainder) sortedEntries.unshift(entryRemainder);
    if (exitRemainder) sortedExits.unshift(exitRemainder);
  }

  if (totalQty > 0) {
    outTrades.push({
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
      rawExecutions,
    });
  }

  if (sortedEntries.length > 0) {
    const totalOpenQty = sortedEntries.reduce((sum, entry) => sum + entry.qty, 0);
    const openValueSum = sortedEntries.reduce((sum, entry) => sum + entry.price * entry.qty, 0);
    const openCommission = sortedEntries.reduce((sum, entry) => sum + entry.commission, 0);
    const openFees = sortedEntries.reduce((sum, entry) => sum + entry.fees, 0);
    const entryTime = sortedEntries.reduce(
      (earliest, entry) => (!earliest || compareTimes(entry.time, earliest) < 0 ? entry.time : earliest),
      '',
    );

    outNewOpen.push({
      symbol,
      direction,
      avgEntryPrice: totalOpenQty > 0 ? openValueSum / totalOpenQty : 0,
      avgExitPrice: 0,
      totalQuantity: totalOpenQty,
      grossPnl: 0,
      netPnl: 0,
      entryTime,
      exitTime: '',
      commission: openCommission,
      fees: openFees,
      isOpen: true,
      remainingQty: totalOpenQty,
      rawExecutions: sortedEntries.map((entry) => toMatcherExecution(symbol, direction, 'ENTRY', entry)),
    });
  }

  if (sortedExits.length > 0) {
    const unmatchedQty = sortedExits.reduce((sum, exit) => sum + exit.qty, 0);
    const label = direction === 'LONG' ? 'SELL' : 'COVER BUY';
    warnings.push(`${symbol}: ${unmatchedQty} unmatched ${label} share(s) (${sortedExits.length} fill(s)) - no matching entry or open position`);
  }
}

export function matchExecutions(
  executions: MatcherExecution[],
  openPositions: OpenPositionInput[] = [],
): MatcherResult {
  const warnings: string[] = [];
  const trades: MatchedTrade[] = [];
  const newOpenPositions: MatchedTrade[] = [];
  const closingFills: ClosingFill[] = [];

  const longEntries: Record<string, RawBucket[]> = {};
  const longExits: Record<string, RawBucket[]> = {};
  const shortEntries: Record<string, RawBucket[]> = {};
  const shortExits: Record<string, RawBucket[]> = {};
  const longOpen: Record<string, OpenPositionInput[]> = {};
  const shortOpen: Record<string, OpenPositionInput[]> = {};

  for (const exec of executions) {
    const { symbol, side, qty, price, time, commission, fees } = exec;
    const bucket: RawBucket = { qty, price, time, commission: commission ?? 0, fees: fees ?? 0 };
    if (side === 'LONG_ENTRY') (longEntries[symbol] ??= []).push(bucket);
    else if (side === 'LONG_EXIT') (longExits[symbol] ??= []).push(bucket);
    else if (side === 'SHORT_ENTRY') (shortEntries[symbol] ??= []).push(bucket);
    else if (side === 'SHORT_EXIT') (shortExits[symbol] ??= []).push(bucket);
  }

  for (const open of openPositions) {
    if (open.direction === 'LONG') (longOpen[open.symbol] ??= []).push(open);
    else (shortOpen[open.symbol] ??= []).push(open);
  }

  const sortOpen = (list: OpenPositionInput[]) => list.sort((a, b) => {
    const byDate = a.entryDate.getTime() - b.entryDate.getTime();
    if (byDate !== 0) return byDate;
    return compareTimes(a.entryTime, b.entryTime);
  });
  for (const list of Object.values(longOpen)) sortOpen(list);
  for (const list of Object.values(shortOpen)) sortOpen(list);

  const allSymbols = new Set([
    ...Object.keys(longEntries),
    ...Object.keys(longExits),
    ...Object.keys(shortEntries),
    ...Object.keys(shortExits),
    ...Object.keys(longOpen),
    ...Object.keys(shortOpen),
  ]);

  for (const symbol of allSymbols) {
    matchSide(
      symbol,
      'LONG',
      longEntries[symbol] ?? [],
      longExits[symbol] ?? [],
      longOpen[symbol] ?? [],
      trades,
      newOpenPositions,
      closingFills,
      warnings,
    );
    matchSide(
      symbol,
      'SHORT',
      shortEntries[symbol] ?? [],
      shortExits[symbol] ?? [],
      shortOpen[symbol] ?? [],
      trades,
      newOpenPositions,
      closingFills,
      warnings,
    );
  }

  return { trades, newOpenPositions, closingFills, warnings };
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
