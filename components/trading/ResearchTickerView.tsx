'use client';

import { useCallback, useEffect, useState } from 'react';

import ResearchChart from '@/components/trading/ResearchChart';
import ResearchCompanyHeader from '@/components/trading/ResearchCompanyHeader';
import ResearchReportSections from '@/components/trading/ResearchReportSections';
import ResearchTldr from '@/components/trading/ResearchTldr';
import type { ResearchSnapshot } from '@/lib/types';

interface SnapshotErrorResponse {
  error?: string;
  warnings?: string[];
  retryHint?: string;
}

interface Props {
  ticker: string;
  onCompanyName?: (name: string | null) => void;
}

export default function ResearchTickerView({ ticker, onCompanyName }: Props) {
  const [data, setData] = useState<ResearchSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // YYYY-MM-DD when the user clicks a gap-stat row; null = live chart.
  const [historicalDate, setHistoricalDate] = useState<string | null>(null);

  const fetchData = useCallback(async (selectedTicker: string) => {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    onCompanyName?.(null);
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
      onCompanyName?.(result.companyName ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Lookup failed');
      setStatusMessage(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [onCompanyName]);

  useEffect(() => {
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

  return (
    <div className="flex flex-col">
      {/* Top row: company info panel on the left, chart on the right — fixed height */}
      <div className="flex h-[420px] shrink-0 border-b border-white/10">
        <div className="w-[320px] shrink-0 overflow-y-auto">
          <ResearchCompanyHeader ticker={ticker} companyName={data.companyName ?? null} header={data.header} />
        </div>
        <div className="min-h-0 flex-1 bg-[#0A0A0B]">
          <ResearchChart
            ticker={ticker}
            historicalDate={historicalDate}
            onClearHistorical={() => setHistoricalDate(null)}
          />
        </div>
      </div>

      <ResearchReportSections ticker={ticker} data={data} onSelectGapDate={setHistoricalDate} />

      <div className="border-t border-white/10">
        <ResearchTldr ticker={ticker} />
      </div>
    </div>
  );
}
