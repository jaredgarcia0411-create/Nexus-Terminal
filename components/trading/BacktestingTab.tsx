'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Search } from 'lucide-react';

import BacktestChartWorkspace from '@/components/trading/BacktestChartWorkspace';
import BacktestManagerView from '@/components/trading/BacktestManagerView';
import BacktestStatsView from '@/components/trading/BacktestStatsView';
import BacktestingSidebar, { type BacktestSelection } from '@/components/trading/BacktestingSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

// Charts tab opens directly into the chart workspace. On first paint we don't
// have access to localStorage (SSR), so we start with a placeholder view and
// hydrate the saved ticker (or fall back to AAPL on today's date) inside a
// mount effect below.
const CHARTS_LAST_TICKER_KEY = 'nexus.charts.lastTicker';
// Remember whether Charts was last on the chart workspace or the Backtest
// Manager so a refresh returns to the same spot. The stats sub-view saves as
// 'manager' (it needs a backtest id we don't round-trip), so refreshing from
// stats lands back on the manager list.
const CHARTS_VIEW_KEY = 'nexus.charts.view';

function getInitialView(): View {
  if (typeof window !== 'undefined') {
    try {
      if (localStorage.getItem(CHARTS_VIEW_KEY) === 'manager') {
        return { kind: 'manager' };
      }
    } catch {
      // Ignore storage failures — fall through to the chart default.
    }
  }
  // Chart workspace placeholder; ticker/date hydrate in the mount effect below.
  return { kind: 'chart', ticker: null, date: null, id: null, name: null, userId: null };
}

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
  // like a charting area first, unless a prior refresh left us on the manager.
  // The actual ticker/date is hydrated from localStorage in the mount effect
  // below — we can't read it during initial render because that runs on the
  // server.
  const [view, setView] = useState<View>(getInitialView);

  // Persist which top-level view we're on so a refresh restores it.
  useEffect(() => {
    try {
      localStorage.setItem(CHARTS_VIEW_KEY, view.kind === 'chart' ? 'chart' : 'manager');
    } catch {
      // Ignore storage failures — non-critical preference.
    }
  }, [view.kind]);
  const [lookupTicker, setLookupTicker] = useState('');
  const [lookupDate, setLookupDate] = useState('');
  // When the user clicks Launch Chart with a known recent review, we set this
  // to the review id. The effect below picks it up once the sessions GET
  // resolves and drops the user into read-only review mode automatically.
  const [autoLoadReviewId, setAutoLoadReviewId] = useState<string | null>(null);

  const openChartView = useCallback((
    selection: BacktestSelection | null,
    activeBacktest: ActiveBacktestSummary = { id: null, name: null, userId: null },
    reviewToAutoLoad: string | null = null,
  ) => {
    setAutoLoadReviewId(reviewToAutoLoad);
    setView({
      kind: 'chart',
      ticker: selection?.ticker ?? null,
      date: selection?.date ?? null,
      id: activeBacktest.id,
      name: activeBacktest.name,
      userId: activeBacktest.userId,
    });
  }, []);

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
    setView((current) => (
      current.kind === 'chart'
        ? { ...current, date: newDate }
        : current
    ));
  }, []);

  return (
    <motion.div
      key="backtesting"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] overflow-hidden bg-background"
    >
      <AnimatePresence mode="wait">
      {view.kind === 'manager' ? (
        <motion.div
          key="manager"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex min-h-0 min-w-0 flex-1"
        >
          <BacktestManagerView
            onLaunchChart={(backtest, autoLoadReview) => openChartView(
              autoLoadReview ? { ticker: autoLoadReview.ticker, date: autoLoadReview.date } : null,
              backtest
                ? { id: backtest.id, name: backtest.name, userId: backtest.ownerId }
                : { id: null, name: null, userId: null },
              autoLoadReview?.id ?? null,
            )}
            onOpenLastChart={() => handleSelect({ ticker: getPersistedTicker(), date: todayIsoDate() })}
            onViewStats={(backtestId) => setView({ kind: 'stats', backtestId })}
          />
        </motion.div>
      ) : null}

      {view.kind === 'stats' ? (
        <motion.div
          key="stats"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex min-h-0 min-w-0 flex-1"
        >
          <BacktestStatsView
            backtestId={view.backtestId}
            onBack={() => setView({ kind: 'manager' })}
            onOpenInChart={(ticker, date, activeBacktest) => openChartView({ ticker, date }, activeBacktest)}
            currentUserId={currentUserId}
          />
        </motion.div>
      ) : null}

      {view.kind === 'chart' ? (
        <motion.div
          key="chart"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex min-h-0 min-w-0 flex-1"
        >
          <BacktestChartWorkspace
            key={`${view.id ?? 'free'}:${view.ticker ?? 'empty'}:${view.date ?? 'empty'}`}
            ticker={view.ticker}
            date={view.date}
            currentUserId={currentUserId}
            backtestId={view.id}
            autoLoadReviewId={autoLoadReviewId}
            activeBacktest={
              view.id && view.name && view.userId
                ? { id: view.id, name: view.name, userId: view.userId }
                : null
            }
            onAnchorChange={handleAnchorChange}
            headerLeft={
              <button
                type="button"
                onClick={() => setView({ kind: 'manager' })}
                className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-sm font-medium leading-none text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Back to backtest manager"
                title="Back to backtest manager"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Backtest Manager
              </button>
            }
            toolbarLeft={
              !view.id ? (
                <form
                  onSubmit={handleLookupSubmit}
                  className="flex items-center gap-1.5"
                  aria-label="Lookup ticker on date"
                >
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={lookupTicker}
                      onChange={(event) => setLookupTicker(event.target.value.toUpperCase())}
                      placeholder="TICKER"
                      className="h-7 w-[8.25rem] border-border bg-accent pl-7 font-mono text-xs uppercase text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <input
                    type="date"
                    value={lookupDate}
                    onChange={(event) => setLookupDate(event.target.value)}
                    className="h-7 w-[8.25rem] rounded-md border border-border bg-accent px-2 font-mono text-xs text-foreground [color-scheme:dark]"
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="xs"
                    disabled={!lookupValid}
                    className="h-7 text-[11px] text-muted-foreground hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Load
                  </Button>
                </form>
              ) : (
                <div className="flex min-w-0 items-center px-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {view.name ?? 'Backtest'}
                  </span>
                </div>
              )
            }
            renderRightPanel={(simPanel) => (
              <BacktestingSidebar
                selected={view.ticker && view.date ? { ticker: view.ticker, date: view.date } : null}
                onSelect={handleSelect}
                activeBacktestId={view.id}
                topPanel={simPanel}
              />
            )}
          />
        </motion.div>
      ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
