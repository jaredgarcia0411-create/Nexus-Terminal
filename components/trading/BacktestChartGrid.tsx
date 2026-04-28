'use client';

import BacktestChart, { type IndicatorKey } from '@/components/trading/BacktestChart';
import type { BacktestTimeframeKey } from '@/lib/chart-timeframes';

type ChartCellConfig = {
  timeframe: BacktestTimeframeKey;
  indicators: IndicatorKey[];
};

const DEFAULT_CELLS: ChartCellConfig[] = [
  { timeframe: '5m', indicators: ['EMA9', 'EMA20', 'VWAP'] },
  { timeframe: '15m', indicators: ['EMA9', 'EMA20', 'VWAP'] },
  { timeframe: '1h', indicators: ['EMA20', 'EMA50'] },
  { timeframe: '1D', indicators: ['SMA50', 'SMA200'] },
];

interface BacktestChartGridProps {
  ticker: string | null;
  date: string | null;
  onAnchorChange: (newDate: string) => void;
}

export default function BacktestChartGrid({ ticker, date, onAnchorChange }: BacktestChartGridProps) {
  if (!ticker || !date) {
    return (
      <div className="flex min-h-[520px] items-center justify-center border border-white/10 bg-[#121214] text-sm text-zinc-500">
        Pick a ticker on the right
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-2 xl:grid-rows-2">
      {DEFAULT_CELLS.map((cell) => (
        <BacktestChart
          key={`${ticker}:${cell.timeframe}`}
          ticker={ticker}
          anchorDate={date}
          defaultTimeframe={cell.timeframe}
          defaultIndicators={cell.indicators}
          onAnchorChange={cell.timeframe === '1D' ? onAnchorChange : undefined}
        />
      ))}
    </div>
  );
}
