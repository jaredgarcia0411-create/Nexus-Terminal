'use client';

import { useCallback, useEffect, useState } from 'react';

import ResearchChart from '@/components/trading/ResearchChart';
import ResearchCompanyHeader from '@/components/trading/ResearchCompanyHeader';
import ResearchReportSections from '@/components/trading/ResearchReportSections';
import ResearchTldr from '@/components/trading/ResearchTldr';

interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

interface AskEdgarLookupData {
  ticker: string;
  fetchedAt: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
  warnings: string[];
}

interface Props {
  ticker: string;
}

export default function ResearchTickerView({ ticker }: Props) {
  const [data, setData] = useState<AskEdgarLookupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (selectedTicker: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/askedgar/lookup?ticker=${encodeURIComponent(selectedTicker)}`);
      if (!response.ok) throw new Error(`Lookup failed: ${response.status}`);
      const result = (await response.json()) as AskEdgarLookupData;
      setData(result);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Lookup failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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

  if (!data) return null;

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col">
      {/* Top row: company info panel on the left, chart on the right */}
      <div className="flex min-h-0 flex-1 border-b border-white/10">
        <div className="w-[220px] shrink-0 overflow-y-auto">
          <ResearchCompanyHeader ticker={ticker} rawData={data.rawData} />
        </div>
        <div className="min-h-0 flex-1 bg-[#0A0A0B]">
          <ResearchChart ticker={ticker} />
        </div>
      </div>

      {/* Report sections below chart — always visible */}
      <ResearchReportSections ticker={ticker} rawData={data.rawData} />

      <div className="border-t border-white/10">
        <ResearchTldr ticker={ticker} />
      </div>
    </div>
  );
}
