import { describe, expect, it } from 'vitest';

import { computeRowFill, computeSessionHighs, getMassiveFillKeys, isEmptySheetCell } from '@/lib/sheets/massive-fill';
import { nyDateTimeToEpoch } from '@/lib/time-utils';
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
      bar: { volume: 123_456, vwap: 1.23, close: 1.2, high: 1.3, low: 1.1 },
      sharesOutstanding: null,
      sessionHighs: null,
    })).toEqual({
      vol: 123_456,
      dvol: 151_851,
    });
  });

  it('uses close for dollar volume when vwap is null', () => {
    expect(computeRowFill({
      values: {},
      keys: getMassiveFillKeys(columns),
      bar: { volume: 100, vwap: null, close: 2.5, high: 3, low: 2 },
      sharesOutstanding: null,
      sessionHighs: null,
    })).toMatchObject({ dvol: 250 });
  });

  it('never overwrites existing values', () => {
    expect(computeRowFill({
      values: { vol: 1, dvol: 'manual', float_value: 2 },
      keys: getMassiveFillKeys(columns),
      bar: { volume: 100, vwap: 2, close: 1, high: 3, low: 1 },
      sharesOutstanding: 500,
      sessionHighs: null,
    })).toEqual({});
  });

  it('overwrites existing values when force is set', () => {
    expect(computeRowFill({
      values: { vol: 1, dvol: 'manual', float_value: 2 },
      keys: getMassiveFillKeys(columns),
      bar: { volume: 100, vwap: 2, close: 1, high: 3, low: 1 },
      sharesOutstanding: 500,
      sessionHighs: null,
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
      sessionHighs: null,
    })).toEqual({ float_value: 1_000_000 });

    // No shares resolved for the row's date -> nothing to fill.
    expect(computeRowFill({
      values: {},
      keys,
      bar: null,
      sharesOutstanding: null,
      sessionHighs: null,
    })).toEqual({});
  });
});

const at = (date: string, time: string) => nyDateTimeToEpoch(date, time)!;
const sessionBars = [
  { t: at('2026-06-05', '17:00:00'), h: 2.4 },
  { t: at('2026-06-08', '06:59:00'), h: 2.5 },
  { t: at('2026-06-08', '07:00:00'), h: 2.9 },
  { t: at('2026-06-08', '09:30:00'), h: 5 },
];
const sessionKeys = {
  pdcKey: 'pdc', pdRangeKey: 'pd_range', ahHighKey: 'ah',
  pmEarlyKey: 'pm_early', pmLateKey: 'pm_late', extensionKey: 'ext',
};
const dailyBar = { volume: 1, vwap: null, close: 2, high: 3, low: 1 };
const completeHighs = { ahHigh: 2.4, pmEarlyHigh: 2.5, pmLateHigh: 2.9, complete: true };

describe('sheets session highs and extension', () => {
  it('registers the first column of each new fill type', () => {
    const types = ['pdc', 'pd_range', 'ah_high', 'pm_high_early', 'pm_high_late', 'pm_extension'] as const;
    const columns = types.map((type, index) => ({ key: Object.values(sessionKeys)[index], name: type, type }));
    expect(getMassiveFillKeys([...columns, ...columns.map((column) => ({ ...column, key: `${column.key}_2` }))]))
      .toEqual(sessionKeys);
  });

  it('buckets Friday AH and Monday PM bars with half-open boundaries', () => {
    expect(computeSessionHighs(sessionBars, '2026-06-05', '2026-06-08', at('2026-06-08', '12:00:00')))
      .toEqual(completeHighs);
    expect(computeSessionHighs([
      { t: at('2026-06-05', '15:59:00'), h: 100 },
      { t: at('2026-06-05', '16:00:00'), h: 2.4 },
      { t: at('2026-06-05', '20:00:00'), h: 100 },
      { t: at('2026-06-08', '03:59:00'), h: 100 },
      { t: at('2026-06-08', '04:00:00'), h: 2.5 },
      { t: at('2026-06-08', '07:00:00'), h: 2.9 },
      { t: at('2026-06-08', '09:30:00'), h: 100 },
    ], '2026-06-05', '2026-06-08', at('2026-06-08', '09:30:00'))).toEqual(completeHighs);
  });

  it.each([
    ['2026-06-05', '19:59:00', { ahHigh: null, pmEarlyHigh: null, pmLateHigh: null, complete: false }],
    ['2026-06-05', '20:00:00', { ahHigh: 2.4, pmEarlyHigh: null, pmLateHigh: null, complete: false }],
    ['2026-06-08', '06:00:00', { ahHigh: 2.4, pmEarlyHigh: null, pmLateHigh: null, complete: false }],
    ['2026-06-08', '07:00:00', { ahHigh: 2.4, pmEarlyHigh: 2.5, pmLateHigh: null, complete: false }],
    ['2026-06-08', '09:30:00', completeHighs],
  ])('only fills closed windows at %s %s ET', (date, time, expected) => {
    expect(computeSessionHighs(sessionBars, '2026-06-05', '2026-06-08', at(date, time))).toEqual(expected);
  });

  it('fills all six values using the daily bar', () => {
    expect(computeRowFill({
      values: {}, keys: sessionKeys, bar: dailyBar, sharesOutstanding: null, sessionHighs: completeHighs,
    })).toEqual({ pdc: 2, pd_range: 2, ah: 2.4, pm_early: 2.5, pm_late: 2.9, ext: 0.45 });
    expect(computeRowFill({
      values: { pdc: 100, pd_range: 100 }, keys: { extensionKey: 'ext' }, bar: dailyBar,
      sharesOutstanding: null, sessionHighs: completeHighs,
    })).toEqual({ ext: 0.45 });
  });

  it('leaves extension blank until PM is complete', () => {
    expect(computeRowFill({
      values: {}, keys: sessionKeys, bar: dailyBar, sharesOutstanding: null,
      sessionHighs: { ahHigh: 2.4, pmEarlyHigh: null, pmLateHigh: null, complete: false },
    })).toEqual({ pdc: 2, pd_range: 2, ah: 2.4 });
  });

  it('leaves extension blank for non-positive ranges, missing bars, or no highs', () => {
    for (const bar of [{ ...dailyBar, high: 1 }, { ...dailyBar, high: 0 }, null]) {
      expect(computeRowFill({
        values: {}, keys: { extensionKey: 'ext' }, bar, sharesOutstanding: null, sessionHighs: completeHighs,
      })).toEqual({});
    }
    const emptyHighs = computeSessionHighs([], '2026-06-05', '2026-06-08', at('2026-06-08', '12:00:00'));
    expect(computeRowFill({
      values: {}, keys: sessionKeys, bar: dailyBar, sharesOutstanding: null, sessionHighs: emptyHighs,
    })).toEqual({ pdc: 2, pd_range: 2 });
  });

  it('preserves existing session values unless forced', () => {
    const values = { pdc: 5, pd_range: 5, ah: 5, pm_early: 5, pm_late: 5, ext: 5 };
    expect(computeRowFill({
      values, keys: sessionKeys, bar: dailyBar, sharesOutstanding: null, sessionHighs: completeHighs,
    })).toEqual({});
    expect(computeRowFill({
      values, keys: sessionKeys, bar: dailyBar, sharesOutstanding: null, sessionHighs: completeHighs, force: true,
    })).toEqual({ pdc: 2, pd_range: 2, ah: 2.4, pm_early: 2.5, pm_late: 2.9, ext: 0.45 });
  });
});
