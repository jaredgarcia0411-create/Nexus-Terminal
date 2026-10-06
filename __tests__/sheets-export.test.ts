import { describe, expect, it } from 'vitest';

import type { SheetColumn } from '@/lib/sheets/columns';
import { buildSheetCsv } from '@/lib/sheets/export';
import type { GridRow } from '@/lib/sheets/grid';

const columns: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text' },
  { key: 'research_report', name: 'Report', type: 'report' },
  { key: 'chart', name: 'Chart', type: 'chart' },
  { key: 'r', name: 'R', type: 'rmultiple' },
  { key: 'watched', name: 'Watched', type: 'checkbox' },
  { key: 'setups', name: 'Setups', type: 'multiselect' },
  { key: 'float', name: 'Float', type: 'float' },
  { key: 'note', name: 'Note', type: 'text' },
];

describe('buildSheetCsv', () => {
  it('skips button columns and converts values for Google Sheets', () => {
    const rows: GridRow[] = [
      {
        __id: 'r1',
        __version: 1,
        ticker: 'AAPL',
        research_report: 'report-123',
        watched: true,
        setups: ['Gap', 'Fade'],
        float: 12500000,
        note: 'said "hi", then left',
      },
      { __id: 'r2', __version: 1, ticker: 'MSFT' },
    ];

    const csv = buildSheetCsv(columns, rows, { r1: 1.23456, r2: null });

    expect(csv.split('\r\n')).toEqual([
      'Ticker,R,Watched,Setups,Float,Note',
      'AAPL,1.23,TRUE,"Gap, Fade",12500000,"said ""hi"", then left"',
      'MSFT,,FALSE,,,',
    ]);
  });
});
