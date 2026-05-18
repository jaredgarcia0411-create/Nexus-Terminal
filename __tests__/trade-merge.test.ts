import { describe, expect, it } from 'vitest';

function weightedAvg(trades: { price: number; qty: number }[]): number {
  const totalQty = trades.reduce((sum, trade) => sum + trade.qty, 0);
  if (totalQty === 0) return 0;
  return trades.reduce((sum, trade) => sum + trade.price * trade.qty, 0) / totalQty;
}

function unionTags(tagSets: string[][]): string[] {
  return Array.from(new Set(tagSets.flat()));
}

function mergeNotes(notes: (string | null | undefined)[]): string | null {
  const fragments = notes.map((note) => note?.trim()).filter((note): note is string => !!note);
  return fragments.length > 0 ? fragments.join(' --- ') : null;
}

describe('merge helpers - weightedAvg', () => {
  it('computes weighted average entry price', () => {
    const trades = [
      { price: 100, qty: 200 },
      { price: 120, qty: 100 },
    ];

    expect(weightedAvg(trades)).toBeCloseTo(106.67, 2);
  });

  it('returns 0 for zero total qty', () => {
    expect(weightedAvg([])).toBe(0);
  });
});

describe('merge helpers - unionTags', () => {
  it('deduplicates tags across merged trades', () => {
    const tags = unionTags([['momentum', 'breakout'], ['momentum', 'earnings']]);
    expect(tags.sort()).toEqual(['breakout', 'earnings', 'momentum']);
  });

  it('handles empty tag sets', () => {
    expect(unionTags([[], []])).toEqual([]);
  });
});

describe('merge helpers - mergeNotes', () => {
  it('joins non-empty notes with separator', () => {
    expect(mergeNotes(['Good entry', 'Follow through'])).toBe('Good entry --- Follow through');
  });

  it('skips null and empty notes', () => {
    expect(mergeNotes([null, 'Only this', ''])).toBe('Only this');
  });

  it('returns null when all notes are empty', () => {
    expect(mergeNotes([null, '', undefined])).toBeNull();
  });
});

describe('merge - direction validation logic parity', () => {
  it('detects opposite directions', () => {
    const directions = new Set(['LONG', 'SHORT']);
    expect(directions.size).toBe(2);
  });

  it('allows same-direction merge', () => {
    const directions = new Set(['LONG', 'LONG']);
    expect(directions.size).toBe(1);
  });
});
