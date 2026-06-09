// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import type React from 'react';

import ResearchTickerView from '@/components/trading/ResearchTickerView';
import type { ResearchSnapshot } from '@/lib/types';

const { reportCacheMock, toastMock } = vi.hoisted(() => ({
  reportCacheMock: {
    reportId: null as string | null,
    prefetchResearchReport: vi.fn().mockResolvedValue(undefined),
    getCachedReportId: vi.fn((ticker: string) => (ticker ? reportCacheMock.reportId : null)),
  },
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/components/trading/ResearchChart', () => ({
  default: ({ ticker }: { ticker: string }) => <div data-testid="research-chart">chart {ticker}</div>,
}));

vi.mock('@/components/trading/ResearchCompanyHeader', () => ({
  default: ({ ticker, companyName }: { ticker: string; companyName: string | null }) => (
    <div data-testid="research-company-header">{ticker} {companyName}</div>
  ),
}));

vi.mock('@/components/trading/ResearchReportSections', () => ({
  default: ({ ticker, activeTab }: { ticker: string; activeTab: string }) => (
    <div data-testid="research-report-sections">{ticker} {activeTab}</div>
  ),
}));

vi.mock('@/components/trading/ResearchSubNav', () => ({
  default: ({
    tabs,
    activeTab,
    onTabChange,
  }: {
    tabs: Array<{ key: string; label: string }>;
    activeTab: string;
    onTabChange: (tab: 'overview' | 'dilution' | 'news' | 'filings' | 'research') => void;
  }) => (
    <nav data-active-tab={activeTab}>
      {tabs.map((tab) => (
        <button key={tab.key} type="button" onClick={() => onTabChange(tab.key as 'overview' | 'dilution' | 'news' | 'filings' | 'research')}>
          {tab.label}
        </button>
      ))}
    </nav>
  ),
}));

vi.mock('@/components/trading/ResearchReportPanel', () => ({
  getCachedReportId: reportCacheMock.getCachedReportId,
  prefetchResearchReport: reportCacheMock.prefetchResearchReport,
}));

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeSnapshot(overrides: Partial<ResearchSnapshot> = {}): ResearchSnapshot {
  return {
    ticker: 'AAPL',
    fetchedAt: '2026-05-31T12:00:00.000Z',
    companyName: 'Apple Inc.',
    warnings: [],
    header: {
      marketCap: 1_000_000_000,
      outstandingShares: 100_000_000,
      float: 80_000_000,
      exchange: 'NASDAQ',
      ipoDate: null,
      industry: 'Technology',
      country: 'US',
      price: 100,
      shortInterest: null,
      volume: 1_000_000,
      description: 'Company description',
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
    historicalFloat: [],
    reverseSplits: [],
    historicalTickers: [],
    gapStats: [],
    ...overrides,
  };
}

function installSnapshotFetch(response: Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();

    if (url.startsWith('/api/askedgar/snapshot')) return response.clone();

    return jsonResponse({ error: 'unexpected fetch' }, { status: 500 });
  }) as MockedFunction<typeof fetch>;

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ResearchTickerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    reportCacheMock.reportId = null;
  });

  it('fetches a snapshot and renders header, chart, and report boundaries', async () => {
    installSnapshotFetch(jsonResponse(makeSnapshot()));

    render(<ResearchTickerView ticker="AAPL" />);

    await waitFor(() => {
      expect(screen.getByTestId('research-company-header').textContent).toContain('AAPL Apple Inc.');
    });
    expect(screen.getByTestId('research-chart').textContent).toContain('chart AAPL');
    expect(screen.getByTestId('research-report-sections').textContent).toContain('AAPL overview');
    expect(reportCacheMock.prefetchResearchReport).toHaveBeenCalledWith('AAPL');

    fireEvent.click(screen.getByText('Reports'));
    expect(screen.getByTestId('research-report-sections').textContent).toContain('AAPL research');
  });

  it('shows rate-limit status and clears data on 429 responses', async () => {
    installSnapshotFetch(jsonResponse({ error: 'too many requests', retryHint: 'Retry in 2 minutes.' }, { status: 429 }));

    render(<ResearchTickerView ticker="AAPL" />);

    await waitFor(() => {
      expect(screen.getByText('AskEdgar is rate limited right now. Retry in 2 minutes.')).toBeTruthy();
    });
    expect(screen.queryByTestId('research-company-header')).toBeNull();
  });

  it('shows unavailable status and clears data on 503 responses', async () => {
    installSnapshotFetch(jsonResponse({ error: 'unavailable' }, { status: 503 }));

    render(<ResearchTickerView ticker="AAPL" />);

    await waitFor(() => {
      expect(screen.getByText('AskEdgar data is not available for this ticker right now.')).toBeTruthy();
    });
    expect(screen.queryByTestId('research-company-header')).toBeNull();
  });

  it('shows other non-OK errors from the response payload', async () => {
    installSnapshotFetch(jsonResponse({ error: 'Ticker lookup failed', retryHint: 'Try again later.' }, { status: 500 }));

    render(<ResearchTickerView ticker="AAPL" />);

    await waitFor(() => {
      expect(screen.getByText('Ticker lookup failed Try again later.')).toBeTruthy();
    });
  });

});
