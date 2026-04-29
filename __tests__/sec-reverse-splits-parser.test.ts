import { describe, expect, it } from 'vitest';

import { extractReverseSplit } from '@/lib/sec/reverse-splits';

describe('extractReverseSplit', () => {
  it('extracts ratio and effective long-form date', () => {
    expect(
      extractReverseSplit('The company effected a 1-for-25 reverse stock split, effective March 14, 2026.'),
    ).toEqual({ ratio: '1-for-25', executionDate: '2026-03-14' });
  });

  it('extracts ratio without a date', () => {
    expect(extractReverseSplit('The issuer approved a 1 for 50 reverse stock split yesterday.')).toEqual({
      ratio: '1-for-50',
      executionDate: null,
    });
  });

  it('handles colon-separated ratios', () => {
    expect(extractReverseSplit('The board approved a reverse stock split at a ratio of 1:100.')).toEqual({
      ratio: '1-for-100',
      executionDate: null,
    });
  });

  it('rejects forward splits', () => {
    expect(extractReverseSplit('The company announced a 25-for-1 forward stock split.')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(extractReverseSplit('')).toBeNull();
  });

  it('returns null for non-split item 5.03 amendments', () => {
    expect(extractReverseSplit('The board approved an amendment to increase the size of the board of directors.')).toBeNull();
  });
});
