import { format } from 'date-fns';
import type { Trade } from '@/lib/types';

export interface DayAggregate {
  grossResult: number;
  netResult: number;
  rTotal: number;
  tradeIds: string[];
}

export interface WeekAggregate {
  grossResult: number;
  netResult: number;
  rTotal: number;
  perDayR: { date: string; r: number }[];
  tradeIds: string[];
}

// Use local-timezone date keys (yyyy-MM-dd) so trades bucket into the same
// day the user sees on TradingCalendar, which also uses date-fns `format`.
function toLocalDateKey(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return format(d, 'yyyy-MM-dd');
}

/**
 * Aggregate all trades that fall on `date` (YYYY-MM-DD, local timezone).
 * R is only counted for trades where initialRisk > 0.
 */
export function aggregateDay(trades: Trade[], date: string): DayAggregate {
  const matching = trades.filter((t) => toLocalDateKey(t.date) === date && !t.isOpen);

  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    grossResult += t.grossPnl;
    netResult += t.netPnl;
    if (t.initialRisk && t.initialRisk > 0) {
      rTotal += t.netPnl / t.initialRisk;
    }
    tradeIds.push(t.id);
  }

  return { grossResult, netResult, rTotal, tradeIds };
}

/**
 * Aggregate all trades in [weekStart, weekEnd] inclusive (YYYY-MM-DD local).
 */
export function aggregateWeek(
  trades: Trade[],
  weekStart: string,
  weekEnd: string,
): WeekAggregate {
  const matching = trades.filter((t) => {
    const key = toLocalDateKey(t.date);
    return key >= weekStart && key <= weekEnd && !t.isOpen;
  });

  const dayRMap: Record<string, number> = {};
  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    const key = toLocalDateKey(t.date);
    grossResult += t.grossPnl;
    netResult += t.netPnl;
    if (t.initialRisk && t.initialRisk > 0) {
      const r = t.netPnl / t.initialRisk;
      rTotal += r;
      dayRMap[key] = (dayRMap[key] ?? 0) + r;
    }
    tradeIds.push(t.id);
  }

  const perDayR = Object.entries(dayRMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => ({ date, r }));

  return { grossResult, netResult, rTotal, perDayR, tradeIds };
}
