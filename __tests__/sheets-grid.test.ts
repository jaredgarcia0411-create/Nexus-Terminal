import { describe, expect, it } from 'vitest';

import { DEFAULT_SHEET_COLUMNS, ensureLockedColumns, type SheetColumn } from '@/lib/sheets/columns';
import {
  filterGridRows,
  gridRowsFromSheet,
  nextColumnKey,
  sortGridRows,
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

const datedRows: GridRow[] = [
  { __id: 'r1', __version: 1, date: '2026-06-07' },
  { __id: 'r2', __version: 1, date: '2026-06-09' },
  { __id: 'r3', __version: 1, date: '2026-06-08' },
  { __id: 'r4', __version: 1, date: '2026-06-09' },
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
    const legacyColumns = DEFAULT_SHEET_COLUMNS.filter((column) => column.key !== 'r');

    expect(ensureLockedColumns(legacyColumns)).toEqual(DEFAULT_SHEET_COLUMNS);
  });

  it('re-syncs outdated locked column names from the defaults', () => {
    const stale = DEFAULT_SHEET_COLUMNS.map((column) =>
      column.key === 'research_report' ? { ...column, name: 'Research Report' } : column,
    );

    expect(ensureLockedColumns(stale)).toEqual(DEFAULT_SHEET_COLUMNS);
  });

  it('strips retired locked Sample and Watch columns and appends the R column', () => {
    const legacyColumns = [
      ...DEFAULT_SHEET_COLUMNS.filter((column) => column.key !== 'r'),
      { key: 'add_to_sample', name: 'Sample', type: 'action', locked: true },
      { key: 'add_to_watchlist', name: 'Watch', type: 'watchlist', locked: true },
    ] satisfies SheetColumn[];

    const normalized = ensureLockedColumns(legacyColumns);

    expect(normalized).toEqual(DEFAULT_SHEET_COLUMNS);
    expect(normalized.at(-1)).toEqual({ key: 'r', name: 'R', type: 'rmultiple', locked: true });
  });

  it('unlocks a legacy locked Tag column so it can be deleted, without removing it', () => {
    const legacyColumns = [
      ...DEFAULT_SHEET_COLUMNS.slice(0, 2),
      { key: 'tag', name: 'Tag', type: 'select', options: [], locked: true },
      ...DEFAULT_SHEET_COLUMNS.slice(2),
    ] satisfies SheetColumn[];

    const normalized = ensureLockedColumns(legacyColumns);

    expect(normalized.find((column) => column.key === 'tag')).toEqual({
      key: 'tag',
      name: 'Tag',
      type: 'select',
      options: [],
      locked: false,
    });
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

  it('filters multiselect columns by selected option text', () => {
    const rows: GridRow[] = [
      { __id: 'r1', __version: 1, setups: ['Gap', 'Momentum'] },
      { __id: 'r2', __version: 1, setups: ['Reversal'] },
      { __id: 'r3', __version: 1, setups: 'Momentum' },
    ];
    const columns: SheetColumn[] = [
      { key: 'setups', name: 'Setups', type: 'multiselect' },
    ];

    expect(filterGridRows(rows, columns, { setups: 'momentum' }).map((row) => row.__id)).toEqual(['r1']);
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

  it('sorts rows by date descending', () => {
    expect(sortGridRows(datedRows, 'date_desc').map((row) => row.__id)).toEqual(['r2', 'r4', 'r3', 'r1']);
  });

  it('sorts rows by date ascending', () => {
    expect(sortGridRows(datedRows, 'date_asc').map((row) => row.__id)).toEqual(['r1', 'r3', 'r2', 'r4']);
  });

  it('returns rows unchanged in manual mode', () => {
    expect(sortGridRows(datedRows, 'manual')).toBe(datedRows);
  });

  it('sorts empty dates to the top in date modes', () => {
    const rows = [
      { __id: 'r1', __version: 1, date: '2026-06-08' },
      { __id: 'r2', __version: 1, date: '' },
      { __id: 'r3', __version: 1 },
      { __id: 'r4', __version: 1, date: '2026-06-09' },
    ];

    expect(sortGridRows(rows, 'date_desc').map((row) => row.__id)).toEqual(['r2', 'r3', 'r4', 'r1']);
    expect(sortGridRows(rows, 'date_asc').map((row) => row.__id)).toEqual(['r2', 'r3', 'r1', 'r4']);
  });

  it('preserves incoming order for equal dates', () => {
    const rows = [
      { __id: 'r1', __version: 1, date: '2026-06-08' },
      { __id: 'r2', __version: 1, date: '2026-06-08' },
      { __id: 'r3', __version: 1, date: '2026-06-08' },
    ];

    expect(sortGridRows(rows, 'date_desc').map((row) => row.__id)).toEqual(['r1', 'r2', 'r3']);
  });
});
