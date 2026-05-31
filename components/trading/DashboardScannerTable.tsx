'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

interface TradingViewGainer {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketVolume: number | null;
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketVolume: number | null;
  extendedHoursVolume: number;
  priorDayClose?: number | null;
  dayOneMovePercent: number;
  dayOneMark: number;
  dayOneMoveSource: 'pre-market' | 'after-hours';
}

interface ScannerSummary {
  ticker: string;
  cashRemainingMonths: number | null;
  hasAtm: boolean;
  hasEl: boolean;
  hasWarrants: boolean;
  hasS1: boolean;
  fetchedAt: string;
}

type DashboardLatchState = {
  date: string;
  rowsByTicker: Record<string, TradingViewGainer>;
};

const LEGACY_DASHBOARD_DAY1_LATCH_STORAGE_KEY = 'nexus-dashboard-day1-latched';
const DASHBOARD_DAY1_LATCH_STORAGE_KEY = 'nexus-dashboard-day1-latched-v2';

interface DashboardScannerTableProps {
  onNavigateToResearch: (ticker: string) => void;
}

function fmtVolume(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function fmtMonths(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 100) return `${value.toFixed(0)} mo`;
  if (value >= 10) return `${value.toFixed(1)} mo`;
  return `${value.toFixed(2)} mo`;
}

function todayInNewYork(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD
}

function emptyLatchState(date = todayInNewYork()): DashboardLatchState {
  return { date, rowsByTicker: {} };
}

function isTradingViewGainer(value: unknown): value is TradingViewGainer {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.ticker === 'string'
    && typeof row.price === 'number'
    && Number.isFinite(row.price)
    && typeof row.change === 'number'
    && Number.isFinite(row.change)
    && typeof row.volume === 'number'
    && Number.isFinite(row.volume)
    && typeof row.extendedHoursVolume === 'number'
    && Number.isFinite(row.extendedHoursVolume)
    && typeof row.dayOneMovePercent === 'number'
    && Number.isFinite(row.dayOneMovePercent)
    && typeof row.dayOneMark === 'number'
    && Number.isFinite(row.dayOneMark)
    && (row.dayOneMoveSource === 'pre-market' || row.dayOneMoveSource === 'after-hours');
}

function normalizeRowsByTicker(value: unknown): Record<string, TradingViewGainer> {
  if (!value || typeof value !== 'object') return {};

  const rows: Record<string, TradingViewGainer> = {};
  for (const [ticker, row] of Object.entries(value as Record<string, unknown>)) {
    if (!isTradingViewGainer(row)) continue;
    rows[ticker] = row;
  }
  return rows;
}

function loadDashboardLatch(storageKey: string): DashboardLatchState {
  const today = todayInNewYork();
  if (typeof window === 'undefined') return emptyLatchState(today);

  try {
    if (storageKey !== LEGACY_DASHBOARD_DAY1_LATCH_STORAGE_KEY) {
      window.localStorage.removeItem(LEGACY_DASHBOARD_DAY1_LATCH_STORAGE_KEY);
    }

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return emptyLatchState(today);

    const parsed = JSON.parse(raw) as { date?: unknown; rowsByTicker?: unknown };
    if (parsed.date !== today) {
      window.localStorage.removeItem(storageKey);
      return emptyLatchState(today);
    }

    return {
      date: today,
      rowsByTicker: normalizeRowsByTicker(parsed.rowsByTicker),
    };
  } catch {
    return emptyLatchState(today);
  }
}

function persistLatch(storageKey: string, latch: DashboardLatchState) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(latch));
  } catch {
    // Ignore storage failures; the in-memory latch still keeps rows for this tab.
  }
}

function dayOneMark(gainer: TradingViewGainer) {
  return gainer.dayOneMark;
}

function dayOnePriorClose(gainer: TradingViewGainer) {
  return gainer.priorDayClose ?? gainer.price;
}

function dayOneMarkChange(gainer: TradingViewGainer) {
  return gainer.dayOneMovePercent;
}

function dayOneVolume(gainer: TradingViewGainer): number {
  return gainer.extendedHoursVolume;
}

function mergeLatchRows(
  previous: DashboardLatchState,
  today: string,
  rowsToMerge: TradingViewGainer[],
): DashboardLatchState {
  const baseRows = previous.date === today ? previous.rowsByTicker : {};
  const rowsByTicker = { ...baseRows };

  for (const row of rowsToMerge) {
    rowsByTicker[row.ticker] = row;
  }

  return { date: today, rowsByTicker };
}

function sortDayOneRows(rowsByTicker: Record<string, TradingViewGainer>): TradingViewGainer[] {
  return Object.values(rowsByTicker).sort((a, b) => (
    dayOneMarkChange(b) - dayOneMarkChange(a)
    || dayOneVolume(b) - dayOneVolume(a)
    || a.ticker.localeCompare(b.ticker)
  ));
}

function BoolCell({ value }: { value: boolean }) {
  return (
    <span className={value ? 'font-semibold text-emerald-400' : 'font-semibold text-rose-500'}>
      {value ? 'Y' : 'N'}
    </span>
  );
}

function TH({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2 text-sm font-medium text-muted-foreground ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function TD({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-2 text-sm ${right ? 'text-right tabular-nums' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}

export default function DashboardScannerTable({ onNavigateToResearch }: DashboardScannerTableProps) {
  const [isRealtime, setIsRealtime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<Record<string, ScannerSummary>>({});
  const requestedSummariesRef = useRef(new Set<string>());
  const [dayOneLatch, setDayOneLatch] = useState<DashboardLatchState>(() => loadDashboardLatch(DASHBOARD_DAY1_LATCH_STORAGE_KEY));

  const fetchScannerState = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/scanner-state');
      if (!res.ok) return;
      const data = (await res.json()) as {
        gainers: TradingViewGainer[];
        isRealtime: boolean;
        fetchedAt: string;
      };
      const nextGainers = data.gainers ?? [];
      const today = todayInNewYork();
      setIsRealtime(data.isRealtime ?? false);
      setDayOneLatch((previous) => mergeLatchRows(
        previous,
        today,
        nextGainers,
      ));
    } catch {
      // Keep last good scanner state on transient polling failures.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchScannerState();
    const interval = setInterval(() => {
      void fetchScannerState();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchScannerState]);

  useEffect(() => {
    persistLatch(DASHBOARD_DAY1_LATCH_STORAGE_KEY, dayOneLatch);
  }, [dayOneLatch]);

  const dayOneRows = useMemo(() => (
    sortDayOneRows(dayOneLatch.rowsByTicker)
  ), [dayOneLatch.rowsByTicker]);

  useEffect(() => {
    if (dayOneRows.length === 0) return;

    for (const gainer of dayOneRows) {
      if (requestedSummariesRef.current.has(gainer.ticker)) continue;
      requestedSummariesRef.current.add(gainer.ticker);

      void (async () => {
        try {
          const res = await fetch(`/api/askedgar/scanner-summary?ticker=${encodeURIComponent(gainer.ticker)}`);
          if (!res.ok) return;
          const data = (await res.json()) as ScannerSummary;
          setSummaries((prev) => ({ ...prev, [data.ticker]: data }));
        } catch {
          // Leave scanner summary cells in their loading placeholder state.
        }
      })();
    }
  }, [dayOneRows]);

  const tableCard = 'overflow-hidden rounded-xl border border-border bg-card';
  const headerRow = 'border-b border-border bg-card';
  const bodyRow = 'cursor-pointer border-b border-border transition-colors hover:bg-accent';

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, ticker: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onNavigateToResearch(ticker);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className={tableCard}>
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading gainers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={tableCard}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-bold text-foreground">
            Day 1 Setup
          </h2>
          <span className={`text-[10px] font-medium ${isRealtime ? 'text-primary' : 'text-amber-500'}`}>
            {isRealtime ? 'LIVE' : '15-MIN DELAY'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-full table-fixed">
            <colgroup>
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[80px]" />
              <col className="w-[70px]" />
              <col className="w-[80px]" />
              <col className="w-[70px]" />
            </colgroup>
            <thead>
              <tr className={headerRow}>
                <TH>Ticker</TH>
                <TH right>PDC</TH>
                <TH right>Mark</TH>
                <TH right>Mark % Chg</TH>
                <TH right>Volume</TH>
                <TH right>Cash (mo)</TH>
                <TH right>ATM</TH>
                <TH right>EL</TH>
                <TH right>Warrants</TH>
                <TH right>S1</TH>
              </tr>
            </thead>
            <tbody>
              {dayOneRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No Day 1 gainers detected.
                  </td>
                </tr>
              ) : dayOneRows.map((gainer) => {
                // Day 1 table is pre-market focused. During pre-market TV's `close` field
                // returns yesterday's regular-session close — which is what we want for PDC.
                // Mark / Mark % Chg / Volume use route-derived extended-hours fields.
                const pdc = dayOnePriorClose(gainer);
                const mark = dayOneMark(gainer);
                const markChange = dayOneMarkChange(gainer);
                const vol = dayOneVolume(gainer);
                const summary = summaries[gainer.ticker];
                return (
                  <tr
                    key={gainer.ticker}
                    className={bodyRow}
                    onClick={() => onNavigateToResearch(gainer.ticker)}
                    onKeyDown={(event) => handleRowKeyDown(event, gainer.ticker)}
                    role="button"
                    tabIndex={0}
                    title={`Open ${gainer.ticker} in Research`}
                  >
                    <TD>
                      <span className="text-foreground">{gainer.ticker}</span>
                    </TD>
                    <TD right>${pdc.toFixed(3)}</TD>
                    <TD right>${mark.toFixed(3)}</TD>
                    <TD right>
                      <span className={markChange >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                        {markChange >= 0 ? '+' : ''}{markChange.toFixed(2)}%
                      </span>
                    </TD>
                    <TD right>{fmtVolume(vol)}</TD>
                    <TD right>
                      {summary ? fmtMonths(summary.cashRemainingMonths) : <span className="text-muted-foreground">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasAtm} /> : <span className="text-muted-foreground">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasEl} /> : <span className="text-muted-foreground">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasWarrants} /> : <span className="text-muted-foreground">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasS1} /> : <span className="text-muted-foreground">...</span>}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
