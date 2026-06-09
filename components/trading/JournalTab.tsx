'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ChevronDown, ChevronRight, LayoutGrid, Search, Tag as TagIcon } from 'lucide-react';
import DailyReportSheet from '@/components/trading/DailyReportSheet';
import TradingCalendar from '@/components/trading/TradingCalendar';
import TradeTable from '@/components/trading/TradeTable';
import WeeklyReviewSheet from '@/components/trading/WeeklyReviewSheet';
import JournalTradeChart from '@/components/trading/JournalTradeChart';
import YearOverview from '@/components/trading/YearOverview';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/ui-trade-utils';
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
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
  onApplyTradeTags: (assignments: Array<{ tradeId: string; tags: string[] }>) => Promise<void>;
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
  const [yearOverview, setYearOverview] = useState(false);
  const [calMonth, setCalMonth] = useState<Date>(() => new Date());
  const [overviewYear, setOverviewYear] = useState<number>(() => new Date().getFullYear());
  // When set, the journal list below the calendar filters down to this date
  // and the matching card auto-expands. Cleared by clicking the same date
  // again or the X chip rendered above the list.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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

  // dayCards already covers every date with trades; when the user picks a
  // date on the calendar we narrow the visible list to just that day. Empty
  // result is fine — it surfaces "No trades match the current filters."
  const displayedDayCards = useMemo(() => {
    if (!selectedDate) return dayCards;
    return dayCards.filter((day) => day.sortKey === selectedDate);
  }, [dayCards, selectedDate]);

  const availableYears = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    for (const trade of filteredTrades) years.add(trade.date.getFullYear());
    return [...years].sort((a, b) => a - b);
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
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search symbol..."
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="w-64 rounded-lg border border-border bg-accent py-1.5 pl-10 pr-4 text-sm transition-colors focus:border-ring/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-card"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 ? (
            <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-accent px-2 py-1">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Set Risk:</span>
                <input
                  type="number"
                  placeholder="$500"
                  value={riskInput}
                  onChange={(event) => onRiskInputChange(event.target.value)}
                  className="w-20 rounded-lg border border-border bg-accent px-2 py-1 text-xs transition-colors focus:border-ring/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-card"
                />
                <button onClick={onApplyRisk} className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary hover:bg-primary/20">
                  Apply
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-border bg-accent px-2 py-1">
                <TagIcon className="h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Add Tag..."
                  value={bulkTagInput}
                  onChange={(event) => onBulkTagInputChange(event.target.value)}
                  className="w-24 rounded-lg border border-border bg-accent px-2 py-1 text-xs transition-colors focus:border-ring/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-card"
                />
                <button onClick={onBulkAddTag} className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary hover:bg-primary/20">
                  Add
                </button>
              </div>
            </div>
          ) : null}
          {!yearOverview ? (
            <button
              type="button"
              onClick={() => {
                setOverviewYear(calMonth.getFullYear());
                setYearOverview(true);
              }}
              className="flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
            >
              <LayoutGrid className="h-4 w-4" /> Year Overview
            </button>
          ) : null}
        </div>
      </div>

      {yearOverview ? (
        <div className="grid grid-cols-3 items-center">
          <button
            type="button"
            onClick={() => {
              setYearOverview(false);
              setCalMonth(new Date());
              setSelectedDate(null);
              setDrcDate(null);
            }}
            className="flex h-8 w-8 items-center justify-center justify-self-start rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Back to calendar"
            title="Back to calendar"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h3 className="justify-self-center text-base font-semibold text-foreground">Year Overview</h3>
          <div className="flex items-center gap-1 justify-self-end rounded-lg border border-border bg-accent p-0.5">
            {availableYears.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => setOverviewYear(year)}
                className={`rounded-md px-3 py-1 text-sm tabular-nums transition-colors ${
                  year === overviewYear
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <TradingCalendar
        trades={filteredTrades}
        month={calMonth}
        onMonthChange={setCalMonth}
        selectedDate={selectedDate}
        onDayClick={(dateKey) => {
          // Toggle: clicking the same date again clears the filter, closes
          // the DRC, and collapses the day card so the journal returns to
          // its prior state. Otherwise set both — DRC opens AND the journal
          // narrows + auto-expands the matching day.
          if (selectedDate === dateKey) {
            setSelectedDate(null);
            setDrcDate(null);
            setExpandedDays((prev) => {
              const next = new Set(prev);
              next.delete(dateKey);
              return next;
            });
          } else {
            setSelectedDate(dateKey);
            setDrcDate(dateKey);
            setExpandedDays((prev) => new Set(prev).add(dateKey));
          }
        }}
        onWeekClick={(start, end) => setWeekRange({ start, end })}
      />

      {yearOverview ? (
        <YearOverview
          trades={filteredTrades}
          year={overviewYear}
          activeMonth={calMonth}
          onOpenMonth={(monthDate) => setCalMonth(monthDate)}
        />
      ) : null}

      <div className="space-y-4">
        {displayedDayCards.map((day) => {
          const expanded = expandedDays.has(day.sortKey);
          const tradedSymbols = [...new Set(day.trades.map((trade) => trade.symbol))];
          return (
            <div key={day.sortKey} className="overflow-hidden rounded-xl border border-border bg-card">
              {/* Header acts like a button (click anywhere expands the day),
                  but is rendered as a div so we can nest the "View Journal
                  Log" button inside — nested <button> would be invalid HTML.
                  role+tabIndex+onKeyDown give it the same keyboard semantics. */}
              {/* 3-column grid: date on the left, View Journal Log dead-
                  center, symbol tags + PnL on the right. Centering it via
                  the grid (rather than a flex margin) keeps the button at
                  the same x across every card automatically. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleDay(day.sortKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleDay(day.sortKey);
                  }
                }}
                className="grid w-full cursor-pointer grid-cols-3 items-center gap-4 border-b border-border p-4 text-left hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <div>
                    <p className="text-base font-semibold">{format(day.date, 'EEEE, MMM dd yyyy')}</p>
                    <p className="text-sm text-muted-foreground">{day.trades.length} trades</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDrcDate(day.sortKey);
                  }}
                  className="justify-self-center rounded-md bg-transparent px-3 py-1.5 text-sm font-medium text-foreground hover:bg-card focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
                >
                  View Journal Log
                </button>

                <div className="flex items-center justify-end">
                  <p className={`text-base font-medium ${day.dailyNetPnl > 0 ? 'text-emerald-400' : day.dailyNetPnl < 0 ? 'text-rose-400' : 'text-foreground'}`}>
                    {formatCurrency(day.dailyNetPnl)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-b border-border bg-accent/50 p-3 text-sm sm:grid-cols-5">
                <div>
                  <p className="text-muted-foreground">Total Trades</p>
                  <p className="font-medium">{day.trades.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Win %</p>
                  <p className="font-medium">{day.winRate.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Commissions</p>
                  <p className="font-medium">{formatCurrency(day.totalCommissions)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">MFE/MAE Ratio</p>
                  <p className="font-medium">{day.mfeMaeRatio == null ? '-' : day.mfeMaeRatio.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tickers</p>
                  <p className="font-medium text-foreground">
                    {tradedSymbols.length > 0 ? tradedSymbols.join(', ') : '-'}
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

                    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trade Replay Charts</p>
                      <div className="space-y-3">
                        {day.trades.slice(0, chartCountByDay[day.sortKey] ?? INITIAL_CHART_BATCH).map((trade) => (
                          <div key={`chart-${trade.id}`} className="space-y-2">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <p className="font-semibold text-foreground">{trade.symbol} ({trade.direction})</p>
                              <p className="font-mono text-muted-foreground">
                                {isCrossDayTrade(trade)
                                  ? `${format(new Date(`${trade.sortKey}T00:00:00`), 'MMM dd')} ${trade.entryTime || '--:--'} → ${format(new Date(`${bucketKey(trade)}T00:00:00`), 'MMM dd')} ${trade.exitTime || '--:--'}`
                                  : `${trade.entryTime || '--:--'} - ${trade.exitTime || '--:--'}`}
                              </p>
                              <Select
                                value={chartTimeframes[trade.id] ?? '5m'}
                                onValueChange={(value) => setChartTimeframes((prev) => ({ ...prev, [trade.id]: value as TradeChartTimeframeKey }))}
                              >
                                <SelectTrigger className="h-7 w-24 bg-accent border-border text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-card border-border text-foreground">
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
                              className="rounded-lg border border-border bg-accent px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
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

        {displayedDayCards.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
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
        globalTags={globalTags}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        onDeleteGlobalTag={onDeleteGlobalTag}
        onTradeClick={onTradeClick}
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
