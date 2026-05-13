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

describe('getReverseSplits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getCikForTickerMock.mockResolvedValue({
      ticker: 'GLND',
      cik: '0001234567',
      name: 'Galena',
      exchange: 'Nasdaq',
    });
    getSecFilingsForProfileMock.mockResolvedValue({
      status: 'success',
      count: 4,
      results: [
        {
          accession_number: '0001234567-26-000004',
          form_type: '8-K',
          filed_at: '2026-04-20',
          headline: 'Item 5.03 amendments',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/doc4.htm',
          primary_doc_description: '8-K filing',
          items: '5.03,9.01',
        },
        {
          accession_number: '0001234567-26-000003',
          form_type: '8-K/A',
          filed_at: '2026-04-10',
          headline: 'Older amendment',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000003/doc3.htm',
          primary_doc_description: '8-K/A filing',
          items: null,
        },
        {
          accession_number: '0001234567-26-000002',
          form_type: '8-K',
          filed_at: '2026-04-05',
          headline: 'Other item',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000002/doc2.htm',
          primary_doc_description: '8-K filing',
          items: '1.01',
        },
        {
          accession_number: '0001234567-26-000001',
          form_type: '10-Q',
          filed_at: '2026-04-01',
          headline: 'Quarterly report',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/doc1.htm',
          primary_doc_description: '10-Q filing',
          items: null,
        },
      ],
    });
    getFilingBodyMock.mockImplementation(async ({ accessionNumber }: { accessionNumber: string }) => {
      if (accessionNumber === '0001234567-26-000004') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: '8-K',
          filedAt: '2026-04-20',
          text: 'The company effected a 1-for-25 reverse stock split, effective March 14, 2026.',
        };
      }
      if (accessionNumber === '0001234567-26-000003') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: '8-K/A',
          filedAt: '2026-04-10',
          text: 'The board amended the bylaws to increase the size of the board.',
        };
      }
      return null;
    });
  });

  it('filters to item 5.03 8-Ks, parses reverse splits, and returns the expected shape', async () => {
    const { getReverseSplits } = await import('@/lib/sec/reverse-splits');

    const result = await getReverseSplits('GLND');

    expect(getSecFilingsForProfileMock).toHaveBeenCalledWith('GLND', 'reverse-splits');
    expect(getFilingBodyMock).toHaveBeenCalledTimes(2);
    expect(getFilingBodyMock).toHaveBeenNthCalledWith(1, {
      accessionNumber: '0001234567-26-000004',
      cik: '0001234567',
      formType: '8-K',
      filedAt: '2026-04-20',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/doc4.htm',
    });
    expect(result).toEqual({
      status: 'success',
      count: 1,
      results: [{
        ratio: '1-for-25',
        executionDate: '2026-03-14',
        announcementDate: '2026-04-20',
        accessionNumber: '0001234567-26-000004',
        url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/doc4.htm',
      }],
    });
  });
});
