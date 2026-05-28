import { format } from 'date-fns';
import { normalizeSide, type MatcherExecution } from '@/lib/position-matcher';
import { defaultParser } from './parsers/default';
import type { BrokerParserConfig } from './parsers/types';
import { parseTimeToSeconds } from './parsers/utils';
import { Trade, Direction } from './types';

export interface RawExecution {
  qty: number;
  price: number;
  time: string;
  commission: number;
  fees: number;
}

export interface SymbolExecutions {
  shortEntry: RawExecution[];
  shortExit: RawExecution[];
  longEntry: RawExecution[];
  longExit: RawExecution[];
}

export interface ProcessedCsvResult {
  trades: Trade[];
  warnings: string[];
}

interface MatchedPair {
  symbol: string;
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  commission: number;
  fees: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
}

function compareTimes(a: string, b: string): number {
  const aSecs = parseTimeToSeconds(a);
  const bSecs = parseTimeToSeconds(b);

  if (aSecs != null && bSecs != null) return aSecs - bSecs;
  if (aSecs != null && bSecs == null) return -1;
  if (aSecs == null && bSecs != null) return 1;
  return a.localeCompare(b);
}

function buildRemainingExecution(exec: RawExecution, matchedQty: number): RawExecution | null {
  const remainingQty = exec.qty - matchedQty;
  if (remainingQty <= 0) return null;

  const ratio = exec.qty > 0 ? remainingQty / exec.qty : 0;
  return {
    ...exec,
    qty: remainingQty,
    commission: exec.commission * ratio,
    fees: exec.fees * ratio,
  };
}

export const parseDateFromFilename = (filename: string) => {
  const base = filename.replace(/\.csv$/i, '');
  const numberParts = Array.from(base.matchAll(/\d+/g));
  if (numberParts.length < 3) return null;

  const lastThree = numberParts.slice(-3).map((part) => part[0]);
  const [firstRaw, secondRaw, thirdRaw] = lastThree;

  let year: number;
  let month: number;
  let day: number;

  if (firstRaw.length === 4) {
    year = Number(firstRaw);
    month = Number(secondRaw);
    day = Number(thirdRaw);
  } else {
    year = Number(thirdRaw.length === 2 ? `20${thirdRaw}` : thirdRaw);
    const first = Number(firstRaw);
    const second = Number(secondRaw);

    if (first >= 1 && first <= 12 && second >= 1 && second <= 31) {
      month = first;
      day = second;
    } else if (second >= 1 && second <= 12 && first >= 1 && first <= 31) {
      month = second;
      day = first;
    } else {
      return null;
    }
  }

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return {
    date,
    sortKey: format(date, 'yyyy-MM-dd'),
  };
};

export interface ExtractRawResult {
  executions: MatcherExecution[];
  warnings: string[];
}

export const extractRawExecutions = (
  data: Record<string, string>[],
  parser?: BrokerParserConfig,
): ExtractRawResult => {
  const warnings: string[] = [];
  const executions: MatcherExecution[] = [];
  const activeParser = parser ?? defaultParser;
  const parserContext = activeParser.buildContext?.(data as Record<string, unknown>[]);

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = activeParser.normalizeRow(rawRow as Record<string, unknown>, rowIndex, parserContext);

      if (!exec) return;

      const canonicalSide = normalizeSide(exec.side);
      if (!canonicalSide) {
        warnings.push(`Row ${rowIndex + 1}: Unknown side "${exec.side}" for ${exec.symbol}, skipping`);
        return;
      }

      executions.push({
        symbol: exec.symbol,
        side: canonicalSide,
        qty: exec.qty,
        price: exec.price,
        time: exec.time,
        commission: exec.commission,
        fees: exec.fees,
      });
    } catch (rowError) {
      const msg = rowError instanceof Error ? rowError.message : 'Unknown error';
      warnings.push(`Row ${rowIndex + 1}: Parse error — ${msg}`);
    }
  });

  if (parserContext && typeof parserContext === 'object') {
    const parserWarnings = (parserContext as { warnings?: unknown }).warnings;
    if (Array.isArray(parserWarnings)) {
      for (const warning of parserWarnings) {
        if (typeof warning === 'string' && warning.trim()) {
          warnings.push(warning);
        }
      }
    }
  }

  return { executions, warnings };
};

function consolidateExecutions(
  tradeId: string,
  executions: Trade['rawExecutions'],
): Trade['rawExecutions'] {
  const merged = new Map<string, Trade['rawExecutions'][number]>();

  for (const exec of executions) {
    const key = `${exec.side}|${exec.time}|${exec.price}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += exec.qty;
      existing.commission += exec.commission;
      existing.fees += exec.fees;
      continue;
    }
    merged.set(key, { ...exec });
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      const byTime = compareTimes(a.time, b.time);
      if (byTime !== 0) return byTime;
      if (a.side !== b.side) return a.side === 'ENTRY' ? -1 : 1;
      return a.price - b.price;
    })
    .map((exec, index) => ({
      ...exec,
      id: `${tradeId}|${exec.side}|${index}`,
    }));
}

export const processCsvData = (
  data: Record<string, string>[],
  dateInfo: { date: Date; sortKey: string },
  parser?: BrokerParserConfig,
): ProcessedCsvResult => {
  const symbolMap: Record<string, SymbolExecutions> = {};
  const warnings: string[] = [];
  const activeParser = parser ?? defaultParser;
  const parserContext = activeParser.buildContext?.(data as Record<string, unknown>[]);

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = activeParser.normalizeRow(rawRow as Record<string, unknown>, rowIndex, parserContext);

      if (!exec) return;

      const { symbol: sym, side, qty, price, time, commission, fees } = exec;

      if (!symbolMap[sym]) {
        symbolMap[sym] = { shortEntry: [], shortExit: [], longEntry: [], longExit: [] };
      }

      if (side === 'SS') symbolMap[sym].shortEntry.push({ qty, price, time, commission, fees });
      else if (side === 'B') symbolMap[sym].shortExit.push({ qty, price, time, commission, fees });
      else if (side === 'MARGIN') symbolMap[sym].longEntry.push({ qty, price, time, commission, fees });
      else if (side === 'S') symbolMap[sym].longExit.push({ qty, price, time, commission, fees });
    } catch (rowError) {
      const msg = rowError instanceof Error ? rowError.message : 'Unknown error';
      warnings.push(`Row ${rowIndex + 1}: Parse error — ${msg}`);
    }
  });

  if (parserContext && typeof parserContext === 'object') {
    const parserWarnings = (parserContext as { warnings?: unknown }).warnings;
    if (Array.isArray(parserWarnings)) {
      for (const warning of parserWarnings) {
        if (typeof warning === 'string' && warning.trim()) {
          warnings.push(warning);
        }
      }
    }
  }

  // Normalize bucket ordering to chronological execution matching.
  for (const bucket of Object.values(symbolMap)) {
    bucket.shortEntry.sort((a, b) => compareTimes(a.time, b.time));
    bucket.shortExit.sort((a, b) => compareTimes(a.time, b.time));
    bucket.longEntry.sort((a, b) => compareTimes(a.time, b.time));
    bucket.longExit.sort((a, b) => compareTimes(a.time, b.time));
  }

  const matchedPairs: MatchedPair[] = [];

  Object.entries(symbolMap).forEach(([sym, d]) => {
    const se = [...d.shortEntry];
    const sx = [...d.shortExit];
    while (se.length && sx.length) {
      const entry = se.shift()!;
      const exit = sx.shift()!;
      const q = Math.min(entry.qty, exit.qty);

      if (q <= 0) {
        const entryRemainder = buildRemainingExecution(entry, q);
        const exitRemainder = buildRemainingExecution(exit, q);
        if (entryRemainder) se.unshift(entryRemainder);
        if (exitRemainder) sx.unshift(exitRemainder);
        continue;
      }

      const commission =
        (entry.qty > 0 ? (entry.commission / entry.qty) * q : 0) +
        (exit.qty > 0 ? (exit.commission / exit.qty) * q : 0);
      const fees =
        (entry.qty > 0 ? (entry.fees / entry.qty) * q : 0) +
        (exit.qty > 0 ? (exit.fees / exit.qty) * q : 0);

      matchedPairs.push({
        symbol: sym,
        direction: 'SHORT' as Direction,
        entryPrice: entry.price,
        exitPrice: exit.price,
        qty: q,
        commission,
        fees,
        grossPnl: (entry.price - exit.price) * q,
        netPnl: (entry.price - exit.price) * q - commission - fees,
        entryTime: entry.time,
        exitTime: exit.time,
      });

      const entryRemainder = buildRemainingExecution(entry, q);
      const exitRemainder = buildRemainingExecution(exit, q);
      if (entryRemainder) se.unshift(entryRemainder);
      if (exitRemainder) sx.unshift(exitRemainder);
    }

    const le = [...d.longEntry];
    const lx = [...d.longExit];
    while (le.length && lx.length) {
      const entry = le.shift()!;
      const exit = lx.shift()!;
      const q = Math.min(entry.qty, exit.qty);

      if (q <= 0) {
        const entryRemainder = buildRemainingExecution(entry, q);
        const exitRemainder = buildRemainingExecution(exit, q);
        if (entryRemainder) le.unshift(entryRemainder);
        if (exitRemainder) lx.unshift(exitRemainder);
        continue;
      }

      const commission =
        (entry.qty > 0 ? (entry.commission / entry.qty) * q : 0) +
        (exit.qty > 0 ? (exit.commission / exit.qty) * q : 0);
      const fees =
        (entry.qty > 0 ? (entry.fees / entry.qty) * q : 0) +
        (exit.qty > 0 ? (exit.fees / exit.qty) * q : 0);

      matchedPairs.push({
        symbol: sym,
        direction: 'LONG' as Direction,
        entryPrice: entry.price,
        exitPrice: exit.price,
        qty: q,
        commission,
        fees,
        grossPnl: (exit.price - entry.price) * q,
        netPnl: (exit.price - entry.price) * q - commission - fees,
        entryTime: entry.time,
        exitTime: exit.time,
      });

      const entryRemainder = buildRemainingExecution(entry, q);
      const exitRemainder = buildRemainingExecution(exit, q);
      if (entryRemainder) le.unshift(entryRemainder);
      if (exitRemainder) lx.unshift(exitRemainder);
    }

    const pushUnmatched = (rows: RawExecution[], label: string, hint: string) => {
      if (rows.length === 0) return;
      const totalQty = rows.reduce((sum, r) => sum + r.qty, 0);
      const qtyDisplay = Number.isInteger(totalQty) ? totalQty : Math.round(totalQty * 100) / 100;
      const shares = qtyDisplay === 1 ? 'share' : 'shares';
      const fills = rows.length === 1 ? 'fill' : 'fills';
      warnings.push(`${sym}: ${qtyDisplay} unmatched ${label} ${shares} (${rows.length} ${fills}) — ${hint}`);
    };

    pushUnmatched(se, 'SHORT SELL', 'position may still be open short');
    pushUnmatched(sx, 'COVER BUY', 'no matching short entries (carry-over from earlier session?)');
    pushUnmatched(le, 'BUY', 'position may still be open long');
    pushUnmatched(lx, 'SELL', 'no matching long entries (carry-over from earlier session?)');
  });

  const mergedMap: Record<string, Trade> = {};

  matchedPairs.forEach((pair) => {
    const key = `${dateInfo.sortKey}|${pair.symbol}|${pair.direction}`;
    if (!mergedMap[key]) {
      mergedMap[key] = {
        id: key,
        date: dateInfo.date,
        sortKey: dateInfo.sortKey,
        symbol: pair.symbol,
        direction: pair.direction,
        avgEntryPrice: 0,
        avgExitPrice: 0,
        totalQuantity: 0,
        grossPnl: 0,
        netPnl: 0,
        entryTime: '',
        exitTime: '',
        executionCount: 0,
        rawExecutions: [],
        pnl: 0,
        executions: 0,
        commission: 0,
        fees: 0,
        tags: [],
      };
    }

    const trade = mergedMap[key];

    if (trade.date.getHours() === 0 && trade.date.getMinutes() === 0) {
      const firstEntry = pair.direction === 'LONG' ? symbolMap[pair.symbol].longEntry[0] : symbolMap[pair.symbol].shortEntry[0];

      if (firstEntry && firstEntry.time) {
        const timeParts = firstEntry.time.split(':');
        if (timeParts.length >= 2) {
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          const seconds = timeParts.length > 2 ? parseInt(timeParts[2], 10) : 0;

          const newDate = new Date(trade.date);
          newDate.setHours(hours, minutes, seconds);
          trade.date = newDate;
        }
      }
    }

    const entryValue = trade.avgEntryPrice * trade.totalQuantity + pair.entryPrice * pair.qty;
    const exitValue = trade.avgExitPrice * trade.totalQuantity + pair.exitPrice * pair.qty;

    trade.totalQuantity += pair.qty;
    trade.grossPnl += pair.grossPnl;
    trade.netPnl += pair.netPnl;
    trade.pnl = trade.netPnl;
    trade.commission = (trade.commission || 0) + pair.commission;
    trade.fees = (trade.fees || 0) + pair.fees;
    trade.executionCount++;
    trade['executions'] = trade.executionCount;
    trade.avgEntryPrice = entryValue / trade.totalQuantity;
    trade.avgExitPrice = exitValue / trade.totalQuantity;

    if (!trade.entryTime || compareTimes(pair.entryTime, trade.entryTime) < 0) {
      trade.entryTime = pair.entryTime;
    }
    if (!trade.exitTime || compareTimes(pair.exitTime, trade.exitTime) > 0) {
      trade.exitTime = pair.exitTime;
    }

    const executionBase = `${trade.id}|${trade.executionCount}`;
    trade.rawExecutions.push(
      {
        id: `${executionBase}|ENTRY`,
        side: 'ENTRY',
        price: pair.entryPrice,
        qty: pair.qty,
        time: pair.entryTime,
        commission: pair.commission / 2,
        fees: pair.fees / 2,
      },
      {
        id: `${executionBase}|EXIT`,
        side: 'EXIT',
        price: pair.exitPrice,
        qty: pair.qty,
        time: pair.exitTime,
        commission: pair.commission / 2,
        fees: pair.fees / 2,
      },
    );
  });

  for (const trade of Object.values(mergedMap)) {
    trade.rawExecutions = consolidateExecutions(trade.id, trade.rawExecutions);
    const entryTimes = trade.rawExecutions.filter((exec) => exec.side === 'ENTRY').map((exec) => exec.time);
    const exitTimes = trade.rawExecutions.filter((exec) => exec.side === 'EXIT').map((exec) => exec.time);

    trade.entryTime = entryTimes.length > 0 ? entryTimes.sort((a, b) => compareTimes(a, b))[0] : '';
    trade.exitTime = exitTimes.length > 0 ? exitTimes.sort((a, b) => compareTimes(b, a))[0] : '';
  }

  return { trades: Object.values(mergedMap), warnings };
};
