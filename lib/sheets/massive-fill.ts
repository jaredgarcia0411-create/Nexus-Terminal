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
  force = false,
}: {
  values: Record<string, unknown>;
  keys: MassiveFillKeys;
  bar: Pick<GroupedDailyBar, 'volume' | 'vwap' | 'close'> | null;
  // Shares outstanding as of the row's own date (the caller fetches it dated),
  // so this fills the correct historical float, not just today's.
  sharesOutstanding: number | null;
  // When true, overwrite cells that already hold a value (refresh) instead of
  // only writing into empty ones.
  force?: boolean;
}): Record<string, unknown> {
  const fill: Record<string, unknown> = {};
  // A cell is writable if it's empty, or if we're force-refreshing.
  const writable = (key: string) => force || (!hasFiniteNumber(values[key]) && isEmptySheetCell(values[key]));

  if (bar) {
    if (keys.shareKey && writable(keys.shareKey)) {
      fill[keys.shareKey] = bar.volume;
    }

    if (keys.dollarKey && writable(keys.dollarKey)) {
      fill[keys.dollarKey] = Math.round((bar.vwap ?? bar.close) * bar.volume);
    }
  }

  if (keys.floatKey && sharesOutstanding != null && writable(keys.floatKey)) {
    fill[keys.floatKey] = sharesOutstanding;
  }

  return fill;
}
