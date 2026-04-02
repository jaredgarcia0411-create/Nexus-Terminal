'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import JarvisMacroSummary from '@/components/trading/JarvisMacroSummary';
import { Button } from '@/components/ui/button';
import { useMarketStream } from '@/hooks/use-market-stream';
import { useRelaySocket } from '@/hooks/use-relay-socket';
import { useSchwabStatus } from '@/hooks/use-schwab-status';
import type { JarvisMacroSummaryOutput } from '@/lib/jarvis/types';
import {
  quotesToSnapshot,
  type MarketInstrument,
  type MarketMoverRow,
  type MarketSnapshotPayload,
} from '@/lib/quote-mappers';
import type { RelayQuoteUpdate, RelayScreenerData } from '@/lib/relay-types';

type SnapshotCoverage = {
  totalInstruments: number;
  availablePrices: number;
  missingPriceCount: number;
  missingPriceBySection: {
    indices: number;
    commodities: number;
    equities: number;
  };
};

function formatNumber(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatChange(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function isBigMove(value: number | null) {
  return value != null && Number.isFinite(value) && Math.abs(value) > 30;
}

function countMissing(items: MarketInstrument[]) {
  return items.filter((item) => item.price == null).length;
}

function buildCoverage(data: MarketSnapshotPayload): SnapshotCoverage {
  const totalInstruments = data.indices.length + data.commodities.length + data.equities.length;
  const missingPriceBySection = {
    indices: countMissing(data.indices),
    commodities: countMissing(data.commodities),
    equities: countMissing(data.equities),
  };
  const missingPriceCount =
    missingPriceBySection.indices +
    missingPriceBySection.commodities +
    missingPriceBySection.equities;

  return {
    totalInstruments,
    availablePrices: totalInstruments - missingPriceCount,
    missingPriceCount,
    missingPriceBySection,
  };
}

function InstrumentCard({ item }: { item: MarketInstrument }) {
  const positive = (item.changePercent ?? 0) >= 0;
  const sessionBadge = item.quoteSession === 'pre-market'
    ? 'Pre'
    : item.quoteSession === 'after-hours'
      ? 'AH'
      : null;

  return (
    <div className="rounded-lg border border-white/10 bg-[#121214] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-zinc-200">{item.label}</p>
          {sessionBadge ? <span className="rounded border border-white/15 bg-white/5 px-1 py-0.5 text-[10px] text-zinc-400">{sessionBadge}</span> : null}
        </div>
        <span className={`text-sm ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>{formatPercent(item.changePercent)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-lg font-semibold tabular-nums text-white">{formatNumber(item.price)}</p>
        {item.extendedQuoteUnavailable && item.extendedUnavailableLabel ? (
          <span className="rounded border border-zinc-500/25 bg-zinc-500/10 px-1.5 py-0.5 text-[10px] text-zinc-400">{item.extendedUnavailableLabel}</span>
        ) : null}
      </div>
      <p className={`mt-1 text-sm ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>{formatChange(item.change)}</p>
    </div>
  );
}

function MoversTable({ title, rows }: { title: string; rows: MarketMoverRow[] }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="rounded-xl border border-white/10 bg-[#121214] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        <p className="text-sm text-zinc-500">{rows.length} symbols</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full tabular-nums text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-zinc-400">
              <th className="px-2 py-2">Ticker</th>
              <th className="px-2 py-2">Price</th>
              <th className="px-2 py-2">Prev Close</th>
              <th className="px-2 py-2">Change</th>
              <th className="px-2 py-2">Change %</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const positive = (row.changePercent ?? 0) >= 0;
              return (
                <tr key={`${title}-${row.ticker}`} className="border-b border-white/5 text-zinc-200">
                  <td className="px-2 py-2 font-medium">{row.ticker}</td>
                  <td className="px-2 py-2">{formatNumber(row.price)}</td>
                  <td className="px-2 py-2">{formatNumber(row.previousClose)}</td>
                  <td className={`px-2 py-2 ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>{formatChange(row.change)}</td>
                  <td className={`px-2 py-2 ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    <span>{formatPercent(row.changePercent)}</span>
                    {isBigMove(row.changePercent) ? (
                      <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">30%+</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-zinc-500">No symbols available.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[11px] text-zinc-500">Page {safePage} of {totalPages}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={safePage <= 1}
            className="rounded border border-white/15 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={safePage >= totalPages}
            className="rounded border border-white/15 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MarketsTab() {
  const [macroSummary, setMacroSummary] = useState<JarvisMacroSummaryOutput | null>(null);
  const [snapshot, setSnapshot] = useState<MarketSnapshotPayload | null>(null);
  const [loadingMacro, setLoadingMacro] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<SnapshotCoverage | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [dataSource, setDataSource] = useState<'realtime' | 'delayed' | null>(null);

  const { schwabStatus, loading: schwabLoading, refresh: refreshSchwabStatus } = useSchwabStatus();

  // --- Relay WebSocket (direct from Fly.io, bypasses DB) ---
  const quoteMapRef = useRef(new Map<string, RelayQuoteUpdate>());

  const buildSnapshotFromQuotes = useCallback((quotes: Map<string, RelayQuoteUpdate>): MarketSnapshotPayload => {
    const { indices, commodities, equities } = quotesToSnapshot(quotes);
    return {
      indices,
      commodities,
      equities,
      movers: snapshot?.movers ?? { gainers: [], losers: [] },
    };
  }, [snapshot?.movers]);

  const handleRelaySnapshot = useCallback((quotes: RelayQuoteUpdate[]) => {
    const map = quoteMapRef.current;
    for (const q of quotes) {
      map.set(q.symbol, q);
    }

    setSnapshot(buildSnapshotFromQuotes(map));
    setCoverage(buildCoverage(buildSnapshotFromQuotes(map)));
    setDataSource('realtime');
    setLastLoadedAt(new Date());
    setLoadingSnapshot(false);
    setWarning(null);
    setIsStale(false);
  }, [buildSnapshotFromQuotes]);

  const handleRelayQuotes = useCallback((quotes: RelayQuoteUpdate[]) => {
    const map = quoteMapRef.current;
    for (const q of quotes) {
      const existing = map.get(q.symbol);
      map.set(q.symbol, { ...(existing ?? {}), ...q, symbol: q.symbol });
    }

    setSnapshot(buildSnapshotFromQuotes(map));
    setDataSource('realtime');
    setLastLoadedAt(new Date());

  }, [buildSnapshotFromQuotes]);

  const handleRelayScreener = useCallback((data: RelayScreenerData) => {
    const toMoverRow = (item: RelayScreenerData['gainers'][number]): MarketMoverRow => ({
      ticker: item.symbol,
      price: item.lastPrice,
      previousClose: null,
      change: item.netChange,
      changePercent: item.netChangePercent,
      updated: null,
      volume: item.totalVolume,
    });

    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        movers: {
          gainers: data.gainers.map(toMoverRow),
          losers: data.losers.map(toMoverRow),
        },
      };
    });

  }, []);

  const { connected: relayConnected, fallbackToSSE: relayFallback } = useRelaySocket({
    enabled: dataSource === 'realtime' || (schwabStatus.linked && !schwabLoading),
    onSnapshot: handleRelaySnapshot,
    onQuotes: handleRelayQuotes,
    onScreener: handleRelayScreener,
  });

  const { connected: sseConnected, fallbackToPolling } = useMarketStream({
    enabled: (dataSource === 'realtime' || (schwabStatus.linked && !schwabLoading)) && relayFallback,
    scannerFilters: {} as Record<string, never>,
    scannerSortBy: 'netChangePercent' as const,
    scannerSortDir: 'desc' as const,
    onSnapshot: (data) => {
      const payload = data as {
        mappedSnapshot?: MarketSnapshotPayload;
        fetchedAt?: string;
      };

      if (!payload.mappedSnapshot) {
        return;
      }

      setSnapshot(payload.mappedSnapshot);
      setCoverage(buildCoverage(payload.mappedSnapshot));
      setWarning(null);
      setIsStale(false);
      setDataSource('realtime');
      setLastLoadedAt(payload.fetchedAt ? new Date(payload.fetchedAt) : new Date());
      setLoadingSnapshot(false);
    },
    onScanner: () => {},
    onError: (error) => {
      setWarning(error);
    },
  });

  const loadMacroSummary = useCallback(async () => {
    setLoadingMacro(true);
    try {
      const response = await fetch('/api/jarvis/macro-summary/latest');
      if (!response.ok) throw new Error('Failed to load macro summary');
      const payload = (await response.json()) as { latest?: JarvisMacroSummaryOutput | null };
      setMacroSummary(payload.latest ?? null);
    } catch {
      setMacroSummary(null);
    } finally {
      setLoadingMacro(false);
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    try {
      const response = await fetch('/api/market-data/snapshot');
      if (!response.ok) throw new Error('Failed to load market snapshot');
      const payload = (await response.json()) as {
        data?: MarketSnapshotPayload;
        fetchedAt?: string;
        warning?: string | null;
        stale?: boolean;
        coverage?: SnapshotCoverage;
        dataSource?: 'realtime' | 'delayed';
      };
      setSnapshot(payload.data ?? null);
      setWarning(payload.warning ?? null);
      setCoverage(payload.coverage ?? null);
      setIsStale(Boolean(payload.stale));
      setDataSource(payload.dataSource ?? 'delayed');
      setLastLoadedAt(payload.fetchedAt ? new Date(payload.fetchedAt) : new Date());
    } catch {
      setWarning('Could not refresh market snapshot data.');
      setDataSource('delayed');
    } finally {
      setLoadingSnapshot(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMacroSummary(), loadSnapshot()]);
  }, [loadMacroSummary, loadSnapshot]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    // If we have a live connection (relay WebSocket or SSE), no polling needed —
    // data arrives via push. Only poll when everything has fallen back to polling.
    if (relayConnected || sseConnected || (dataSource === 'realtime' && !fallbackToPolling)) {
      return;
    }

    const intervalMs = dataSource === 'realtime' ? 5_000 : 60_000;
    const interval = window.setInterval(() => {
      void loadSnapshot();
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [loadSnapshot, dataSource, fallbackToPolling, relayConnected, sseConnected]);

  return (
    <motion.section key="markets" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-zinc-400">Unified market snapshot with market movers across major asset classes.</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refreshAll()}
          disabled={loadingMacro || loadingSnapshot}
          className="border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10"
        >
          {loadingMacro || loadingSnapshot ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#121214] px-4 py-3 text-sm text-zinc-400">
        <div className="flex items-center gap-2">
          {dataSource === 'realtime' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              LIVE
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-zinc-400">
              15-MIN DELAYED
            </span>
          )}
            <span className="text-xs text-zinc-500">
              {dataSource === 'realtime'
                ? relayConnected
                  ? 'Schwab real-time (direct WebSocket)'
                  : 'Schwab real-time streaming (SSE)'
                : 'Massive API delayed data'}
            </span>
        </div>
        {lastLoadedAt ? <p className="mt-1 text-xs text-zinc-500">Last market update: {lastLoadedAt.toLocaleTimeString()}</p> : null}
        {coverage ? (
          <p className="mt-1 text-xs text-zinc-500">
            Snapshot coverage: {coverage.availablePrices}/{coverage.totalInstruments} symbols populated ({coverage.missingPriceCount} missing).
          </p>
        ) : null}
        {warning ? <p className="mt-2 text-xs text-amber-300">{warning}</p> : null}
        {isStale ? <p className="mt-1 text-xs text-amber-300">Data is stale (older than 30 minutes).</p> : null}
      </div>

      {!schwabLoading && !schwabStatus.linked && schwabStatus.status !== 'expired' ? (
        <div className="rounded-xl border border-white/10 bg-[#121214] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">Want real-time data?</p>
              <p className="text-xs text-zinc-400">Link your Schwab account for live streaming prices.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.href = '/api/schwab/auth';
              }}
              className="border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10"
            >
              Link Schwab Account
            </Button>
          </div>
        </div>
      ) : null}

      {!schwabLoading && schwabStatus.linked ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-emerald-400">Schwab account linked — real-time data active</p>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/schwab/status', { method: 'DELETE' });
                await refreshSchwabStatus();
                await loadSnapshot();
              }}
              className="text-xs text-zinc-500 underline hover:text-zinc-300"
            >
              Unlink
            </button>
          </div>
          {schwabStatus.refreshExpiresAt ? (
            <p className="mt-1 text-[10px] text-zinc-500">
              Re-authorization needed by {new Date(schwabStatus.refreshExpiresAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      ) : null}

      {!schwabLoading && schwabStatus.status === 'expired' ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-300">Schwab link expired</p>
              <p className="text-xs text-zinc-400">Your Schwab refresh token has expired (7-day limit). Re-link to restore real-time data.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.href = '/api/schwab/auth';
              }}
              className="border-amber-500/30 bg-amber-500/10 px-3 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
            >
              Re-link Schwab
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-200">Indexes</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {(snapshot?.indices ?? []).map((item) => <InstrumentCard key={item.symbol} item={item} />)}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-200">Commodities, Bonds & FX</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {(snapshot?.commodities ?? []).map((item) => <InstrumentCard key={item.symbol} item={item} />)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
        <h2 className="mb-3 text-base font-semibold text-zinc-200">Major Equity Components</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(snapshot?.equities ?? []).map((item) => <InstrumentCard key={item.symbol} item={item} />)}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 bg-[#121214] p-4">
        <h2 className="text-base font-semibold text-zinc-100">Market Movers</h2>
        <p className="text-xs text-zinc-500 md:hidden">Swipe horizontally to switch between gainers and losers.</p>

        <div className="hidden gap-3 md:grid md:grid-cols-2">
          <MoversTable title="Top Gainers" rows={snapshot?.movers.gainers ?? []} />
          <MoversTable title="Top Losers" rows={snapshot?.movers.losers ?? []} />
        </div>

        <div className="md:hidden overflow-x-auto">
          <div className="flex w-[200%] snap-x snap-mandatory gap-3">
            <div className="w-1/2 shrink-0 snap-start">
              <MoversTable title="Top Gainers" rows={snapshot?.movers.gainers ?? []} />
            </div>
            <div className="w-1/2 shrink-0 snap-start">
              <MoversTable title="Top Losers" rows={snapshot?.movers.losers ?? []} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
        {loadingMacro ? <p className="text-sm text-zinc-500">Loading macro summary...</p> : null}
        {!loadingMacro && macroSummary ? <JarvisMacroSummary macroSummary={macroSummary} /> : null}
        {!loadingMacro && !macroSummary ? <p className="text-sm text-zinc-500">No macro summary available yet.</p> : null}
      </div>
    </motion.section>
  );
}
