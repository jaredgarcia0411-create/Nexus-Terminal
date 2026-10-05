import { nyDateTimeToEpoch } from '@/lib/time-utils';
import type { GroupedDailyBar } from '@/lib/massive-market';
import type { SheetColumn } from '@/lib/sheets/columns';

export type MassiveFillKeys = {
  shareKey?: string;
  dollarKey?: string;
  floatKey?: string;
  pdcKey?: string;
  pdRangeKey?: string;
  ahHighKey?: string;
  pmEarlyKey?: string;
  pmLateKey?: string;
  extensionKey?: string;
};

export function getMassiveFillKeys(columns: SheetColumn[]): MassiveFillKeys {
  const keys: MassiveFillKeys = {};
  for (const column of columns) {
    if (column.type === 'share_volume' && !keys.shareKey) keys.shareKey = column.key;
    if (column.type === 'dollar_volume' && !keys.dollarKey) keys.dollarKey = column.key;
    if (column.type === 'float' && !keys.floatKey) keys.floatKey = column.key;
    if (column.type === 'pdc' && !keys.pdcKey) keys.pdcKey = column.key;
    if (column.type === 'pd_range' && !keys.pdRangeKey) keys.pdRangeKey = column.key;
    if (column.type === 'ah_high' && !keys.ahHighKey) keys.ahHighKey = column.key;
    if (column.type === 'pm_high_early' && !keys.pmEarlyKey) keys.pmEarlyKey = column.key;
    if (column.type === 'pm_high_late' && !keys.pmLateKey) keys.pmLateKey = column.key;
    if (column.type === 'pm_extension' && !keys.extensionKey) keys.extensionKey = column.key;
  }
  return keys;
}

export function isEmptySheetCell(value: unknown): boolean {
  return value == null || value === '';
}

export type SessionHighs = {
  ahHigh: number | null;
  pmEarlyHigh: number | null;
  pmLateHigh: number | null;
  complete: boolean;
};

// Open windows return null: fill only writes empty cells, so a partial high
// saved mid-session would never be corrected. Windows are [start, end) in ET.
export function computeSessionHighs(
  bars: Array<{ t: number; h: number }>,
  scanDate: string,
  tradeDate: string,
  nowMs: number,
): SessionHighs {
  const windowHigh = (date: string, start: string, end: string) => {
    const startMs = nyDateTimeToEpoch(date, start)!;
    const endMs = nyDateTimeToEpoch(date, end)!;
    if (nowMs < endMs) return null;
    let high: number | null = null;
    for (const bar of bars) {
      if (bar.t >= startMs && bar.t < endMs && (high == null || bar.h > high)) high = bar.h;
    }
    return high;
  };

  return {
    ahHigh: windowHigh(scanDate, '16:00:00', '20:00:00'),
    pmEarlyHigh: windowHigh(tradeDate, '04:00:00', '07:00:00'),
    pmLateHigh: windowHigh(tradeDate, '07:00:00', '09:30:00'),
    complete: nowMs >= nyDateTimeToEpoch(tradeDate, '09:30:00')!,
  };
}

function hasFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export function computeRowFill({
  values,
  keys,
  bar,
  sharesOutstanding,
  sessionHighs,
  force = false,
}: {
  values: Record<string, unknown>;
  keys: MassiveFillKeys;
  bar: Pick<GroupedDailyBar, 'volume' | 'vwap' | 'close' | 'high' | 'low'> | null;
  // Shares outstanding as of the row's own date (the caller fetches it dated),
  // so this fills the correct historical float, not just today's.
  sharesOutstanding: number | null;
  sessionHighs: SessionHighs | null;
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

    if (keys.pdcKey && writable(keys.pdcKey)) {
      fill[keys.pdcKey] = bar.close;
    }

    if (keys.pdRangeKey && writable(keys.pdRangeKey)) {
      fill[keys.pdRangeKey] = Math.round((bar.high - bar.low) * 10000) / 10000;
    }
  }

  if (keys.floatKey && sharesOutstanding != null && writable(keys.floatKey)) {
    fill[keys.floatKey] = sharesOutstanding;
  }

  if (sessionHighs) {
    if (keys.ahHighKey && sessionHighs.ahHigh != null && writable(keys.ahHighKey)) {
      fill[keys.ahHighKey] = sessionHighs.ahHigh;
    }
    if (keys.pmEarlyKey && sessionHighs.pmEarlyHigh != null && writable(keys.pmEarlyKey)) {
      fill[keys.pmEarlyKey] = sessionHighs.pmEarlyHigh;
    }
    if (keys.pmLateKey && sessionHighs.pmLateHigh != null && writable(keys.pmLateKey)) {
      fill[keys.pmLateKey] = sessionHighs.pmLateHigh;
    }

    // Extension measures the AH/PM high above PDC in scan-day range multiples.
    const highs = [sessionHighs.ahHigh, sessionHighs.pmEarlyHigh, sessionHighs.pmLateHigh]
      .filter((high): high is number => high != null);
    const range = bar ? bar.high - bar.low : 0;
    if (bar && keys.extensionKey && sessionHighs.complete && highs.length > 0 && range > 0 && writable(keys.extensionKey)) {
      fill[keys.extensionKey] = Math.round(((Math.max(...highs) - bar.close) / range) * 10000) / 10000;
    }
  }

  return fill;
}
