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

  const fetchData = useCallback(async (selectedTicker: string) => {
    setLoading(true);
    setError(null);
    onCompanyName?.(null);
    try {
      const response = await fetch(`/api/askedgar/snapshot?ticker=${encodeURIComponent(selectedTicker)}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as SnapshotErrorResponse | null;
        const message = payload?.error?.trim() || `Lookup failed: ${response.status}`;
        const retryHint = payload?.retryHint?.trim();
        throw new Error(retryHint ? `${message} ${retryHint}` : message);
      }

      const result = (await response.json()) as ResearchSnapshot;
      setData(result);
      onCompanyName?.(result.companyName ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Lookup failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [onCompanyName]);

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
    <div className="flex flex-col">
      {/* Top row: company info panel on the left, chart on the right — fixed height */}
      <div className="flex h-[500px] shrink-0 border-b border-white/10">
        <div className="w-[220px] shrink-0 overflow-y-auto">
          <ResearchCompanyHeader ticker={ticker} companyName={data.companyName ?? null} header={data.header} />
        </div>
        <div className="min-h-0 flex-1 bg-[#0A0A0B]">
          <ResearchChart ticker={ticker} />
        </div>
      </div>

      {/* Report sections below chart — always visible */}
      {data.warnings.length > 0 ? (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          <p className="font-medium">AskEdgar warnings</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-100/90">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ResearchReportSections ticker={ticker} data={data} />

      <div className="border-t border-white/10">
        <ResearchTldr ticker={ticker} />
      </div>
    </div>
  );
}
