'use client';

import { useMemo } from 'react';
import { isSameMonth } from 'date-fns';

import MiniMonthCalendar from '@/components/trading/MiniMonthCalendar';
import { dailyPnlByDate } from '@/lib/journal-aggregates';
import type { Trade } from '@/lib/types';

interface YearOverviewProps {
  trades: Trade[];
  year: number;
  activeMonth: Date;
  onOpenMonth: (monthDate: Date) => void;
}

export default function YearOverview({
  trades,
  year,
  activeMonth,
  onOpenMonth,
}: YearOverviewProps) {
  const pnlByDate = useMemo(() => dailyPnlByDate(trades), [trades]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, m) => new Date(year, m, 1)), [year]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {months.map((month) => (
        <MiniMonthCalendar
          key={month.getMonth()}
          monthDate={month}
          pnlByDate={pnlByDate}
          isActive={isSameMonth(month, activeMonth)}
          onOpen={() => onOpenMonth(month)}
        />
      ))}
    </div>
  );
}
