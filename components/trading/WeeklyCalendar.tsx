'use client';

import { useMemo } from 'react';
import { eachDayOfInterval, endOfWeek, format, isSameDay, isToday, startOfWeek } from 'date-fns';
import { formatCurrency, getPnLColor } from '@/lib/trading-utils';
import { Trade } from '@/lib/types';

interface WeeklyCalendarProps {
  trades: Trade[];
}

interface DayBucket {
  date: Date;
  pnl: number;
  count: number;
}

export default function WeeklyCalendar({ trades }: WeeklyCalendarProps) {
  const weekDays = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 0 });
    const end = endOfWeek(start, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, []);

  const dailyStats = useMemo<Record<string, DayBucket>>(() => {
    const map = new Map<string, DayBucket>();

    trades.forEach((trade) => {
      const key = format(new Date(trade.date), 'yyyy-MM-dd');
      const bucket = map.get(key) ?? { date: new Date(trade.date), pnl: 0, count: 0 };
      bucket.pnl += trade.netPnl;
      bucket.count += 1;
      bucket.date = new Date(trade.date);
      map.set(key, bucket);
    });

    return Object.fromEntries(
      weekDays.map((day) => {
        const key = format(day, 'yyyy-MM-dd');
        const bucket = map.get(key);
        return [
          key,
          bucket ?? {
            date: day,
            pnl: 0,
            count: 0,
          },
        ];
      }),
    );
  }, [trades, weekDays]);

  return (
    <div className="rounded-2xl border border-white/5 bg-[#121214] p-4 sm:p-6">
      <h3 className="mb-4 text-lg font-semibold text-white">{format(weekDays[0], 'MMM yyyy')}</h3>
      <div className="grid grid-cols-7 gap-3">
        {weekDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const bucket = dailyStats[key];
          const isCurrentDay = isToday(day);
          const pnl = bucket?.pnl ?? 0;
          const count = bucket?.count ?? 0;

          return (
            <div
              key={key}
              className={`rounded-xl border p-4 flex flex-col gap-1 min-h-[120px] ${
                isCurrentDay
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-white/10 bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-white">{format(day, 'd')}</span>
                <span className="text-xs font-medium text-zinc-500">{format(day, 'EEE')}</span>
              </div>
              <div className="mt-auto">
                <span className={`text-sm font-bold ${getPnLColor(pnl)}`}>{formatCurrency(pnl)}</span>
                <span className="text-[10px] text-zinc-500 block">{count} trades</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
