import { describe, expect, it } from 'vitest';

import type { AskEdgarResponse } from '@/lib/askedgar';
import { normalizeAskEdgarResponse } from '@/lib/askedgar';

const emptyResponse: AskEdgarResponse<unknown> = {
  status: 'success',
  count: 0,
  results: [],
};

describe('normalizeAskEdgarResponse', () => {
  it('maps SEC-backed identity events into the client-safe snapshot contract', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      'identity-events': {
        status: 'success',
        count: 1,
        results: [{
          previousTicker: 'OHAR',
          currentTicker: 'NHBI',
          previousCompanyName: 'Old Harbor Therapeutics Inc.',
          currentCompanyName: 'New Harbor BioSciences Inc.',
          effectiveDate: '2026-05-15',
          exchangeMarket: 'Nasdaq Capital Market',
          eventTypes: ['ticker_change', 'name_change', 'not_allowed'],
          filedAt: '2026-05-14',
          formType: '8-K',
          accessionNumber: '0001234567-26-000006',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000006/8k.htm',
          sourceSnippet: 'Server-only parser context is intentionally not mapped.',
        }],
      },
    };

    const snapshot = normalizeAskEdgarResponse(rawData, {
      ticker: 'NHBI',
      companyName: 'New Harbor BioSciences Inc.',
      fetchedAt: '2026-05-15T00:00:00.000Z',
      warnings: [],
    });

    expect(snapshot.identityEvents).toEqual([{
      previousTicker: 'OHAR',
      currentTicker: 'NHBI',
      previousCompanyName: 'Old Harbor Therapeutics Inc.',
      currentCompanyName: 'New Harbor BioSciences Inc.',
      effectiveDate: '2026-05-15',
      exchangeMarket: 'Nasdaq Capital Market',
      eventTypes: ['ticker_change', 'name_change'],
      filedAt: '2026-05-14',
      formType: '8-K',
      accessionNumber: '0001234567-26-000006',
      url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000006/8k.htm',
    }]);
  });

  it('maps richer reverse-split effective dates into the existing snapshot shape', () => {
    const rawData: Record<string, AskEdgarResponse<unknown>> = {
      'reverse-splits': {
        status: 'success',
        count: 1,
        results: [{
          ratio: '1-for-20',
          executionDate: null,
          effectiveDate: '2026-05-21',
          lifecycleStatus: 'completed',
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
      date: '2026-05-21',
      ratio: '1-for-20',
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
      ownership: emptyResponse,
      'historical-float-pro': emptyResponse,
      'reverse-splits': emptyResponse,
      'split-status': emptyResponse,
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

  it('maps SEC-backed offerings, filters resale rows, and derives risk fields from compliance only', () => {
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
            status: 'resale_only',
            offeringType: 'REGISTERED DIRECT',
            sharesAmount: 3_000_000,
            sharePrice: 1,
            offeringAmount: null,
            warrantsAmount: null,
            isSellingStockholderResale: false,
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
        headline: 'PIPE (8-K Item 3.02)',
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
      ownership: emptyResponse,
      'historical-float-pro': emptyResponse,
      'reverse-splits': emptyResponse,
      'split-status': emptyResponse,
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
