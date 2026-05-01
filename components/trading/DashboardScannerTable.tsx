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

interface MdrEligibility {
  ticker: string;
  eligible: boolean;
  hadPriorBigDay: boolean;
  isUp3xFromBase: boolean;
  isNew20dHigh: boolean;
  priorBase20Low: number | null;
  priorHigh20: number | null;
  priorClose: number | null;
  fetchedAt: string;
}

type MarketSession = 'pre-market' | 'regular' | 'after-hours' | 'closed';

type DashboardLatchState = {
  date: string;
  rowsByTicker: Record<string, TradingViewGainer>;
};

type DashboardMdrLatchState = DashboardLatchState & {
  eligibilityByTicker: Record<string, MdrEligibility>;
};

const DASHBOARD_DAY1_LATCH_STORAGE_KEY = 'nexus-dashboard-day1-latched';
const DASHBOARD_MDR_LATCH_STORAGE_KEY = 'nexus-dashboard-mdr-latched';

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
function sessionMark(g: TradingViewGainer, session: MarketSession): number {
  if (session === 'pre-market' && g.preMarketPrice != null && Number.isFinite(g.preMarketPrice)) {
    return g.preMarketPrice;
  }
  return g.price;
}

function sessionVolume(g: TradingViewGainer, session: MarketSession): number {
  if (session === 'pre-market' && g.preMarketVolume != null && Number.isFinite(g.preMarketVolume)) {
    return g.preMarketVolume;
  }
  return g.volume;
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

function emptyMdrLatchState(date = todayInNewYork()): DashboardMdrLatchState {
  return { date, rowsByTicker: {}, eligibilityByTicker: {} };
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
    && Number.isFinite(row.volume);
}

function isMdrEligibility(value: unknown): value is MdrEligibility {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.ticker === 'string'
    && typeof row.eligible === 'boolean'
    && typeof row.hadPriorBigDay === 'boolean'
    && typeof row.isUp3xFromBase === 'boolean'
    && typeof row.isNew20dHigh === 'boolean'
    && typeof row.fetchedAt === 'string';
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

function normalizeEligibilityByTicker(value: unknown): Record<string, MdrEligibility> {
  if (!value || typeof value !== 'object') return {};

  const rows: Record<string, MdrEligibility> = {};
  for (const [ticker, row] of Object.entries(value as Record<string, unknown>)) {
    if (!isMdrEligibility(row)) continue;
    rows[ticker] = row;
  }
  return rows;
}

function loadDashboardLatch(storageKey: string): DashboardLatchState {
  const today = todayInNewYork();
  if (typeof window === 'undefined') return emptyLatchState(today);

  try {
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

function loadDashboardMdrLatch(): DashboardMdrLatchState {
  const today = todayInNewYork();
  if (typeof window === 'undefined') return emptyMdrLatchState(today);

  try {
    const raw = window.localStorage.getItem(DASHBOARD_MDR_LATCH_STORAGE_KEY);
    if (!raw) return emptyMdrLatchState(today);

    const parsed = JSON.parse(raw) as {
      date?: unknown;
      rowsByTicker?: unknown;
      eligibilityByTicker?: unknown;
    };
    if (parsed.date !== today) {
      window.localStorage.removeItem(DASHBOARD_MDR_LATCH_STORAGE_KEY);
      return emptyMdrLatchState(today);
    }

    return {
      date: today,
      rowsByTicker: normalizeRowsByTicker(parsed.rowsByTicker),
      eligibilityByTicker: normalizeEligibilityByTicker(parsed.eligibilityByTicker),
    };
  } catch {
    return emptyMdrLatchState(today);
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

function isDayOneCandidate(gainer: TradingViewGainer) {
  return gainer.marketCap != null && gainer.marketCap < 300_000_000;
}

function dayOneMark(gainer: TradingViewGainer) {
  return gainer.preMarketPrice ?? gainer.price;
}

function dayOneMarkChange(gainer: TradingViewGainer) {
  return gainer.preMarketChange ?? gainer.change;
}

function dayOneVolume(gainer: TradingViewGainer) {
  return gainer.preMarketVolume ?? gainer.volume;
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
  return Object.values(rowsByTicker).sort((a, b) => dayOneMarkChange(b) - dayOneMarkChange(a));
}

function sortMdrRows(
  rowsByTicker: Record<string, TradingViewGainer>,
  eligibilityByTicker: Record<string, MdrEligibility>,
  session: MarketSession,
) {
  return Object.values(rowsByTicker)
    .map((gainer) => {
      const pdc = eligibilityByTicker[gainer.ticker]?.priorClose ?? gainer.price;
      const mark = sessionMark(gainer, session);
      const chg = pdc > 0 ? (mark / pdc - 1) * 100 : 0;
      return { gainer, pdc, mark, chg };
    })
    .sort((a, b) => b.chg - a.chg);
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

export default function DashboardScannerTable({ onNavigateToResearch }: DashboardScannerTableProps) {
  const [gainers, setGainers] = useState<TradingViewGainer[]>([]);
  const [isRealtime, setIsRealtime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<Record<string, ScannerSummary>>({});
  const requestedSummariesRef = useRef(new Set<string>());
  const [dayOneLatch, setDayOneLatch] = useState<DashboardLatchState>(() => loadDashboardLatch(DASHBOARD_DAY1_LATCH_STORAGE_KEY));
  const [mdrLatch, setMdrLatch] = useState<DashboardMdrLatchState>(() => loadDashboardMdrLatch());
  // Per-ticker fetch dedupe — the eligibility check is keyed by (ticker, mark), but
  // we only want to *attempt* an eligibility fetch once per ticker per session until
  // we either get an `eligible: true` (latch it) or we re-poll on the next gainers tick.
  const requestedEligibilityRef = useRef(new Set<string>());

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
      setGainers(nextGainers);
      setIsRealtime(data.isRealtime ?? false);
      setDayOneLatch((previous) => mergeLatchRows(
        previous,
        today,
        nextGainers.filter(isDayOneCandidate),
      ));
      setMdrLatch((previous) => {
        const baseRows = previous.date === today ? previous.rowsByTicker : {};
        const baseEligibility = previous.date === today ? previous.eligibilityByTicker : {};
        const rowsByTicker = { ...baseRows };

        for (const row of nextGainers) {
          if (rowsByTicker[row.ticker]) {
            rowsByTicker[row.ticker] = row;
          }
        }

        return { date: today, rowsByTicker, eligibilityByTicker: baseEligibility };
      });
      requestedEligibilityRef.current = new Set();
    } catch {
      // Keep the last good scanner rows on transient polling failures.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGainers();
    const interval = setInterval(() => void fetchGainers(), 10_000);
    return () => clearInterval(interval);
  }, [fetchGainers]);

  useEffect(() => {
    persistLatch(DASHBOARD_DAY1_LATCH_STORAGE_KEY, dayOneLatch);
  }, [dayOneLatch]);

  useEffect(() => {
    persistLatch(DASHBOARD_MDR_LATCH_STORAGE_KEY, mdrLatch);
  }, [mdrLatch]);

  const dayOneRows = useMemo(() => sortDayOneRows(dayOneLatch.rowsByTicker), [dayOneLatch.rowsByTicker]);

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

  useEffect(() => {
    if (gainers.length === 0) return;
    const today = todayInNewYork();
    const session = getMarketSession();

    for (const gainer of gainers) {
      // Already latched as MDR-eligible today — don't re-check.
      if (mdrLatch.date === today && mdrLatch.rowsByTicker[gainer.ticker]) continue;

      // Volume gate — must be >= 10M shares (pre-market vol during PM, regular vol otherwise).
      const vol = sessionVolume(gainer, session);
      if (!Number.isFinite(vol) || vol < 10_000_000) continue;

      // Mark used for the structural check — pre-market price during PM, live mark otherwise.
      const mark = sessionMark(gainer, session);
      if (!Number.isFinite(mark) || mark <= 0) continue;

      // Dedupe per gainers tick. The Ref is cleared whenever the gainers list reference
      // changes (every 10 seconds), so a non-eligible ticker can be re-checked on the
      // next tick once its mark or volume has moved.
      const key = `${gainer.ticker}:${mark.toFixed(3)}`;
      if (requestedEligibilityRef.current.has(key)) continue;
      requestedEligibilityRef.current.add(key);

      void (async () => {
        try {
          const url = `/api/scanner/mdr-eligibility?ticker=${encodeURIComponent(gainer.ticker)}&mark=${mark}`;
          const res = await fetch(url);
          if (!res.ok) return;
          const data = (await res.json()) as MdrEligibility;
          if (data.eligible) {
            setMdrLatch((previous) => {
              const baseRows = previous.date === today ? previous.rowsByTicker : {};
              const baseEligibility = previous.date === today ? previous.eligibilityByTicker : {};
              return {
                date: today,
                rowsByTicker: { ...baseRows, [data.ticker]: gainer },
                eligibilityByTicker: { ...baseEligibility, [data.ticker]: data },
              };
            });
          }
        } catch {
          // Leave row out of MDR table on transient failure; will retry on next gainers tick.
        }
      })();
    }
  }, [gainers, mdrLatch]);

  const tableCard = 'overflow-hidden rounded-xl border border-white/10 bg-[#121214]';
  const headerRow = 'border-b border-white/5 bg-[#0f0f11]';
  const bodyRow = 'cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5';

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, ticker: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onNavigateToResearch(ticker);
  };

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
              {(() => {
                const session = getMarketSession();
                // Sort by recomputed Mark % Chg desc (mark vs true PDC). Pre-sort here
                // so the table mirrors the Day 1 ordering — biggest movers up top.
                const mdrGainers = sortMdrRows(
                  mdrLatch.rowsByTicker,
                  mdrLatch.eligibilityByTicker,
                  session,
                );

                if (mdrGainers.length === 0) {
                  return (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-zinc-500">
                        No MDR setups detected.
                      </td>
                    </tr>
                  );
                }

                return mdrGainers.map(({ gainer, pdc, mark, chg: markChange }) => {
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
                      {/* TODO: MDR threshold formulas plug in here next. */}
                      <TD right className="text-zinc-600">—</TD>
                      <TD right className="text-zinc-600">—</TD>
                      <TD right className="text-zinc-600">—</TD>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
