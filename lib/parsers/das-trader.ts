import type { BrokerParserConfig, NormalizedExecution } from './types';

type DasContext = {
  resolvedSideByRow: Record<number, NormalizedExecution['side']>;
  warnings: string[];
};

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

function parseTimeToSeconds(time: string): number | null {
  const match = cleanString(time).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

export const dasTraderParser: BrokerParserConfig = {
  id: 'das-trader',
  name: 'DAS Trader',

  detect: (headers) => {
    const upper = headers.map((h) => h.toUpperCase().trim()).filter((h) => h !== '');
    return upper.includes('ROUTE') && upper.includes('ACCOUNT') && upper.includes('TYPE');
  },

  buildContext: (rows) => {
    const candidates: Array<{
      rowIndex: number;
      symbol: string;
      rawSide: 'SS' | 'S' | 'B';
      qty: number;
      timeRank: number | null;
    }> = [];

    rows.forEach((row, rowIndex) => {
      const symbol = cleanString(readCell(row, 'Symbol')).toUpperCase();
      const rawSide = cleanString(readCell(row, 'Side')).toUpperCase();
      const qty = Math.abs(parseNumber(readCell(row, 'Qty')));
      const timeRank = parseTimeToSeconds(cleanString(readCell(row, 'Time')));

      if (!symbol || qty === 0) return;
      if (rawSide !== 'SS' && rawSide !== 'S' && rawSide !== 'B') return;

      candidates.push({ rowIndex, symbol, rawSide, qty, timeRank });
    });

    const ordered = [...candidates].sort((a, b) => {
      if (a.timeRank != null && b.timeRank != null && a.timeRank !== b.timeRank) {
        return a.timeRank - b.timeRank;
      }
      if (a.timeRank != null && b.timeRank == null) return -1;
      if (a.timeRank == null && b.timeRank != null) return 1;
      return a.rowIndex - b.rowIndex;
    });

    const stateBySymbol = new Map<string, { longQty: number; shortQty: number }>();
    const resolvedSideByRow: Record<number, NormalizedExecution['side']> = {};
    const warnings: string[] = [];

    for (const row of ordered) {
      const state = stateBySymbol.get(row.symbol) ?? { longQty: 0, shortQty: 0 };
      stateBySymbol.set(row.symbol, state);

      if (row.rawSide === 'SS') {
        state.shortQty += row.qty;
        resolvedSideByRow[row.rowIndex] = 'SS';
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
  },

  normalizeRow: (row, rowIndex, context): NormalizedExecution | null => {
    const symbol = cleanString(readCell(row, 'Symbol')).toUpperCase();
    const rawSide = cleanString(readCell(row, 'Side')).toUpperCase();
    const qty = Math.abs(parseNumber(readCell(row, 'Qty')));
    const price = parseNumber(readCell(row, 'Price'));
    const time = cleanString(readCell(row, 'Time'));

    if (!symbol || qty === 0 || price === 0) return null;

    const ctx = context as DasContext | { shortSymbols?: Set<string> } | undefined;
    let side = (ctx as DasContext | undefined)?.resolvedSideByRow?.[rowIndex];

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
