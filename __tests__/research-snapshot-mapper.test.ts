import { describe, expect, it } from 'vitest';

import type { AskEdgarResponse } from '@/lib/askedgar';
import { normalizeAskEdgarResponse } from '@/lib/askedgar';

const emptyResponse: AskEdgarResponse<unknown> = {
  status: 'success',
  count: 0,
  results: [],
};

describe('normalizeAskEdgarResponse', () => {
  it('splits filings out of news and preserves SEC filing metadata', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      screener: emptyResponse,
      'float-outstanding': emptyResponse,
      'dilution-rating': emptyResponse,
      'dilution-data': emptyResponse,
      'nasdaq-compliance': emptyResponse,
      registrations: emptyResponse,
      'equity-lines': emptyResponse,
      offerings: emptyResponse,
      news: {
        status: 'success',
        count: 1,
        results: [{
          title: 'Biotech announces trial milestone',
          summary: 'Topline data expected next quarter.',
          filed_at: '2026-04-25',
          source: 'News',
        }],
      },
      'filing-titles': {
        status: 'success',
        count: 7,
        results: [
          {
            accession_number: '0000000001-26-000001',
            form_type: 'CORRESP',
            filed_at: '2026-04-18',
            headline: 'Staff correspondence',
            url: 'https://www.sec.gov/Archives/edgar/data/1/correspondence.htm',
          },
          {
            accession_number: '0000000001-26-000002',
            form_type: '10-K',
            filed_at: '2026-04-24',
            headline: 'Annual report',
            url: 'https://www.sec.gov/Archives/edgar/data/1/10k.htm',
          },
          {
            accession_number: '0000000001-26-000003',
            form_type: '8-K',
            filed_at: '2026-04-26',
            headline: 'Current report',
            url: 'https://www.sec.gov/Archives/edgar/data/1/8k.htm',
          },
          {
            accession_number: '0000000001-26-000004',
            form_type: 'S-1',
            filed_at: '2026-04-23',
            headline: 'Registration statement',
            url: 'https://www.sec.gov/Archives/edgar/data/1/s1.htm',
          },
          {
            accession_number: '0000000001-26-000005',
            form_type: '424B3',
            filed_at: '2026-04-22',
            headline: 'Prospectus supplement',
            url: 'https://www.sec.gov/Archives/edgar/data/1/424b3.htm',
          },
          {
            accession_number: '0000000001-26-000006',
            form_type: 'DEF 14A',
            filed_at: '2026-04-21',
            headline: 'Definitive proxy statement',
            url: 'https://www.sec.gov/Archives/edgar/data/1/def14a.htm',
          },
          {
            accession_number: '0000000001-26-000007',
            form_type: 'SC 13D',
            filed_at: '2026-04-20',
            headline: 'Beneficial ownership report',
            url: 'https://www.sec.gov/Archives/edgar/data/1/sc13d.htm',
          },
        ],
      },
      ownership: emptyResponse,
      'historical-float-pro': {
        status: 'success',
        count: 1,
        results: [{
          reported_date: '2026-04-15',
          outstanding: 123456789,
          float: 45678901,
          tradable_float: 42000000,
        }],
      },
      'reverse-splits': emptyResponse,
      'split-status': emptyResponse,
      agreements: emptyResponse,
      'gap-stats': emptyResponse,
    };

    const snapshot = normalizeAskEdgarResponse(rawData, {
      ticker: 'ABCD',
      companyName: 'Acme Biotech',
      fetchedAt: '2026-04-29T00:00:00.000Z',
      warnings: [],
    });

    expect(snapshot.news).toEqual([
      expect.objectContaining({
        title: 'Biotech announces trial milestone',
        formType: 'News',
        isNews: true,
      }),
    ]);

    expect(snapshot.filings).toHaveLength(7);
    expect(snapshot.filings.map((filing) => filing.formType)).toEqual([
      '8-K',
      '10-K',
      'S-1',
      '424B3',
      'DEF 14A',
      'SC 13D',
      'CORRESP',
    ]);
    expect(snapshot.filings.map((filing) => filing.bucket)).toEqual([
      'news',
      'financials',
      'registrations',
      'prospectus',
      'proxies',
      'ownerships',
      'other',
    ]);
    expect(snapshot.filings[0]).toMatchObject({
      title: 'Current report',
      filedAt: '2026-04-26',
      url: 'https://www.sec.gov/Archives/edgar/data/1/8k.htm',
      accessionNumber: '0000000001-26-000003',
    });
    expect(snapshot.news.some((item) => item.title === 'Current report')).toBe(false);
    expect(snapshot.historicalFloat).toEqual([
      expect.objectContaining({
        date: '2026-04-15',
        outstanding: 123456789,
      }),
    ]);
  });

  it('maps SEC-backed offerings, filters resale rows, and derives risk fields from compliance only', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      screener: emptyResponse,
      'float-outstanding': emptyResponse,
      'dilution-rating': emptyResponse,
      'dilution-data': emptyResponse,
      'nasdaq-compliance': {
        status: 'success',
        count: 1,
        results: [{ regsho: true, status: 'Watch' }],
      },
      registrations: emptyResponse,
      'equity-lines': emptyResponse,
      offerings: {
        status: 'success',
        count: 3,
        results: [
          {
            accessionNumber: '0000000001-26-000100',
            formType: '424B5',
            filedAt: '2026-04-25',
            url: 'https://www.sec.gov/Archives/edgar/data/1/atm.htm',
            offeringType: 'ATM USED',
            sharesAmount: 2_000_000,
            sharePrice: 2.5,
            offeringAmount: 5_000_000,
            warrantsAmount: null,
            isSellingStockholderResale: false,
          },
          {
            accessionNumber: '0000000001-26-000101',
            formType: '424B3',
            filedAt: '2026-04-24',
            url: 'https://www.sec.gov/Archives/edgar/data/1/resale.htm',
            offeringType: 'REGISTERED DIRECT',
            sharesAmount: 3_000_000,
            sharePrice: 1,
            offeringAmount: null,
            warrantsAmount: null,
            isSellingStockholderResale: true,
          },
          {
            accessionNumber: '0000000001-26-000102',
            formType: '8-K',
            filedAt: '2026-04-23',
            url: 'https://www.sec.gov/Archives/edgar/data/1/pipe.htm',
            offeringType: 'PIPE',
            sharesAmount: null,
            sharePrice: null,
            offeringAmount: null,
            warrantsAmount: null,
            isSellingStockholderResale: false,
          },
        ],
      },
      news: emptyResponse,
      'filing-titles': emptyResponse,
      ownership: emptyResponse,
      'historical-float-pro': emptyResponse,
      'reverse-splits': emptyResponse,
      'split-status': emptyResponse,
      agreements: emptyResponse,
      'gap-stats': emptyResponse,
    };

    const snapshot = normalizeAskEdgarResponse(rawData, {
      ticker: 'ABCD',
      companyName: 'Acme Biotech',
      fetchedAt: '2026-04-29T00:00:00.000Z',
      warnings: [],
    });

    expect(snapshot.offerings).toEqual([
      {
        headline: 'ATM USED — 2,000,000 shares — @ $2.50 — $5.0M',
        filedAt: '2026-04-25',
        offeringType: 'ATM USED',
        sharesAmount: 2_000_000,
        warrantsAmount: null,
        sharePrice: 2.5,
        offeringAmount: 5_000_000,
      },
      {
        headline: 'PIPE (8-K)',
        filedAt: '2026-04-23',
        offeringType: 'PIPE',
        sharesAmount: null,
        warrantsAmount: null,
        sharePrice: null,
        offeringAmount: null,
      },
    ]);
    expect(snapshot.overallRisk).toBeNull();
    expect(snapshot.regsho).toBe(true);
    expect(snapshot.nasdaqCompliance).toBe('Watch');
  });
});
