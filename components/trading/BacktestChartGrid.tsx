'use client';

import { useState } from 'react';

import BacktestChart, { type IndicatorKey } from '@/components/trading/BacktestChart';
import { useChartDrawings, type DrawingTool } from '@/hooks/use-chart-drawings';
import { BACKTEST_FRAME_CONFIG, type BacktestTimeframeKey } from '@/lib/chart-timeframes';
import type { BacktestAction, BacktestActionType } from '@/lib/types';

type ChartSlotId = 'primary' | 'secondary' | 'hourly' | 'daily';

const EXPAND_STORAGE_KEY = 'nexus-backtest-expand-slot';
const KNOWN_SLOT_IDS: readonly ChartSlotId[] = ['primary', 'secondary', 'hourly', 'daily'];

function readPersistedExpandedSlot(): ChartSlotId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(EXPAND_STORAGE_KEY);
    if (!stored) return null;
    return (KNOWN_SLOT_IDS as readonly string[]).includes(stored)
      ? (stored as ChartSlotId)
      : null;
  } catch {
    return null;
  }
}

function writePersistedExpandedSlot(slotId: ChartSlotId | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (slotId === null) {
      window.localStorage.removeItem(EXPAND_STORAGE_KEY);
    } else {
      window.localStorage.setItem(EXPAND_STORAGE_KEY, slotId);
    }
  } catch {
    // Ignore storage errors.
  }
}

type ChartCellConfig = {
  id: ChartSlotId;
  defaultTimeframe: BacktestTimeframeKey;
};

type ChartGridState = {
  scope: string;
  activeDrawingTool: DrawingTool;
  expandedSlotId: ChartSlotId | null;
  timeframesBySlot: Record<ChartSlotId, BacktestTimeframeKey>;
};

const DEFAULT_CELLS: ChartCellConfig[] = [
  { id: 'primary', defaultTimeframe: '5m' },
  { id: 'secondary', defaultTimeframe: '15m' },
  { id: 'hourly', defaultTimeframe: '1h' },
  { id: 'daily', defaultTimeframe: '1D' },
];

function getDefaultSlotTimeframes(): Record<ChartSlotId, BacktestTimeframeKey> {
  return {
    primary: '5m',
    secondary: '15m',
    hourly: '1h',
    daily: '1D',
  };
}

function getDefaultIndicators(timeframe: BacktestTimeframeKey): IndicatorKey[] {
  if (timeframe === '1D') return ['SMA50', 'SMA200'];
  if (timeframe === '1h') return ['EMA20', 'EMA50'];
  return ['VWAP'];
}

interface BacktestChartGridProps {
  ticker: string | null;
  date: string | null;
  onAnchorChange: (newDate: string) => void;
  armedAction: BacktestActionType | null;
  onArmedClick: (payload: { price: number; barTime: string }) => void;
  actions: BacktestAction[];
  currentStop: number | null;
  extraSessionsForward: number;
}

export default function BacktestChartGrid({
  ticker,
  date,
  onAnchorChange,
  armedAction,
  onArmedClick,
  actions,
  currentStop,
  extraSessionsForward,
}: BacktestChartGridProps) {
  const drawingScope = ticker && date ? `${ticker}:${date}:intraday` : 'empty:intraday';
  const [gridState, setGridState] = useState<ChartGridState>({
    scope: drawingScope,
    activeDrawingTool: null,
    expandedSlotId: readPersistedExpandedSlot(),
    timeframesBySlot: getDefaultSlotTimeframes(),
  });
  const currentGridState = gridState.scope === drawingScope
    ? gridState
    : {
      scope: drawingScope,
      activeDrawingTool: null,
      expandedSlotId: readPersistedExpandedSlot(),
      timeframesBySlot: getDefaultSlotTimeframes(),
    };
  const { activeDrawingTool, expandedSlotId, timeframesBySlot } = currentGridState;
  const drawingsController = useChartDrawings(drawingScope, activeDrawingTool, '#ffffff', 1, { persist: false });

  const setActiveDrawingTool = (tool: DrawingTool) => {
    setGridState({
      ...currentGridState,
      activeDrawingTool: tool,
    });
  };

  const toggleExpandedSlot = (slotId: ChartSlotId) => {
    const nextExpanded = currentGridState.expandedSlotId === slotId ? null : slotId;
    writePersistedExpandedSlot(nextExpanded);
    setGridState({
      ...currentGridState,
      expandedSlotId: nextExpanded,
    });
  };

  const setSlotTimeframe = (slotId: ChartSlotId, timeframe: BacktestTimeframeKey) => {
    setGridState({
      ...currentGridState,
      activeDrawingTool: BACKTEST_FRAME_CONFIG[timeframe].intraday ? currentGridState.activeDrawingTool : null,
      timeframesBySlot: {
        ...currentGridState.timeframesBySlot,
        [slotId]: timeframe,
      },
    });
  };

  if (!ticker || !date) {
    return (
      <div className="flex min-h-[520px] items-center justify-center border border-white/10 bg-[#121214] text-sm text-zinc-500">
        Pick a ticker on the right
      </div>
    );
  }

  const visibleCells = expandedSlotId
    ? DEFAULT_CELLS.filter((cell) => cell.id === expandedSlotId)
    : DEFAULT_CELLS;

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
      {visibleCells.map((cell) => {
        const timeframe = timeframesBySlot[cell.id] ?? cell.defaultTimeframe;
        const isIntradayDrawingChart = BACKTEST_FRAME_CONFIG[timeframe].intraday;
        const isExpanded = expandedSlotId === cell.id;

        return (
          <BacktestChart
            key={`${ticker}:${cell.id}:${timeframe}`}
            ticker={ticker}
            anchorDate={date}
            timeframe={timeframe}
            onTimeframeChange={(nextTimeframe) => setSlotTimeframe(cell.id, nextTimeframe)}
            defaultIndicators={getDefaultIndicators(timeframe)}
            onAnchorChange={timeframe === '1D' ? onAnchorChange : undefined}
            armedAction={armedAction}
            onArmedClick={onArmedClick}
            actions={actions}
            currentStop={currentStop}
            drawingsController={isIntradayDrawingChart ? drawingsController : null}
            activeDrawingTool={isIntradayDrawingChart ? activeDrawingTool : null}
            onDrawingToolChange={isIntradayDrawingChart ? setActiveDrawingTool : undefined}
            isExpanded={isExpanded}
            onToggleExpanded={() => toggleExpandedSlot(cell.id)}
            extraSessionsForward={extraSessionsForward}
          />
        );
      })}
    </div>
  );
}
