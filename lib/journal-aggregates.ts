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

/**
 * Aggregate all trades that fall on `date` (YYYY-MM-DD).
 * R is only counted for trades where initialRisk > 0.
 */
export function aggregateDay(trades: Trade[], date: string): DayAggregate {
  const matching = trades.filter((t) => {
    // trade.date is a Date object after normalizeTrade
    const key = t.date instanceof Date
      ? t.date.toISOString().slice(0, 10)
      : String(t.date).slice(0, 10);
    return key === date;
  });

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
 * Aggregate all trades in [weekStart, weekEnd] inclusive (YYYY-MM-DD strings).
 */
export function aggregateWeek(
  trades: Trade[],
  weekStart: string,
  weekEnd: string,
): WeekAggregate {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(weekEnd + 'T23:59:59');

  const matching = trades.filter((t) => {
    const d = t.date instanceof Date ? t.date : new Date(t.date);
    return d >= start && d <= end;
  });

  // Build per-day R map
  const dayRMap: Record<string, number> = {};
  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    const d = t.date instanceof Date ? t.date : new Date(t.date);
    const key = d.toISOString().slice(0, 10);
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
