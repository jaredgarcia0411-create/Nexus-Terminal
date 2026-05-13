'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';

import PerformanceCharts from '@/components/trading/PerformanceCharts';
import PerformanceStatsTable from '@/components/trading/PerformanceStatsTable';
import TagFilterDropdown from '@/components/trading/TagFilterDropdown';
import { getPnLColor } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';

interface PerformanceTabProps {
  filteredTrades: Trade[];
  globalTags: string[];
  performanceMetric: '$' | 'R';
  onMetricChange: (metric: '$' | 'R') => void;
  onTradeClick: (trade: Trade) => void;
}

export default function PerformanceTab({
  filteredTrades,
  globalTags,
  performanceMetric,
  onMetricChange,
  onTradeClick,
}: PerformanceTabProps) {
  const [selectedTagFilters, setSelectedTagFilters] = useState<Set<string>>(new Set());
  const [pnlMode, setPnlMode] = useState<'gross' | 'net'>('net');

  const performanceTrades = useMemo(() => {
    if (selectedTagFilters.size === 0) return filteredTrades;
    return filteredTrades.filter((trade) => (trade.tags ?? []).some((tag) => selectedTagFilters.has(tag)));
  }, [filteredTrades, selectedTagFilters]);

  const stats = useMemo(() => {
    const pnlFor = (trade: Trade) => (pnlMode === 'gross' ? trade.grossPnl : trade.netPnl);
    const pnlValues = performanceTrades.map((trade) => pnlFor(trade));
    const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
    const winningTrades = performanceTrades.filter((trade) => pnlFor(trade) > 0);
    const losingTrades = performanceTrades.filter((trade) => pnlFor(trade) < 0);
    const winRate = performanceTrades.length > 0 ? (winningTrades.length / performanceTrades.length) * 100 : 0;

    const wins = winningTrades.reduce((sum, trade) => sum + pnlFor(trade), 0);
    const losses = Math.abs(losingTrades.reduce((sum, trade) => sum + pnlFor(trade), 0));
    const profitFactor = losses === 0 ? (wins > 0 ? Infinity : 0) : wins / losses;

    const mfeValues = performanceTrades.map((trade) => trade.mfe).filter((value): value is number => typeof value === 'number');
    const maeValues = performanceTrades.map((trade) => trade.mae).filter((value): value is number => typeof value === 'number');
    const exitEffValues = performanceTrades
      .map((trade) => trade.exitEfficiency)
      .filter((value): value is number => typeof value === 'number');

    const averageMfe = mfeValues.length > 0 ? mfeValues.reduce((sum, value) => sum + value, 0) / mfeValues.length : null;
    const averageMae = maeValues.length > 0 ? maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length : null;
    const averageExitEfficiency =
      exitEffValues.length > 0 ? exitEffValues.reduce((sum, value) => sum + value, 0) / exitEffValues.length : null;

    const largestWin = performanceTrades
      .map((trade) => ({ symbol: trade.symbol, value: pnlFor(trade) }))
      .sort((a, b) => b.value - a.value)[0] ?? null;
    const largestLoss = performanceTrades
      .map((trade) => ({ symbol: trade.symbol, value: pnlFor(trade) }))
      .sort((a, b) => a.value - b.value)[0] ?? null;

    return {
      totalPnl,
      winRate,
      profitFactor,
      averageMfe,
      averageMae,
      averageExitEfficiency,
      largestWin,
      largestLoss,
    };
  }, [performanceTrades, pnlMode]);

  const fmtCurrency = (value: number | null) =>
    value == null ? '-' : value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  const fmtPct = (value: number | null) => (value == null ? '-' : `${(value * 100).toFixed(1)}%`);

  return (
    <motion.div
      key="performance"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono uppercase tracking-wider text-zinc-500">Tag Filter</span>
          <TagFilterDropdown
            globalTags={globalTags}
            selectedTags={selectedTagFilters}
            onToggleTag={(tag) => {
              setSelectedTagFilters((prev) => {
                const next = new Set(prev);
                if (next.has(tag)) next.delete(tag);
                else next.add(tag);
                return next;
              });
            }}
            onClearTags={() => setSelectedTagFilters(new Set())}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setPnlMode('net')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${pnlMode === 'net' ? 'bg-zinc-700/60 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              Net
            </button>
            <button
              type="button"
              onClick={() => setPnlMode('gross')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${pnlMode === 'gross' ? 'bg-zinc-700/60 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              Gross
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => onMetricChange('$')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${performanceMetric === '$' ? 'bg-zinc-700/60 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              $
            </button>
            <button
              type="button"
              onClick={() => onMetricChange('R')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${performanceMetric === 'R' ? 'bg-zinc-700/60 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              R
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">
            Total {pnlMode === 'net' ? 'Net' : 'Gross'} PnL
          </div>
          <div className={`text-3xl font-bold tracking-tight tabular-nums ${getPnLColor(stats.totalPnl)}`}>
            {fmtCurrency(stats.totalPnl)}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">Win Rate</div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">{stats.winRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">Profit Factor</div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">
            {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Average MFE</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{fmtCurrency(stats.averageMfe)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Average MAE</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{fmtCurrency(stats.averageMae)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Average Exit Efficiency</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{fmtPct(stats.averageExitEfficiency)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Largest Win / Loss</p>
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-emerald-500">
              {stats.largestWin ? `${stats.largestWin.symbol} ${fmtCurrency(stats.largestWin.value)}` : '-'}
            </p>
            <p className="text-rose-500">
              {stats.largestLoss ? `${stats.largestLoss.symbol} ${fmtCurrency(stats.largestLoss.value)}` : '-'}
            </p>
          </div>
        </div>
      </div>

      <PerformanceCharts trades={performanceTrades} metric={performanceMetric} pnlMode={pnlMode} />
      <PerformanceStatsTable trades={performanceTrades} onTradeClick={onTradeClick} />
    </motion.div>
  );
}
