'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Search, Tag as TagIcon } from 'lucide-react';
import DailyReportSheet from '@/components/trading/DailyReportSheet';
import TradingCalendar from '@/components/trading/TradingCalendar';
import TradeTable from '@/components/trading/TradeTable';
import WeeklyReviewSheet from '@/components/trading/WeeklyReviewSheet';
import JournalTradeChart from '@/components/trading/JournalTradeChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, getPnLColor } from '@/lib/trading-utils';
import {
  TRADE_CHART_TIMEFRAME_CONFIG,
  type TradeChartTimeframeKey,
} from '@/lib/chart-timeframes';
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
};

const INITIAL_CHART_BATCH = 4;
const CHART_BATCH_STEP = 4;

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
  const [chartCountByDay, setChartCountByDay] = useState<Record<string, number>>({});
  const [chartTimeframes, setChartTimeframes] = useState<Record<string, TradeChartTimeframeKey>>({});
  const [drcDate, setDrcDate] = useState<string | null>(null);
  const [weekRange, setWeekRange] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('nexus.journal.calendarOpen');
    }
  }, []);

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
        };
      });
  }, [filteredTrades]);

  const toggleDay = (sortKey: string) => {
    const isCurrentlyExpanded = expandedDays.has(sortKey);
    if (!isCurrentlyExpanded) {
      setChartCountByDay((counts) => ({
        ...counts,
        [sortKey]: counts[sortKey] ?? INITIAL_CHART_BATCH,
      }));
    }

    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(sortKey)) {
        next.delete(sortKey);
      } else {
        next.add(sortKey);
      }
      return next;
    });
  };

  return (
    <motion.div key="journal" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
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

        {selectedIds.size > 0 ? (
          <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
              <span className="text-[10px] font-bold uppercase text-zinc-500">Set Risk:</span>
              <input
                type="number"
                placeholder="$500"
                value={riskInput}
                onChange={(event) => onRiskInputChange(event.target.value)}
                className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
              />
              <button onClick={onApplyRisk} className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-500 hover:bg-emerald-500/20">
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
                className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
              />
              <button onClick={onBulkAddTag} className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-500 hover:bg-emerald-500/20">
                Add
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <TradingCalendar
        trades={filteredTrades}
        onDayClick={(dateKey) => setDrcDate(dateKey)}
        onWeekClick={(start, end) => setWeekRange({ start, end })}
      />

      <div className="space-y-4">
        {dayCards.map((day) => {
          const expanded = expandedDays.has(day.sortKey);
          return (
            <div key={day.sortKey} className="overflow-hidden rounded-xl border border-white/10 bg-[#121214]">
              <button
                onClick={() => toggleDay(day.sortKey)}
                className="flex w-full items-center justify-between gap-4 border-b border-white/10 p-4 text-left hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  {expanded ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
                  <div>
                    <p className="text-base font-semibold">{format(day.date, 'EEEE, MMM dd yyyy')}</p>
                    <p className="text-sm text-zinc-500">{day.trades.length} trades</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden items-center gap-1.5 sm:flex">
                    {[...new Set(day.trades.map((t) => t.symbol))].map((sym) => (
                      <span key={sym} className="rounded bg-white/5 px-2 py-0.5 text-xs font-medium text-zinc-400">
                        {sym}
                      </span>
                    ))}
                  </div>
                  <p className={`text-base font-semibold ${getPnLColor(day.dailyNetPnl)}`}>
                    {formatCurrency(day.dailyNetPnl)}
                  </p>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-3 border-b border-white/10 bg-white/[0.02] p-3 text-sm sm:grid-cols-5">
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
                  <p className={`font-medium ${getPnLColor(day.dailyNetPnl)}`}>
                    {formatCurrency(day.dailyNetPnl)}
                  </p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {expanded ? (
                  <motion.div
                    key={day.sortKey}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="space-y-4 p-3"
                  >
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
                      hideSelection
                    />

                    <div className="space-y-3 rounded-xl border border-white/10 bg-[#121214] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Trade Replay Charts</p>
                      <div className="space-y-3">
                        {day.trades.slice(0, chartCountByDay[day.sortKey] ?? INITIAL_CHART_BATCH).map((trade) => (
                          <div key={`chart-${trade.id}`} className="space-y-2">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <p className="font-semibold text-white">{trade.symbol} ({trade.direction})</p>
                              <p className="font-mono text-zinc-500">{trade.entryTime || '--:--'} - {trade.exitTime || '--:--'}</p>
                              <Select
                                value={chartTimeframes[trade.id] ?? '5m'}
                                onValueChange={(value) => setChartTimeframes((prev) => ({ ...prev, [trade.id]: value as TradeChartTimeframeKey }))}
                              >
                                <SelectTrigger className="h-7 w-24 bg-white/5 border-white/10 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-[#18181b] border-white/10 text-white">
                                  {Object.entries(TRADE_CHART_TIMEFRAME_CONFIG).map(([value, cfg]) => (
                                    <SelectItem key={value} value={value}>
                                      {cfg.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <JournalTradeChart trade={trade} timeframe={chartTimeframes[trade.id] ?? '5m'} />
                          </div>
                        ))}

                        {day.trades.length > (chartCountByDay[day.sortKey] ?? INITIAL_CHART_BATCH) ? (
                          <div className="flex justify-center">
                            <button
                              onClick={() => {
                                setChartCountByDay((counts) => ({
                                  ...counts,
                                  [day.sortKey]: Math.min(day.trades.length, (counts[day.sortKey] ?? INITIAL_CHART_BATCH) + CHART_BATCH_STEP),
                                }));
                              }}
                              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10"
                            >
                              Load {Math.min(CHART_BATCH_STEP, Math.max(0, day.trades.length - (chartCountByDay[day.sortKey] ?? INITIAL_CHART_BATCH)))} more charts
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}

        {dayCards.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#121214] p-10 text-center text-sm text-zinc-500">
            No trades match the current filters.
          </div>
        ) : null}
      </div>

      <DailyReportSheet
        open={drcDate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrcDate(null);
          }
        }}
        date={drcDate}
        trades={filteredTrades}
        onSaved={() => setDrcDate(null)}
      />

      <WeeklyReviewSheet
        open={weekRange !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWeekRange(null);
          }
        }}
        weekStart={weekRange?.start ?? null}
        weekEnd={weekRange?.end ?? null}
        trades={filteredTrades}
        onSaved={() => setWeekRange(null)}
      />
    </motion.div>
  );
}
