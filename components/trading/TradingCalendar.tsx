'use client';

import React, { useMemo } from 'react';
import { Trade } from '@/lib/types';
import { formatCurrency, formatR, getPnLColor } from '@/lib/trading-utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { 
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
      const dateKey = format(new Date(trade.date), 'yyyy-MM-dd');
      if (!stats[dateKey]) {
        stats[dateKey] = { pnl: 0, r: 0, trades: [] };
      }
      stats[dateKey].pnl += trade.netPnl;
      stats[dateKey].trades.push(trade);
      // Ensure trades for the day are sorted descending
      stats[dateKey].trades.sort((a, b) => b.date.getTime() - a.date.getTime());
      if (trade.initialRisk) {
        stats[dateKey].r += trade.netPnl / trade.initialRisk;
      }
    });
    return stats;
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
            <h3 className="text-base font-medium text-white">Trading Calendar</h3>
          )}
          <div className="flex items-center gap-4">
            <span
              className={`text-base font-medium tabular-nums ${
                monthlyR > 0 ? 'text-emerald-400' : monthlyR < 0 ? 'text-rose-400' : 'text-white'
              }`}
            >
              {formatR(monthlyR)}
            </span>
            <span className="text-base font-medium">{format(currentMonth, 'MMMM yyyy')}</span>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1 hover:bg-white/5 rounded-md transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={nextMonth} className="p-1 hover:bg-white/5 rounded-md transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className={`grid gap-px overflow-hidden rounded-xl border border-white/5 bg-white/5 ${isMobile ? 'grid-cols-7' : 'grid-cols-8'}`}>
          {(isMobile ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Weekly']).map((day) => (
            <div key={day} className="bg-[#18181b] py-3 text-center text-[10px] font-bold text-zinc-500 tracking-widest">
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
                    className={`${isMobile ? 'min-h-[60px] p-1.5' : 'min-h-[100px] p-2'} relative flex cursor-pointer flex-col gap-1 bg-[#121214] transition-all group ${
                      !isCurrentMonth ? 'opacity-20' : 'hover:bg-white/[0.03]'
                    } ${isToday ? 'ring-1 ring-inset ring-white/50' : ''} ${
                      isOffDay ? 'bg-white/[0.01]' : ''
                    } ${isSelected ? 'bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/30' : ''}`}
                  >
                    <span className={`${isMobile ? 'text-[12px]' : 'text-[13px]'} font-mono ${isToday ? 'text-white font-bold' : 'text-zinc-500'}`}>
                      {format(day, 'd')}
                    </span>

                    {stats && (stats.pnl !== 0 || stats.r !== 0) && (
                      <div className="mt-auto flex flex-col gap-0.5">
                        <div className={`${isMobile ? 'text-[13px]' : 'text-[14px]'} font-bold ${getPnLColor(stats.pnl)}`}>
                          {stats.pnl >= 0 ? '+' : ''}{formatCurrency(stats.pnl)}
                        </div>
                        <div className={`${isMobile ? 'text-[12px]' : 'text-[13px]'} font-medium opacity-60 ${stats.r > 0 ? 'text-emerald-400' : stats.r < 0 ? 'text-rose-400' : 'text-white'}`}>
                          {formatR(stats.r)}
                        </div>
                      </div>
                    )}

                    {/* Hover indicator */}
                    <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                );
              })}
              
              {!isMobile ? (
                <div
                  className={`min-h-[100px] border-l border-white/5 bg-white/5 p-2 ${onWeekClick ? 'cursor-pointer hover:bg-white/[0.08] transition-colors' : ''}`}
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
                    <div className={`text-[13px] font-medium opacity-70 ${week.weeklyR > 0 ? 'text-emerald-400' : week.weeklyR < 0 ? 'text-rose-400' : 'text-white'}`}>
                      {formatR(week.weeklyR)}
                    </div>
                    {onWeekClick && (
                      <div className="text-[9px] text-zinc-600 uppercase tracking-widest mt-1">Review</div>
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
