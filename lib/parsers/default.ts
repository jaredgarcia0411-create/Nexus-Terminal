import { parsePrice } from '../trading-utils';
import type { BrokerParserConfig, NormalizedExecution } from './types';
import { SIDE_ALIASES, normalizeColumnNames, parseCost } from './utils';

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
