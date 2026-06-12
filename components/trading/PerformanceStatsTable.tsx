'use client';

import { useMemo } from 'react';
import { ArrowUpRight, Info } from 'lucide-react';
import { bucketKey } from '@/lib/journal-aggregates';
import { formatCurrency } from '@/lib/ui-trade-utils';
import { Trade } from '@/lib/types';

interface PerformanceStatsTableProps {
  trades: Trade[];
  onTradeClick: (trade: Trade) => void;
}

interface HoldInfo {
  trade: Trade;
  minutes: number;
}

type StatsCell = {
  label: string;
  value: string;
  clickTrade?: Trade;
};

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x) * t;
  return sign * y;
}

function parseTradeMinutes(date: Date, time: string): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(seconds)) {
    return null;
  }

  const parsed = new Date(date);
  parsed.setHours(hours, minutes, seconds, 0);
  return parsed.getTime();
}

function formatHoldTime(minutes: number | null): string {
  if (minutes == null) return '-';
  if (minutes === 0) return '0';

  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const remainingMinutes = Math.floor(absMinutes % 60);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const hourRemainder = hours % 24;
    if (hourRemainder === 0) {
      return `about ${days} day${days === 1 ? '' : 's'}`;
    }
    return `about ${days} day${days === 1 ? '' : 's'} ${hourRemainder}h`;
  }

  if (hours === 0) {
    return `about ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
  }

  return `about ${hours} hour${hours === 1 ? '' : 's'}${remainingMinutes > 0 ? ` ${remainingMinutes}m` : ''}`;
}

function parseHoldMinutes(trade: Trade): number | null {
  const entryTime = parseTradeMinutes(trade.date, trade.entryTime);
  const exitTime = parseTradeMinutes(trade.date, trade.exitTime);
  if (entryTime == null || exitTime == null) {
    return null;
  }

  const delta = (exitTime - entryTime) / 60000;
  if (!Number.isFinite(delta) || delta < 0) {
    return null;
  }

  return delta;
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = calculateMean(values);
  const variance =
    values.reduce((sum, value) => {
      const delta = value - mean;
      return sum + delta * delta;
    }, 0) / values.length;

  return Math.sqrt(variance);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export default function PerformanceStatsTable({ trades, onTradeClick }: PerformanceStatsTableProps) {
  const openCount = useMemo(() => trades.filter((trade) => trade.isOpen).length, [trades]);

  const stats = useMemo(() => {
    if (trades.length === 0) {
      return [] as StatsCell[];
    }

    const closedTrades = trades.filter((trade) => !trade.isOpen);
    if (closedTrades.length === 0) {
      return [] as StatsCell[];
    }

    const totalGainLoss = closedTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
    const winningTrades = closedTrades.filter((trade) => trade.netPnl > 0);
    const losingTrades = closedTrades.filter((trade) => trade.netPnl < 0);
    const scratchTrades = closedTrades.filter((trade) => Math.abs(trade.netPnl) === 0);

    const dailyTotals = new Map<string, number>();
    const dailyVolume = new Map<string, number>();
    for (const trade of closedTrades) {
      const key = bucketKey(trade);
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + trade.netPnl);
      dailyVolume.set(key, (dailyVolume.get(key) ?? 0) + trade.totalQuantity);
    }
    const dailyValues = Array.from(dailyTotals.values());
    const dailyVolumeValues = Array.from(dailyVolume.values());

    const averageDailyGainLoss = dailyValues.length > 0 ? dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length : 0;
    const averageDailyVolume = dailyVolumeValues.length > 0 ? dailyVolumeValues.reduce((sum, value) => sum + value, 0) / dailyVolumeValues.length : 0;

    const totalQuantity = closedTrades.reduce((sum, trade) => sum + trade.totalQuantity, 0);
    const averagePerShareGainLoss = totalQuantity > 0 ? totalGainLoss / totalQuantity : 0;
    const averageTradeGainLoss = closedTrades.length > 0 ? totalGainLoss / closedTrades.length : 0;
    const averageWinningTrade = winningTrades.length > 0 ? winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length : 0;
    const averageLosingTrade = losingTrades.length > 0 ? losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length : 0;

    const winningCount = winningTrades.length;
    const losingCount = losingTrades.length;
    const winPercent = closedTrades.length > 0 ? (winningCount / closedTrades.length) * 100 : 0;
    const lossPercent = closedTrades.length > 0 ? (losingCount / closedTrades.length) * 100 : 0;

    const holdTradePairs = closedTrades
      .map((trade) => {
        const minutes = parseHoldMinutes(trade);
        return minutes == null ? null : { trade, minutes };
      })
      .filter((entry): entry is HoldInfo => entry !== null);

    const winningHoldTrades = holdTradePairs.filter((entry) => entry.trade.netPnl > 0);
    const losingHoldTrades = holdTradePairs.filter((entry) => entry.trade.netPnl < 0);
    const scratchHoldTrades = holdTradePairs.filter((entry) => Math.abs(entry.trade.netPnl) <= 1);

    const averageScratchHoldTime = scratchHoldTrades.length > 0 ? calculateMean(scratchHoldTrades.map((entry) => entry.minutes)) : null;
    const averageWinningHoldTime = winningHoldTrades.length > 0 ? calculateMean(winningHoldTrades.map((entry) => entry.minutes)) : null;
    const averageLosingHoldTime = losingHoldTrades.length > 0 ? calculateMean(losingHoldTrades.map((entry) => entry.minutes)) : null;

    const sortedByDate = [...closedTrades].sort((a, b) => {
      const aKey = bucketKey(a);
      const bKey = bucketKey(b);
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      // Tie-break by exit time within the same close day so streaks are
      // chronologically ordered by realization, not entry.
      return a.exitTime.localeCompare(b.exitTime);
    });
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let maxConsecutiveWinTrade: Trade | null = null;
    let maxConsecutiveLossTrade: Trade | null = null;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    for (const trade of sortedByDate) {
      if (trade.netPnl > 0) {
        currentWinStreak += 1;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) {
          maxConsecutiveWins = currentWinStreak;
          maxConsecutiveWinTrade = trade;
        }
      } else if (trade.netPnl < 0) {
        currentLossStreak += 1;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentLossStreak;
          maxConsecutiveLossTrade = trade;
        }
      } else {
        currentWinStreak = 0;
        currentLossStreak = 0;
      }
    }

    const largestGainTrade = closedTrades.slice().sort((a, b) => b.netPnl - a.netPnl)[0] ?? null;
    const largestLossTrade = closedTrades.slice().sort((a, b) => a.netPnl - b.netPnl)[0] ?? null;

    const pnlValues = closedTrades.map((trade) => trade.netPnl);
    const meanPnl = calculateMean(pnlValues);
    const pnlStdDev = calculateStdDev(pnlValues);
    const sqn = pnlValues.length > 0 && pnlStdDev > 0 ? (Math.sqrt(pnlValues.length) * meanPnl) / pnlStdDev : 0;

    const grossProfit = winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

    const pWin = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;
    const zDenom = Math.sqrt(Math.max(pWin * (1 - pWin), 1e-8));
    const zScore = closedTrades.length > 1 ? (pWin - 0.5) * Math.sqrt(closedTrades.length) / zDenom : 0;
    const randomChance = clampProbability(1 - erf(Math.abs(zScore) / Math.SQRT2));

    const avgWinAbs =
      winningTrades.length > 0 ? winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length : 0;
    const avgLossAbs =
      losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length) : 0;
    const winProb = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;
    const kellyPercentage =
      avgLossAbs > 0 && winProb > 0 && winProb < 1 ? winProb - (1 - winProb) / (avgWinAbs / avgLossAbs) : 0;

    const kRatio = pWin > 0 && pnlStdDev > 0 ? (avgWinAbs * winProb) / pnlStdDev : 0;

    const totalCommissions = closedTrades.reduce((sum, trade) => sum + (trade.commission ?? 0), 0);
    const totalFees = closedTrades.reduce((sum, trade) => sum + (trade.fees ?? 0), 0);

    const maeValues = closedTrades
      .map((trade) => trade.mae)
      .filter((mae): mae is number => typeof mae === 'number' && Number.isFinite(mae));
    const mfeValues = closedTrades
      .map((trade) => trade.mfe)
      .filter((mfe): mfe is number => typeof mfe === 'number' && Number.isFinite(mfe));

    const avgMae = maeValues.length > 0 ? maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length : 0;
    const avgMfe = mfeValues.length > 0 ? mfeValues.reduce((sum, value) => sum + value, 0) / mfeValues.length : 0;

    const cells: StatsCell[] = [
      { label: 'Total Gain/Loss', value: formatCurrency(totalGainLoss) },
      { label: 'Largest Gain', value: largestGainTrade ? formatCurrency(largestGainTrade.netPnl) : '-', clickTrade: largestGainTrade ?? undefined },
      { label: 'Largest Loss', value: largestLossTrade ? formatCurrency(largestLossTrade.netPnl) : '-', clickTrade: largestLossTrade ?? undefined },
      { label: 'Average Daily Gain/Loss', value: formatCurrency(averageDailyGainLoss) },
      { label: 'Average Daily Volume', value: averageDailyVolume.toFixed(0) },
      { label: 'Average Per Share Gain/Loss', value: formatCurrency(averagePerShareGainLoss) },
      { label: 'Average Trade Gain/Loss', value: formatCurrency(averageTradeGainLoss) },
      { label: 'Average Winning Trade', value: winningTrades.length > 0 ? formatCurrency(averageWinningTrade) : '-' },
      { label: 'Average Losing Trade', value: losingTrades.length > 0 ? formatCurrency(averageLosingTrade) : '-' },
      { label: 'Total Number of Trades', value: `${closedTrades.length}` },
      { label: 'Number of Winning Trades', value: `${winningCount} (${formatPercent(winPercent)})` },
      { label: 'Number of Losing Trades', value: `${losingCount} (${formatPercent(lossPercent)})` },
      { label: 'Average Hold Time (Scratch)', value: formatHoldTime(scratchTrades.length > 0 ? averageScratchHoldTime : null) },
      { label: 'Average Hold Time (Winning)', value: formatHoldTime(averageWinningHoldTime) },
      { label: 'Average Hold Time (Losing)', value: formatHoldTime(averageLosingHoldTime) },
      { label: 'Number of Scratch Trades', value: `${scratchTrades.length}` },
      {
        label: 'Max Consecutive Wins',
        value: maxConsecutiveWins > 0 ? String(maxConsecutiveWins) : '-',
        clickTrade: maxConsecutiveWinTrade ?? undefined,
      },
      {
        label: 'Max Consecutive Losses',
        value: maxConsecutiveLosses > 0 ? String(maxConsecutiveLosses) : '-',
        clickTrade: maxConsecutiveLossTrade ?? undefined,
      },
      { label: 'Trade P/L Std Dev', value: Number.isFinite(pnlStdDev) ? formatCurrency(pnlStdDev) : '-' },
      { label: 'System Quality Number', value: Number.isFinite(sqn) ? sqn.toFixed(2) : '-' },
      { label: 'Probability of Random Chance', value: `${(randomChance * 100).toFixed(1)}%` },
      { label: 'Kelly Percentage', value: `${(kellyPercentage * 100).toFixed(2)}%` },
      { label: 'K-Ratio', value: Number.isFinite(kRatio) ? kRatio.toFixed(2) : '-' },
      { label: 'Profit Factor', value: profitFactor === Number.POSITIVE_INFINITY ? '∞' : profitFactor.toFixed(2) },
      { label: 'Total Commissions', value: formatCurrency(totalCommissions) },
      { label: 'Total Fees', value: formatCurrency(totalFees) },
      { label: 'Average MAE', value: formatCurrency(avgMae) },
      { label: 'Average MFE', value: formatCurrency(avgMfe) },
      {
        label: 'Avg Risk per Trade',
        value: (() => {
          const riskedTrades = closedTrades.filter((trade) => trade.initialRisk);
          if (riskedTrades.length === 0) return '-';
          const avg = riskedTrades.reduce((acc, trade) => acc + (trade.initialRisk ?? 0), 0) / riskedTrades.length;
          return formatCurrency(avg);
        })(),
      },
      {
        label: 'Total R-Multiple',
        value: (() => {
          const riskedTrades = closedTrades.filter((trade) => trade.initialRisk);
          if (riskedTrades.length === 0) return '-';
          const total = riskedTrades.reduce((acc, trade) => acc + trade.netPnl / (trade.initialRisk ?? 1), 0);
          return `${total.toFixed(2)}R`;
        })(),
      },
    ];

    while (cells.length < 30) {
      cells.push({ label: '', value: '' });
    }

    return cells.slice(0, 30);
  }, [trades]);

  if (trades.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-center text-sm text-muted-foreground">Import trades to see statistics</p>
      </div>
    );
  }

  const rows: StatsCell[][] = Array.from({ length: 10 }, (_, rowIndex) => stats.slice(rowIndex * 3, rowIndex * 3 + 3));

  return (
    <div className="rounded-2xl border border-border bg-card p-6 tabular-nums">
      <div className="mb-6 flex items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Stats</h3>
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        {openCount > 0 ? (
          <span className="ml-auto text-xs text-amber-400 font-medium">
            {openCount} open position{openCount === 1 ? '' : 's'} excluded
          </span>
        ) : null}
      </div>

      <div className="divide-y divide-border">
        {rows.map((row, rowIndex) => (
          <div key={`row-${rowIndex}`} className="grid grid-cols-3 gap-4 py-3 text-sm sm:text-xs">
            {row.map((cell, cellIndex) => (
              <div key={`cell-${rowIndex}-${cellIndex}`} className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{cell.label}</span>
                <div className="flex items-center gap-1">
                  <span className={`text-sm font-medium ${cell.value.startsWith('-') ? 'text-rose-500' : 'text-foreground'}`}>
                    {cell.value}
                  </span>
                  {cell.clickTrade ? (
                    <button
                      onClick={() => onTradeClick(cell.clickTrade as Trade)}
                      className="text-primary hover:text-primary/80"
                      type="button"
                      title={`Open trade ${cell.clickTrade?.symbol}`}
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
