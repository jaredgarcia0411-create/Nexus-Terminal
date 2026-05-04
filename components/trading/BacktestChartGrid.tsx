'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import BacktestChart, { type IndicatorKey } from '@/components/trading/BacktestChart';
import { normalizeDrawings, useChartDrawings, type DrawingTool } from '@/hooks/use-chart-drawings';
import { BACKTEST_FRAME_CONFIG, type BacktestTimeframeKey } from '@/lib/chart-timeframes';
import type { BacktestAction, BacktestActionType, BacktestChartState } from '@/lib/types';

type ChartSlotId = 'primary' | 'secondary' | 'hourly' | 'daily';

const EXPAND_STORAGE_KEY = 'nexus-backtest-expand-slot';
const GRID_LAYOUT_STORAGE_KEY = 'nexus-backtest-grid-layout';
const KNOWN_SLOT_IDS: readonly ChartSlotId[] = ['primary', 'secondary', 'hourly', 'daily'];
const KNOWN_GRID_LAYOUTS = ['stacked', 'grid2x2'] as const;
type GridLayout = (typeof KNOWN_GRID_LAYOUTS)[number];
const KNOWN_INDICATORS: readonly IndicatorKey[] = [
  'SMA20',
  'SMA50',
  'SMA200',
  'EMA9',
  'EMA20',
  'EMA21',
  'EMA50',
  'VWAP',
  'VOLUME',
  'BB',
  'RSI',
  'ATR',
];

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

function readPersistedGridLayout(): GridLayout {
  if (typeof window === 'undefined') return 'stacked';
  try {
    const stored = window.localStorage.getItem(GRID_LAYOUT_STORAGE_KEY);
    return (KNOWN_GRID_LAYOUTS as readonly string[]).includes(stored ?? '')
      ? (stored as GridLayout)
      : 'stacked';
  } catch {
    return 'stacked';
  }
}

function writePersistedGridLayout(layout: GridLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GRID_LAYOUT_STORAGE_KEY, layout);
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
  indicatorsBySlot: Record<ChartSlotId, IndicatorKey[]>;
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
  if (timeframe === '1D') return ['SMA50', 'SMA200', 'VOLUME'];
  if (timeframe === '1h') return ['EMA20', 'EMA50', 'VOLUME'];
  return ['VWAP', 'VOLUME'];
}

function getDefaultIndicatorsBySlot(
  timeframesBySlot: Record<ChartSlotId, BacktestTimeframeKey>,
): Record<ChartSlotId, IndicatorKey[]> {
  return {
    primary: getDefaultIndicators(timeframesBySlot.primary),
    secondary: getDefaultIndicators(timeframesBySlot.secondary),
    hourly: getDefaultIndicators(timeframesBySlot.hourly),
    daily: getDefaultIndicators(timeframesBySlot.daily),
  };
}

function isIndicatorKey(value: string): value is IndicatorKey {
  return (KNOWN_INDICATORS as readonly string[]).includes(value);
}

function normalizeIndicators(
  loaded: BacktestChartState | null,
  timeframesBySlot: Record<ChartSlotId, BacktestTimeframeKey>,
): Record<ChartSlotId, IndicatorKey[]> {
  const defaults = getDefaultIndicatorsBySlot(timeframesBySlot);
  const rawIndicators = loaded?.indicators;
  if (!rawIndicators) return defaults;

  return {
    primary: Array.isArray(rawIndicators.primary)
      ? rawIndicators.primary.filter(isIndicatorKey)
      : defaults.primary,
    secondary: Array.isArray(rawIndicators.secondary)
      ? rawIndicators.secondary.filter(isIndicatorKey)
      : defaults.secondary,
    hourly: Array.isArray(rawIndicators.hourly)
      ? rawIndicators.hourly.filter(isIndicatorKey)
      : defaults.hourly,
    daily: Array.isArray(rawIndicators.daily)
      ? rawIndicators.daily.filter(isIndicatorKey)
      : defaults.daily,
  };
}

function createGridState(scope: string, loadedChartState: BacktestChartState | null): ChartGridState {
  const timeframesBySlot = getDefaultSlotTimeframes();
  return {
    scope,
    activeDrawingTool: null,
    expandedSlotId: readPersistedExpandedSlot(),
    timeframesBySlot,
    indicatorsBySlot: normalizeIndicators(loadedChartState, timeframesBySlot),
  };
}

function areIndicatorListsEqual(left: readonly IndicatorKey[], right: readonly IndicatorKey[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
  isReadOnly?: boolean;
  loadedChartState?: BacktestChartState | null;
  onChartStateChange?: (state: BacktestChartState) => void;
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
  isReadOnly = false,
  loadedChartState = null,
  onChartStateChange,
}: BacktestChartGridProps) {
  const drawingScope = ticker && date ? `${ticker}:${date}:intraday` : 'empty:intraday';
  const [gridState, setGridState] = useState<ChartGridState>(() => createGridState(drawingScope, null));
  const [gridLayout, setGridLayout] = useState<GridLayout>(() => readPersistedGridLayout());
  const fallbackGridState = useMemo(
    () => createGridState(drawingScope, null),
    [drawingScope],
  );
  const baseGridState = gridState.scope === drawingScope
    ? gridState
    : fallbackGridState;
  const loadedIndicatorsBySlot = useMemo(
    () => normalizeIndicators(loadedChartState, baseGridState.timeframesBySlot),
    [baseGridState.timeframesBySlot, loadedChartState],
  );
  const currentGridState = useMemo(
    () => (
      isReadOnly
        ? {
          ...baseGridState,
          activeDrawingTool: null,
          indicatorsBySlot: loadedIndicatorsBySlot,
        }
        : baseGridState
    ),
    [baseGridState, isReadOnly, loadedIndicatorsBySlot],
  );
  const { activeDrawingTool, expandedSlotId, timeframesBySlot, indicatorsBySlot } = currentGridState;
  const drawingsController = useChartDrawings(drawingScope, activeDrawingTool, '#ffffff', 1, { persist: false });
  const { drawings, replaceAllDrawings } = drawingsController;
  const hydratedChartStateRef = useRef<BacktestChartState | null | undefined>(undefined);
  const hydratedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReadOnly) {
      if (hydratedChartStateRef.current !== undefined) {
        hydratedChartStateRef.current = undefined;
        hydratedScopeRef.current = null;
        replaceAllDrawings([]);
      }
      return;
    }
    if (hydratedChartStateRef.current === loadedChartState && hydratedScopeRef.current === drawingScope) return;

    hydratedChartStateRef.current = loadedChartState;
    hydratedScopeRef.current = drawingScope;
    replaceAllDrawings(normalizeDrawings(loadedChartState?.drawings ?? []));
  }, [drawingScope, isReadOnly, loadedChartState, replaceAllDrawings]);

  useEffect(() => {
    onChartStateChange?.({
      drawings,
      indicators: indicatorsBySlot,
    });
  }, [drawings, indicatorsBySlot, onChartStateChange]);

  const setActiveDrawingTool = (tool: DrawingTool) => {
    if (isReadOnly) return;

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

  const toggleGridLayout = () => {
    setGridLayout((prev) => {
      const next: GridLayout = prev === 'stacked' ? 'grid2x2' : 'stacked';
      writePersistedGridLayout(next);
      return next;
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
      indicatorsBySlot: {
        ...currentGridState.indicatorsBySlot,
        [slotId]: getDefaultIndicators(timeframe),
      },
    });
  };

  const setSlotIndicators = (slotId: ChartSlotId, next: IndicatorKey[]) => {
    if (isReadOnly) return;
    if (areIndicatorListsEqual(currentGridState.indicatorsBySlot[slotId], next)) return;

    setGridState({
      ...currentGridState,
      indicatorsBySlot: {
        ...currentGridState.indicatorsBySlot,
        [slotId]: next,
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
    <div
      className={
        expandedSlotId
          ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden'
          : gridLayout === 'grid2x2'
            ? 'grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 overflow-hidden'
            : 'scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1'
      }
    >
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
            defaultIndicators={indicatorsBySlot[cell.id] ?? getDefaultIndicators(timeframe)}
            onIndicatorsChange={(next) => setSlotIndicators(cell.id, next)}
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
            gridLayout={gridLayout}
            onToggleGridLayout={toggleGridLayout}
            extraSessionsForward={extraSessionsForward}
            isReadOnly={isReadOnly}
          />
        );
      })}
    </div>
  );
}
