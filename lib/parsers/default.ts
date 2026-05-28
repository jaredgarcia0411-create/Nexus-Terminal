import { parsePrice } from '../ui-trade-utils';
import type { BrokerParserConfig, NormalizedExecution } from './types';
import {
  SIDE_ALIASES,
  normalizeColumnNames,
  parseCost,
  parseTimeToSeconds,
  resolveSidesByPositionState,
  type PositionResolverRow,
} from './utils';

type DefaultContext = {
  resolvedSideByRow: Record<number, NormalizedExecution['side']>;
  warnings: string[];
};

export const defaultParser: BrokerParserConfig = {
  id: 'default',
  name: 'Default (DAS Trader / Generic)',

  detect: (headers) => {
    const upper = headers.map((h) => h.toUpperCase().trim());
    return upper.includes('SYMBOL') && (upper.includes('SIDE') || upper.includes('ACTION'));
  },

  buildContext: (rawRows) => {
    const inputs: PositionResolverRow[] = [];

    rawRows.forEach((rawRow, rowIndex) => {
      const row = normalizeColumnNames(rawRow);
      const symbol = String(row.Symbol ?? '').toUpperCase().trim();
      const rawSideString = String(row.Side ?? row.Action ?? row.Type ?? '').toUpperCase().trim();
      const rawSide = SIDE_ALIASES[rawSideString];
      const qty = parseFloat(String(row.Qty ?? row.Quantity ?? '')) || 0;
      const time = String(row.Time ?? '');

      if (!symbol || !rawSide || qty === 0) return;

      inputs.push({
        rowIndex,
        symbol,
        rawSide,
        qty,
        timeRank: parseTimeToSeconds(time),
      });
    });

    return resolveSidesByPositionState(inputs);
  },

  normalizeRow: (rawRow, rowIndex, context): NormalizedExecution | null => {
    const row = normalizeColumnNames(rawRow);
    const sym = String(row.Symbol ?? '').toUpperCase().trim();
    const rawSideString = String(row.Side ?? row.Action ?? row.Type ?? '').toUpperCase().trim();
    const fallbackSide = SIDE_ALIASES[rawSideString];
    const qty = parseFloat(String(row.Qty ?? row.Quantity ?? '')) || 0;
    const price = parsePrice(row.Price);
    const time = String(row.Time ?? '');
    const commission = parseCost(row.Commission ?? row.Comm);
    const fees = parseCost(row.Fees ?? row.Fee);

    if (!sym || qty === 0) return null;

    const resolved = (context as DefaultContext | undefined)?.resolvedSideByRow?.[rowIndex];
    const side = resolved ?? fallbackSide;
    if (!side) return null;

    return { symbol: sym, side, qty, price, time, commission, fees };
  },
};
