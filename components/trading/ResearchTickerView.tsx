'use client';

import { useCallback, useEffect, useState } from 'react';

import ResearchChart from '@/components/trading/ResearchChart';
import ResearchCompanyHeader from '@/components/trading/ResearchCompanyHeader';
import ResearchReportSections from '@/components/trading/ResearchReportSections';
import ResearchSubNav from '@/components/trading/ResearchSubNav';
import type { ResearchSnapshot } from '@/lib/types';

interface SnapshotErrorResponse {
  error?: string;
  warnings?: string[];
  retryHint?: string;
}

interface Props {
  ticker: string;
}

type TabKey = 'overview' | 'dilution' | 'news' | 'filings' | 'gap-stats';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'dilution', label: 'Dilution' },
  { key: 'news', label: 'News' },
  { key: 'filings', label: 'Filings' },
  { key: 'gap-stats', label: 'Gap Stats' },
];

export default function ResearchTickerView({ ticker }: Props) {
  const [data, setData] = useState<ResearchSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // YYYY-MM-DD when the user clicks a gap-stat row; null = live chart.
  const [historicalDate, setHistoricalDate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const fetchData = useCallback(async (selectedTicker: string) => {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/askedgar/snapshot?ticker=${encodeURIComponent(selectedTicker)}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as SnapshotErrorResponse | null;
        const message = payload?.error?.trim() || `Lookup failed: ${response.status}`;
        const retryHint = payload?.retryHint?.trim();

        if (response.status === 429) {
          setData(null);
          setStatusMessage(retryHint ? `AskEdgar is rate limited right now. ${retryHint}` : 'AskEdgar is rate limited right now. Please retry shortly.');
          return;
        }

        if (response.status === 503) {
          setData(null);
          setStatusMessage('AskEdgar data is not available for this ticker right now.');
          return;
        }

        throw new Error(retryHint ? `${message} ${retryHint}` : message);
      }

      const result = (await response.json()) as ResearchSnapshot;
      setData(result);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Lookup failed');
      setStatusMessage(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setActiveTab('overview');
    setHistoricalDate(null);
    void fetchData(ticker);
  }, [ticker, fetchData]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading {ticker} data...
      </div>
    );
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-rose-400">{error}</div>;
  }

  if (statusMessage) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500">{statusMessage}</div>;
  }

  if (!data) return null;

  const hasChart = activeTab === 'overview' || activeTab === 'gap-stats';

  return (
    <div className="flex h-full flex-col">
      {/* Sub-nav stays pinned so the user can swap tabs without scrolling back up. shrink-0 keeps it
          out of the flex distribution. */}
      <div className="shrink-0">
        <ResearchSubNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Top row: company info panel on the left, chart only where it supports the tab. Pinned. */}
      <div className={`flex shrink-0 border-b border-white/10 ${hasChart ? 'h-[420px]' : ''}`}>
        <div className="w-[320px] shrink-0 overflow-y-auto">
          <ResearchCompanyHeader ticker={ticker} companyName={data.companyName ?? null} header={data.header} compact={!hasChart} />
        </div>
        {hasChart ? (
          <div className="min-h-0 flex-1 bg-[#0A0A0B]">
            <ResearchChart
              ticker={ticker}
              historicalDate={historicalDate}
              onClearHistorical={() => setHistoricalDate(null)}
            />
          </div>
        ) : null}
      </div>

      {/* Only this section scrolls. min-h-0 is required so flex-1 can actually shrink below content
          height inside a flex column — otherwise the parent grows and the outer scrollbar comes back. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ResearchReportSections ticker={ticker} data={data} activeTab={activeTab} onSelectGapDate={setHistoricalDate} />
      </div>
    </div>
  );
}
