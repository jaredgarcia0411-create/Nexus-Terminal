import { Trade, Direction } from './types';
import { parsePrice } from './trading-utils';
import { format } from 'date-fns';
import type { BrokerParserConfig, NormalizedExecution } from './parsers/types';

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
  const numbers = base.match(/\d+/g);
  if (!numbers || numbers.length < 3) return null;

  const nums = numbers.slice(-3);
  const month = parseInt(nums[0], 10);
  const day = parseInt(nums[1], 10);
  let year = parseInt(nums[2], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 100) year = 2000 + year;

  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return {
    date,
    sortKey: format(date, 'yyyy-MM-dd'),
  };
};

// Side alias map for the built-in parser path
const SIDE_ALIASES: Record<string, string> = {
  SS: 'SS',
  'SELL SHORT': 'SS',
  SHORT: 'SS',
  'SHORT SELL': 'SS',
  B: 'B',
  BUY: 'B',
  'BUY TO COVER': 'B',
  BTC: 'B',
  MARGIN: 'MARGIN',
  LONG: 'MARGIN',
  'BUY TO OPEN': 'MARGIN',
  BTO: 'MARGIN',
  S: 'S',
  SELL: 'S',
  'SELL TO CLOSE': 'S',
  STC: 'S',
};

const COLUMN_ALIASES: Record<string, string> = {
  SYMBOL: 'Symbol',
  TICKER: 'Symbol',
  SYM: 'Symbol',
  SIDE: 'Side',
  ACTION: 'Side',
  TYPE: 'Side',
  INSTRUCTION: 'Side',
  QTY: 'Qty',
  QUANTITY: 'Qty',
  SHARES: 'Qty',
  SIZE: 'Qty',
  AMOUNT: 'Qty',
  PRICE: 'Price',
  'FILL PRICE': 'Price',
  'AVG PRICE': 'Price',
  COMMISSION: 'Commission',
  COMM: 'Commission',
  COMMISSIONS: 'Commission',
  FEES: 'Fees',
  FEE: 'Fees',
  TIME: 'Time',
  'FILL TIME': 'Time',
};

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const trimmedKey = key.trim();
    const upperKey = trimmedKey.toUpperCase();
    const mappedKey = COLUMN_ALIASES[upperKey] ?? trimmedKey;
    normalized[mappedKey] = value;
  }
  return normalized;
}

function normalizeSide(rawSide: string): string | null {
  const cleaned = rawSide.toUpperCase().trim();
  return SIDE_ALIASES[cleaned] ?? null;
}

function parseCost(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (!cleaned) return 0;
  const norm = cleaned.startsWith('(') && cleaned.endsWith(')') ? `-${cleaned.slice(1, -1)}` : cleaned;
  const parsed = parseFloat(norm);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

/** Built-in row normalization (used when no parser plugin is provided) */
function builtinNormalizeRow(rawRow: Record<string, unknown>, rowIndex: number, warnings: string[]): NormalizedExecution | null {
  const row = normalizeRow(rawRow);
  const sym = String(row.Symbol ?? '').toUpperCase().trim();
  const rawSide = String(row.Side ?? '').trim();
  const side = normalizeSide(rawSide);
  const qty = parseFloat(String(row.Qty ?? row.Quantity ?? '')) || 0;
  const price = parsePrice(row.Price);
  const time = String(row.Time ?? '');
  const commission = parseCost(row.Commission ?? row.Comm);
  const fees = parseCost(row.Fees ?? row.Fee);

  if (!sym) return null;

  if (!side) {
    if (rawSide) {
      warnings.push(`Row ${rowIndex + 1}: Unknown side "${rawSide}" for ${sym}, skipping`);
    }
    return null;
  }

  if (qty === 0) {
    warnings.push(`Row ${rowIndex + 1}: Zero quantity for ${sym}, skipping`);
    return null;
  }

  return { symbol: sym, side: side as NormalizedExecution['side'], qty, price, time, commission, fees };
}

export const processCsvData = (
  data: any[],
  dateInfo: { date: Date; sortKey: string },
  parser?: BrokerParserConfig,
): ProcessedCsvResult => {
  const symbolMap: Record<string, SymbolExecutions> = {};
  const warnings: string[] = [];

  data.forEach((rawRow, rowIndex) => {
    try {
      const exec = parser
        ? parser.normalizeRow(rawRow as Record<string, unknown>, rowIndex)
        : builtinNormalizeRow(rawRow as Record<string, unknown>, rowIndex, warnings);

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

  const matchedPairs: any[] = [];

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
        pnl: (entry.price - exit.price) * q - commission - fees,
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
        pnl: (exit.price - entry.price) * q - commission - fees,
      });

      const entryRemainder = buildRemainingExecution(entry, q);
      const exitRemainder = buildRemainingExecution(exit, q);
      if (entryRemainder) le.unshift(entryRemainder);
      if (exitRemainder) lx.unshift(exitRemainder);
    }

    se.forEach(() => {
      warnings.push(`Skipped unmatched SHORT SELL execution for ${sym} (no matching buy)`);
    });
    sx.forEach(() => {
      warnings.push(`Skipped unmatched BUY execution for ${sym} (no matching short sell)`);
    });
    le.forEach(() => {
      warnings.push(`Skipped unmatched BUY execution for ${sym} (no matching sell)`);
    });
    lx.forEach(() => {
      warnings.push(`Skipped unmatched SELL execution for ${sym} (no matching buy)`);
    });
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
    trade.pnl += pair.pnl;
    trade.commission = (trade.commission || 0) + pair.commission;
    trade.fees = (trade.fees || 0) + pair.fees;
    trade.executions++;
    trade.avgEntryPrice = entryValue / trade.totalQuantity;
    trade.avgExitPrice = exitValue / trade.totalQuantity;
  });

  return { trades: Object.values(mergedMap), warnings };
};
