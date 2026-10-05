import { epochToNySortKey } from '@/lib/time-utils';
import type { TradeMarker } from '@/lib/types';

// One split event from Massive. `factor` is Massive's cumulative
// historical_adjustment_factor — it already includes every later split, so a
// single multiply converts a raw price into the split-adjusted price that
// Massive's default (adjusted=true) candles use.
export interface SplitEvent {
  executionDate: string; // YYYY-MM-DD, the first session that trades post-split
  factor: number;
}

// Massive's rule: for a price on date D, use the factor of the FIRST split whose
// execution date is after D. Splits on or before D are already baked into that
// day's prices, so they're skipped. Expects `splits` sorted oldest first.
// YYYY-MM-DD strings sort the same as dates, so a plain string compare works.
export function adjustPriceForSplits(price: number, dateKey: string, splits: SplitEvent[]): number {
  const nextSplit = splits.find((split) => split.executionDate > dateKey);
  return nextSplit ? price * nextSplit.factor : price;
}

// Chart markers carry their own timestamp, so each one is adjusted by its own NY
// date — a cross-day hold with a split between entry and exit still lines up.
export function adjustMarkersForSplits(markers: TradeMarker[], splits: SplitEvent[]): TradeMarker[] {
  if (splits.length === 0) return markers;
  return markers.map((marker) => ({
    ...marker,
    price: adjustPriceForSplits(marker.price, epochToNySortKey(marker.time), splits),
  }));
}
