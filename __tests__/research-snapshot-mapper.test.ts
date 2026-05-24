import { describe, expect, it } from 'vitest';

import type { AskEdgarResponse } from '@/lib/askedgar';
import { normalizeAskEdgarResponse } from '@/lib/askedgar';

const emptyResponse: AskEdgarResponse<unknown> = {
  status: 'success',
  count: 0,
  results: [],
};

describe('normalizeAskEdgarResponse', () => {
  it('maps AE historical tickers into the client-safe snapshot contract', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      'historical-tickers': {
        status: 'success',
        count: 1,
        results: [{
          current_ticker: 'BINI',
          historical_tickers: [{ ticker: 'MULN', date_changed: '2025-07-28' }],
        }],
      },
    };

    const snapshot = normalizeAskEdgarResponse(rawData, {
      ticker: 'NHBI',
      companyName: 'New Harbor BioSciences Inc.',
      fetchedAt: '2026-05-15T00:00:00.000Z',
      warnings: [],
    });

    expect(snapshot.historicalTickers).toEqual([{
      ticker: 'MULN',
      dateChanged: '2025-07-28',
    }]);
  });

  it('maps AE reverse-split rows into the existing snapshot shape', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      'reverse-splits': {
        status: 'success',
        count: 1,
        results: [{
          ticker: 'TNXP',
          execution_date: '2025-02-05',
          split_from: 100,
          split_to: 1,
          last_updated: '2026-05-24T00:00:00Z',
        }],
      },
    };

    const snapshot = normalizeAskEdgarResponse(rawData, {
      ticker: 'ABCD',
      companyName: 'Acme Biotech',
      fetchedAt: '2026-04-29T00:00:00.000Z',
      warnings: [],
    });

    expect(snapshot.reverseSplits).toEqual([{
      date: '2025-02-05',
      ratio: '100-for-1',
    }]);
  });

  it('uses first-party SEC filing metadata for the filings tab while preserving news rows', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      screener: emptyResponse,
      'dilution-rating': emptyResponse,
      'dilution-data': emptyResponse,
      'nasdaq-compliance': emptyResponse,
      registrations: emptyResponse,
      'equity-lines': emptyResponse,
      offerings: emptyResponse,
      news: {
        status: 'success',
        count: 2,
        results: [
          {
            title: 'Biotech announces trial milestone',
            body: 'Topline data expected next quarter.',
            filed_at: '2026-04-25',
            form_type: 'news',
          },
          {
            accession_number: 'ask-edgar-filing',
            form_type: '8-K',
            filed_at: '2026-04-24',
            headline: 'AskEdgar filing row should be fallback only',
          },
        ],
      },
      'sec-filings': {
        status: 'success',
        count: 2,
        results: [
          {
            accession_number: '0000000001-26-000200',
            cik: '0000000001',
            ticker_requested: 'ABCD',
            ticker_at_ingest: 'ABCD',
            form_type: '10-K',
            filed_at: '2026-04-22',
            report_date: '2025-12-31',
            acceptance_datetime: '2026-04-22T20:00:00.000Z',
            headline: 'Annual report',
            url: 'https://www.sec.gov/Archives/edgar/data/1/10k.htm',
            primary_document: '10k.htm',
            primary_doc_description: 'Annual report',
            items: null,
            archive_source: null,
          },
          {
            accession_number: '0000000001-24-000010',
            cik: '0000000001',
            ticker_requested: 'ABCD',
            ticker_at_ingest: 'ABCD',
            form_type: 'S-1',
            filed_at: '2024-12-15',
            report_date: '2024-12-15',
            acceptance_datetime: '2024-12-15T20:00:00.000Z',
            headline: 'Registration statement',
            url: 'https://www.sec.gov/Archives/edgar/data/1/s1.htm',
            primary_document: 's1.htm',
            primary_doc_description: 'Registration statement',
            items: null,
            archive_source: 'CIK0000000001-submissions-001.json',
          },
        ],
      },
      'historical-float-pro': emptyResponse,
      'reverse-splits': emptyResponse,
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
        isNews: true,
      }),
    ]);
    expect(snapshot.filings).toEqual([
      expect.objectContaining({
        accessionNumber: '0000000001-26-000200',
        formType: '10-K',
        bucket: 'financials',
        title: 'Annual report',
        filedAt: '2026-04-22',
      }),
      expect.objectContaining({
        accessionNumber: '0000000001-24-000010',
        formType: 'S-1',
        bucket: 'registrations',
        title: 'Registration statement',
        filedAt: '2024-12-15',
      }),
    ]);
    expect(snapshot.filings.some((filing) => filing.accessionNumber === 'ask-edgar-filing')).toBe(false);
  });

  it('keeps only rendered news fallback filing types from news', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      screener: emptyResponse,
      'dilution-rating': emptyResponse,
      'dilution-data': emptyResponse,
      'nasdaq-compliance': emptyResponse,
      registrations: emptyResponse,
      'equity-lines': emptyResponse,
      offerings: emptyResponse,
      news: {
        status: 'success',
        count: 8,
        results: [
          {
            title: 'Biotech announces trial milestone',
            body: 'Topline data expected next quarter.',
            summary: 'Topline data expected next quarter.',
            filed_at: '2026-04-25',
            form_type: 'news',
          },
          {
            accession_number: '0000000001-26-000001',
            form_type: 'CORRESP',
            filed_at: '2026-04-18',
            headline: 'Staff correspondence',
            document_url: 'https://www.sec.gov/Archives/edgar/data/1/correspondence.htm',
          },
          {
            accession_number: '0000000001-26-000002',
            form_type: '10-K',
            filed_at: '2026-04-24',
            headline: 'Annual report',
            document_url: 'https://www.sec.gov/Archives/edgar/data/1/10k.htm',
          },
          {
            accession_number: '0000000001-26-000003',
            form_type: '8-K',
            filed_at: '2026-04-26',
            headline: 'Current report',
            document_url: 'https://www.sec.gov/Archives/edgar/data/1/8k.htm',
          },
          {
            accession_number: '0000000001-26-000004',
            form_type: 'S-1',
            filed_at: '2026-04-23',
            headline: 'Registration statement',
            document_url: 'https://www.sec.gov/Archives/edgar/data/1/s1.htm',
          },
          {
            accession_number: '0000000001-26-000005',
            form_type: '424B3',
            filed_at: '2026-04-22',
            headline: 'Prospectus supplement',
            document_url: 'https://www.sec.gov/Archives/edgar/data/1/424b3.htm',
          },
          {
            accession_number: '0000000001-26-000006',
            form_type: 'DEF 14A',
            filed_at: '2026-04-21',
            headline: 'Definitive proxy statement',
            document_url: 'https://www.sec.gov/Archives/edgar/data/1/def14a.htm',
          },
          {
            accession_number: '0000000001-26-000007',
            form_type: 'SC 13D',
            filed_at: '2026-04-20',
            headline: 'Beneficial ownership report',
            document_url: 'https://www.sec.gov/Archives/edgar/data/1/sc13d.htm',
          },
        ],
      },
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
        formType: 'news',
        isNews: true,
      }),
    ]);

    expect(snapshot.filings).toHaveLength(2);
    expect(snapshot.filings.map((filing) => filing.formType)).toEqual([
      '8-K',
      'S-1',
    ]);
    expect(snapshot.filings.map((filing) => filing.bucket)).toEqual([
      'news',
      'registrations',
    ]);
    expect(snapshot.filings[0]).toMatchObject({
      title: 'Current report',
      filedAt: '2026-04-26',
      url: 'https://www.sec.gov/Archives/edgar/data/1/8k.htm',
      accessionNumber: '0000000001-26-000003',
    });
    expect(snapshot.filings.some((filing) => filing.formType === '10-K')).toBe(false);
    expect(snapshot.filings.some((filing) => filing.formType === 'CORRESP')).toBe(false);
    expect(snapshot.news.some((item) => item.title === 'Current report')).toBe(false);
    expect(snapshot.historicalFloat).toEqual([
      expect.objectContaining({
        date: '2026-04-15',
        outstanding: 123456789,
      }),
    ]);
  });

  it('maps AE offerings and derives risk fields from compliance only', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      screener: emptyResponse,
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
        count: 2,
        results: [
          {
            ticker: 'TNXP',
            headline: 'ATM USED',
            filed_at: '2026-05-11',
            form_type: 'news',
            offering_type: ' S-3',
            askedgar_url: 'https://app.askedgar.io/filing',
            selling_shareholder_details: 'None',
            shares_amount: 2_000_000,
            warrants_amount: null,
            share_price: 2.5,
            offering_amount: 5_000_000,
            conversion_price: null,
            last_updated: '2026-05-24T00:00:00Z',
          },
          {
            ticker: 'TNXP',
            headline: 'EQUITY LINE USED',
            filed_at: '2026-05-10',
            offering_type: 'EQUITY LINE',
            shares_amount: 100_000,
            warrants_amount: null,
            share_price: null,
            offering_amount: null,
          },
        ],
      },
      news: emptyResponse,
      'filing-titles': emptyResponse,
      'historical-float-pro': emptyResponse,
      'reverse-splits': emptyResponse,
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
        headline: 'ATM USED',
        filedAt: '2026-05-11',
        offeringType: 'S-3',
        sharesAmount: 2_000_000,
        warrantsAmount: null,
        sharePrice: 2.5,
        offeringAmount: 5_000_000,
      },
    ]);
    expect(snapshot.overallRisk).toBeNull();
    expect(snapshot.regsho).toBe(true);
    expect(snapshot.nasdaqCompliance).toBe('Watch');
  });

  it('preserves registration and warrant statuses and maps convertible note rows', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      screener: emptyResponse,
      'dilution-rating': emptyResponse,
      'dilution-data': {
        status: 'success',
        count: 2,
        results: [
          {
            details: 'Series A warrants',
            warrants_amount: 1_000_000,
            warrants_remaining: 750_000,
            warrants_exercise_price: 1.5,
            warrant_status: 'Potentially in play',
            filed_at: '2026-04-20',
          },
          {
            convertible_note_details: 'Senior secured convertible note',
            principal_amount: '$2,500,000',
            conversion_price: '$0.75',
            maturity_date: '2027-04-20',
            note_status: 'Outstanding',
            filed_at: '2026-04-21',
          },
        ],
      },
      'nasdaq-compliance': emptyResponse,
      registrations: {
        status: 'success',
        count: 1,
        results: [{
          headline: 'At-the-market offering program',
          is_atm: true,
          effective_status: false,
          status: 'Restricted by baby shelf',
          line_amount: '$10,000,000',
          remaining_capacity: '$4,500,000',
          filed_at: '2026-04-19',
        }],
      },
      'equity-lines': emptyResponse,
      offerings: emptyResponse,
      news: emptyResponse,
      'historical-float-pro': emptyResponse,
      'reverse-splits': emptyResponse,
      'gap-stats': emptyResponse,
    };

    const snapshot = normalizeAskEdgarResponse(rawData, {
      ticker: 'ABCD',
      companyName: 'Acme Biotech',
      fetchedAt: '2026-04-29T00:00:00.000Z',
      warnings: [],
    });

    expect(snapshot.registrations[0]).toMatchObject({
      isAtm: true,
      isEffective: false,
      status: 'Restricted by baby shelf',
      offeringAmount: 10_000_000,
      amountRemainingAtm: 4_500_000,
    });
    expect(snapshot.warrants[0]).toMatchObject({
      status: 'Potentially in play',
      exercisePrice: 1.5,
    });
    expect(snapshot.convertibleNotes).toEqual([
      {
        details: 'Senior secured convertible note',
        principalAmount: 2_500_000,
        conversionPrice: 0.75,
        maturityDate: '2027-04-20',
        filedAt: '2026-04-21',
        status: 'Outstanding',
        documentUrl: null,
      },
    ]);
    expect(snapshot.dilutionDetails.convertibles).toBe('Senior secured convertible note');
  });
});
