'use client';

import React, { useMemo } from 'react';
import { Trade } from '@/lib/types';
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
import { formatCurrency, formatR, getPnLColor } from '@/lib/ui-trade-utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { 
  addDays,
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay,
  addMonths,
  subMonths,
  isWeekend
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TradingCalendarProps {
  trades: Trade[];
  onDayClick?: (dateKey: string) => void;
  onWeekClick?: (weekStart: string, weekEnd: string) => void;
  embedded?: boolean;
  // Optional controlled selection. When provided, the calendar uses this for
  // the highlight ring instead of its internal state — letting the parent
  // (e.g. JournalTab's date filter) drive which day looks selected.
  selectedDate?: string | null;
}

type WeekData = {
  days: Date[];
  weeklyPnl: number;
  weeklyR: number;
};

export default function TradingCalendar({
  trades,
  onDayClick,
  onWeekClick,
  embedded = false,
  selectedDate: controlledSelectedDate,
}: TradingCalendarProps) {
  const isMobile = useIsMobile();
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [internalSelectedDate, setInternalSelectedDate] = React.useState<string | null>(null);
  // Prefer the controlled prop when the parent passes one; otherwise fall
  // back to internal state. `undefined` means uncontrolled, `null` means
  // explicitly "no selection."
  const selectedDate = controlledSelectedDate !== undefined ? controlledSelectedDate : internalSelectedDate;

  const { monthStart, monthEnd, startDate, endDate } = useMemo(() => {
    const mStart = startOfMonth(currentMonth);
    const mEnd = endOfMonth(mStart);
    const sDate = startOfWeek(mStart);
    const eDate = endOfWeek(mEnd);
    return { monthStart: mStart, monthEnd: mEnd, startDate: sDate, endDate: eDate };
  }, [currentMonth]);

  const calendarDays = useMemo(() => eachDayOfInterval({
    start: startDate,
    end: endDate,
  }), [startDate, endDate]);

  const dailyStats = useMemo(() => {
    const stats: Record<string, { pnl: number; r: number; trades: Trade[] }> = {};
    trades.forEach((trade) => {
      if (trade.isOpen) return;
      const dateKey = bucketKey(trade);
      if (!stats[dateKey]) {
        stats[dateKey] = { pnl: 0, r: 0, trades: [] };
      }
      stats[dateKey].pnl += trade.netPnl;
      stats[dateKey].trades.push(trade);
      // Sort by entry day descending so the day's trades render newest-first.
      stats[dateKey].trades.sort((a, b) => b.date.getTime() - a.date.getTime());
      if (trade.initialRisk) {
        stats[dateKey].r += trade.netPnl / trade.initialRisk;
      }
    });
    return stats;
  }, [trades]);

  // Cross-day closed trades whose [entry, close] window includes each day.
  const spanMap = useMemo(() => {
    const map: Record<
      string,
      Array<{
        tradeId: string;
        symbol: string;
        netPnl: number;
        entryKey: string;
        closeKey: string;
      }>
    > = {};

    const crossDayTrades = trades
      .filter((trade) => isCrossDayTrade(trade))
      .map((trade) => ({
        tradeId: trade.id,
        symbol: trade.symbol,
        netPnl: trade.netPnl,
        entryKey: trade.sortKey,
        closeKey: bucketKey(trade),
      }))
      .sort((a, b) => a.closeKey.localeCompare(b.closeKey));

    for (const span of crossDayTrades) {
      let cursor = new Date(`${span.entryKey}T00:00:00`);
      const end = new Date(`${span.closeKey}T00:00:00`);
      while (cursor.getTime() <= end.getTime()) {
        const key = format(cursor, 'yyyy-MM-dd');
        if (!map[key]) map[key] = [];
        map[key].push(span);
        cursor = addDays(cursor, 1);
      }
    }

    return map;
  }, [trades]);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  // Group days into weeks
  const weeks = useMemo(() => {
    const w: WeekData[] = [];
    let currentWeek: Date[] = [];
    
    calendarDays.forEach((day, i) => {
      currentWeek.push(day);
      if ((i + 1) % 7 === 0) {
        // Calculate weekly totals
        const weeklyPnl = currentWeek.reduce((sum, d) => {
          const key = format(d, 'yyyy-MM-dd');
          return sum + (dailyStats[key]?.pnl || 0);
        }, 0);
        const weeklyR = currentWeek.reduce((sum, d) => {
          const key = format(d, 'yyyy-MM-dd');
          return sum + (dailyStats[key]?.r || 0);
        }, 0);
        
        w.push({ days: currentWeek, weeklyPnl, weeklyR });
        currentWeek = [];
      }
    });
    return w;
  }, [calendarDays, dailyStats]);

  // Sum R only for days that actually fall in the visible month — the
  // calendar grid includes leading/trailing days from neighboring months,
  // and we don't want those leaking into the month total.
  const monthlyR = useMemo(() => {
    return calendarDays.reduce((sum, day) => {
      if (!isSameMonth(day, monthStart)) return sum;
      const key = format(day, 'yyyy-MM-dd');
      return sum + (dailyStats[key]?.r || 0);
    }, 0);
  }, [calendarDays, monthStart, dailyStats]);

  return (
    <div className="space-y-6">
      <div>
        <div className={`flex items-center justify-between ${embedded ? 'mb-4' : 'mb-8'}`}>
          {embedded ? <div /> : (
            <h3 className="text-base font-medium text-foreground">Trading Calendar</h3>
          )}
          <div className="flex items-center gap-4">
            <span
              className={`text-base font-medium tabular-nums ${
                monthlyR > 0 ? 'text-emerald-400' : monthlyR < 0 ? 'text-rose-400' : 'text-foreground'
              }`}
            >
              {formatR(monthlyR)}
            </span>
            <span className="text-base font-medium">{format(currentMonth, 'MMMM yyyy')}</span>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1 hover:bg-accent rounded-md transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={nextMonth} className="p-1 hover:bg-accent rounded-md transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className={`grid gap-px overflow-hidden rounded-xl border border-border bg-accent ${isMobile ? 'grid-cols-7' : 'grid-cols-8'}`}>
          {(isMobile ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Weekly']).map((day) => (
            <div key={day} className="bg-card py-3 text-center text-[11px] font-bold text-muted-foreground tracking-widest">
              {day}
            </div>
          ))}

          {weeks.map((week, weekIdx) => (
            <React.Fragment key={weekIdx}>
              {week.days.map((day: Date, dayIdx: number) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const stats = dailyStats[dateKey];
                const isCurrentMonth = isSameMonth(day, monthStart);
                const isToday = isSameDay(day, new Date());
                const isOffDay = isWeekend(day);
                const isSelected = selectedDate === dateKey;

                return (
                  <div 
                    key={dayIdx} 
                    onClick={() => {
                      if (onDayClick) {
                        onDayClick(dateKey);
                      } else {
                        setInternalSelectedDate(isSelected ? null : dateKey);
                      }
                    }}
                    className={`${isMobile ? 'min-h-[60px] p-1.5' : 'min-h-[100px] p-2'} relative flex cursor-pointer flex-col gap-1 bg-card transition-all group ${
                      !isCurrentMonth ? 'opacity-20' : 'hover:bg-accent/80'
                    } ${isToday ? 'ring-1 ring-inset ring-white/50' : ''} ${
                      isOffDay ? 'bg-accent/40' : ''
                    } ${isSelected ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : ''}`}
                  >
                    <span className={`${isMobile ? 'text-[12px]' : 'text-[13px]'} font-mono ${isToday ? 'text-foreground font-bold' : 'text-muted-foreground'}`}>
                      {format(day, 'd')}
                    </span>

                    {(() => {
                      const spans = spanMap[dateKey];
                      if (!spans || spans.length === 0) return null;
                      const visible = spans.slice(0, 2);
                      const overflow = spans.length - visible.length;
                      return (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {visible.map((span) => {
                            const isStart = span.entryKey === dateKey;
                            const isEnd = span.closeKey === dateKey;
                            const color =
                              span.netPnl > 0
                                ? 'bg-emerald-500/50'
                                : span.netPnl < 0
                                  ? 'bg-rose-500/50'
                                  : 'bg-muted/40';
                            const rounded =
                              isStart && isEnd
                                ? 'rounded-full'
                                : isStart
                                  ? 'rounded-l-full'
                                  : isEnd
                                    ? 'rounded-r-full'
                                    : '';
                            const entryLabel = format(new Date(`${span.entryKey}T00:00:00`), 'MMM dd');
                            const closeLabel = format(new Date(`${span.closeKey}T00:00:00`), 'MMM dd');
                            return (
                              <div
                                key={span.tradeId}
                                className={`h-[3px] ${color} ${rounded}`}
                                title={`${span.symbol} • opened ${entryLabel}, closed ${closeLabel}`}
                              />
                            );
                          })}
                          {overflow > 0 ? (
                            <span className="text-[9px] leading-none text-muted-foreground">
                              +{overflow}
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}

                    {stats && (stats.pnl !== 0 || stats.r !== 0) && (
                      <div className="mt-auto flex flex-col gap-0.5">
                        <div className={`${isMobile ? 'text-[13px]' : 'text-[14px]'} font-bold ${getPnLColor(stats.pnl)}`}>
                          {stats.pnl >= 0 ? '+' : ''}{formatCurrency(stats.pnl)}
                        </div>
                        <div className={`${isMobile ? 'text-[12px]' : 'text-[13px]'} font-medium opacity-60 ${stats.r > 0 ? 'text-emerald-400' : stats.r < 0 ? 'text-rose-400' : 'text-foreground'}`}>
                          {formatR(stats.r)}
                        </div>
                      </div>
                    )}

                    {/* Hover indicator */}
                    <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                );
              })}
              
              {!isMobile ? (
                <div
                  className={`min-h-[100px] border-l border-border bg-accent p-2 ${onWeekClick ? 'cursor-pointer hover:bg-accent/80 transition-colors' : ''}`}
                  onClick={() => {
                    if (!onWeekClick) return;
                    const weekStartDate = week.days[0];
                    const weekEndDate = week.days[week.days.length - 1];
                    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    onWeekClick(fmt(weekStartDate), fmt(weekEndDate));
                  }}
                >
                  <div className="flex h-full flex-col items-center justify-center gap-1">
                    <div className={`text-[14px] font-bold ${getPnLColor(week.weeklyPnl)}`}>
                      {week.weeklyPnl >= 0 ? '+' : ''}{formatCurrency(week.weeklyPnl)}
                    </div>
                    <div className={`text-[13px] font-medium opacity-70 ${week.weeklyR > 0 ? 'text-emerald-400' : week.weeklyR < 0 ? 'text-rose-400' : 'text-foreground'}`}>
                      {formatR(week.weeklyR)}
                    </div>
                    {onWeekClick && (
                      <div className="text-[9px] text-muted-foreground uppercase tracking-widest mt-1">Review</div>
                    )}
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
