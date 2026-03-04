'use client';

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Upload } from 'lucide-react';
import PerformanceCharts from '@/components/trading/PerformanceCharts';
import TradeTable from '@/components/trading/TradeTable';
import { Button } from '@/components/ui/button';
import type { Trade } from '@/lib/types';

interface DashboardTabProps {
  trades: Trade[];
  filteredTrades: Trade[];
  performanceMetric: '$' | 'R';
  selectedIds: Set<string>;
  globalTags: string[];
  onImportClick: () => void;
  onNewTradeClick: () => void;
  onSetActiveTab: (tab: 'journal') => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag: (tagName: string) => void;
  onTradeClick: (trade: Trade) => void;
}

export default function DashboardTab({
  trades,
  filteredTrades,
  performanceMetric,
  selectedIds,
  globalTags,
  onImportClick,
  onNewTradeClick,
  onSetActiveTab,
  onToggleSelect,
  onSelectAll,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
  onTradeClick,
}: DashboardTabProps) {
  const stats = useMemo(() => {
    const totalPnl = trades.reduce((acc, trade) => acc + trade.pnl, 0);
    const winningTrades = trades.filter((trade) => trade.pnl > 0);
    const losingTrades = trades.filter((trade) => trade.pnl < 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const wins = winningTrades.reduce((acc, trade) => acc + trade.pnl, 0);
    const losses = Math.abs(losingTrades.reduce((acc, trade) => acc + trade.pnl, 0));
    const profitFactor = losses === 0 ? (wins > 0 ? Infinity : 0) : wins / losses;
    return { totalPnl, winRate, profitFactor };
  }, [trades]);

  return (
    <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
      {trades.length === 0 ? (
        <div className="space-y-5 rounded-2xl border border-white/5 bg-[#121214] p-10 text-center">
          <h2 className="text-2xl font-bold">Welcome to Nexus Terminal</h2>
          <p className="mx-auto max-w-2xl text-sm text-zinc-400">Import your trading data to get started.</p>
          <div className="flex flex-col items-center gap-3">
            <Button
              onClick={onImportClick}
              className="inline-flex items-center gap-2 bg-emerald-500 px-5 py-2 font-semibold text-black hover:bg-emerald-400"
            >
              <Upload className="h-4 w-4" />
              Import Trades
            </Button>
            <p className="text-xs text-zinc-500">
              CSV files should be named like <span className="font-mono">01-15-25.csv</span> (MM-DD-YY)
            </p>
            <Button onClick={onNewTradeClick} variant="outline" className="border-white/10 bg-white/5 text-sm text-white hover:bg-white/10">
              Or add a trade manually
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
              <div className="mb-2 text-xs font-mono uppercase text-zinc-500">Total PnL</div>
              <div className={`text-3xl font-bold tracking-tight ${stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                ${stats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
              <div className="mb-2 text-xs font-mono uppercase text-zinc-500">Win Rate</div>
              <div className="text-3xl font-bold tracking-tight">
                {stats.winRate.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
              <div className="mb-2 text-xs font-mono uppercase text-zinc-500">Profit Factor</div>
              <div className="text-3xl font-bold tracking-tight">
                {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}
              </div>
            </div>
          </div>

          <PerformanceCharts trades={filteredTrades} metric={performanceMetric} />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Recent Trades</h2>
              <Button variant="ghost" onClick={() => onSetActiveTab('journal')} className="text-sm text-emerald-500 hover:text-emerald-400">
                View Journal
              </Button>
            </div>
            <TradeTable
              trades={filteredTrades.slice(0, 10)}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onSelectAll={onSelectAll}
              onAddTag={onAddTag}
              onRemoveTag={onRemoveTag}
              onDeleteGlobalTag={onDeleteGlobalTag}
              onTradeClick={onTradeClick}
              globalTags={globalTags}
              readOnly
            />
          </div>
        </>
      )}
    </motion.div>
  );
}
