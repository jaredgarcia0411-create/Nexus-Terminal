import { describe, expect, it } from 'vitest';

import { computeRowFill, getMassiveFillKeys, isEmptySheetCell } from '@/lib/sheets/massive-fill';
import type { SheetColumn } from '@/lib/sheets/columns';

const columns: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text' },
  { key: 'vol', name: 'Share Vol', type: 'share_volume' },
  { key: 'dvol', name: '$ Vol', type: 'dollar_volume' },
  { key: 'float_value', name: 'Float', type: 'float' },
];

describe('sheets Massive fill helpers', () => {
  it('finds the first fill column keys by type', () => {
    expect(getMassiveFillKeys(columns)).toEqual({
      shareKey: 'vol',
      dollarKey: 'dvol',
      floatKey: 'float_value',
    });
  });

  it('treats nullish and blank cells as empty only', () => {
    expect(isEmptySheetCell(undefined)).toBe(true);
    expect(isEmptySheetCell(null)).toBe(true);
    expect(isEmptySheetCell('')).toBe(true);
    expect(isEmptySheetCell('manual')).toBe(false);
    expect(isEmptySheetCell(0)).toBe(false);
  });

  it('fills empty volume and dollar volume cells from an unadjusted bar', () => {
    expect(computeRowFill({
      values: {},
      keys: getMassiveFillKeys(columns),
      bar: { volume: 123_456, vwap: 1.23, close: 1.2 },
      sharesOutstanding: null,
    })).toEqual({
      vol: 123_456,
      dvol: 151_851,
    });
  });

  it('uses close for dollar volume when vwap is null', () => {
    expect(computeRowFill({
      values: {},
      keys: getMassiveFillKeys(columns),
      bar: { volume: 100, vwap: null, close: 2.5 },
      sharesOutstanding: null,
    })).toMatchObject({ dvol: 250 });
  });

  it('never overwrites existing values', () => {
    expect(computeRowFill({
      values: { vol: 1, dvol: 'manual', float_value: 2 },
      keys: getMassiveFillKeys(columns),
      bar: { volume: 100, vwap: 2, close: 1 },
      sharesOutstanding: 500,
    })).toEqual({});
  });

  it('overwrites existing values when force is set', () => {
    expect(computeRowFill({
      values: { vol: 1, dvol: 'manual', float_value: 2 },
      keys: getMassiveFillKeys(columns),
      bar: { volume: 100, vwap: 2, close: 1 },
      sharesOutstanding: 500,
      force: true,
    })).toEqual({
      vol: 100,
      dvol: 200,
      float_value: 500,
    });
  });

  it('fills float from the dated shares the caller provides', () => {
    const keys = getMassiveFillKeys(columns);
    expect(computeRowFill({
      values: {},
      keys,
      bar: null,
      sharesOutstanding: 1_000_000,
    })).toEqual({ float_value: 1_000_000 });

    // No shares resolved for the row's date -> nothing to fill.
    expect(computeRowFill({
      values: {},
      keys,
      bar: null,
      sharesOutstanding: null,
    })).toEqual({});
  });
});
