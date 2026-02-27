'use client';

import React, { useMemo } from 'react';
import { Trade } from '@/lib/types';
import { formatCurrency, formatR } from '@/lib/trading-utils';
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
import { motion, AnimatePresence } from 'motion/react';

interface TradingCalendarProps {
  trades: Trade[];
}

export default function TradingCalendar({ trades }: TradingCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);

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
      stats[dateKey].pnl += trade.pnl;
      stats[dateKey].trades.push(trade);
      // Ensure trades for the day are sorted descending
      stats[dateKey].trades.sort((a, b) => b.date.getTime() - a.date.getTime());
      if (trade.initialRisk) {
        stats[dateKey].r += trade.pnl / trade.initialRisk;
      }
    });
    return stats;
  }, [trades]);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  // Group days into weeks
  const weeks = useMemo(() => {
    const w: any[] = [];
    let currentWeek: any[] = [];
    
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

  const selectedTrades = selectedDate ? dailyStats[selectedDate]?.trades || [] : [];

  return (
    <div className="space-y-6">
      <div className="bg-[#121214] border border-white/5 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Trading Calendar</h3>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">{format(currentMonth, 'MMMM yyyy')}</span>
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

        <div className="grid grid-cols-8 gap-px bg-white/5 border border-white/5 rounded-xl overflow-hidden">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Weekly'].map((day) => (
            <div key={day} className="bg-[#18181b] py-3 text-center text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
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
                    onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                    className={`min-h-[100px] p-2 bg-[#121214] flex flex-col gap-1 transition-all cursor-pointer relative group ${
                      !isCurrentMonth ? 'opacity-20' : 'hover:bg-white/[0.03]'
                    } ${isToday ? 'ring-1 ring-inset ring-emerald-500/50' : ''} ${
                      isOffDay ? 'bg-white/[0.01]' : ''
                    } ${isSelected ? 'bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/30' : ''}`}
                  >
                    <span className={`text-[10px] font-mono ${isToday ? 'text-emerald-500 font-bold' : 'text-zinc-500'}`}>
                      {format(day, 'd')}
                    </span>
                    
                    {stats && (stats.pnl !== 0 || stats.r !== 0) && (
                      <div className="mt-auto flex flex-col gap-0.5">
                        <div className={`text-[11px] font-bold ${stats.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {stats.pnl >= 0 ? '+' : ''}{formatCurrency(stats.pnl)}
                        </div>
                        <div className={`text-[9px] font-medium opacity-60 ${stats.r >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatR(stats.r)}
                        </div>
                      </div>
                    )}

                    {/* Hover indicator */}
                    <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                );
              })}
              
              {/* Weekly Totals Column */}
              <div className="min-h-[100px] p-2 bg-white/5 flex flex-col justify-center items-center gap-1 border-l border-white/5">
                <div className={`text-xs font-bold ${week.weeklyPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {week.weeklyPnl >= 0 ? '+' : ''}{formatCurrency(week.weeklyPnl)}
                </div>
                <div className={`text-[10px] font-medium opacity-70 ${week.weeklyR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatR(week.weeklyR)}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Selected Date Trades Dropdown/List */}
      <AnimatePresence mode="wait">
        {selectedDate && (
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="bg-[#121214] border border-white/5 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                  Trades for {format(new Date(selectedDate + 'T00:00:00'), 'MMMM d, yyyy')}
                </h4>
                <button 
                  onClick={() => setSelectedDate(null)}
                  className="text-xs text-zinc-500 hover:text-white transition-colors"
                >
                  Close
                </button>
              </div>
              
              <div className="space-y-2">
                {selectedTrades.length > 0 ? (
                  selectedTrades.map((trade) => (
                    <div key={trade.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex items-center gap-4">
                        <span className={`w-1.5 h-8 rounded-full ${trade.direction === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <div>
                          <div className="font-bold text-sm">{trade.symbol}</div>
                          <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">
                            {trade.direction} • {trade.totalQuantity} Shares
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-bold ${trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {formatCurrency(trade.pnl)}
                        </div>
                        {trade.initialRisk && (
                          <div className="text-[10px] text-zinc-500 font-mono">
                            {formatR(trade.pnl / trade.initialRisk)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-zinc-500 text-sm italic">
                    No trades recorded for this day.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
