'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { motion } from 'motion/react';
import { ChevronDown, ChevronRight, Search, Tag as TagIcon } from 'lucide-react';
import TradeTable from '@/components/trading/TradeTable';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';

interface JournalTabProps {
  filteredTrades: Trade[];
  selectedIds: Set<string>;
  globalTags: string[];
  searchQuery: string;
  riskInput: string;
  bulkTagInput: string;
  onSearchQueryChange: (value: string) => void;
  onRiskInputChange: (value: string) => void;
  onBulkTagInputChange: (value: string) => void;
  onApplyRisk: () => void;
  onBulkAddTag: () => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag: (tagName: string) => void;
  onTradeClick: (trade: Trade) => void;
}

type DayCard = {
  sortKey: string;
  date: Date;
  trades: Trade[];
  dailyNetPnl: number;
  totalCommissions: number;
  winRate: number;
  mfeMaeRatio: number | null;
  sparklinePoints: number[];
};

function DaySparkline({ points }: { points: number[] }) {
  if (points.length === 0) return <div className="h-8 text-[10px] text-zinc-600">-</div>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const polyline = points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 30 - ((point - min) / range) * 30;
      return `${x},${y}`;
    })
    .join(' ');

  const color = points.at(-1)! >= 0 ? '#10b981' : '#f43f5e';

  return (
    <svg viewBox="0 0 100 30" className="h-8 w-24">
      <polyline fill="none" stroke={color} strokeWidth="2" points={polyline} />
    </svg>
  );
}

export default function JournalTab({
  filteredTrades,
  selectedIds,
  globalTags,
  searchQuery,
  riskInput,
  bulkTagInput,
  onSearchQueryChange,
  onRiskInputChange,
  onBulkTagInputChange,
  onApplyRisk,
  onBulkAddTag,
  onToggleSelect,
  onSelectAll,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
  onTradeClick,
}: JournalTabProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const dayCards = useMemo<DayCard[]>(() => {
    const dayMap = new Map<string, Trade[]>();
    for (const trade of filteredTrades) {
      const list = dayMap.get(trade.sortKey) ?? [];
      list.push(trade);
      dayMap.set(trade.sortKey, list);
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([sortKey, trades]) => {
        const sorted = [...trades].sort((a, b) => b.date.getTime() - a.date.getTime());
        const chronological = [...trades].sort((a, b) => a.date.getTime() - b.date.getTime());
        let cumulative = 0;
        const sparklinePoints = chronological.map((trade) => {
          cumulative += trade.netPnl;
          return cumulative;
        });

        const dailyNetPnl = sorted.reduce((sum, trade) => sum + trade.netPnl, 0);
        const wins = sorted.filter((trade) => trade.netPnl > 0).length;
        const totalCommissions = sorted.reduce((sum, trade) => sum + (trade.commission ?? 0) + (trade.fees ?? 0), 0);

        const mfeValues = sorted.map((trade) => trade.mfe).filter((value): value is number => typeof value === 'number');
        const maeValues = sorted.map((trade) => trade.mae).filter((value): value is number => typeof value === 'number');
        const avgMfe = mfeValues.length > 0 ? mfeValues.reduce((sum, value) => sum + value, 0) / mfeValues.length : null;
        const avgMae = maeValues.length > 0 ? maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length : null;
        const mfeMaeRatio = avgMfe != null && avgMae != null && avgMae > 0 ? avgMfe / avgMae : null;

        return {
          sortKey,
          date: new Date(sorted[0].date),
          trades: sorted,
          dailyNetPnl,
          totalCommissions,
          winRate: sorted.length > 0 ? (wins / sorted.length) * 100 : 0,
          mfeMaeRatio,
          sparklinePoints,
        };
      });
  }, [filteredTrades]);

  const toggleDay = (sortKey: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(sortKey)) next.delete(sortKey);
      else next.add(sortKey);
      return next;
    });
  };

  return (
    <motion.div key="journal" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex flex-col gap-6 rounded-2xl border border-white/5 bg-[#121214] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold">Trading Journal</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                className="w-64 rounded-lg border border-white/10 bg-white/5 py-1.5 pl-10 pr-4 text-sm transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
              />
            </div>
          </div>

          {selectedIds.size > 0 ? (
            <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                <span className="text-[10px] font-bold uppercase text-zinc-500">Set Risk:</span>
                <input
                  type="number"
                  placeholder="$500"
                  value={riskInput}
                  onChange={(event) => onRiskInputChange(event.target.value)}
                  className="w-16 border-b border-white/10 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
                />
                <button onClick={onApplyRisk} className="text-[10px] font-bold uppercase text-emerald-500 hover:text-emerald-400">
                  Apply
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                <TagIcon className="h-3 w-3 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Add Tag..."
                  value={bulkTagInput}
                  onChange={(event) => onBulkTagInputChange(event.target.value)}
                  className="w-20 border-b border-white/10 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
                />
                <button onClick={onBulkAddTag} className="text-[10px] font-bold uppercase text-emerald-500 hover:text-emerald-400">
                  Add
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {dayCards.map((day) => {
          const expanded = expandedDays.has(day.sortKey);
          return (
            <div key={day.sortKey} className="overflow-hidden rounded-2xl border border-white/5 bg-[#121214]">
              <button
                onClick={() => toggleDay(day.sortKey)}
                className="flex w-full items-center justify-between gap-4 border-b border-white/5 p-4 text-left hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  {expanded ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
                  <div>
                    <p className="text-sm font-semibold">{format(day.date, 'EEEE, MMM dd yyyy')}</p>
                    <p className="text-xs text-zinc-500">{day.trades.length} trades</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <DaySparkline points={day.sparklinePoints} />
                  <p className={`text-sm font-semibold ${day.dailyNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {formatCurrency(day.dailyNetPnl)}
                  </p>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-3 border-b border-white/5 bg-white/[0.02] p-3 text-xs sm:grid-cols-5">
                <div>
                  <p className="text-zinc-500">Total Trades</p>
                  <p className="font-medium">{day.trades.length}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Win %</p>
                  <p className="font-medium">{day.winRate.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-zinc-500">Commissions</p>
                  <p className="font-medium">{formatCurrency(day.totalCommissions)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">MFE/MAE Ratio</p>
                  <p className="font-medium">{day.mfeMaeRatio == null ? '-' : day.mfeMaeRatio.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Net PnL</p>
                  <p className={`font-medium ${day.dailyNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {formatCurrency(day.dailyNetPnl)}
                  </p>
                </div>
              </div>

              {expanded ? (
                <div className="p-3">
                  <TradeTable
                    trades={day.trades}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onSelectAll={onSelectAll}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                    onDeleteGlobalTag={onDeleteGlobalTag}
                    onTradeClick={onTradeClick}
                    globalTags={globalTags}
                  />
                </div>
              ) : null}
            </div>
          );
        })}

        {dayCards.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-[#121214] p-10 text-center text-sm text-zinc-500">
            No trades match the current filters.
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
