import { describe, expect, it } from 'vitest';
import { computeCover } from '@/lib/cover-position';

const open = (id: string, qty: number, entry: number) => ({
  id,
  totalQuantity: qty,
  avgEntryPrice: entry,
  commission: 0,
  fees: 0,
});

describe('computeCover', () => {
  it('fully closes a single short at the cover price', () => {
    const result = computeCover('SHORT', 315.33, 500, [open('a', 500, 313)]);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].remainingQty).toBe(0);
    expect(result.matches[0].grossPnl).toBeCloseTo((313 - 315.33) * 500);
    expect(result.flipQty).toBe(0);
  });

  it('closes multiple shorts FIFO', () => {
    const result = computeCover('SHORT', 315.33, 500, [
      open('a', 300, 314.98),
      open('b', 200, 312.92),
    ]);

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.remainingQty === 0)).toBe(true);
    expect(result.flipQty).toBe(0);
  });

  it('partially closes when cover qty is less than open qty', () => {
    const result = computeCover('SHORT', 315, 300, [open('a', 500, 313)]);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchedQty).toBe(300);
    expect(result.matches[0].remainingQty).toBe(200);
    expect(result.flipQty).toBe(0);
  });

  it('flips leftover when cover qty is greater than open qty', () => {
    const result = computeCover('SHORT', 315, 700, [open('a', 500, 313)]);

    expect(result.matches[0].matchedQty).toBe(500);
    expect(result.matches[0].remainingQty).toBe(0);
    expect(result.flipQty).toBe(200);
  });

  it('closes a long via a sell', () => {
    const result = computeCover('LONG', 12, 100, [open('a', 100, 10)]);

    expect(result.matches[0].grossPnl).toBeCloseTo((12 - 10) * 100);
  });
});
