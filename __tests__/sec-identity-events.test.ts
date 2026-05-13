import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCikForTickerMock, getSecFilingsForProfileMock, getFilingBodyMock } = vi.hoisted(() => ({
  getCikForTickerMock: vi.fn(),
  getSecFilingsForProfileMock: vi.fn(),
  getFilingBodyMock: vi.fn(),
}));

vi.mock('@/lib/sec/cik-map', () => ({
  getCikForTicker: getCikForTickerMock,
}));

vi.mock('@/lib/sec/submissions', () => ({
  getSecFilingsForProfile: getSecFilingsForProfileMock,
  getSecFilingPullProfileConfig: () => ({
    limit: 1000,
    sinceDays: 3650,
    parseCandidateLimit: 200,
    metadataOnly: false,
  }),
}));

vi.mock('@/lib/sec/filing-body', () => ({
  getFilingBody: getFilingBodyMock,
}));

describe('getIdentityEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getCikForTickerMock.mockResolvedValue({
      ticker: 'NHBI',
      cik: '0001234567',
      name: 'New Harbor BioSciences Inc.',
      exchange: 'Nasdaq',
    });
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'success',
      count: 7,
      results: [
        {
          accession_number: '0001234567-26-000007',
          form_type: 'S-1/A',
          filed_at: '2026-05-20',
          headline: 'Registration amendment',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000007/s1a.htm',
          items: null,
        },
        {
          accession_number: '0001234567-26-000006',
          form_type: '8-K',
          filed_at: '2026-05-15',
          headline: 'Item 5.03 amendments',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000006/8k.htm',
          items: '5.03,9.01',
        },
        {
          accession_number: '0001234567-26-000005',
          form_type: '8-K',
          filed_at: '2026-05-10',
          headline: 'Other item',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000005/8k.htm',
          items: '1.01',
        },
        {
          accession_number: '0001234567-26-000004',
          form_type: 'DEF 14A',
          filed_at: '2026-05-06',
          headline: 'Proxy statement',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/def14a.htm',
          items: null,
        },
        {
          accession_number: '0001234567-26-000003',
          form_type: '6-K',
          filed_at: '2026-05-04',
          headline: 'Foreign issuer report',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000003/6k.htm',
          items: null,
        },
        {
          accession_number: '0001234567-26-000002',
          form_type: '10-Q',
          filed_at: '2026-05-03',
          headline: 'Quarterly report',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000002/10q.htm',
          items: null,
        },
      ],
    });
    getFilingBodyMock.mockImplementation(async ({ accessionNumber }: { accessionNumber: string }) => {
      if (accessionNumber === '0001234567-26-000007') {
        return {
          accessionNumber,
          text: 'Current name: New Harbor BioSciences Inc. Former name: Old Harbor Therapeutics Inc.',
        };
      }
      if (accessionNumber === '0001234567-26-000006') {
        return {
          accessionNumber,
          text: 'Effective May 15, 2026, the ticker symbol changed from OHAR to NHBI on the Nasdaq Capital Market. The CIK remains the same.',
        };
      }
      if (accessionNumber === '0001234567-26-000004') {
        return {
          accessionNumber,
          text: 'The proxy statement asks stockholders to approve executive compensation.',
        };
      }
      if (accessionNumber === '0001234567-26-000003') {
        return {
          accessionNumber,
          text: 'The issuer transferred its listing from NYSE American to the Nasdaq Capital Market effective 2026-05-01.',
        };
      }
      return null;
    });
  });

  it('filters to identity-change candidate forms and fetches bodies lazily', async () => {
    const { getIdentityEvents } = await import('@/lib/sec/identity-events');

    const result = await getIdentityEvents('NHBI');

    expect(getSecFilingsForProfileMock).toHaveBeenCalledWith('NHBI', 'symbol-changes');
    expect(getFilingBodyMock).toHaveBeenCalledTimes(4);
    expect(getFilingBodyMock).toHaveBeenNthCalledWith(1, {
      accessionNumber: '0001234567-26-000007',
      cik: '0001234567',
      formType: 'S-1/A',
      filedAt: '2026-05-20',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000007/s1a.htm',
    });
    expect(getFilingBodyMock).toHaveBeenNthCalledWith(2, {
      accessionNumber: '0001234567-26-000006',
      cik: '0001234567',
      formType: '8-K',
      filedAt: '2026-05-15',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000006/8k.htm',
    });
    expect(result).toEqual({
      status: 'success',
      count: 3,
      results: [
        expect.objectContaining({
          previousCompanyName: 'Old Harbor Therapeutics Inc',
          currentCompanyName: 'New Harbor BioSciences Inc',
          eventTypes: ['name_change'],
          formType: 'S-1/A',
          accessionNumber: '0001234567-26-000007',
        }),
        expect.objectContaining({
          previousTicker: 'OHAR',
          currentTicker: 'NHBI',
          effectiveDate: '2026-05-15',
          exchangeMarket: 'Nasdaq Capital Market',
          eventTypes: ['ticker_change', 'cik_identity_continuity'],
          formType: '8-K',
          accessionNumber: '0001234567-26-000006',
        }),
        expect.objectContaining({
          exchangeMarket: 'Nasdaq Capital Market',
          eventTypes: ['exchange_listing_change'],
          effectiveDate: '2026-05-01',
          formType: '6-K',
          accessionNumber: '0001234567-26-000003',
        }),
      ],
    });
  });
});
