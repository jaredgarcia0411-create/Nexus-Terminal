import { describe, expect, it } from 'vitest';

import type { Trade } from '@/lib/types';
import {
  buildWatchlistTradeTagAssignments,
  coerceWatchlistRows,
  dedupeWatchlistRows,
  type WatchlistRow,
} from '@/lib/watchlist';

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 'trade-1',
    date: new Date('2026-05-31T00:00:00'),
    sortKey: '2026-05-31',
    symbol: 'AAPL',
    direction: 'LONG',
    avgEntryPrice: 10,
    avgExitPrice: 12,
    totalQuantity: 100,
    grossPnl: 200,
    netPnl: 190,
    entryTime: '09:30',
    exitTime: '10:00',
    executionCount: 2,
    rawExecutions: [],
    pnl: 190,
    executions: 2,
    tags: [],
    ...overrides,
  };
}

describe('watchlist helpers', () => {
  it('coerces legacy thesis into tags', () => {
    expect(coerceWatchlistRows([{ id: 'row-1', ticker: 'AAPL', thesis: 'Momentum', grade: 'A', notes: '' }])).toEqual([
      { id: 'row-1', ticker: 'AAPL', tags: ['Momentum'], grade: 'A', notes: '' },
    ]);
  });

  it('coerces tag arrays by trimming and deduping strings', () => {
    expect(coerceWatchlistRows([{ id: 'row-1', ticker: 'AAPL', tags: [' gap ', 'gap', '', 123], grade: '', notes: '' }])).toEqual([
      { id: 'row-1', ticker: 'AAPL', tags: ['gap'], grade: '', notes: '' },
    ]);
  });

  it('dedupes weekly watchlist rows by ticker and merges newer fields', () => {
    const rows: WatchlistRow[] = [
      { id: 'old', ticker: 'aapl', tags: ['Momentum'], grade: 'B', notes: 'Old note', sourceDate: '2026-05-25' },
      { id: 'new', ticker: 'AAPL', tags: ['Gap', 'Momentum'], grade: 'A', notes: 'New note', reportId: 'report-1', sourceDate: '2026-05-26' },
    ];

    expect(dedupeWatchlistRows(rows)).toEqual([
      { id: 'old', ticker: 'AAPL', tags: ['Momentum', 'Gap'], grade: 'A', notes: 'New note', reportId: 'report-1', sourceDate: '2026-05-26' },
    ]);
  });

  it('builds missing same-day trade tag assignments by ticker', () => {
    const trades = [
      makeTrade({ id: 'trade-1', symbol: 'aapl', tags: ['Momentum'] }),
      makeTrade({ id: 'trade-2', symbol: 'MSFT', tags: [] }),
      makeTrade({ id: 'trade-3', symbol: 'TSLA', tags: [] }),
    ];
    const rows: WatchlistRow[] = [
      { id: 'row-1', ticker: 'AAPL', tags: ['Momentum', 'Gap'], grade: '', notes: '' },
      { id: 'row-2', ticker: 'MSFT', tags: ['News'], grade: '', notes: '' },
    ];

    expect(buildWatchlistTradeTagAssignments(trades, rows)).toEqual([
      { tradeId: 'trade-1', tags: ['Gap'] },
      { tradeId: 'trade-2', tags: ['News'] },
    ]);
  });
});
