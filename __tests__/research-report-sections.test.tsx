// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ResearchReportSections from '@/components/trading/ResearchReportSections';
import type { ResearchSnapshot } from '@/lib/types';

vi.mock('@/components/trading/ResearchReportPanel', () => ({
  default: () => null,
}));

vi.mock('@/components/trading/ResearchTldr', () => ({
  default: () => null,
}));

function buildSnapshot(overrides: Partial<ResearchSnapshot> = {}): ResearchSnapshot {
  return {
    ticker: 'ABCD',
    fetchedAt: '2026-05-13T12:00:00.000Z',
    companyName: 'Acme Biotech',
    warnings: [],
    header: {
      marketCap: null,
      outstandingShares: null,
      float: null,
      exchange: null,
      ipoDate: null,
      industry: null,
      country: null,
      price: null,
      shortInterest: null,
      volume: null,
      description: null,
    },
    dilutionRating: null,
    cashNeedRating: null,
    offeringFrequencyRating: null,
    offeringAbilityRating: null,
    warrantExerciseRating: null,
    overallRisk: null,
    regsho: false,
    nasdaqCompliance: null,
    dilutionDetails: {
      cashRemainingMonths: null,
      cashBurn: null,
      estimatedCash: null,
      managementCommentary: null,
      cashNeedDescription: null,
      filedAt: null,
      warrantInfo: null,
      convertibles: null,
      authorizedShares: null,
      sharesAvailable: null,
    },
    warrants: [],
    convertibleNotes: [],
    registrations: [],
    equityLines: [],
    offerings: [],
    news: [],
    filings: [],
    ownershipGroups: [],
    historicalFloat: [],
    reverseSplits: [],
    identityEvents: [],
    splitStatuses: [],
    agreements: [],
    gapStats: [],
    ...overrides,
  };
}

describe('ResearchReportSections filings UI', () => {
  it('summarizes gap-up days that closed below the open', () => {
    const data = buildSnapshot({
      gapStats: [
        {
          date: '2026-02-25',
          gapPercentage: 42,
          marketOpen: 0.74,
          marketClose: 1.08,
          intradayHigh: 1.74,
          intradayLow: 0.64,
          volume: 209_971_651,
          tags: [],
        },
        {
          date: '2025-12-29',
          gapPercentage: 51,
          marketOpen: 1.71,
          marketClose: 1.64,
          intradayHigh: 2.47,
          intradayLow: 1.64,
          volume: 38_833_174,
          tags: ['S-1'],
        },
        {
          date: '2025-09-09',
          gapPercentage: 123,
          marketOpen: 8.24,
          marketClose: null,
          intradayHigh: 8.42,
          intradayLow: 4,
          volume: 10_326_625,
          tags: [],
        },
      ],
    });

    render(<ResearchReportSections ticker="ABCD" data={data} activeTab="overview" />);

    expect(document.body.textContent).toContain('Closed below open: 1/2 (50%)');
  });

  it('renders first-party SEC filings across buckets and chronological view', () => {
    const data = buildSnapshot({
      filings: [
        {
          formType: '10-K',
          bucket: 'financials',
          title: 'Annual report',
          filedAt: '2026-04-22',
          url: 'https://www.sec.gov/Archives/edgar/data/1/10k.htm',
          accessionNumber: '0000000001-26-000200',
        },
        {
          formType: 'S-1',
          bucket: 'registrations',
          title: 'Registration statement from archive shard',
          filedAt: '2024-12-15',
          url: 'https://www.sec.gov/Archives/edgar/data/1/s1.htm',
          accessionNumber: '0000000001-24-000010',
        },
        {
          formType: 'DEF 14A',
          bucket: 'proxies',
          title: 'Definitive proxy statement',
          filedAt: '2025-06-01',
          url: 'https://www.sec.gov/Archives/edgar/data/1/def14a.htm',
          accessionNumber: '0000000001-25-000030',
        },
      ],
    });

    render(<ResearchReportSections ticker="ABCD" data={data} activeTab="filings" />);

    expect(screen.getAllByText('Financials').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Annual report')).toBeTruthy();
    expect(screen.getAllByText('Registrations').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Registration statement from archive shard')).toBeTruthy();
    expect(screen.getAllByText('Proxies').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Definitive proxy statement')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Chronological' }));

    const chronologicalRows = screen.getAllByRole('row').map((row) => row.textContent);
    expect(chronologicalRows[0]).toBe('TypeHeadlineFiled At');
    expect(chronologicalRows[1]).toContain('10-KAnnual report');
    expect(chronologicalRows[2]).toContain('DEF 14ADefinitive proxy statement');
    expect(chronologicalRows[3]).toContain('S-1Registration statement from archive shard');
  });

  it('renders former symbols below financial commentary without the redundant offering risks block', () => {
    const data = buildSnapshot({
      dilutionDetails: {
        cashRemainingMonths: null,
        cashBurn: null,
        estimatedCash: null,
        managementCommentary: 'Management flagged future financing needs.',
        cashNeedDescription: null,
        filedAt: null,
        warrantInfo: null,
        convertibles: null,
        authorizedShares: null,
        sharesAvailable: null,
      },
      identityEvents: [
        {
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
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/8k.htm',
        },
        {
          previousTicker: null,
          currentTicker: null,
          previousCompanyName: 'Legacy Bio Inc.',
          currentCompanyName: 'Acme Biotech',
          effectiveDate: '2026-04-01',
          exchangeMarket: null,
          eventTypes: ['name_change'],
          filedAt: '2026-04-01',
          formType: 'S-1/A',
          accessionNumber: '0001234567-26-000005',
          url: 'https://www.sec.gov/Archives/edgar/data/1234567/s1a.htm',
        },
      ],
    });

    render(<ResearchReportSections ticker="NHBI" data={data} activeTab="dilution" />);

    const pageText = document.body.textContent ?? '';
    expect(pageText.indexOf('Financial Commentary')).toBeLessThan(pageText.indexOf('Former Symbols'));
    expect(screen.queryByText('Offering Risks')).toBeNull();
    expect(screen.queryByText('Auth Shares')).toBeNull();
    expect(screen.getByText('Management flagged future financing needs.')).toBeTruthy();
    expect(screen.getByText('Former Symbols')).toBeTruthy();
    expect(screen.getByText('OHAR')).toBeTruthy();
    expect(screen.getByText('NHBI')).toBeTruthy();
    expect(screen.getByText('8-K')).toBeTruthy();
    expect(screen.queryByText('Legacy Bio Inc.')).toBeNull();
  });
});
