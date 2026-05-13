'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type BacktestSelection = {
  ticker: string;
  date: string;
};

type SystemTickerRow = {
  id: string;
  ticker: string;
  date: string;
  grade: string | null;
  setupType: string | null;
  day1GapPct: number | null;
};

type SystemTickersResponse = {
  rows?: SystemTickerRow[];
  error?: string;
};

type BacktestDetailResponse = {
  backtest?: {
    id: string;
    name: string;
    sampleSetId?: string | null;
    sampleSetName?: string | null;
    sampleSetRows?: Array<{ ticker: string; date: string }> | null;
  };
  error?: string;
};

type SampleSetListItem = {
  id: string;
  name: string;
  ownerName: string | null;
};

type SampleSetListResponse = {
  sampleSets?: SampleSetListItem[];
  error?: string;
};

type SampleSetDetailResponse = {
  sampleSet?: {
    id: string;
    name: string;
    rows?: Array<{ ticker: string; date: string }> | null;
  };
  error?: string;
};

type SortDirection = 'asc' | 'desc';

const SAMPLE_SELECT_PLACEHOLDER = '__select_sample_set__';
const SYSTEM_SAMPLE_SET = '__system__';

interface BacktestingSidebarProps {
  selected: BacktestSelection | null;
  onSelect: (selection: BacktestSelection) => void;
  activeBacktestId: string | null;
  topPanel?: ReactNode;
  onToggleCollapse?: () => void;
}

function useSystemTickers() {
  const [rows, setRows] = useState<SystemTickerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchRows = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/system-tickers', { signal: controller.signal });
        const payload = (await response.json().catch(() => ({}))) as SystemTickersResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? 'Could not load system tickers');
        }

        setRows(payload.rows ?? []);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setError(fetchError instanceof Error ? fetchError.message : 'Could not load system tickers');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void fetchRows();

    return () => controller.abort();
  }, []);

  return { rows, loading, error };
}

export default function BacktestingSidebar({
  selected,
  onSelect,
  activeBacktestId,
  topPanel,
  onToggleCollapse,
}: BacktestingSidebarProps) {
  const { rows, loading, error } = useSystemTickers();
  const [filter, setFilter] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [sampleSetRows, setSampleSetRows] = useState<SystemTickerRow[] | null>(null);
  const [availableSampleSets, setAvailableSampleSets] = useState<SampleSetListItem[]>([]);
  const [selectedSampleSetId, setSelectedSampleSetId] = useState<string>('');
  const [selectedSampleSetName, setSelectedSampleSetName] = useState<string | null>(null);
  const [sampleSetLoading, setSampleSetLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const loadSampleSets = async () => {
      try {
        const response = await fetch('/api/sample-sets', { signal: controller.signal });
        const payload = (await response.json().catch(() => ({}))) as SampleSetListResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? 'Could not load sample sets');
        }

        setAvailableSampleSets(payload.sampleSets ?? []);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        console.error(loadError);
        setAvailableSampleSets([]);
      }
    };

    void loadSampleSets();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeBacktestId) {
      return;
    }

    setSelectedSampleSetId('');
    setSelectedSampleSetName(null);
    setSampleSetLoading(false);
    setSampleSetRows(null);

    const controller = new AbortController();

    const loadBacktest = async () => {
      try {
        const response = await fetch(`/api/backtests/${activeBacktestId}`, { signal: controller.signal });
        const payload = (await response.json().catch(() => ({}))) as BacktestDetailResponse;
        if (!response.ok || !payload.backtest) {
          throw new Error(payload.error ?? 'Could not load backtest');
        }

        // The sidebar label tracks the sample set source. If an older
        // response has sampleSetId without sampleSetName, fall back to the
        // backtest name instead of mislabeling it as System Sheet.
        setSelectedSampleSetName(
          payload.backtest.sampleSetId
            ? (payload.backtest.sampleSetName ?? payload.backtest.name)
            : 'System Sheet',
        );
        // When a backtest has no sample set (System Sheet), leave sampleSetRows
        // null so the sidebar falls back to the live system tickers list.
        if (!payload.backtest.sampleSetId) {
          setSampleSetRows(null);
        } else {
          setSampleSetRows(
            (payload.backtest.sampleSetRows ?? []).map((row, index) => ({
              id: `${row.ticker}-${row.date}-${index}`,
              ticker: row.ticker,
              date: row.date,
              grade: null,
              setupType: null,
              day1GapPct: null,
            })),
          );
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;
        console.error(loadError);
        setSampleSetRows([]);
        setSelectedSampleSetName(null);
      }
    };

    void loadBacktest();

    return () => controller.abort();
  }, [activeBacktestId]);

  useEffect(() => {
    if (activeBacktestId) return;
    if (!selectedSampleSetId) {
      setSampleSetLoading(false);
      setSampleSetRows(null);
      setSelectedSampleSetName(null);
      return;
    }
    if (selectedSampleSetId === SYSTEM_SAMPLE_SET) {
      setSampleSetLoading(false);
      setSampleSetRows(null);
      setSelectedSampleSetName('System Sheet');
      return;
    }

    const controller = new AbortController();

    const loadSampleSet = async () => {
      setSampleSetLoading(true);
      try {
        const response = await fetch(`/api/sample-sets/${selectedSampleSetId}`, { signal: controller.signal });
        const payload = (await response.json().catch(() => ({}))) as SampleSetDetailResponse;
        if (!response.ok || !payload.sampleSet) {
          throw new Error(payload.error ?? 'Could not load sample set');
        }

        setSelectedSampleSetName(payload.sampleSet.name);
        setSampleSetRows(
          (payload.sampleSet.rows ?? []).map((row, index) => ({
            id: `${row.ticker}-${row.date}-${index}`,
            ticker: row.ticker,
            date: row.date,
            grade: null,
            setupType: null,
            day1GapPct: null,
          })),
        );
      } catch (loadError) {
        if (controller.signal.aborted) return;
        console.error(loadError);
        setSampleSetRows([]);
        setSelectedSampleSetName(null);
      } finally {
        if (!controller.signal.aborted) setSampleSetLoading(false);
      }
    };

    void loadSampleSet();

    return () => controller.abort();
  }, [activeBacktestId, selectedSampleSetId]);

  const visibleRows = useMemo(() => {
    if (!activeBacktestId && !selectedSampleSetId) return [];
    if (
      !activeBacktestId
      && selectedSampleSetId !== SYSTEM_SAMPLE_SET
      && sampleSetRows == null
    ) {
      return [];
    }

    const query = filter.trim().toUpperCase();
    const sortRows = (list: SystemTickerRow[]) =>
      list.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return sortDirection === 'asc' ? dateCompare : -dateCompare;
        return a.ticker.localeCompare(b.ticker);
      });

    const sourceRows = sampleSetRows ?? rows;
    return sortRows(
      sourceRows.filter((row) => (query ? row.ticker.toUpperCase().includes(query) : true)).slice(),
    );
  }, [activeBacktestId, filter, rows, sampleSetRows, selectedSampleSetId, sortDirection]);

  const sourceLabel = selectedSampleSetName ?? 'Select Sample Set';
  const awaitingSampleSelection = !activeBacktestId && !selectedSampleSetId;

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-white/10 bg-[#0A0A0B]">
      {onToggleCollapse ? (
        <div className="flex justify-end px-2 py-1">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
            title="Collapse panel"
            aria-label="Collapse panel"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {topPanel ? (
        <div className="scrollbar-thin max-h-[55%] shrink-0 overflow-y-auto border-b border-white/10">
          {topPanel}
        </div>
      ) : null}
      <div className="border-b border-white/10 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value.toUpperCase())}
            placeholder="Filter ticker"
            className="h-8 border-white/10 bg-white/5 pl-8 text-xs text-zinc-100 placeholder:text-zinc-600"
          />
        </div>

        {!activeBacktestId ? (
          <Select
            value={selectedSampleSetId || SAMPLE_SELECT_PLACEHOLDER}
            onValueChange={(value) => setSelectedSampleSetId(value === SAMPLE_SELECT_PLACEHOLDER ? '' : value)}
          >
            <SelectTrigger
              aria-label="Select Sample Set"
              className="mt-2 h-8 w-full border-white/10 bg-black text-xs text-zinc-100"
            >
              <SelectValue placeholder="Select Sample Set" />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-black text-white">
              <SelectItem value={SAMPLE_SELECT_PLACEHOLDER}>Select Sample Set</SelectItem>
              <SelectItem value={SYSTEM_SAMPLE_SET}>System Sheet</SelectItem>
              {availableSampleSets.map((sampleSet) => (
                <SelectItem key={sampleSet.id} value={sampleSet.id}>
                  {sampleSet.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="mt-2 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
              {sourceLabel}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
            className="h-7 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            DATE {sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
        {awaitingSampleSelection ? (
          <div className="px-3 py-4 text-sm text-zinc-500">Select a sample set to load tickers</div>
        ) : null}
        {!awaitingSampleSelection && sampleSetLoading ? (
          <div className="px-3 py-4 text-sm text-zinc-500">Loading sample set...</div>
        ) : null}
        {!awaitingSampleSelection && !sampleSetLoading && !sampleSetRows && loading ? (
          <div className="px-3 py-4 text-sm text-zinc-500">Loading tickers...</div>
        ) : null}
        {!awaitingSampleSelection && !sampleSetLoading && !sampleSetRows && !loading && error ? (
          <div className="px-3 py-4 text-sm text-rose-400">{error}</div>
        ) : null}
        {!awaitingSampleSelection && !sampleSetLoading && (sampleSetRows || (!loading && !error)) && visibleRows.length === 0 ? (
          <div className="px-3 py-4 text-sm text-zinc-500">
            {sampleSetRows ? 'No sample set rows match filter' : 'No tickers found'}
          </div>
        ) : null}
        {visibleRows.length > 0 ? (
          <div className="flex flex-col">
            {visibleRows.map((row) => {
              const isActive = selected?.ticker === row.ticker && selected.date === row.date;

              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelect({ ticker: row.ticker, date: row.date })}
                  className={cn(
                    'border-b border-white/5 px-3 py-2.5 text-left transition-colors hover:bg-white/5',
                    isActive ? 'border-l-2 border-l-emerald-500 bg-emerald-500/5' : 'border-l-2 border-l-transparent',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-zinc-100">{row.ticker}</span>
                    <span className="font-mono text-xs tabular-nums text-zinc-500">{row.date}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
