import { describe, expect, it } from 'vitest';

import { summarizeFilingMetadata } from '@/lib/sec/filing-summary';

function summarize(formType: string, items: string | null = null, primaryDocDescription: string | null = null): string {
  return summarizeFilingMetadata({ formType, items, primaryDocDescription });
}

describe('filing metadata summary', () => {
  it('labels quarterly filings and amendments', () => {
    expect(summarize('10-Q')).toBe('quarterly report');
    expect(summarize('10-Q/A')).toBe('amended quarterly report');
  });

  it('labels 8-K filings from item codes', () => {
    expect(summarize('8-K', '5.02')).toBe('director/officer change');
    expect(summarize('8-K', '2.02,9.01')).toBe('results of operations');
    expect(summarize('8-K', '9.01')).toBe('financial statements and exhibits');
    expect(summarize('8-K', null)).toBe('current report');
    expect(summarize('8-K', '')).toBe('current report');
    expect(summarize('8-K', '1.01,2.03,5.02')).toBe('material definitive agreement, creation of a material financial obligation');
  });

  it('labels amended 8-K filings from item codes', () => {
    expect(summarize('8-K/A', '5.03')).toBe('amended charter/bylaw amendment');
  });

  it('labels registration, prospectus, and ownership filings', () => {
    expect(summarize('S-1')).toBe('registration statement');
    expect(summarize('S-1/A')).toBe('amended registration statement');
    expect(summarize('424B5')).toBe('prospectus supplement');
    expect(summarize('SC 13G/A')).toBe('amended beneficial ownership report');
  });

  it('preserves the existing fallback for unknown forms', () => {
    expect(summarize('NT 10-Q', null, 'Notification of late filing')).toBe('Notification of late filing');
    expect(summarize('NT 10-Q')).toBe('NT 10-Q filing');
  });
});
