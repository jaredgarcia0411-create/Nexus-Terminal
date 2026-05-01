'use client';

import { useState } from 'react';

import BacktestChart, { type IndicatorKey } from '@/components/trading/BacktestChart';
import { useChartDrawings, type DrawingTool } from '@/hooks/use-chart-drawings';
import type { BacktestTimeframeKey } from '@/lib/chart-timeframes';
import type { BacktestAction, BacktestActionType } from '@/lib/types';

type ChartCellConfig = {
  timeframe: BacktestTimeframeKey;
  indicators: IndicatorKey[];
};

type ChartGridState = {
  scope: string;
  activeDrawingTool: DrawingTool;
  expandedTimeframe: BacktestTimeframeKey | null;
  extraSessionsForward: number;
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
  const drawingScope = ticker && date ? `${ticker}:${date}:intraday` : 'empty:intraday';
  const [gridState, setGridState] = useState<ChartGridState>({
    scope: drawingScope,
    activeDrawingTool: null,
    expandedTimeframe: null,
    extraSessionsForward: 0,
  });
  const currentGridState = gridState.scope === drawingScope
    ? gridState
    : {
      scope: drawingScope,
      activeDrawingTool: null,
      expandedTimeframe: null,
      extraSessionsForward: 0,
    };
  const { activeDrawingTool, expandedTimeframe, extraSessionsForward } = currentGridState;
  const drawingsController = useChartDrawings(drawingScope, activeDrawingTool, '#ffffff', 1, { persist: false });

  const setActiveDrawingTool = (tool: DrawingTool) => {
    setGridState({
      ...currentGridState,
      activeDrawingTool: tool,
    });
  };

  const toggleExpandedTimeframe = (timeframe: BacktestTimeframeKey) => {
    setGridState({
      ...currentGridState,
      expandedTimeframe: currentGridState.expandedTimeframe === timeframe ? null : timeframe,
      extraSessionsForward: 0,
    });
  };

  const setExtraSessionsForward = (next: number) => {
    setGridState({
      ...currentGridState,
      extraSessionsForward: next,
    });
  };

  if (!ticker || !date) {
    return (
      <div className="flex min-h-[520px] items-center justify-center border border-white/10 bg-[#121214] text-sm text-zinc-500">
        Pick a ticker on the right
      </div>
    );
  }

  const visibleCells = expandedTimeframe
    ? DEFAULT_CELLS.filter((cell) => cell.timeframe === expandedTimeframe)
    : DEFAULT_CELLS;

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
      {visibleCells.map((cell) => {
        const isIntradayDrawingChart = cell.timeframe === '5m' || cell.timeframe === '15m' || cell.timeframe === '1h';
        const isExpanded = expandedTimeframe === cell.timeframe;

        return (
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
            drawingsController={isIntradayDrawingChart ? drawingsController : null}
            activeDrawingTool={isIntradayDrawingChart ? activeDrawingTool : null}
            onDrawingToolChange={isIntradayDrawingChart ? setActiveDrawingTool : undefined}
            isExpanded={isExpanded}
            onToggleExpanded={() => toggleExpandedTimeframe(cell.timeframe)}
            extraSessionsForward={isExpanded ? extraSessionsForward : 0}
            onExtraSessionsForwardChange={setExtraSessionsForward}
          />
        );
      })}
    </div>
  );
}
