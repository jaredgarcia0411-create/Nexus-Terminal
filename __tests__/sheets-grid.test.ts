import { describe, expect, it } from 'vitest';

import { DEFAULT_SHEET_COLUMNS, ensureLockedColumns, type SheetColumn } from '@/lib/sheets/columns';
import {
  filterGridRows,
  gridRowsFromSheet,
  nextColumnKey,
  slugifyColumnKey,
  valuesFromGridRow,
  type GridRow,
} from '@/lib/sheets/grid';

const columns: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text' },
  { key: 'note', name: 'Note', type: 'text' },
];

const filterColumns: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text' },
  { key: 'tag', name: 'Tag', type: 'select' },
  { key: 'watched', name: 'Watched', type: 'checkbox' },
];

const filterRows: GridRow[] = [
  { __id: 'r1', __version: 1, ticker: 'AAPL', tag: 'Momentum', watched: true },
  { __id: 'r2', __version: 1, ticker: 'MSFT', tag: 'Reversal', watched: false },
  { __id: 'r3', __version: 1, ticker: 'NVDA', tag: 'Momentum', watched: true },
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

  it('appends missing locked default columns without reordering existing columns', () => {
    const legacyColumns = DEFAULT_SHEET_COLUMNS.filter((column) => column.key !== 'add_to_watchlist');

    expect(ensureLockedColumns(legacyColumns)).toEqual(DEFAULT_SHEET_COLUMNS);
  });

  it('re-syncs outdated locked column names from the defaults', () => {
    const stale = DEFAULT_SHEET_COLUMNS.map((column) =>
      column.key === 'add_to_sample' ? { ...column, name: 'Add to Sample' } : column,
    );

    expect(ensureLockedColumns(stale)).toEqual(DEFAULT_SHEET_COLUMNS);
  });

  it('returns columns unchanged when locked defaults are already present', () => {
    const columnsWithCustom = [
      ...DEFAULT_SHEET_COLUMNS,
      { key: 'custom_note', name: 'Custom Note', type: 'text' },
    ] satisfies SheetColumn[];

    expect(ensureLockedColumns(columnsWithCustom)).toBe(columnsWithCustom);
  });

  it('filters rows by text contains matches', () => {
    expect(filterGridRows(filterRows, filterColumns, { ticker: 'AAP' }).map((row) => row.__id)).toEqual(['r1']);
  });

  it('returns no rows when a text filter has no matches', () => {
    expect(filterGridRows(filterRows, filterColumns, { ticker: 'TSLA' })).toEqual([]);
  });

  it('matches text filters case-insensitively', () => {
    expect(filterGridRows(filterRows, filterColumns, { tag: 'momentum' }).map((row) => row.__id)).toEqual([
      'r1',
      'r3',
    ]);
  });

  it('filters checkbox columns by checked state', () => {
    expect(filterGridRows(filterRows, filterColumns, { watched: 'checked' }).map((row) => row.__id)).toEqual([
      'r1',
      'r3',
    ]);
    expect(filterGridRows(filterRows, filterColumns, { watched: 'unchecked' }).map((row) => row.__id)).toEqual([
      'r2',
    ]);
  });

  it('combines multiple filters with AND semantics', () => {
    expect(
      filterGridRows(filterRows, filterColumns, { tag: 'momentum', ticker: 'nv' }).map((row) => row.__id),
    ).toEqual(['r3']);
  });

  it('treats empty filters as passthrough', () => {
    expect(filterGridRows(filterRows, filterColumns, { ticker: '', watched: 'all' })).toBe(filterRows);
  });
});
