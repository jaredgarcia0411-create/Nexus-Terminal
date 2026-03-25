'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import PerformanceCharts from '@/components/trading/PerformanceCharts';
import PerformanceStatsTable from '@/components/trading/PerformanceStatsTable';
import TagFilterDropdown from '@/components/trading/TagFilterDropdown';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';

interface PerformanceTabProps {
  filteredTrades: Trade[];
  globalTags: string[];
  performanceMetric: '$' | 'R';
  onMetricChange: (metric: '$' | 'R') => void;
  onTradeClick: (trade: Trade) => void;
}

export default function PerformanceTab({ filteredTrades, globalTags, performanceMetric, onMetricChange, onTradeClick }: PerformanceTabProps) {
  const [selectedTagFilters, setSelectedTagFilters] = useState<Set<string>>(new Set());

  const performanceTrades = useMemo(() => {
    if (selectedTagFilters.size === 0) return filteredTrades;
    return filteredTrades.filter((trade) => (trade.tags ?? []).some((tag) => selectedTagFilters.has(tag)));
  }, [filteredTrades, selectedTagFilters]);

  return (
  <motion.div key="performance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
    <div className="flex flex-wrap items-center justify-between">
      <p className="text-sm text-zinc-400">Detailed breakdowns of win rate, R-multiples, and symbol distribution.</p>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => onMetricChange('$')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${performanceMetric === '$' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
          >
            $ Metrics
          </button>
          <button
            onClick={() => onMetricChange('R')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${performanceMetric === 'R' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
          >
            R Metrics
          </button>
        </div>
      </div>

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

      <PerformanceCharts trades={performanceTrades} metric={performanceMetric} />
      <PerformanceStatsTable trades={performanceTrades} onTradeClick={onTradeClick} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">Symbol Distribution</h3>
          <div className="space-y-3">
            {Object.entries(
              performanceTrades.reduce<Record<string, number>>((acc, trade) => {
                acc[trade.symbol] = (acc[trade.symbol] || 0) + 1;
                return acc;
              }, {}),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([symbol, count]) => (
                <div key={symbol} className="flex items-center justify-between">
                  <span className="font-mono text-sm">{symbol}</span>
                  <div className="mx-4 h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full bg-emerald-500" style={{ width: `${(count / Math.max(performanceTrades.length, 1)) * 100}%` }} />
                  </div>
                  <span className="text-xs text-zinc-500">{count} trades</span>
                </div>
              ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">Risk Summary</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">Avg Risk per Trade</span>
              <span className="font-mono text-sm">
                {formatCurrency(
                  performanceTrades.filter((trade) => trade.initialRisk).reduce((acc, trade) => acc + (trade.initialRisk || 0), 0) /
                    (performanceTrades.filter((trade) => trade.initialRisk).length || 1),
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">Total R-Multiple</span>
              <span className="font-mono text-sm text-emerald-500">
                {performanceTrades
                  .filter((trade) => trade.initialRisk)
                  .reduce((acc, trade) => acc + trade.netPnl / (trade.initialRisk || 1), 0)
                  .toFixed(2)}
                R
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
