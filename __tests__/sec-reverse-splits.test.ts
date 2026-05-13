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
      count: 7,
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
          accession_number: '0001234567-26-000007',
          form_type: '8-K',
          filed_at: '2026-04-08',
          headline: 'Other events',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000007/doc7.htm',
          primary_doc_description: '8-K filing',
          items: '8.01',
        },
        {
          accession_number: '0001234567-26-000006',
          form_type: '6-K',
          filed_at: '2026-04-07',
          headline: 'Foreign issuer report',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000006/doc6.htm',
          primary_doc_description: '6-K filing',
          items: null,
        },
        {
          accession_number: '0001234567-26-000005',
          form_type: 'DEF 14A',
          filed_at: '2026-04-06',
          headline: 'Proxy statement',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000005/doc5.htm',
          primary_doc_description: 'Proxy filing',
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
          text: 'On April 18, 2026, the company announced that it effected a 1-for-25 reverse stock split, effective March 14, 2026.',
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
      if (accessionNumber === '0001234567-26-000007') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: '8-K',
          filedAt: '2026-04-08',
          text: 'Item 8.01 Other Events. The board approved a reverse stock split at a ratio of 1:50.',
        };
      }
      if (accessionNumber === '0001234567-26-000006') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: '6-K',
          filedAt: '2026-04-07',
          text: 'The issuer completed a share consolidation of one share for every twenty shares effective 2026-04-30.',
        };
      }
      if (accessionNumber === '0001234567-26-000005') {
        return {
          accessionNumber,
          cik: '0001234567',
          formType: 'DEF 14A',
          filedAt: '2026-04-06',
          text: 'Shareholders approved the reverse stock split proposal at the special meeting on April 5, 2026. The proposal authorizes a 1-for-10 reverse stock split.',
        };
      }
      return null;
    });
  });

  it('filters to reverse-split candidate forms, parses split lifecycle fields, and returns the expected shape', async () => {
    const { getReverseSplits } = await import('@/lib/sec/reverse-splits');

    const result = await getReverseSplits('GLND');

    expect(getSecFilingsForProfileMock).toHaveBeenCalledWith('GLND', 'reverse-splits');
    expect(getFilingBodyMock).toHaveBeenCalledTimes(5);
    expect(getFilingBodyMock).toHaveBeenNthCalledWith(1, {
      accessionNumber: '0001234567-26-000004',
      cik: '0001234567',
      formType: '8-K',
      filedAt: '2026-04-20',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/doc4.htm',
    });
    expect(getFilingBodyMock).toHaveBeenNthCalledWith(3, {
      accessionNumber: '0001234567-26-000007',
      cik: '0001234567',
      formType: '8-K',
      filedAt: '2026-04-08',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000007/doc7.htm',
    });
    expect(getFilingBodyMock).toHaveBeenNthCalledWith(4, {
      accessionNumber: '0001234567-26-000006',
      cik: '0001234567',
      formType: '6-K',
      filedAt: '2026-04-07',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000006/doc6.htm',
    });
    expect(getFilingBodyMock).toHaveBeenNthCalledWith(5, {
      accessionNumber: '0001234567-26-000005',
      cik: '0001234567',
      formType: 'DEF 14A',
      filedAt: '2026-04-06',
      primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000005/doc5.htm',
    });
    expect(result).toEqual({
      status: 'success',
      count: 4,
      results: [
        expect.objectContaining({
          ratio: '1-for-25',
          executionDate: '2026-03-14',
          effectiveDate: '2026-03-14',
          voteApprovalDate: null,
          announcementDate: '2026-04-18',
          lifecycleStatus: 'completed',
          accessionNumber: '0001234567-26-000004',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/doc4.htm',
          sourceSnippet: expect.stringContaining('reverse stock split'),
          confidence: 'high',
        }),
        expect.objectContaining({
          ratio: '1-for-50',
          lifecycleStatus: 'approved',
          accessionNumber: '0001234567-26-000007',
          confidence: 'medium',
        }),
        expect.objectContaining({
          ratio: '1-for-20',
          effectiveDate: '2026-04-30',
          lifecycleStatus: 'completed',
          accessionNumber: '0001234567-26-000006',
          confidence: 'high',
        }),
        expect.objectContaining({
          ratio: '1-for-10',
          voteApprovalDate: '2026-04-05',
          announcementDate: '2026-04-06',
          lifecycleStatus: 'approved',
          accessionNumber: '0001234567-26-000005',
          confidence: 'high',
        }),
      ],
    });
  });
});
