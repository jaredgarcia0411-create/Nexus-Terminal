'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useHotkeys } from 'react-hotkeys-hook';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

import BacktestChartGrid from '@/components/trading/BacktestChartGrid';
import BacktestManagerView from '@/components/trading/BacktestManagerView';
import BacktestPlaceOrderDialog, { type BacktestOrderDraft } from '@/components/trading/BacktestPlaceOrderDialog';
import BacktestSimPanel from '@/components/trading/BacktestSimPanel';
import BacktestStatsView from '@/components/trading/BacktestStatsView';
import BacktestTradeMenu from '@/components/trading/BacktestTradeMenu';
import BacktestingSidebar, { type BacktestSelection } from '@/components/trading/BacktestingSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBacktestSession } from '@/hooks/use-backtest-session';
import type { BacktestActionType, BacktestChartState } from '@/lib/types';

type ActiveBacktestSummary = {
  id: string | null;
  name: string | null;
  userId: string | null;
};

type View =
  | { kind: 'manager' }
  | ({
    kind: 'chart';
    ticker: string | null;
    date: string | null;
  } & ActiveBacktestSummary)
  | { kind: 'stats'; backtestId: string };

function getInitialRiskDollars() {
  if (typeof window === 'undefined') return 100;

  try {
    const stored = Number(localStorage.getItem('nexus-default-risk'));
    return Number.isFinite(stored) && stored > 0 ? stored : 100;
  } catch {
    return 100;
  }
}

// Charts tab opens directly into the chart workspace. On first paint we don't
// have access to localStorage (SSR), so we start with a placeholder view and
// hydrate the saved ticker (or fall back to AAPL on today's date) inside a
// mount effect below.
const CHARTS_LAST_TICKER_KEY = 'nexus.charts.lastTicker';

function getPersistedTicker(): string {
  if (typeof window === 'undefined') return 'AAPL';
  try {
    const stored = localStorage.getItem(CHARTS_LAST_TICKER_KEY);
    if (stored && /^[A-Z0-9.\-^]{1,10}$/.test(stored)) return stored;
  } catch {
    // Ignore storage failures.
  }
  return 'AAPL';
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BacktestingTab() {
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string | null } | undefined)?.id ?? null;

  // Default to the chart workspace (not the manager) so the Charts tab feels
  // like a charting area first. The actual ticker/date is hydrated from
  // localStorage in the mount effect below — we can't read it during initial
  // render because that runs on the server.
  const [view, setView] = useState<View>({
    kind: 'chart',
    ticker: null,
    date: null,
    id: null,
    name: null,
    userId: null,
  });
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [riskDollars, setRiskDollars] = useState(getInitialRiskDollars);
  const [armedAction, setArmedAction] = useState<BacktestActionType | null>(null);
  const [pendingOrder, setPendingOrder] = useState<BacktestOrderDraft | null>(null);
  const [extraSessionsForward, setExtraSessionsForward] = useState(0);
  const [lookupTicker, setLookupTicker] = useState('');
  const [lookupDate, setLookupDate] = useState('');
  const latestChartStateRef = useRef<BacktestChartState>({ drawings: [], indicators: {} });
  // When the user clicks Launch Chart with a known recent review, we set this
  // to the review id. The effect below picks it up once the sessions GET
  // resolves and drops the user into read-only review mode automatically.
  const [autoLoadReviewId, setAutoLoadReviewId] = useState<string | null>(null);

  const selected = view.kind === 'chart' && view.ticker && view.date
    ? { ticker: view.ticker, date: view.date }
    : null;

  const resetTransientState = useCallback(() => {
    setArmedAction(null);
    setPendingOrder(null);
    setExtraSessionsForward(0);
  }, []);

  const openChartView = useCallback((
    selection: BacktestSelection | null,
    activeBacktest: ActiveBacktestSummary = { id: null, name: null, userId: null },
    reviewToAutoLoad: string | null = null,
  ) => {
    resetTransientState();
    setAutoLoadReviewId(reviewToAutoLoad);
    setView({
      kind: 'chart',
      ticker: selection?.ticker ?? null,
      date: selection?.date ?? null,
      id: activeBacktest.id,
      name: activeBacktest.name,
      userId: activeBacktest.userId,
    });
  }, [resetTransientState]);

  const handleSelect = useCallback((nextSelection: BacktestSelection) => {
    const activeBacktest =
      view.kind === 'chart'
        ? { id: view.id, name: view.name, userId: view.userId }
        : { id: null, name: null, userId: null };

    // Manually picking a new (ticker, date) cancels any pending auto-load —
    // the user has signaled they want a fresh chart, not the review we queued.
    setAutoLoadReviewId(null);
    openChartView(nextSelection, activeBacktest);

    // Persist the ticker so the Charts tab reopens to the same symbol next
    // session. Failures are non-fatal (private browsing etc.).
    try {
      localStorage.setItem(CHARTS_LAST_TICKER_KEY, nextSelection.ticker);
    } catch {
      // Ignore storage failures.
    }
  }, [openChartView, view]);

  // On first mount of the Charts tab, hydrate to the persisted ticker (or
  // AAPL) on today's date. We only run this once — if the user navigates
  // away and the user-id-less placeholder view ever re-mounts, the same
  // effect fires again. That's fine: it produces a deterministic default.
  useEffect(() => {
    if (view.kind !== 'chart' || view.ticker || view.date) return;
    handleSelect({ ticker: getPersistedTicker(), date: todayIsoDate() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLookupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = lookupTicker.trim().toUpperCase();
    if (!ticker) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(lookupDate)
      ? lookupDate
      : new Date().toISOString().slice(0, 10);
    handleSelect({ ticker, date });
  };

  const lookupValid = lookupTicker.trim().length > 0;

  const handleAnchorChange = useCallback((newDate: string) => {
    setExtraSessionsForward(0);
    setView((current) => (
      current.kind === 'chart'
        ? { ...current, date: newDate }
        : current
    ));
  }, []);

  const sessionState = useBacktestSession({
    ticker: selected?.ticker ?? null,
    date: selected?.date ?? null,
    riskDollars,
    backtestId: view.kind === 'chart' ? view.id : null,
    autoLoadReviewId,
  });

  useEffect(() => {
    if (sessionState.isReadOnly) return;
    latestChartStateRef.current = { drawings: [], indicators: {} };
  }, [sessionState.session?.id, sessionState.isReadOnly]);

  const handleChartStateChange = useCallback((nextChartState: BacktestChartState) => {
    latestChartStateRef.current = nextChartState;
  }, []);

  useHotkeys('esc', () => {
    setArmedAction(null);
    setPendingOrder(null);
  }, { preventDefault: true });

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

  return (
    <motion.div
      key="backtesting"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] overflow-hidden bg-[#0A0A0B]"
    >
      {view.kind === 'manager' ? (
        <BacktestManagerView
          onLaunchChart={(backtest, autoLoadReview) => openChartView(
            autoLoadReview ? { ticker: autoLoadReview.ticker, date: autoLoadReview.date } : null,
            backtest
              ? { id: backtest.id, name: backtest.name, userId: backtest.ownerId }
              : { id: null, name: null, userId: null },
            autoLoadReview?.id ?? null,
          )}
          onViewStats={(backtestId) => setView({ kind: 'stats', backtestId })}
        />
      ) : null}

      {view.kind === 'stats' ? (
        <BacktestStatsView
          backtestId={view.backtestId}
          onBack={() => setView({ kind: 'manager' })}
          onOpenInChart={(ticker, date, activeBacktest) => openChartView({ ticker, date }, activeBacktest)}
          currentUserId={currentUserId}
        />
      ) : null}

      {view.kind === 'chart' ? (
        <div
          className={
            rightCollapsed
              ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] transition-[grid-template-columns] duration-300'
              : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_220px] transition-[grid-template-columns] duration-300 xl:grid-cols-[minmax(0,1fr)_280px]'
          }
        >
          <main className="flex min-h-0 min-w-0 flex-col gap-0 overflow-hidden pr-2">
            <div className="grid h-7 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-1 text-xs text-zinc-500">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView({ kind: 'manager' })}
                  className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
                  aria-label="Back to backtest manager"
                  title="Back to backtest manager"
                >
                  <ChevronLeft className="h-3 w-3" />
                  Backtest Manager
                </button>
              </div>

              <div className="flex min-w-0 items-center justify-center gap-2">
                {selected ? (
                  <>
                    <span className="font-mono text-base font-semibold text-white">{selected.ticker}</span>
                    <span className="font-mono text-sm tabular-nums text-zinc-500">{selected.date}</span>
                  </>
                ) : null}
              </div>

              <div className="flex items-center justify-end pr-1">
                <button
                  type="button"
                  onClick={() => setRightCollapsed((current) => !current)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
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

            <div className="grid h-10 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-white/10 px-1">
              {!view.id ? (
                <form
                  onSubmit={handleLookupSubmit}
                  className="flex items-center gap-1.5"
                  aria-label="Lookup ticker on date"
                >
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                    <Input
                      value={lookupTicker}
                      onChange={(event) => setLookupTicker(event.target.value.toUpperCase())}
                      placeholder="TICKER"
                      className="h-7 w-[8.25rem] border-white/10 bg-white/5 pl-7 font-mono text-xs uppercase text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                  <input
                    type="date"
                    value={lookupDate}
                    onChange={(event) => setLookupDate(event.target.value)}
                    className="h-7 w-[8.25rem] rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs text-zinc-100 [color-scheme:dark]"
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="xs"
                    disabled={!lookupValid}
                    className="h-7 text-[11px] text-zinc-300 hover:bg-transparent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Load
                  </Button>
                </form>
              ) : (
                <div className="flex min-w-0 items-center px-2">
                  <span className="truncate text-sm font-medium text-zinc-200">
                    {view.name ?? 'Backtest'}
                  </span>
                </div>
              )}

              <div />

              <div className="flex items-center justify-end gap-2">
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={!selected || extraSessionsForward <= 0}
                    onClick={() => setExtraSessionsForward((current) => Math.max(0, current - 1))}
                    className="text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-30"
                    title="Remove one forward day"
                    aria-label="Remove one forward day"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="min-w-9 text-center font-mono text-xs tabular-nums text-zinc-400">
                    +{extraSessionsForward}D
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={!selected}
                    onClick={() => setExtraSessionsForward((current) => current + 1)}
                    className="text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-30"
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
              <div className="flex h-9 shrink-0 items-center justify-between border border-emerald-500/20 bg-emerald-500/8 px-3">
                <span className="text-sm text-emerald-300">
                  Click chart to place {armedAction.replace('_', ' ')} entry. ESC to cancel.
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setArmedAction(null)}
                  className="border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
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
            <BacktestingSidebar
              selected={selected}
              onSelect={handleSelect}
              activeBacktestId={view.id}
              topPanel={(
              <BacktestSimPanel
                ticker={selected?.ticker ?? null}
                date={selected?.date ?? null}
                riskDollars={effectiveRiskDollars}
                activeBacktest={
                  view.id && view.name && view.userId
                    ? { id: view.id, name: view.name, userId: view.userId }
                    : null
                }
                currentUserId={currentUserId}
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
              )}
            />
          ) : null}
        </div>
      ) : null}

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
    </motion.div>
  );
}
