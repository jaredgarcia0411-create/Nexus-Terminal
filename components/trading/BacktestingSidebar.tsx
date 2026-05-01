'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseSampleSetCsv, type SampleSetRow } from '@/lib/sample-set-csv';
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

type SortDirection = 'asc' | 'desc';

interface BacktestingSidebarProps {
  selected: BacktestSelection | null;
  onSelect: (selection: BacktestSelection) => void;
  topPanel?: ReactNode;
}

function formatGap(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
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

export default function BacktestingSidebar({ selected, onSelect, topPanel }: BacktestingSidebarProps) {
  const { rows, loading, error } = useSystemTickers();
  const [filter, setFilter] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [loadedTrades, setLoadedTrades] = useState<SampleSetRow[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncInputRef = useRef<HTMLInputElement>(null);
  const tradesInputRef = useRef<HTMLInputElement>(null);

  const handleSyncSheetFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSyncing(true);
    setSyncStatus(null);

    try {
      const text = await file.text();
      const { parseSystemSheet } = await import('@/lib/system-sheet-parser');
      const { rows: parsedRows, warnings } = parseSystemSheet(text);

      if (parsedRows.length === 0) {
        throw new Error(`No rows parsed (${warnings.length} warning(s))`);
      }

      const response = await fetch('/api/system-sheet/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error ?? `Sync failed with status ${response.status}`);
      }

      await response.json();
      setSyncStatus('Synced');

      if (warnings.length > 0) {
        console.warn('System sheet sync warnings:', warnings);
      }
    } catch (syncError) {
      console.error('System sheet sync failed', syncError);
      setSyncStatus('Failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleLoadTradesFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const { rows: trades } = parseSampleSetCsv(text);
      if (trades.length === 0) {
        window.alert('No trades found in CSV.');
        return;
      }
      setLoadedTrades(trades);
    } catch (loadError) {
      console.error('Load trades failed', loadError);
      window.alert(loadError instanceof Error ? loadError.message : 'Failed to load trades CSV.');
    }
  };

  const visibleRows = useMemo(() => {
    const query = filter.trim().toUpperCase();
    const sortRows = (list: SystemTickerRow[]) =>
      list.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return sortDirection === 'asc' ? dateCompare : -dateCompare;
        return a.ticker.localeCompare(b.ticker);
      });

    if (loadedTrades) {
      const mapped: SystemTickerRow[] = loadedTrades
        .filter((row) => (query ? row.ticker.includes(query) : true))
        .map((row, index) => ({
          id: `loaded-${row.ticker}-${row.date}-${index}`,
          ticker: row.ticker,
          date: row.date,
          grade: null,
          setupType: null,
          day1GapPct: null,
        }));
      return sortRows(mapped);
    }

    return sortRows(
      rows.filter((row) => (query ? row.ticker.toUpperCase().includes(query) : true)).slice(),
    );
  }, [filter, rows, sortDirection, loadedTrades]);

  const sourceLabel = loadedTrades ? `Loaded (${loadedTrades.length})` : 'System';

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-white/10 bg-[#0A0A0B]">
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

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={syncing}
            onClick={() => syncInputRef.current?.click()}
            className="h-7 border border-white/10 bg-white/5 text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync Sheet'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => tradesInputRef.current?.click()}
            className="h-7 border border-white/10 bg-white/5 text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            Load Trades
          </Button>
        </div>
        <input
          ref={syncInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleSyncSheetFile}
          className="hidden"
        />
        <input
          ref={tradesInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleLoadTradesFile}
          className="hidden"
        />
        {syncStatus ? (
          <div className="mt-1 text-[10px] text-zinc-500">{syncStatus}</div>
        ) : null}

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">{sourceLabel}</span>
            {loadedTrades ? (
              <button
                type="button"
                onClick={() => setLoadedTrades(null)}
                className="text-zinc-500 hover:text-zinc-200"
                aria-label="Clear loaded trades"
                title="Clear loaded trades"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
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
        {!loadedTrades && loading ? (
          <div className="px-3 py-4 text-sm text-zinc-500">Loading tickers...</div>
        ) : null}
        {!loadedTrades && !loading && error ? (
          <div className="px-3 py-4 text-sm text-rose-400">{error}</div>
        ) : null}
        {(loadedTrades || (!loading && !error)) && visibleRows.length === 0 ? (
          <div className="px-3 py-4 text-sm text-zinc-500">
            {loadedTrades ? 'No trades match filter' : 'No tickers found'}
          </div>
        ) : null}
        {visibleRows.length > 0 ? (
          <div className="flex flex-col">
            {visibleRows.map((row) => {
              const isActive = selected?.ticker === row.ticker && selected.date === row.date;
              const gap = formatGap(row.day1GapPct);
              const hasMeta = row.grade || gap || row.setupType;

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
                    <span className="font-mono text-[11px] tabular-nums text-zinc-500">{row.date}</span>
                  </div>
                  {hasMeta ? (
                    <div className="mt-1 flex items-center gap-2 text-[11px]">
                      {row.grade ? (
                        <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-400">
                          {row.grade}
                        </span>
                      ) : null}
                      {gap ? <span className="font-mono tabular-nums text-zinc-400">{gap}</span> : null}
                      {row.setupType ? <span className="truncate text-zinc-500">{row.setupType}</span> : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
