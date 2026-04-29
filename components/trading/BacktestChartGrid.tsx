'use client';

import BacktestChart, { type IndicatorKey } from '@/components/trading/BacktestChart';
import type { BacktestTimeframeKey } from '@/lib/chart-timeframes';
import type { BacktestAction, BacktestActionType } from '@/lib/types';

type ChartCellConfig = {
  timeframe: BacktestTimeframeKey;
  indicators: IndicatorKey[];
};

const DEFAULT_CELLS: ChartCellConfig[] = [
  { timeframe: '5m', indicators: ['VWAP'] },
  { timeframe: '15m', indicators: ['VWAP'] },
  { timeframe: '1h', indicators: ['EMA20', 'EMA50'] },
  { timeframe: '1D', indicators: ['SMA50', 'SMA200'] },
];

interface BacktestChartGridProps {
  ticker: string | null;
  date: string | null;
  onAnchorChange: (newDate: string) => void;
  armedAction: BacktestActionType | null;
  onArmedClick: (payload: { price: number; barTime: string }) => void;
  actions: BacktestAction[];
  currentStop: number | null;
}

export default function BacktestChartGrid({
  ticker,
  date,
  onAnchorChange,
  armedAction,
  onArmedClick,
  actions,
  currentStop,
}: BacktestChartGridProps) {
  if (!ticker || !date) {
    return (
      <div className="flex min-h-[520px] items-center justify-center border border-white/10 bg-[#121214] text-sm text-zinc-500">
        Pick a ticker on the right
      </div>
    );
  }

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
      {DEFAULT_CELLS.map((cell) => (
        <BacktestChart
          key={`${ticker}:${cell.timeframe}`}
          ticker={ticker}
          anchorDate={date}
          defaultTimeframe={cell.timeframe}
          defaultIndicators={cell.indicators}
          onAnchorChange={cell.timeframe === '1D' ? onAnchorChange : undefined}
          armedAction={armedAction}
          onArmedClick={onArmedClick}
          actions={actions}
          currentStop={currentStop}
        />
      ))}
    </div>
  );
}
