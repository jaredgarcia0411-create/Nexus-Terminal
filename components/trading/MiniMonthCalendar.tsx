'use client';

import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

interface MiniMonthCalendarProps {
  monthDate: Date;
  pnlByDate: Map<string, number>;
  isActive: boolean;
  onOpen: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function MiniMonthCalendar({
  monthDate,
  pnlByDate,
  isActive,
  onOpen,
}: MiniMonthCalendarProps) {
  const monthStart = startOfMonth(monthDate);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart),
    end: endOfWeek(endOfMonth(monthStart)),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-foreground">{format(monthDate, 'MMMM, yyyy')}</span>
        <button
          type="button"
          onClick={onOpen}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            isActive
              ? 'border border-primary/40 bg-primary/10 text-primary'
              : 'bg-accent text-muted-foreground hover:bg-accent/80 hover:text-foreground'
          }`}
        >
          {isActive ? 'Active' : 'Open'}
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="text-center text-[10px] font-bold tracking-widest text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const pnl = pnlByDate.get(key) ?? 0;
          const inMonth = isSameMonth(day, monthStart);
          const tone = !inMonth
            ? 'text-muted-foreground/30'
            : pnl > 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : pnl < 0
                ? 'bg-rose-500/10 text-rose-400'
                : 'text-foreground';

          return (
            <div
              key={key}
              className={`flex h-8 items-center justify-center rounded text-sm font-mono tabular-nums ${tone}`}
            >
              {format(day, 'd')}
            </div>
          );
        })}
      </div>
    </div>
  );
}
