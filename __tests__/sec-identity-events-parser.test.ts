import { describe, expect, it } from 'vitest';

import { extractIdentityEvent } from '@/lib/sec/identity-events';

describe('SEC identity event extraction', () => {
  it('extracts a ticker and name change with an effective date and exchange', () => {
    const event = extractIdentityEvent(`
      Effective May 15, 2026, the Company changed its name from Old Harbor Therapeutics Inc.
      to New Harbor BioSciences Inc. The common stock will begin trading on The Nasdaq
      Capital Market under the new ticker symbol NHBI, previously traded under the ticker OHAR.
      The Company's CIK will remain unchanged.
    `);

    expect(event).toEqual(expect.objectContaining({
      previousTicker: 'OHAR',
      currentTicker: 'NHBI',
      previousCompanyName: 'Old Harbor Therapeutics Inc',
      currentCompanyName: 'New Harbor BioSciences Inc',
      effectiveDate: '2026-05-15',
      exchangeMarket: 'Nasdaq Capital Market',
      eventTypes: ['ticker_change', 'name_change', 'cik_identity_continuity'],
      confidence: 'high',
      sourceSnippet: expect.stringContaining('changed its name'),
    }));
  });

  it('extracts former and current names from registration cover-page labels', () => {
    const event = extractIdentityEvent(`
      Current name: Meridian Oncology Corp.
      Former name: Apex Therapeutics Corp.
      This Registration Statement relates to the registrant's common stock.
    `);

    expect(event).toEqual(expect.objectContaining({
      previousCompanyName: 'Apex Therapeutics Corp',
      currentCompanyName: 'Meridian Oncology Corp',
      eventTypes: ['name_change'],
      confidence: 'medium',
    }));
  });

  it('rejects generic former-name cover-page boilerplate without concrete values', () => {
    expect(extractIdentityEvent(`
      Former name, former address and former fiscal year, if changed since last report: Not applicable.
      The registrant files this report under the Securities Exchange Act of 1934.
    `)).toBeNull();
  });
});
