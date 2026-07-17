import type { NormalizedExecution, OpenPositionSeed } from './types';

/** Maps various broker side strings to our canonical side values. */
export const SIDE_ALIASES: Record<string, NormalizedExecution['side']> = {
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

/** Maps various broker column header names to our canonical names. */
export const COLUMN_ALIASES: Record<string, string> = {
  SYMBOL: 'Symbol',
  TICKER: 'Symbol',
  SYM: 'Symbol',
  SIDE: 'Side',
  ACTION: 'Side',
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

/** Parse a commission/fee value from CSV — handles $, parens for negatives, etc. */
export function parseCost(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (!cleaned) return 0;
  const normalized = cleaned.startsWith('(') && cleaned.endsWith(')') ? `-${cleaned.slice(1, -1)}` : cleaned;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

/** Map CSV column headers to their canonical names using COLUMN_ALIASES. */
export function normalizeColumnNames(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const trimmedKey = key.trim();
    const upperKey = trimmedKey.toUpperCase();
    const mappedKey = COLUMN_ALIASES[upperKey] ?? trimmedKey;
    normalized[mappedKey] = value;
  }
  return normalized;
}

/** Parse "HH:MM" or "HH:MM:SS" into total seconds for time comparison. */
export function parseTimeToSeconds(value: string): number | null {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

export interface PositionResolverRow {
  rowIndex: number;
  symbol: string;
  rawSide: 'SS' | 'S' | 'B' | 'MARGIN';
  qty: number;
  timeRank: number | null;
}

export interface PositionResolverResult {
  [key: string]: unknown;
  resolvedSideByRow: Record<number, NormalizedExecution['side']>;
  warnings: string[];
}

/**
 * Walks executions in chronological order to disambiguate each raw `B`.
 */
export function resolveSidesByPositionState(
  rows: PositionResolverRow[],
  seed: OpenPositionSeed[] = [],
): PositionResolverResult {
  const ordered = [...rows].sort((a, b) => {
    if (a.timeRank != null && b.timeRank != null && a.timeRank !== b.timeRank) {
      return a.timeRank - b.timeRank;
    }
    if (a.timeRank != null && b.timeRank == null) return -1;
    if (a.timeRank == null && b.timeRank != null) return 1;
    return a.rowIndex - b.rowIndex;
  });

  const stateBySymbol = new Map<string, { longQty: number; shortQty: number }>();
  for (const position of seed) {
    const state = stateBySymbol.get(position.symbol) ?? { longQty: 0, shortQty: 0 };
    if (position.direction === 'LONG') state.longQty += position.qty;
    else state.shortQty += position.qty;
    stateBySymbol.set(position.symbol, state);
  }
  const resolvedSideByRow: Record<number, NormalizedExecution['side']> = {};
  const warnings: string[] = [];

  for (const row of ordered) {
    const state = stateBySymbol.get(row.symbol) ?? { longQty: 0, shortQty: 0 };
    stateBySymbol.set(row.symbol, state);

    if (row.rawSide === 'SS') {
      // A short-sale tag is ambiguous the same way a bare buy is: some brokers
      // (e.g. DAS) mark EVERY sell as "SS", so a sell while long is really a
      // long close, not a new short. Mirror the B logic below: close an open
      // long first, and only open a short when flat.
      if (state.longQty > 0) {
        if (row.qty > state.longQty + 1e-9) {
          warnings.push(
            `Row ${row.rowIndex + 1}: Ambiguous SELL for ${row.symbol}; qty ${row.qty} exceeds open long ${state.longQty}. Treating as long close.`,
          );
        }
        state.longQty = Math.max(0, state.longQty - row.qty);
        resolvedSideByRow[row.rowIndex] = 'S';
      } else {
        state.shortQty += row.qty;
        resolvedSideByRow[row.rowIndex] = 'SS';
      }
      continue;
    }

    if (row.rawSide === 'MARGIN') {
      state.longQty += row.qty;
      resolvedSideByRow[row.rowIndex] = 'MARGIN';
      continue;
    }

    if (row.rawSide === 'S') {
      state.longQty = Math.max(0, state.longQty - row.qty);
      resolvedSideByRow[row.rowIndex] = 'S';
      continue;
    }

    if (state.shortQty > 0) {
      if (row.qty > state.shortQty + 1e-9) {
        warnings.push(
          `Row ${row.rowIndex + 1}: Ambiguous BUY for ${row.symbol}; qty ${row.qty} exceeds open short ${state.shortQty}. Treating as short cover.`,
        );
      }
      state.shortQty = Math.max(0, state.shortQty - row.qty);
      resolvedSideByRow[row.rowIndex] = 'B';
    } else {
      state.longQty += row.qty;
      resolvedSideByRow[row.rowIndex] = 'MARGIN';
    }
  }

  return { resolvedSideByRow, warnings };
}
