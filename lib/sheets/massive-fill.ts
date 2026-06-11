import type { GroupedDailyBar } from '@/lib/massive-market';
import type { SheetColumn } from '@/lib/sheets/columns';

export type MassiveFillKeys = {
  shareKey?: string;
  dollarKey?: string;
  floatKey?: string;
};

export function getMassiveFillKeys(columns: SheetColumn[]): MassiveFillKeys {
  const keys: MassiveFillKeys = {};
  for (const column of columns) {
    if (column.type === 'share_volume' && !keys.shareKey) keys.shareKey = column.key;
    if (column.type === 'dollar_volume' && !keys.dollarKey) keys.dollarKey = column.key;
    if (column.type === 'float' && !keys.floatKey) keys.floatKey = column.key;
  }
  return keys;
}

export function isEmptySheetCell(value: unknown): boolean {
  return value == null || value === '';
}

function hasFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export function computeRowFill({
  values,
  keys,
  bar,
  sharesOutstanding,
}: {
  values: Record<string, unknown>;
  keys: MassiveFillKeys;
  bar: Pick<GroupedDailyBar, 'volume' | 'vwap' | 'close'> | null;
  // Shares outstanding as of the row's own date (the caller fetches it dated),
  // so this fills the correct historical float, not just today's.
  sharesOutstanding: number | null;
}): Record<string, unknown> {
  const fill: Record<string, unknown> = {};

  if (bar) {
    if (keys.shareKey && !hasFiniteNumber(values[keys.shareKey]) && isEmptySheetCell(values[keys.shareKey])) {
      fill[keys.shareKey] = bar.volume;
    }

    if (keys.dollarKey && !hasFiniteNumber(values[keys.dollarKey]) && isEmptySheetCell(values[keys.dollarKey])) {
      fill[keys.dollarKey] = Math.round((bar.vwap ?? bar.close) * bar.volume);
    }
  }

  if (
    keys.floatKey
    && sharesOutstanding != null
    && !hasFiniteNumber(values[keys.floatKey])
    && isEmptySheetCell(values[keys.floatKey])
  ) {
    fill[keys.floatKey] = sharesOutstanding;
  }

  return fill;
}
