'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import ResearchChart from '@/components/trading/ResearchChart';
import ResearchCompanyHeader from '@/components/trading/ResearchCompanyHeader';
import { getCachedReportId, prefetchResearchReport } from '@/components/trading/ResearchReportPanel';
import ResearchReportSections from '@/components/trading/ResearchReportSections';
import ResearchSubNav from '@/components/trading/ResearchSubNav';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ResearchSnapshot } from '@/lib/types';

interface SnapshotErrorResponse {
  error?: string;
  warnings?: string[];
  retryHint?: string;
}

interface Props {
  ticker: string;
}

type TabKey = 'overview' | 'dilution' | 'news' | 'filings' | 'research';

type SheetPickerItem = {
  id: string;
  name: string;
};

type SheetListResponse = {
  sheets?: Array<{
    id: string;
    name: string;
    role: 'owner' | 'editor' | 'viewer';
    isTemplate: boolean;
    archivedAt: string | null;
    rootId: string | null;
  }>;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'dilution', label: 'Dilution' },
  { key: 'news', label: 'News' },
  { key: 'filings', label: 'Filings' },
  { key: 'research', label: 'Reports' },
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
    // Warm the Research Report cache in the background so the Research tab renders instantly when clicked.
    void prefetchResearchReport(ticker);
  }, [ticker, fetchData]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading {ticker} data...
      </div>
    );
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-rose-400">{error}</div>;
  }

  if (statusMessage) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{statusMessage}</div>;
  }

  if (!data) return null;

  const hasChart = activeTab === 'overview';

  return (
    <div className="flex h-full flex-col">
      {/* Sub-nav stays pinned so the user can swap tabs without scrolling back up. shrink-0 keeps it
          out of the flex distribution. The relative wrapper keeps Add to Sheets overlaid at md+
          without restructuring the shared sub-nav component. */}
      <div className="relative shrink-0">
        <ResearchSubNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="hidden items-center gap-2 px-3 pb-2 md:absolute md:right-2 md:top-1/2 md:flex md:-translate-y-1/2 md:px-0 md:pb-0">
          <AddToSheetsButton ticker={ticker} />
        </div>
      </div>

      {/* Top row: company info panel on the left, chart only where it supports the tab. Pinned. */}
      <div className={`flex shrink-0 flex-col border-b border-border md:flex-row ${hasChart ? 'md:h-[380px]' : ''}`}>
        <div className="scrollbar-hidden w-full shrink-0 overflow-y-auto border-b border-border bg-card md:w-[320px] md:border-b-0 md:border-r">
          <ResearchCompanyHeader ticker={ticker} companyName={data.companyName ?? null} header={data.header} compact={!hasChart} />
        </div>
        {hasChart ? (
          <div className="h-[300px] w-full bg-background md:h-auto md:min-h-0 md:flex-1">
            <ResearchChart
              ticker={ticker}
              historicalDate={historicalDate}
              gapStats={data.gapStats}
              onClearHistorical={() => setHistoricalDate(null)}
            />
          </div>
        ) : null}
      </div>

      {/* Only this section scrolls. min-h-0 is required so flex-1 can actually shrink below content
          height inside a flex column — otherwise the parent grows and the outer scrollbar comes back. */}
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
        <ResearchReportSections ticker={ticker} data={data} activeTab={activeTab} onSelectGapDate={setHistoricalDate} />
      </div>
    </div>
  );
}

export function AddToSheetsButton({ ticker }: { ticker: string }) {
  const [sheets, setSheets] = useState<SheetPickerItem[]>([]);
  const [saving, setSaving] = useState(false);

  const loadSheets = useCallback(async () => {
    try {
      const response = await fetch('/api/sheets');
      if (!response.ok) throw new Error('load failed');
      const payload = (await response.json()) as SheetListResponse;
      setSheets((payload.sheets ?? [])
        .filter((sheet) => (
          (sheet.role === 'owner' || sheet.role === 'editor')
          && !sheet.isTemplate
          && sheet.archivedAt === null
          && sheet.rootId === null
        ))
        .map((sheet) => ({ id: sheet.id, name: sheet.name })));
    } catch {
      setSheets([]);
      toast.error('Failed to load sheets');
    }
  }, []);

  const addToSheet = async (sheet: SheetPickerItem) => {
    if (saving) return;
    setSaving(true);
    try {
      void prefetchResearchReport(ticker);
      const response = await fetch(`/api/sheets/${sheet.id}/append-research-row`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          date: format(new Date(), 'yyyy-MM-dd'),
          reportId: getCachedReportId(ticker) ?? undefined,
        }),
      });
      if (!response.ok) throw new Error('save failed');
      const payload = (await response.json()) as { duplicate?: boolean };
      if (payload.duplicate) {
        toast.success(`${ticker} is already in "${sheet.name}"`);
      } else {
        toast.success(`Added ${ticker} to "${sheet.name}"`);
      }
    } catch {
      toast.error('Failed to add to sheet');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => {
      if (open) void loadSheets();
    }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <Plus className="h-3.5 w-3.5" />
          Add to Sheets
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-card text-foreground">
        {sheets.length === 0 ? (
          <DropdownMenuItem disabled>No sheets yet</DropdownMenuItem>
        ) : (
          sheets.map((sheet) => (
            <DropdownMenuItem
              key={sheet.id}
              disabled={saving}
              onSelect={() => void addToSheet(sheet)}
            >
              {sheet.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
