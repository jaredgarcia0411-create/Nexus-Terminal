import type { BrokerParserConfig, NormalizedExecution } from './types';
import {
  parseTimeToSeconds,
  resolveSidesByPositionState,
  type PositionResolverRow,
} from './utils';

function readCell(row: Record<string, unknown>, header: string): unknown {
  const target = header.trim().toUpperCase();
  for (const [key, value] of Object.entries(row)) {
    if (key.trim().toUpperCase() === target) return value;
  }
  return undefined;
}

function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

function parseNumber(value: unknown): number {
  const parsed = parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export const dasTraderParser: BrokerParserConfig = {
  id: 'das-trader',
  name: 'DAS Trader',

  detect: (headers) => {
    const upper = headers.map((h) => h.toUpperCase().trim()).filter((h) => h !== '');
    return upper.includes('ROUTE') && upper.includes('ACCOUNT') && upper.includes('TYPE');
  },

  buildContext: (rows) => {
    const inputs: PositionResolverRow[] = [];

    rows.forEach((row, rowIndex) => {
      const symbol = cleanString(readCell(row, 'Symbol')).toUpperCase();
      const rawSide = cleanString(readCell(row, 'Side')).toUpperCase();
      const qty = Math.abs(parseNumber(readCell(row, 'Qty')));

      if (!symbol || qty === 0) return;
      if (rawSide !== 'SS' && rawSide !== 'S' && rawSide !== 'B') return;

      inputs.push({
        rowIndex,
        symbol,
        rawSide,
        qty,
        timeRank: parseTimeToSeconds(cleanString(readCell(row, 'Time'))),
      });
    });

    return resolveSidesByPositionState(inputs);
  },

  normalizeRow: (row, rowIndex, context): NormalizedExecution | null => {
    const symbol = cleanString(readCell(row, 'Symbol')).toUpperCase();
    const rawSide = cleanString(readCell(row, 'Side')).toUpperCase();
    const qty = Math.abs(parseNumber(readCell(row, 'Qty')));
    const price = parseNumber(readCell(row, 'Price'));
    const time = cleanString(readCell(row, 'Time'));

    if (!symbol || qty === 0 || price === 0) return null;

    const ctx = context as { resolvedSideByRow?: Record<number, NormalizedExecution['side']>; shortSymbols?: Set<string> } | undefined;
    let side = ctx?.resolvedSideByRow?.[rowIndex];

    // Legacy fallback for direct normalizeRow calls in isolation.
    if (!side) {
      if (rawSide === 'SS') side = 'SS';
      else if (rawSide === 'S') side = 'S';
      else if (rawSide === 'B') side = (ctx as { shortSymbols?: Set<string> } | undefined)?.shortSymbols?.has(symbol) ? 'B' : 'MARGIN';
      else return null;
    }

    return {
      symbol,
      side,
      qty,
      price,
      time,
      commission: 0,
      fees: 0,
    };
  },
};
