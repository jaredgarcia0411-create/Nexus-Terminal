import { describe, expect, it } from 'vitest';
import { adjustMarkersForSplits, adjustPriceForSplits, type SplitEvent } from '@/lib/splits';
import { nyDateTimeToEpoch } from '@/lib/time-utils';
import type { TradeMarker } from '@/lib/types';

// Two reverse splits: 1-for-10 on 2025-03-03, then 1-for-5 on 2025-09-02.
// Massive's factors are cumulative, so a price before the first split needs x50.
const splits: SplitEvent[] = [
  { executionDate: '2025-03-03', factor: 50 },
  { executionDate: '2025-09-02', factor: 5 },
];

function marker(dateKey: string, time: string, price: number, label = 'ENTRY'): TradeMarker {
  return { time: nyDateTimeToEpoch(dateKey, time)!, direction: 'LONG', price, label };
}

describe('adjustPriceForSplits', () => {
  it('leaves the price alone when there are no splits', () => {
    expect(adjustPriceForSplits(1.25, '2025-01-10', [])).toBe(1.25);
  });

  it('uses the cumulative factor of the first split after the trade date', () => {
    expect(adjustPriceForSplits(0.1, '2025-01-10', splits)).toBeCloseTo(5);
  });

  it('only applies later splits for a trade between two splits', () => {
    expect(adjustPriceForSplits(1, '2025-06-01', splits)).toBe(5);
  });

  it('does not adjust a trade on the split execution date (already post-split)', () => {
    expect(adjustPriceForSplits(2, '2025-09-02', splits)).toBe(2);
  });

  it('does not adjust trades after the last split', () => {
    expect(adjustPriceForSplits(3, '2025-10-01', splits)).toBe(3);
  });
});

describe('adjustMarkersForSplits', () => {
  it('returns the same array when there are no splits', () => {
    const markers = [marker('2025-01-10', '09:35:00', 1)];
    expect(adjustMarkersForSplits(markers, [])).toBe(markers);
  });

  it('adjusts each marker by its own date for a hold that spans a split', () => {
    const [entry, exit] = adjustMarkersForSplits(
      [
        marker('2025-08-29', '15:55:00', 1, 'ENTRY'),
        marker('2025-09-02', '09:45:00', 6, 'EXIT'),
      ],
      splits,
    );
    expect(entry!.price).toBe(5);
    expect(exit!.price).toBe(6);
  });

  it('uses the New York date for after-hours fills (UTC is already the next day)', () => {
    // 19:30 NY on 2025-02-28 is 00:30 UTC on 2025-03-01 — still before the split.
    const [adjusted] = adjustMarkersForSplits([marker('2025-02-28', '19:30:00', 0.2)], splits);
    expect(adjusted!.price).toBeCloseTo(10);
  });
});
