'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { motion } from 'motion/react';
import { Search } from 'lucide-react';

import BacktestChartGrid from '@/components/trading/BacktestChartGrid';
import BacktestPlaceOrderDialog, { type BacktestOrderDraft } from '@/components/trading/BacktestPlaceOrderDialog';
import BacktestSimPanel from '@/components/trading/BacktestSimPanel';
import BacktestTradeMenu from '@/components/trading/BacktestTradeMenu';
import BacktestingSidebar, { type BacktestSelection } from '@/components/trading/BacktestingSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBacktestSession } from '@/hooks/use-backtest-session';
import { formatCurrency } from '@/lib/trading-utils';
import type { BacktestActionType } from '@/lib/types';

function getInitialRiskDollars() {
  if (typeof window === 'undefined') return 100;

  try {
    const stored = Number(localStorage.getItem('nexus-default-risk'));
    return Number.isFinite(stored) && stored > 0 ? stored : 100;
  } catch {
    return 100;
  }
}

export default function BacktestingTab() {
  const [selected, setSelected] = useState<BacktestSelection | null>(null);
  const [riskDollars, setRiskDollars] = useState(getInitialRiskDollars);
  const [armedAction, setArmedAction] = useState<BacktestActionType | null>(null);
  const [pendingOrder, setPendingOrder] = useState<BacktestOrderDraft | null>(null);
  // Ad-hoc lookup form lives in the header so any ticker/date can be loaded
  // without needing it in the system list.
  const [lookupTicker, setLookupTicker] = useState('');
  const [lookupDate, setLookupDate] = useState('');

  const handleSelect = useCallback((nextSelection: BacktestSelection) => {
    setArmedAction(null);
    setPendingOrder(null);
    setSelected(nextSelection);
  }, []);

  const handleLookupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = lookupTicker.trim().toUpperCase();
    if (!ticker) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lookupDate)) return;
    handleSelect({ ticker, date: lookupDate });
  };

  const lookupValid = lookupTicker.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(lookupDate);

  const handleAnchorChange = useCallback((newDate: string) => {
    setSelected((current) => (current ? { ...current, date: newDate } : current));
  }, []);

  const sessionState = useBacktestSession({
    ticker: selected?.ticker ?? null,
    date: selected?.date ?? null,
    riskDollars,
  });

  useHotkeys('esc', () => {
    setArmedAction(null);
    setPendingOrder(null);
  }, { preventDefault: true });

  const effectiveRiskDollars = sessionState.effectiveRiskDollars;

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
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_220px] xl:grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden pr-2">
          <div className="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border border-white/10 bg-[#121214] px-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-sm font-semibold text-white">{selected?.ticker ?? 'No ticker'}</span>
              {selected ? <span className="font-mono text-xs tabular-nums text-zinc-500">{selected.date}</span> : null}
            </div>

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
                  className="h-7 w-32 border-white/10 bg-white/5 pl-7 font-mono text-xs uppercase text-zinc-100 placeholder:text-zinc-600"
                />
              </div>
              <input
                type="date"
                value={lookupDate}
                onChange={(event) => setLookupDate(event.target.value)}
                className="h-7 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs text-zinc-100 [color-scheme:dark]"
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

            <div className="flex items-center justify-end gap-2">
              <span className="font-mono text-xs tabular-nums text-zinc-400">{formatCurrency(effectiveRiskDollars)}</span>
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
            ticker={selected?.ticker ?? null}
            date={selected?.date ?? null}
            onAnchorChange={handleAnchorChange}
            armedAction={sessionState.isReadOnly ? null : armedAction}
            onArmedClick={handleArmedClick}
            actions={sessionState.actions}
            currentStop={sessionState.position.stop}
          />
        </main>

        <BacktestingSidebar
          selected={selected}
          onSelect={handleSelect}
          topPanel={(
            <BacktestSimPanel
              ticker={selected?.ticker ?? null}
              date={selected?.date ?? null}
              riskDollars={effectiveRiskDollars}
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
              onSaveReview={sessionState.saveReview}
              onLoadReview={async (reviewId) => {
                setArmedAction(null);
                setPendingOrder(null);
                await sessionState.loadReview(reviewId);
              }}
              onStartNewSession={() => {
                setArmedAction(null);
                setPendingOrder(null);
                sessionState.startNewSession();
              }}
            />
          )}
        />
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
    </motion.div>
  );
}
