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
export function toLocalDateKey(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return format(d, 'yyyy-MM-dd');
}

/**
 * The local day key (yyyy-MM-dd) a trade should bucket into for realized PnL.
 * Closed trades bucket on closedAt; callers should exclude open trades before
 * asking for a bucket key.
 */
export function bucketKey(trade: Pick<Trade, 'date' | 'closedAt'>): string {
  const source = trade.closedAt ?? trade.date;
  return toLocalDateKey(source);
}

/**
 * True when a closed trade was opened on one local day and closed on another.
 * Open trades return false because they have no realized close day yet.
 */
export function isCrossDayTrade(
  trade: Pick<Trade, 'date' | 'closedAt' | 'isOpen' | 'sortKey'>,
): boolean {
  if (trade.isOpen) return false;
  return bucketKey(trade) !== trade.sortKey;
}

// Net PnL per calendar day (bucketed by close date) for the mini-month
// calendars. Skips still-open trades.
export function dailyPnlByDate(trades: Trade[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const trade of trades) {
    if (trade.isOpen) continue;
    const key = bucketKey(trade);
    map.set(key, (map.get(key) ?? 0) + trade.netPnl);
  }
  return map;
}

/**
 * R-multiple summed by date (YYYY-MM-DD local). Mirrors dailyPnlByDate but
 * only counts trades with a real initialRisk, matching aggregateDay's rule.
 */
export function dailyRByDate(trades: Trade[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const trade of trades) {
    if (trade.isOpen) continue;
    if (!trade.initialRisk || trade.initialRisk <= 0) continue;
    const key = bucketKey(trade);
    map.set(key, (map.get(key) ?? 0) + trade.netPnl / trade.initialRisk);
  }
  return map;
}

/**
 * Aggregate all trades that fall on `date` (YYYY-MM-DD, local timezone).
 * R is only counted for trades where initialRisk > 0.
 */
export function aggregateDay(trades: Trade[], date: string): DayAggregate {
  const matching = trades.filter((t) => !t.isOpen && bucketKey(t) === date);

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
    if (t.isOpen) return false;
    const key = bucketKey(t);
    return key >= weekStart && key <= weekEnd;
  });

  const dayRMap: Record<string, number> = {};
  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    const key = bucketKey(t);
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
