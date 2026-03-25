import type { NormalizedExecution } from './types';

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
