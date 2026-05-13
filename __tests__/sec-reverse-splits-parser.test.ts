import { describe, expect, it } from 'vitest';

import { extractReverseSplit } from '@/lib/sec/reverse-splits';

describe('extractReverseSplit', () => {
  it('extracts ratio and effective long-form date', () => {
    expect(
      extractReverseSplit('The company effected a 1-for-25 reverse stock split, effective March 14, 2026.'),
    ).toEqual(expect.objectContaining({
      ratio: '1-for-25',
      executionDate: '2026-03-14',
      effectiveDate: '2026-03-14',
      lifecycleStatus: 'completed',
      confidence: 'high',
    }));
  });

  it('extracts ratio without a date', () => {
    expect(extractReverseSplit('The issuer approved a 1 for 50 reverse stock split yesterday.')).toEqual(expect.objectContaining({
      ratio: '1-for-50',
      executionDate: null,
      effectiveDate: null,
      lifecycleStatus: 'approved',
      confidence: 'medium',
    }));
  });

  it('handles colon-separated ratios', () => {
    expect(extractReverseSplit('The board approved a reverse stock split at a ratio of 1:100.')).toEqual(expect.objectContaining({
      ratio: '1-for-100',
      executionDate: null,
      lifecycleStatus: 'approved',
    }));
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

  it('extracts word-spelled ratios with hyphens', () => {
    expect(
      extractReverseSplit('The company effected a one-for-twenty-five reverse stock split, effective March 14, 2026.'),
    ).toEqual(expect.objectContaining({
      ratio: '1-for-25',
      executionDate: '2026-03-14',
      effectiveDate: '2026-03-14',
      lifecycleStatus: 'completed',
    }));
  });

  it('extracts spaced word-spelled ratios', () => {
    expect(extractReverseSplit('The issuer approved a one for fifty reverse stock split.')).toEqual(expect.objectContaining({
      ratio: '1-for-50',
      executionDate: null,
      lifecycleStatus: 'approved',
    }));
  });

  it('rejects forward word-spelled ratios', () => {
    expect(extractReverseSplit('The company announced a fifty-for-one forward stock split.')).toBeNull();
  });

  it('extracts proposed proxy split lifecycle and vote date', () => {
    expect(
      extractReverseSplit([
        'The board is seeking stockholder approval at the special meeting on May 10, 2026.',
        'Proposal No. 2 authorizes a reverse stock split at a ratio of 1-for-20.',
      ].join(' ')),
    ).toEqual(expect.objectContaining({
      ratio: '1-for-20',
      executionDate: null,
      effectiveDate: null,
      voteApprovalDate: '2026-05-10',
      lifecycleStatus: 'proposed',
      confidence: 'high',
      sourceSnippet: expect.stringContaining('stockholder approval'),
    }));
  });

  it('extracts share-consolidation ratio language', () => {
    expect(
      extractReverseSplit('Each holder will receive one post-split share for every twenty pre-split shares, effective 2026-05-21.'),
    ).toEqual(expect.objectContaining({
      ratio: '1-for-20',
      effectiveDate: '2026-05-21',
      lifecycleStatus: 'effective',
    }));
  });
});
