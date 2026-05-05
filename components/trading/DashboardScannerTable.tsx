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

// MDR feed only carries PM data — decouple from TradingViewGainer so we don't
// force the mdr-candidates route to surface postmarket columns it doesn't need.
interface MdrCandidate {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  preMarketPrice: number | null;
  pmPriceNeeded?: number | null;
  openingGapNeededPercent?: number | null;
  intradayPriceNeeded?: number | null;
}

interface MdrRecentRow {
  ticker: string;
  triggerDate: string;
  triggerClose: number;
  mark: number | null;
  pdc: number | null;
  change: number | null;
  volume: number | null;
  pmPriceNeeded?: number | null;
  openingGapNeededPercent?: number | null;
  intradayPriceNeeded?: number | null;
}

type MarketSession = 'pre-market' | 'regular' | 'after-hours' | 'closed';

type DashboardLatchState = {
  date: string;
  rowsByTicker: Record<string, TradingViewGainer>;
};

const LEGACY_DASHBOARD_DAY1_LATCH_STORAGE_KEY = 'nexus-dashboard-day1-latched';
const DASHBOARD_DAY1_LATCH_STORAGE_KEY = 'nexus-dashboard-day1-latched-v2';

// Inlined from lib/massive-market.ts so we don't pull a server module into the client bundle.
function getMarketSession(now: Date = new Date()): MarketSession {
  const dayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(now);
  if (dayLabel === 'Sat' || dayLabel === 'Sun') return 'closed';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const total = hour * 60 + minute;

  if (total >= 240 && total < 570) return 'pre-market';
  if (total >= 570 && total < 960) return 'regular';
  if (total >= 960 && total < 1200) return 'after-hours';
  return 'closed';
}

// Pick session-aware mark/volume for the MDR table:
//   pre-market → pre-market price/volume (so the structural check fires on PM breakouts)
//   regular/after/closed → today's regular session mark/volume
function sessionMark(
  g: { price: number; preMarketPrice: number | null },
  session: MarketSession,
): number {
  if (session === 'pre-market' && g.preMarketPrice != null && Number.isFinite(g.preMarketPrice)) {
    return g.preMarketPrice;
  }
  return g.price;
}

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
      className={`px-3 py-2 text-sm font-medium text-zinc-300 ${right ? 'text-right' : 'text-left'}`}
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

function fmtDollarOrDash(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

function fmtPercentOrDash(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function thresholdClass(value: number | null | undefined, tone?: 'percent'): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'text-zinc-600';
  if (tone === 'percent') return value >= 0 ? 'text-emerald-400' : 'text-rose-500';
  return undefined;
}

export default function DashboardScannerTable({ onNavigateToResearch }: DashboardScannerTableProps) {
  const [isRealtime, setIsRealtime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<Record<string, ScannerSummary>>({});
  const requestedSummariesRef = useRef(new Set<string>());
  const [dayOneLatch, setDayOneLatch] = useState<DashboardLatchState>(() => loadDashboardLatch(DASHBOARD_DAY1_LATCH_STORAGE_KEY));
  const [mdrLive, setMdrLive] = useState<MdrCandidate[]>([]);
  const [mdrRecent, setMdrRecent] = useState<MdrRecentRow[]>([]);

  const fetchGainers = useCallback(async () => {
    try {
      const res = await fetch('/api/tradingview/gainers');
      if (!res.ok) return;
      const data = (await res.json()) as {
        gainers: TradingViewGainer[];
        isRealtime: boolean;
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
      // Keep the last good scanner rows on transient polling failures.
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMdrLive = useCallback(async () => {
    try {
      const res = await fetch('/api/tradingview/mdr-candidates');
      if (!res.ok) return;
      const data = (await res.json()) as { candidates: MdrCandidate[] };
      setMdrLive(data.candidates ?? []);
    } catch {
      // Keep last good list on transient failures.
    }
  }, []);

  const fetchMdrRecent = useCallback(async () => {
    try {
      const res = await fetch('/api/scanner/mdr-recent');
      if (!res.ok) return;
      const data = (await res.json()) as { rows: MdrRecentRow[] };
      setMdrRecent(data.rows ?? []);
    } catch {
      // Keep last good list on transient failures.
    }
  }, []);

  useEffect(() => {
    void fetchGainers();
    void fetchMdrLive();
    void fetchMdrRecent();
    const interval = setInterval(() => {
      void fetchGainers();
      void fetchMdrLive();
      void fetchMdrRecent();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchGainers, fetchMdrLive, fetchMdrRecent]);

  useEffect(() => {
    persistLatch(DASHBOARD_DAY1_LATCH_STORAGE_KEY, dayOneLatch);
  }, [dayOneLatch]);

  // Session is still used for the MDR mark choice. Day 1 rows now use
  // route-derived AH+PM volume and move fields because the combined-volume
  // qualification cannot be reconstructed from TV's session-current columns.
  const session = getMarketSession();

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

  const tableCard = 'overflow-hidden rounded-xl border border-white/10 bg-[#121214]';
  const headerRow = 'border-b border-white/5 bg-[#0f0f11]';
  const bodyRow = 'cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5';

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, ticker: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onNavigateToResearch(ticker);
  };

  const mdrRows = useMemo(() => {
    const byTicker = new Map<string, {
      ticker: string;
      pdc: number;
      mark: number;
      chg: number;
      pmPriceNeeded: number | null;
      openingGapNeededPercent: number | null;
      intradayPriceNeeded: number | null;
    }>();

    // Live candidates first — TV's `change` is regular-session % change.
    // Back-compute pdc from price + change so the table stays consistent
    // with the existing format. During PM, mark falls back to preMarketPrice.
    for (const c of mdrLive) {
      const mark = sessionMark(c, session);
      const chg = c.change;
      const pdc = chg !== 0 ? c.price / (1 + chg / 100) : c.price;
      byTicker.set(c.ticker, {
        ticker: c.ticker,
        pdc,
        mark,
        chg,
        pmPriceNeeded: c.pmPriceNeeded ?? null,
        openingGapNeededPercent: c.openingGapNeededPercent ?? null,
        intradayPriceNeeded: c.intradayPriceNeeded ?? null,
      });
    }

    // DB rows fill in any ticker not already in the live set. They have
    // proper mark + pdc from Massive's unified snapshot.
    for (const r of mdrRecent) {
      if (byTicker.has(r.ticker)) continue;
      const mark = r.mark ?? r.triggerClose;
      const pdc = r.pdc ?? r.triggerClose;
      const chg = pdc > 0 ? (mark / pdc - 1) * 100 : 0;
      byTicker.set(r.ticker, {
        ticker: r.ticker,
        pdc,
        mark,
        chg,
        pmPriceNeeded: r.pmPriceNeeded ?? null,
        openingGapNeededPercent: r.openingGapNeededPercent ?? null,
        intradayPriceNeeded: r.intradayPriceNeeded ?? null,
      });
    }

    return Array.from(byTicker.values()).sort((a, b) => b.chg - a.chg);
  }, [mdrLive, mdrRecent, session]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className={tableCard}>
          <p className="px-4 py-6 text-sm text-zinc-500">Loading gainers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={tableCard}>
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="text-base font-bold text-zinc-300">
            Gainers Scan — Day 1 Setup
          </h2>
          <span className={`text-[10px] font-medium ${isRealtime ? 'text-emerald-500' : 'text-amber-500'}`}>
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
                <TH right>AH+PM Vol</TH>
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
                  <td colSpan={10} className="px-4 py-6 text-center text-sm text-zinc-500">
                    No Day 1 gainers detected.
                  </td>
                </tr>
              ) : dayOneRows.map((gainer) => {
                // Day 1 table is pre-market focused. During pre-market TV's `close` field
                // returns yesterday's regular-session close — which is what we want for PDC.
                // Mark / Mark % Chg / Volume use the dedicated pre-market columns; we fall
                // back to TV's session-current values when pre-market data is missing.
                const pdc = gainer.price;
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
                      <span className="text-zinc-100">{gainer.ticker}</span>
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
                      {summary ? fmtMonths(summary.cashRemainingMonths) : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasAtm} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasEl} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasWarrants} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasS1} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={tableCard}>
        <div className="border-b border-white/5 px-4 py-3">
          <h2 className="text-base font-bold text-zinc-300">
            Potential MDR Setup
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-full table-fixed">
            <colgroup>
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[110px]" />
              <col className="w-[140px]" />
              <col className="w-[140px]" />
              <col className="w-[140px]" />
            </colgroup>
            <thead>
              <tr className={headerRow}>
                <TH>Ticker</TH>
                <TH right>PDC</TH>
                <TH right>Mark</TH>
                <TH right>Mark % Chg</TH>
                <TH right>PM Price Needed</TH>
                <TH right>Opening Gap Needed</TH>
                <TH right>Intraday Price Needed</TH>
              </tr>
            </thead>
            <tbody>
              {mdrRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-zinc-500">
                    No MDR setups detected.
                  </td>
                </tr>
              ) : (
                mdrRows.map((row) => (
                  <tr
                    key={row.ticker}
                    className={bodyRow}
                    onClick={() => onNavigateToResearch(row.ticker)}
                    onKeyDown={(event) => handleRowKeyDown(event, row.ticker)}
                    role="button"
                    tabIndex={0}
                    title={`Open ${row.ticker} in Research`}
                  >
                    <TD>
                      <span className="text-zinc-100">{row.ticker}</span>
                    </TD>
                    <TD right>${row.pdc.toFixed(3)}</TD>
                    <TD right>${row.mark.toFixed(3)}</TD>
                    <TD right>
                      <span className={row.chg >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                        {row.chg >= 0 ? '+' : ''}{row.chg.toFixed(2)}%
                      </span>
                    </TD>
                    <TD right className={thresholdClass(row.pmPriceNeeded)}>
                      {fmtDollarOrDash(row.pmPriceNeeded)}
                    </TD>
                    <TD right className={thresholdClass(row.openingGapNeededPercent, 'percent')}>
                      {fmtPercentOrDash(row.openingGapNeededPercent)}
                    </TD>
                    <TD right className={thresholdClass(row.intradayPriceNeeded)}>
                      {fmtDollarOrDash(row.intradayPriceNeeded)}
                    </TD>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
