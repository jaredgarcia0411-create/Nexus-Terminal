'use client';

import { motion } from 'motion/react';
import PerformanceCharts from '@/components/trading/PerformanceCharts';
import TradingCalendar from '@/components/trading/TradingCalendar';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';

interface PerformanceTabProps {
  filteredTrades: Trade[];
  performanceMetric: '$' | 'R';
  onMetricChange: (metric: '$' | 'R') => void;
}

export default function PerformanceTab({ filteredTrades, performanceMetric, onMetricChange }: PerformanceTabProps) {
  return (
    <motion.div key="performance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Performance Analytics</h2>
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

      <PerformanceCharts trades={filteredTrades} metric={performanceMetric} />
      <TradingCalendar trades={filteredTrades} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">Symbol Distribution</h3>
          <div className="space-y-3">
            {Object.entries(
              filteredTrades.reduce<Record<string, number>>((acc, trade) => {
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
                    <div className="h-full bg-emerald-500" style={{ width: `${(count / Math.max(filteredTrades.length, 1)) * 100}%` }} />
                  </div>
                  <span className="text-xs text-zinc-500">{count} trades</span>
                </div>
              ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">Risk Summary</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">Avg Risk per Trade</span>
              <span className="font-mono text-sm">
                {formatCurrency(
                  filteredTrades.filter((trade) => trade.initialRisk).reduce((acc, trade) => acc + (trade.initialRisk || 0), 0) /
                    (filteredTrades.filter((trade) => trade.initialRisk).length || 1),
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">Total R-Multiple</span>
              <span className="font-mono text-sm text-emerald-500">
                {filteredTrades
                  .filter((trade) => trade.initialRisk)
                  .reduce((acc, trade) => acc + trade.pnl / (trade.initialRisk || 1), 0)
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
