import { describe, expect, it } from 'vitest';

import { DEFAULT_SHEET_COLUMNS } from '@/lib/sheets/columns';
import {
  buildImportPayload,
  coerceImportNumber,
  detectImportColumns,
} from '@/lib/sheets/import';

describe('sheets CSV import helpers', () => {
  it('detects locked targets, dropped headers, overrides, and inferred types', () => {
    const drafts = detectImportColumns(
      ['Date', 'Ticker', 'Reports', 'Charts', 'Sim Trade', 'Float', '$ Vol', 'Share Vol', 'Active', 'Setup', 'Link', 'Score'],
      [
        ['2026-06-08', 'AAPL', 'r1', 'c1', 's1', '1,234,567', '', '10,000', 'true', 'Gap', 'https://example.com/a', '5'],
        ['2026-06-09', 'MSFT', 'r2', 'c2', 's2', '', ' $12,300 ', '20,000', 'false', 'Gap', 'https://example.com/b', '7'],
        ['2026-06-10', 'TSLA', 'r3', 'c3', 's3', '', '$13,400', '30,000', 'true', 'Pullback', 'https://example.com/c', '9'],
      ],
    );

    expect(drafts.find((draft) => draft.header === 'Date')).toMatchObject({
      key: 'date',
      type: 'date',
      lockedKey: 'date',
      drop: false,
    });
    expect(drafts.find((draft) => draft.header === 'Ticker')).toMatchObject({
      key: 'ticker',
      type: 'text',
      lockedKey: 'ticker',
      drop: false,
    });
    expect(drafts.filter((draft) => draft.drop).map((draft) => draft.header)).toEqual([
      'Reports',
      'Charts',
      'Sim Trade',
    ]);
    expect(drafts.find((draft) => draft.header === 'Float')).toMatchObject({ type: 'float' });
    expect(drafts.find((draft) => draft.header === '$ Vol')).toMatchObject({ type: 'dollar_volume' });
    expect(drafts.find((draft) => draft.header === 'Share Vol')).toMatchObject({ type: 'share_volume' });
    expect(drafts.find((draft) => draft.header === 'Active')).toMatchObject({ type: 'checkbox' });
    expect(drafts.find((draft) => draft.header === 'Setup')).toMatchObject({
      type: 'select',
      options: ['Gap', 'Pullback'],
    });
    expect(drafts.find((draft) => draft.header === 'Link')).toMatchObject({ type: 'url' });
    expect(drafts.find((draft) => draft.header === 'Score')).toMatchObject({ type: 'number' });
  });

  it('auto-drops a CSV R column so it does not duplicate the live locked R column', () => {
    const drafts = detectImportColumns(['R'], [['1.5'], ['2.0']]);

    expect(drafts[0]).toMatchObject({ header: 'R', drop: true });
  });

  it('dedupes generated keys against locked defaults and prior import columns', () => {
    const drafts = detectImportColumns(['Tag', 'Tag', ''], [['A', 'B', 'C']]);

    expect(drafts.map((draft) => draft.key)).toEqual(['tag_2', 'tag_3', 'column']);
  });

  it('coerces import numbers from currency, commas, and blanks', () => {
    expect(coerceImportNumber('$1,234.50')).toBe(1234.5);
    expect(coerceImportNumber(' 10 000 ')).toBe(10000);
    expect(coerceImportNumber('')).toBeNull();
    expect(coerceImportNumber('abc')).toBeNull();
  });

  it('builds import payloads with coercion, omissions, dropped values, and ticker skip counting', () => {
    const drafts = detectImportColumns(
      ['Date', 'Ticker', 'Reports', 'Float', '$ Vol', 'Active', 'Setup', 'Notes'],
      [
        ['2026-06-08', 'AAPL', 'drop-me', '1,200,000', '$10,500', 'true', 'Gap', 'Watch'],
        ['2026-06-09', '', 'drop-me', '2,000,000', '$20,500', 'false', 'Pullback', 'Skip'],
        ['2026-06-10', 'MSFT', 'drop-me', '', '', 'maybe', 'Gap', ''],
      ],
    ).map((draft) => (draft.header === 'Active' ? { ...draft, type: 'checkbox' as const } : draft));

    const payload = buildImportPayload(drafts, [
      ['2026-06-08', 'AAPL', 'drop-me', '1,200,000', '$10,500', 'true', 'Gap', 'Watch'],
      ['2026-06-09', '', 'drop-me', '2,000,000', '$20,500', 'false', 'Pullback', 'Skip'],
      ['2026-06-10', 'MSFT', 'drop-me', '', '', 'maybe', 'Gap', ''],
    ]);

    expect(payload.columns.slice(0, DEFAULT_SHEET_COLUMNS.length)).toEqual(DEFAULT_SHEET_COLUMNS);
    expect(payload.columns.find((column) => column.key === 'reports')).toBeUndefined();
    expect(payload.columns.find((column) => column.type === 'float')).toMatchObject({ key: 'float' });
    expect(payload.rows).toEqual([
      {
        date: '2026-06-08',
        ticker: 'AAPL',
        float: 1200000,
        vol: 10500,
        active: true,
        setup: 'Gap',
        notes: 'Watch',
      },
      {
        date: '2026-06-10',
        ticker: 'MSFT',
        setup: 'Gap',
      },
    ]);
    expect(payload.skipped).toBe(1);
  });
});
