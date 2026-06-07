'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import BacktestChartGrid from '@/components/trading/BacktestChartGrid';
import BacktestPlaceOrderDialog, { type BacktestOrderDraft } from '@/components/trading/BacktestPlaceOrderDialog';
import BacktestSimPanel from '@/components/trading/BacktestSimPanel';
import BacktestTradeMenu from '@/components/trading/BacktestTradeMenu';
import { Button } from '@/components/ui/button';
import { useBacktestSession } from '@/hooks/use-backtest-session';
import type { BacktestActionType, BacktestChartState } from '@/lib/types';

const CHARTS_RIGHT_COLLAPSED_KEY = 'nexus.charts.rightCollapsed';

type ActiveBacktestSummary = {
  id: string;
  name: string;
  userId: string;
};

interface BacktestChartWorkspaceProps {
  ticker: string | null;
  date: string | null;
  currentUserId: string | null;
  backtestId?: string | null;
  sheetRowId?: string | null;
  autoLoadReviewId?: string | null;
  activeBacktest?: ActiveBacktestSummary | null;
  onAnchorChange?: (date: string) => void;
  headerLeft?: ReactNode;
  toolbarLeft?: ReactNode;
  renderRightPanel?: (simPanel: ReactNode) => ReactNode;
}

function getInitialRiskDollars() {
  if (typeof window === 'undefined') return 100;

  try {
    const stored = Number(localStorage.getItem('nexus-default-risk'));
    return Number.isFinite(stored) && stored > 0 ? stored : 100;
  } catch {
    return 100;
  }
}

function getInitialRightCollapsed(): boolean {
  // SSR safety: window is undefined on the server. Default to collapsed so the
  // first paint matches the persisted-collapsed common case.
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(CHARTS_RIGHT_COLLAPSED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export default function BacktestChartWorkspace({
  ticker,
  date,
  currentUserId,
  backtestId = null,
  sheetRowId = null,
  autoLoadReviewId = null,
  activeBacktest = null,
  onAnchorChange,
  headerLeft,
  toolbarLeft,
  renderRightPanel,
}: BacktestChartWorkspaceProps) {
  const [rightCollapsed, setRightCollapsed] = useState(getInitialRightCollapsed);

  // Persist collapse state so the panel stays the way the user left it across
  // tab switches and reloads. Effect-based sync (rather than wrapping the
  // setter) keeps the toggle call site simple.
  useEffect(() => {
    try {
      localStorage.setItem(CHARTS_RIGHT_COLLAPSED_KEY, String(rightCollapsed));
    } catch {
      // Ignore storage failures — non-critical preference.
    }
  }, [rightCollapsed]);
  const [riskDollars, setRiskDollars] = useState(getInitialRiskDollars);
  const [armedAction, setArmedAction] = useState<BacktestActionType | null>(null);
  const [pendingOrder, setPendingOrder] = useState<BacktestOrderDraft | null>(null);
  const [extraSessionsForward, setExtraSessionsForward] = useState(0);
  const latestChartStateRef = useRef<BacktestChartState>({
    drawings: { intraday: [], higher: [] },
    indicators: { intraday: {}, higher: {} },
  });

  const selected = ticker && date ? { ticker, date } : null;

  const sessionState = useBacktestSession({
    ticker,
    date,
    riskDollars,
    backtestId,
    sheetRowId,
    autoLoadReviewId,
  });

  useEffect(() => {
    if (sessionState.isReadOnly) return;
    latestChartStateRef.current = {
      drawings: { intraday: [], higher: [] },
      indicators: { intraday: {}, higher: {} },
    };
  }, [sessionState.session?.id, sessionState.isReadOnly]);

  const handleChartStateChange = useCallback((nextChartState: BacktestChartState) => {
    latestChartStateRef.current = nextChartState;
  }, []);

  useHotkeys('esc', () => {
    setArmedAction(null);
    setPendingOrder(null);
  });

  const effectiveRiskDollars = sessionState.effectiveRiskDollars;
  const chartGridKey = `${selected?.ticker ?? 'empty'}:${selected?.date ?? 'empty'}:${
    sessionState.isReadOnly ? `review:${sessionState.session?.id ?? 'none'}` : 'active'
  }`;

  const updateRisk = useCallback(async (nextRisk: number) => {
    const previousRisk = riskDollars;
    setRiskDollars(nextRisk);
    try {
      localStorage.setItem('nexus-default-risk', String(nextRisk));
    } catch {
      // Ignore storage failures.
    }
    try {
      await sessionState.updateRisk(nextRisk);
    } catch (error) {
      setRiskDollars(previousRisk);
      try {
        localStorage.setItem('nexus-default-risk', String(previousRisk));
      } catch {
        // Ignore storage failures.
      }
      throw error;
    }
  }, [riskDollars, sessionState]);

  const placeAction = useCallback(async (input: {
    actionType: BacktestActionType;
    price: number;
    shares: number;
    stopPrice: number | null;
    barTime: string;
  }) => {
    await sessionState.placeAction(input);
    setArmedAction(null);
    setPendingOrder(null);
  }, [sessionState]);

  const handleArmedClick = useCallback((payload: { price: number; barTime: string }) => {
    setArmedAction((current) => {
      if (!current) return current;
      setPendingOrder({
        actionType: current,
        price: payload.price,
        barTime: payload.barTime,
      });
      return current;
    });
  }, []);

  const handleAnchorChange = useCallback((newDate: string) => {
    setExtraSessionsForward(0);
    onAnchorChange?.(newDate);
  }, [onAnchorChange]);

  const simPanel = (
    <BacktestSimPanel
      ticker={selected?.ticker ?? null}
      date={selected?.date ?? null}
      riskDollars={effectiveRiskDollars}
      activeBacktest={activeBacktest}
      currentUserId={sessionState.currentUserId ?? currentUserId}
      session={sessionState.session}
      actions={sessionState.actions}
      position={sessionState.position}
      reviews={sessionState.reviews}
      isLoading={sessionState.isLoading}
      isMutating={sessionState.isMutating}
      isReadOnly={sessionState.isReadOnly}
      error={sessionState.error}
      onRiskCommit={updateRisk}
      onUndoLast={sessionState.undoLast}
      onClear={sessionState.clear}
      onSaveReview={(label, notes) => sessionState.saveReview(label, notes, latestChartStateRef.current)}
      onLoadReview={async (reviewId) => {
        setArmedAction(null);
        setPendingOrder(null);
        await sessionState.loadReview(reviewId);
      }}
      onDeleteReview={async (reviewId) => {
        setArmedAction(null);
        setPendingOrder(null);
        await sessionState.deleteReview(reviewId);
      }}
    />
  );

  return (
    <>
      <div
        className={
          rightCollapsed
            ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] transition-[grid-template-columns] duration-300'
            : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_220px] transition-[grid-template-columns] duration-300 xl:grid-cols-[minmax(0,1fr)_280px]'
        }
      >
        <main className="flex min-h-0 min-w-0 flex-col gap-0 overflow-hidden pr-2">
          <div className="grid h-7 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-1 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              {headerLeft}
            </div>

            <div className="flex min-w-0 items-center justify-center gap-2">
              {selected ? (
                <>
                  <span className="font-mono text-base font-semibold leading-none text-foreground">{selected.ticker}</span>
                  <span className="font-mono text-sm leading-none tabular-nums text-muted-foreground">{selected.date}</span>
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-end pr-1">
              <button
                type="button"
                onClick={() => setRightCollapsed((current) => !current)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                title={rightCollapsed ? 'Expand panel' : 'Collapse panel'}
                aria-label={rightCollapsed ? 'Expand panel' : 'Collapse panel'}
              >
                {rightCollapsed ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="grid h-10 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-border px-1">
            {toolbarLeft}

            <div />

            <div className="flex items-center justify-end gap-2">
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={!selected || extraSessionsForward <= 0}
                  onClick={() => setExtraSessionsForward((current) => Math.max(0, current - 1))}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  title="Remove one forward day"
                  aria-label="Remove one forward day"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-9 text-center font-mono text-xs tabular-nums text-muted-foreground">
                  +{extraSessionsForward}D
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={!selected}
                  onClick={() => setExtraSessionsForward((current) => current + 1)}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  title="Add one forward day"
                  aria-label="Add one forward day"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              {!sessionState.isReadOnly ? (
                <BacktestTradeMenu
                  disabled={!selected}
                  direction={sessionState.position.direction}
                  armedAction={armedAction}
                  onArm={setArmedAction}
                />
              ) : null}
            </div>
          </div>

          {armedAction ? (
            <div className="flex h-9 shrink-0 items-center justify-between border border-primary/20 bg-primary/8 px-3">
              <span className="text-sm text-primary">
                Click chart to place {armedAction.replace('_', ' ')} entry. ESC to cancel.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setArmedAction(null)}
                className="border border-border bg-accent text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Cancel
              </Button>
            </div>
          ) : null}

          <BacktestChartGrid
            key={chartGridKey}
            ticker={selected?.ticker ?? null}
            date={selected?.date ?? null}
            onAnchorChange={handleAnchorChange}
            armedAction={sessionState.isReadOnly ? null : armedAction}
            onArmedClick={handleArmedClick}
            actions={sessionState.actions}
            currentStop={sessionState.position.stop ?? sessionState.position.lastSetStop}
            extraSessionsForward={extraSessionsForward}
            isReadOnly={sessionState.isReadOnly}
            loadedChartState={sessionState.session?.chartState ?? null}
            onChartStateChange={handleChartStateChange}
          />
        </main>

        {!rightCollapsed ? (
          renderRightPanel ? (
            renderRightPanel(simPanel)
          ) : (
            <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border bg-background">
              <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{simPanel}</div>
            </aside>
          )
        ) : null}
      </div>

      <BacktestPlaceOrderDialog
        open={pendingOrder != null}
        order={pendingOrder}
        position={sessionState.position}
        riskDollars={effectiveRiskDollars}
        onOpenChange={(open) => {
          if (!open) {
            setPendingOrder(null);
            setArmedAction(null);
          }
        }}
        onPlace={placeAction}
      />
    </>
  );
}
