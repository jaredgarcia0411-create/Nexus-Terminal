import { describe, expect, it } from 'vitest';

import type { SheetColumn } from '@/lib/sheets/columns';
import { gridRowsFromSheet, nextColumnKey, slugifyColumnKey, valuesFromGridRow } from '@/lib/sheets/grid';

const columns: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text' },
  { key: 'note', name: 'Note', type: 'text' },
];

describe('sheets grid helpers', () => {
  it('flattens sheet rows into grid rows with meta keys', () => {
    const grid = gridRowsFromSheet([
      { id: 'r1', position: 0, version: 3, values: { ticker: 'AAPL', note: 'hi' } },
    ]);
    expect(grid[0]).toEqual({ __id: 'r1', __version: 3, ticker: 'AAPL', note: 'hi' });
  });

  it('extracts only declared column keys back out', () => {
    const values = valuesFromGridRow(
      { __id: 'r1', __version: 1, ticker: 'AAPL', note: 'hi', stray: 'x' },
      columns,
    );
    expect(values).toEqual({ ticker: 'AAPL', note: 'hi' });
  });

  it('slugifies a name to a safe column key', () => {
    expect(slugifyColumnKey('Sub Bucket!')).toBe('sub_bucket');
    expect(slugifyColumnKey('  Bias  ')).toBe('bias');
  });

  it('avoids key collisions by suffixing', () => {
    expect(nextColumnKey('Note', columns)).toBe('note_2');
    expect(nextColumnKey('Theme', columns)).toBe('theme');
    expect(nextColumnKey('!!!', columns)).toBe('column');
  });
});
