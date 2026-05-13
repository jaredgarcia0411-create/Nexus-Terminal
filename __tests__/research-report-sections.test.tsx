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
});
