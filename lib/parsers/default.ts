import { parsePrice } from '../trading-utils';
import type { BrokerParserConfig, NormalizedExecution } from './types';

const SIDE_ALIASES: Record<string, NormalizedExecution['side']> = {
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

function parseCost(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (!cleaned) return 0;
  const normalized = cleaned.startsWith('(') && cleaned.endsWith(')') ? `-${cleaned.slice(1, -1)}` : cleaned;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

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

export const defaultParser: BrokerParserConfig = {
  id: 'default',
  name: 'Default (DAS Trader / Generic)',

  detect: (headers) => {
    const upper = headers.map((h) => h.toUpperCase().trim());
    return upper.includes('SYMBOL') && (upper.includes('SIDE') || upper.includes('ACTION'));
  },

  normalizeRow: (rawRow, _rowIndex): NormalizedExecution | null => {
    const row = normalizeColumnNames(rawRow);
    const sym = String(row.Symbol ?? '').toUpperCase().trim();
    const rawSide = String(row.Side ?? row.Action ?? row.Type ?? '').toUpperCase().trim();
    const side = SIDE_ALIASES[rawSide];
    const qty = parseFloat(String(row.Qty ?? row.Quantity ?? '')) || 0;
    const price = parsePrice(row.Price);
    const time = String(row.Time ?? '');
    const commission = parseCost(row.Commission ?? row.Comm);
    const fees = parseCost(row.Fees ?? row.Fee);

    if (!sym || !side || qty === 0) return null;

    return { symbol: sym, side, qty, price, time, commission, fees };
  },
};
