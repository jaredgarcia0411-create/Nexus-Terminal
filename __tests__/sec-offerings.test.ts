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
    parseCandidateLimit: 300,
    metadataOnly: false,
  }),
}));

vi.mock('@/lib/sec/filing-body', () => ({
  getFilingBody: getFilingBodyMock,
}));

describe('getOfferings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getCikForTickerMock.mockResolvedValue({
      ticker: 'GLND',
      cik: '0001234567',
      name: 'Galena',
      exchange: 'Nasdaq',
    });
  });

  it('scans mixed forms and returns newest-first SEC offering rows', async () => {
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'success',
      count: 4,
      results: [
        {
          accession_number: '0001234567-26-000004',
          form_type: '10-Q',
          filed_at: '2026-04-23',
          headline: 'Quarterly report',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/10q.htm',
          primary_doc_description: '10-Q filing',
          items: null,
        },
        {
          accession_number: '0001234567-26-000003',
          form_type: '8-K',
          filed_at: '2026-04-22',
          headline: 'PIPE financing',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/8k302.htm',
          primary_doc_description: '8-K filing',
          items: '3.02,9.01',
        },
        {
          accession_number: '0001234567-26-000002',
          form_type: '8-K',
          filed_at: '2026-04-21',
          headline: 'SPA execution',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/8k101.htm',
          primary_doc_description: '8-K filing',
          items: '1.01',
        },
        {
          accession_number: '0001234567-26-000001',
          form_type: '424B5',
          filed_at: '2026-04-20',
          headline: 'Prospectus supplement',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/424b5.htm',
          primary_doc_description: '424B5 filing',
          items: null,
        },
      ],
    });
    getFilingBodyMock.mockImplementation(async ({ accessionNumber }: { accessionNumber: string }) => {
      if (accessionNumber === '0001234567-26-000003') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: '8-K',
          filedAt: '2026-04-22',
          text: 'Item 3.02 Unregistered Sales of Equity Securities. The company issued 1,500,000 shares of common stock at $2.00 per share. We expect gross proceeds of $3 million.',
        };
      }

      if (accessionNumber === '0001234567-26-000002') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: '8-K',
          filedAt: '2026-04-21',
          text: 'Item 1.01 Entry into a Material Definitive Agreement. The company entered into a securities purchase agreement covering 2,500,000 shares of common stock at $1.20 per share. We expect gross proceeds of $3 million.',
        };
      }

      if (accessionNumber === '0001234567-26-000001') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: '424B5',
          filedAt: '2026-04-20',
          text: 'THE OFFERING This at-the-market program covers 2,000,000 shares of common stock at $2.50 per share. We expect gross proceeds of $5.0 million.',
        };
      }

      return null;
    });

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('GLND');

    expect(getSecFilingsForProfileMock).toHaveBeenCalledWith('GLND', 'completed-offerings');
    expect(result).toEqual({
      status: 'success',
      count: 3,
      results: [
        {
          accessionNumber: '0001234567-26-000003',
          formType: '8-K',
          filedAt: '2026-04-22',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/8k302.htm',
          offeringType: 'PIPE',
          sharesAmount: 1_500_000,
          sharePrice: 2,
          offeringAmount: 3_000_000,
          warrantsAmount: null,
          isSellingStockholderResale: false,
        },
        {
          accessionNumber: '0001234567-26-000002',
          formType: '8-K',
          filedAt: '2026-04-21',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/8k101.htm',
          offeringType: 'PRIVATE PLACEMENT',
          sharesAmount: 2_500_000,
          sharePrice: 1.2,
          offeringAmount: 3_000_000,
          warrantsAmount: null,
          isSellingStockholderResale: false,
        },
        {
          accessionNumber: '0001234567-26-000001',
          formType: '424B5',
          filedAt: '2026-04-20',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/424b5.htm',
          offeringType: 'ATM USED',
          sharesAmount: 2_000_000,
          sharePrice: 2.5,
          offeringAmount: 5_000_000,
          warrantsAmount: null,
          isSellingStockholderResale: false,
        },
      ],
    });
  });

  it('includes resale 424B rows in raw results', async () => {
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        accession_number: '0001234567-26-000010',
        form_type: '424B3',
        filed_at: '2026-04-10',
        headline: 'Resale prospectus',
        url: 'https://www.sec.gov/Archives/edgar/data/1234567/resale.htm',
        primary_doc_description: '424B3 filing',
        items: null,
      }],
    });
    getFilingBodyMock.mockResolvedValue({
      accessionNumber: '0001234567-26-000010',
      cik: '0001234567',
      formType: '424B3',
      filedAt: '2026-04-10',
      text: 'This prospectus relates to the resale by the selling stockholders. THE OFFERING This registered direct financing covers 3,000,000 shares of common stock at $1.00 per share.',
    });

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('GLND');

    expect(result).toEqual({
      status: 'success',
      count: 1,
      results: [
        expect.objectContaining({
          accessionNumber: '0001234567-26-000010',
          isSellingStockholderResale: true,
          offeringType: 'REGISTERED DIRECT',
        }),
      ],
    });
  });

  it('returns an empty success response when the ticker has no CIK', async () => {
    getCikForTickerMock.mockResolvedValue(null);

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('UNKNOWN');

    expect(result).toEqual({ status: 'success', count: 0, results: [] });
    expect(getSecFilingsForProfileMock).not.toHaveBeenCalled();
  });

  it('returns SEC submissions errors directly', async () => {
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'error',
      count: 0,
      results: [],
      error: 'SEC submissions lookup failed',
    });

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('GLND');

    expect(result).toEqual({
      status: 'error',
      count: 0,
      results: [],
      error: 'SEC submissions lookup failed',
    });
  });

  it('skips 424B filings that do not produce an offering extraction', async () => {
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        accession_number: '0001234567-26-000020',
        form_type: '424B3',
        filed_at: '2026-04-12',
        headline: 'Amendment',
        url: 'https://www.sec.gov/Archives/edgar/data/1234567/amendment.htm',
        primary_doc_description: '424B3 filing',
        items: null,
      }],
    });
    getFilingBodyMock.mockResolvedValue({
      accessionNumber: '0001234567-26-000020',
      cik: '0001234567',
      formType: '424B3',
      filedAt: '2026-04-12',
      text: 'This filing updates a prior prospectus and contains no offering section or extractable fields.',
    });

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('GLND');

    expect(result).toEqual({ status: 'success', count: 0, results: [] });
  });

  it('skips filings when the SEC body fetch returns null', async () => {
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        accession_number: '0001234567-26-000030',
        form_type: '8-K',
        filed_at: '2026-04-15',
        headline: 'PIPE financing',
        url: 'https://www.sec.gov/Archives/edgar/data/1234567/body-missing.htm',
        primary_doc_description: '8-K filing',
        items: '3.02',
      }],
    });
    getFilingBodyMock.mockResolvedValue(null);

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('GLND');

    expect(result).toEqual({ status: 'success', count: 0, results: [] });
  });

  it('returns a lookup error when CIK resolution throws', async () => {
    getCikForTickerMock.mockRejectedValue(new Error('CIK service down'));

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('GLND');

    expect(result).toEqual({
      status: 'error',
      count: 0,
      results: [],
      error: 'CIK service down',
    });
  });

  it('routes dual-item 8-K filings through the Item 3.02 extractor first', async () => {
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'success',
      count: 1,
      results: [{
        accession_number: '0001234567-26-000040',
        form_type: '8-K',
        filed_at: '2026-04-18',
        headline: 'Dual item filing',
        url: 'https://www.sec.gov/Archives/edgar/data/1234567/dual-items.htm',
        primary_doc_description: '8-K filing',
        items: '1.01,3.02',
      }],
    });
    getFilingBodyMock.mockResolvedValue({
      accessionNumber: '0001234567-26-000040',
      cik: '0001234567',
      formType: '8-K',
      filedAt: '2026-04-18',
      text: [
        'Item 1.01 Entry into a Material Definitive Agreement. The company entered into an at-the-market offering agreement.',
        'Item 3.02 Unregistered Sales of Equity Securities. The company issued 750,000 shares of common stock at $4.00 per share. We expect gross proceeds of $3 million.',
      ].join(' '),
    });

    const { getOfferings } = await import('@/lib/sec/offerings');
    const result = await getOfferings('GLND');

    expect(result).toEqual({
      status: 'success',
      count: 1,
      results: [
        expect.objectContaining({
          accessionNumber: '0001234567-26-000040',
          offeringType: 'PIPE',
          sharesAmount: 750_000,
        }),
      ],
    });
  });
});
