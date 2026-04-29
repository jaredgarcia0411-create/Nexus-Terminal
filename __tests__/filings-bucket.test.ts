import { describe, expect, it } from 'vitest';

import { bucketForFormType } from '@/lib/filings-bucket';

describe('bucketForFormType', () => {
  it.each([
    ['10-K', 'financials'],
    ['8-K', 'news'],
    ['S-1', 'registrations'],
    ['424B3', 'prospectus'],
    ['DEF 14A', 'proxies'],
    ['SC 13D', 'ownerships'],
    ['CORRESP', 'other'],
  ])('maps %s to %s', (formType, expected) => {
    expect(bucketForFormType(formType)).toBe(expected);
  });
});
