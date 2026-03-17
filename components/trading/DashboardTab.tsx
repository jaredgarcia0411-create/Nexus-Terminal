'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Upload } from 'lucide-react';
import PerformanceCharts from '@/components/trading/PerformanceCharts';
import TradeTable from '@/components/trading/TradeTable';
import TradingCalendar from '@/components/trading/TradingCalendar';
import WeeklyCalendar from '@/components/trading/WeeklyCalendar';
import { Button } from '@/components/ui/button';
import { getPnLColor } from '@/lib/trading-utils';
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
  const [pnlMode, setPnlMode] = useState<'gross' | 'net'>('net');

  const stats = useMemo(() => {
    const pnlFor = (trade: Trade) => (pnlMode === 'gross' ? trade.grossPnl : trade.netPnl);
    const pnlValues = trades.map((trade) => pnlFor(trade));
    const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
    const winningTrades = trades.filter((trade) => pnlFor(trade) > 0);
    const losingTrades = trades.filter((trade) => pnlFor(trade) < 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

    const wins = winningTrades.reduce((sum, trade) => sum + pnlFor(trade), 0);
    const losses = Math.abs(losingTrades.reduce((sum, trade) => sum + pnlFor(trade), 0));
    const profitFactor = losses === 0 ? (wins > 0 ? Infinity : 0) : wins / losses;

    const mfeValues = trades.map((trade) => trade.mfe).filter((value): value is number => typeof value === 'number');
    const maeValues = trades.map((trade) => trade.mae).filter((value): value is number => typeof value === 'number');
    const exitEffValues = trades
      .map((trade) => trade.exitEfficiency)
      .filter((value): value is number => typeof value === 'number');

    const averageMfe = mfeValues.length > 0 ? mfeValues.reduce((sum, value) => sum + value, 0) / mfeValues.length : null;
    const averageMae = maeValues.length > 0 ? maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length : null;
    const averageExitEfficiency =
      exitEffValues.length > 0 ? exitEffValues.reduce((sum, value) => sum + value, 0) / exitEffValues.length : null;

    const largestWin = trades
      .map((trade) => ({ symbol: trade.symbol, value: pnlFor(trade) }))
      .sort((a, b) => b.value - a.value)[0] ?? null;
    const largestLoss = trades
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
  }, [trades, pnlMode]);

  const fmtCurrency = (value: number | null) =>
    value == null ? '-' : value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  const fmtPct = (value: number | null) => (value == null ? '-' : `${(value * 100).toFixed(1)}%`);

  return (
    <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      {trades.length === 0 ? (
        <div className="space-y-5 rounded-xl border border-white/10 bg-[#121214] p-10 text-center">
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
      <div className="flex flex-wrap items-center justify-between">
        <p className="text-sm text-zinc-400">Overview of your trading performance.</p>
             <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
               <button
                 onClick={() => setPnlMode('net')}
                 className={`rounded-md px-3 py-1 text-xs font-medium ${pnlMode === 'net' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
               >
                 Net PnL
               </button>
               <button
                 onClick={() => setPnlMode('gross')}
                 className={`rounded-md px-3 py-1 text-xs font-medium ${pnlMode === 'gross' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
               >
                 Gross PnL
               </button>
             </div>
           </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
              <div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">Total {pnlMode === 'net' ? 'Net' : 'Gross'} PnL</div>
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

           <PerformanceCharts trades={filteredTrades} metric={performanceMetric} pnlMode={pnlMode} variant="summary" />

           <WeeklyCalendar trades={filteredTrades} />
           <TradingCalendar trades={filteredTrades} />

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
              pnlMode={pnlMode}
              readOnly
            />
          </div>
        </>
      )}
    </motion.div>
  );
}
