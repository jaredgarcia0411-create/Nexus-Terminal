import { describe, expect, it } from 'vitest';

import {
  coerceWatchlistRows,
  dedupeWatchlistRows,
  type WatchlistRow,
} from '@/lib/watchlist';

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
});
