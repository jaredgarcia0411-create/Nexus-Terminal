'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

interface TradingViewGainer {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
}

interface ScannerSummary {
  ticker: string;
  cashOnHand: number | null;
  hasAtm: boolean;
  hasEl: boolean;
  hasWarrants: boolean;
  hasS1: boolean;
  fetchedAt: string;
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

function fmtCash(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
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
      className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500 ${right ? 'text-right' : 'text-left'}`}
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

  const fetchGainers = useCallback(async () => {
    try {
      const res = await fetch('/api/tradingview/gainers');
      if (!res.ok) return;
      const data = (await res.json()) as {
        gainers: TradingViewGainer[];
        isRealtime: boolean;
      };
      setGainers(data.gainers ?? []);
      setIsRealtime(data.isRealtime ?? false);
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
    if (gainers.length === 0) return;

    for (const gainer of gainers) {
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
  }, [gainers]);

  const tableCard = 'overflow-hidden rounded-xl border border-emerald-500/20 bg-[#121214]';
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

  if (gainers.length === 0) {
    return (
      <div className="space-y-6">
        <div className={tableCard}>
          <p className="px-4 py-6 text-sm text-zinc-500">No gainers found matching scan criteria.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={tableCard}>
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
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
                <TH right>Cash on Hand</TH>
                <TH right>Has ATM</TH>
                <TH right>Has EL</TH>
                <TH right>Has Warrants</TH>
                <TH right>Has S1</TH>
              </tr>
            </thead>
            <tbody>
              {gainers.map((gainer) => {
                const pdc = gainer.price / (1 + gainer.change / 100);
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
                      <span className="font-bold text-zinc-100">{gainer.ticker}</span>
                    </TD>
                    <TD right>${pdc.toFixed(3)}</TD>
                    <TD right>${gainer.price.toFixed(3)}</TD>
                    <TD right>
                      <span className={gainer.change >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                        {gainer.change >= 0 ? '+' : ''}{gainer.change.toFixed(2)}%
                      </span>
                    </TD>
                    <TD right>{fmtVolume(gainer.volume)}</TD>
                    <TD right>
                      {summary ? fmtCash(summary.cashOnHand) : <span className="text-zinc-600">...</span>}
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
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
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
              {gainers.map((gainer) => {
                const pdc = gainer.price / (1 + gainer.change / 100);
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
                      <span className="font-bold text-zinc-100">{gainer.ticker}</span>
                    </TD>
                    <TD right>${pdc.toFixed(3)}</TD>
                    <TD right>${gainer.price.toFixed(3)}</TD>
                    <TD right>
                      <span className={gainer.change >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                        {gainer.change >= 0 ? '+' : ''}{gainer.change.toFixed(2)}%
                      </span>
                    </TD>
                    {/* TODO: MDR threshold formulas plug in here next. */}
                    <TD right className="text-zinc-600">—</TD>
                    <TD right className="text-zinc-600">—</TD>
                    <TD right className="text-zinc-600">—</TD>
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
