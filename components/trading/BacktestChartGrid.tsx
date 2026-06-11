'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import BacktestChart, { type ChartView, type IndicatorKey } from '@/components/trading/BacktestChart';
import {
  fetchChartLibrary,
  normalizeDrawings,
  putChartLibraryEntry,
  useChartDrawings,
  type Drawing,
  type DrawingTool,
} from '@/hooks/use-chart-drawings';
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
  if (timeframe === '1D' || timeframe === '1W' || timeframe === '1M') {
    return ['EMA9', 'SMA50', 'SMA200', 'VOLUME'];
  }
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

type BucketedChartState = {
  intraday: { drawings: Drawing[]; indicators: Record<string, string[]> };
  higher: { drawings: Drawing[]; indicators: Record<string, string[]> };
};

function emptyBucketedChartState(): BucketedChartState {
  return {
    intraday: { drawings: [], indicators: {} },
    higher: { drawings: [], indicators: {} },
  };
}

export function normalizeChartState(loaded: BacktestChartState | null): BucketedChartState {
  if (!loaded) return emptyBucketedChartState();

  if (Array.isArray(loaded.drawings)) {
    return {
      intraday: {
        drawings: normalizeDrawings(loaded.drawings),
        indicators: (loaded.indicators as Record<string, string[]>) ?? {},
      },
      higher: { drawings: [], indicators: {} },
    };
  }

  const drawings = loaded.drawings && !Array.isArray(loaded.drawings) ? loaded.drawings : {};
  const rawIndicators = loaded.indicators as { intraday?: unknown; higher?: unknown } | undefined;
  const indicators = {
    intraday: rawIndicators?.intraday
      && typeof rawIndicators.intraday === 'object'
      && !Array.isArray(rawIndicators.intraday)
      ? rawIndicators.intraday as Record<string, string[]>
      : {},
    higher: rawIndicators?.higher
      && typeof rawIndicators.higher === 'object'
      && !Array.isArray(rawIndicators.higher)
      ? rawIndicators.higher as Record<string, string[]>
      : {},
  };

  return {
    intraday: {
      drawings: normalizeDrawings(drawings.intraday ?? []),
      indicators: indicators.intraday ?? {},
    },
    higher: {
      drawings: normalizeDrawings(drawings.higher ?? []),
      indicators: indicators.higher ?? {},
    },
  };
}

function getBucketForTimeframe(timeframe: BacktestTimeframeKey): 'intraday' | 'higher' {
  return BACKTEST_FRAME_CONFIG[timeframe].intraday ? 'intraday' : 'higher';
}

function coerceIndicatorsForSlot(
  raw: string[] | undefined,
  timeframe: BacktestTimeframeKey,
): IndicatorKey[] {
  return raw && raw.every(isIndicatorKey)
    ? raw
    : getDefaultIndicators(timeframe);
}

function normalizeIndicators(
  loaded: BacktestChartState | null,
  timeframesBySlot: Record<ChartSlotId, BacktestTimeframeKey>,
): Record<ChartSlotId, IndicatorKey[]> {
  const normalized = normalizeChartState(loaded);
  return {
    primary: coerceIndicatorsForSlot(
      normalized[getBucketForTimeframe(timeframesBySlot.primary)].indicators.primary,
      timeframesBySlot.primary,
    ),
    secondary: coerceIndicatorsForSlot(
      normalized[getBucketForTimeframe(timeframesBySlot.secondary)].indicators.secondary,
      timeframesBySlot.secondary,
    ),
    hourly: coerceIndicatorsForSlot(
      normalized[getBucketForTimeframe(timeframesBySlot.hourly)].indicators.hourly,
      timeframesBySlot.hourly,
    ),
    daily: coerceIndicatorsForSlot(
      normalized[getBucketForTimeframe(timeframesBySlot.daily)].indicators.daily,
      timeframesBySlot.daily,
    ),
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
  const gridScope = ticker ? `${ticker}:chart-grid` : 'empty:chart-grid';
  const intradayScope = ticker ? `${ticker}:intraday` : 'empty:intraday';
  const higherScope = ticker ? `${ticker}:higher` : 'empty:higher';
  const [gridState, setGridState] = useState<ChartGridState>(() => createGridState(gridScope, null));
  const [gridLayout, setGridLayout] = useState<GridLayout>(() => readPersistedGridLayout());
  const [libraryIndicators, setLibraryIndicators] = useState<{
    intraday: Record<string, string[]>;
    higher: Record<string, string[]>;
  }>({ intraday: {}, higher: {} });
  const fallbackGridState = useMemo(
    () => createGridState(gridScope, null),
    [gridScope],
  );
  const baseGridState = gridState.scope === gridScope
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
  const bucketedIndicators = useMemo(() => {
    const intraday = { ...libraryIndicators.intraday };
    const higher = { ...libraryIndicators.higher };
    for (const slotId of KNOWN_SLOT_IDS) {
      const timeframe = currentGridState.timeframesBySlot[slotId];
      const list = currentGridState.indicatorsBySlot[slotId] ?? [];
      if (getBucketForTimeframe(timeframe) === 'intraday') {
        intraday[slotId] = list;
      } else {
        higher[slotId] = list;
      }
    }
    return { intraday, higher };
  }, [currentGridState.indicatorsBySlot, currentGridState.timeframesBySlot, libraryIndicators]);
  const intradayController = useChartDrawings(intradayScope, activeDrawingTool, '#ffffff', 1, { persist: false });
  const higherController = useChartDrawings(higherScope, activeDrawingTool, '#ffffff', 1, { persist: false });
  const { drawings: intradayDrawings, replaceAllDrawings: replaceIntradayDrawings } = intradayController;
  const { drawings: higherDrawings, replaceAllDrawings: replaceHigherDrawings } = higherController;
  const hydratedChartStateRef = useRef<BacktestChartState | null | undefined>(undefined);
  const hydratedScopeRef = useRef<string | null>(null);
  const hasHydratedLibraryRef = useRef(false);
  const skipNextPersistRef = useRef({ intraday: false, higher: false });

  useEffect(() => {
    hasHydratedLibraryRef.current = false;
    skipNextPersistRef.current = { intraday: false, higher: false };
  }, [ticker]);

  useEffect(() => {
    if (isReadOnly) return;
    if (!ticker) return;

    let cancelled = false;
    hasHydratedLibraryRef.current = false;
    void (async () => {
      const snapshot = await fetchChartLibrary(ticker);
      if (cancelled) return;
      skipNextPersistRef.current = { intraday: true, higher: true };
      replaceIntradayDrawings(snapshot.intraday.drawings);
      replaceHigherDrawings(snapshot.higher.drawings);
      setLibraryIndicators({
        intraday: snapshot.intraday.indicators,
        higher: snapshot.higher.indicators,
      });
      setGridState((prev) => {
        const nextIndicators = { ...prev.indicatorsBySlot };
        for (const slotId of KNOWN_SLOT_IDS) {
          const timeframe = prev.timeframesBySlot[slotId];
          const bucket = getBucketForTimeframe(timeframe);
          const fromLibrary = bucket === 'intraday'
            ? snapshot.intraday.indicators[slotId]
            : snapshot.higher.indicators[slotId];
          nextIndicators[slotId] = coerceIndicatorsForSlot(fromLibrary, timeframe);
        }
        return { ...prev, indicatorsBySlot: nextIndicators };
      });
      hasHydratedLibraryRef.current = true;
    })();

    return () => { cancelled = true; };
  }, [
    isReadOnly,
    replaceHigherDrawings,
    replaceIntradayDrawings,
    ticker,
  ]);

  useEffect(() => {
    if (!isReadOnly) {
      if (hydratedChartStateRef.current !== undefined) {
        hydratedChartStateRef.current = undefined;
        hydratedScopeRef.current = null;
        replaceIntradayDrawings([]);
        replaceHigherDrawings([]);
      }
      return;
    }
    if (hydratedChartStateRef.current === loadedChartState && hydratedScopeRef.current === gridScope) return;

    hydratedChartStateRef.current = loadedChartState;
    hydratedScopeRef.current = gridScope;
    const normalized = normalizeChartState(loadedChartState);
    replaceIntradayDrawings(normalized.intraday.drawings);
    replaceHigherDrawings(normalized.higher.drawings);
  }, [
    gridScope,
    isReadOnly,
    loadedChartState,
    replaceHigherDrawings,
    replaceIntradayDrawings,
  ]);

  useEffect(() => {
    onChartStateChange?.({
      drawings: {
        intraday: intradayDrawings,
        higher: higherDrawings,
      },
      indicators: bucketedIndicators,
    });
  }, [bucketedIndicators, higherDrawings, intradayDrawings, onChartStateChange]);

  useEffect(() => {
    if (isReadOnly) return;
    if (!ticker) return;
    if (!hasHydratedLibraryRef.current) return;
    if (skipNextPersistRef.current.intraday) {
      skipNextPersistRef.current.intraday = false;
      return;
    }

    void putChartLibraryEntry(ticker, 'intraday', {
      drawings: intradayDrawings,
      indicators: bucketedIndicators.intraday,
    });
  }, [bucketedIndicators.intraday, intradayDrawings, isReadOnly, ticker]);

  useEffect(() => {
    if (isReadOnly) return;
    if (!ticker) return;
    if (!hasHydratedLibraryRef.current) return;
    if (skipNextPersistRef.current.higher) {
      skipNextPersistRef.current.higher = false;
      return;
    }

    void putChartLibraryEntry(ticker, 'higher', {
      drawings: higherDrawings,
      indicators: bucketedIndicators.higher,
    });
  }, [bucketedIndicators.higher, higherDrawings, isReadOnly, ticker]);

  const setActiveDrawingTool = (tool: DrawingTool) => {
    if (isReadOnly) return;

    setGridState({
      ...currentGridState,
      activeDrawingTool: tool,
    });
  };

  // Switch a chart's layout. 'single' expands just that slot; 'stacked'/'grid2x2'
  // clear any expanded slot and set the shared multi-chart layout. Both pieces of
  // state persist to localStorage so each user keeps their last view.
  const selectView = (slotId: ChartSlotId, view: ChartView) => {
    if (view === 'single') {
      writePersistedExpandedSlot(slotId);
      setGridState({ ...currentGridState, expandedSlotId: slotId });
      return;
    }
    writePersistedExpandedSlot(null);
    writePersistedGridLayout(view);
    setGridLayout(view);
    if (currentGridState.expandedSlotId !== null) {
      setGridState({ ...currentGridState, expandedSlotId: null });
    }
  };

  const setSlotTimeframe = (slotId: ChartSlotId, timeframe: BacktestTimeframeKey) => {
    const previousTimeframe = currentGridState.timeframesBySlot[slotId];
    const previousBucket = getBucketForTimeframe(previousTimeframe);
    const bucket = getBucketForTimeframe(timeframe);
    const readOnlySnapshot = isReadOnly ? normalizeChartState(loadedChartState) : null;
    const savedForSlot = readOnlySnapshot
      ? readOnlySnapshot[bucket].indicators[slotId]
      : bucket === 'intraday'
        ? libraryIndicators.intraday[slotId]
        : libraryIndicators.higher[slotId];
    const nextIndicators = coerceIndicatorsForSlot(savedForSlot, timeframe);

    if (!isReadOnly) {
      setLibraryIndicators((prev) => ({
        intraday: {
          ...prev.intraday,
          ...(previousBucket === 'intraday'
            ? { [slotId]: currentGridState.indicatorsBySlot[slotId] ?? getDefaultIndicators(previousTimeframe) }
            : {}),
          ...(bucket === 'intraday' ? { [slotId]: nextIndicators } : {}),
        },
        higher: {
          ...prev.higher,
          ...(previousBucket === 'higher'
            ? { [slotId]: currentGridState.indicatorsBySlot[slotId] ?? getDefaultIndicators(previousTimeframe) }
            : {}),
          ...(bucket === 'higher' ? { [slotId]: nextIndicators } : {}),
        },
      }));
    }
    setGridState({
      ...currentGridState,
      activeDrawingTool: currentGridState.activeDrawingTool,
      timeframesBySlot: {
        ...currentGridState.timeframesBySlot,
        [slotId]: timeframe,
      },
      indicatorsBySlot: {
        ...currentGridState.indicatorsBySlot,
        [slotId]: nextIndicators,
      },
    });
  };

  const setSlotIndicators = (slotId: ChartSlotId, next: IndicatorKey[]) => {
    if (isReadOnly) return;
    if (areIndicatorListsEqual(currentGridState.indicatorsBySlot[slotId], next)) return;

    const bucket = getBucketForTimeframe(currentGridState.timeframesBySlot[slotId]);
    setLibraryIndicators((prev) => ({
      ...prev,
      [bucket]: {
        ...prev[bucket],
        [slotId]: next,
      },
    }));
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
      <div className="flex min-h-[520px] items-center justify-center border border-border bg-card text-sm text-muted-foreground">
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
            drawingsController={isIntradayDrawingChart ? intradayController : higherController}
            activeDrawingTool={activeDrawingTool}
            onDrawingToolChange={setActiveDrawingTool}
            chartView={isExpanded ? 'single' : gridLayout}
            onSelectView={(view) => selectView(cell.id, view)}
            extraSessionsForward={extraSessionsForward}
            isReadOnly={isReadOnly}
          />
        );
      })}
    </div>
  );
}
