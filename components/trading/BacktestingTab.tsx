'use client';

import { useCallback, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { motion } from 'motion/react';

import BacktestChartGrid from '@/components/trading/BacktestChartGrid';
import BacktestPlaceOrderDialog, { type BacktestOrderDraft } from '@/components/trading/BacktestPlaceOrderDialog';
import BacktestSimPanel from '@/components/trading/BacktestSimPanel';
import BacktestTradeMenu from '@/components/trading/BacktestTradeMenu';
import BacktestingSidebar, { type BacktestSelection } from '@/components/trading/BacktestingSidebar';
import { Button } from '@/components/ui/button';
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

  const handleSelect = useCallback((nextSelection: BacktestSelection) => {
    setArmedAction(null);
    setPendingOrder(null);
    setSelected(nextSelection);
  }, []);

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

  return (
    <motion.div
      key="backtesting"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] overflow-hidden bg-[#0A0A0B]"
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex min-w-0 flex-col gap-2 overflow-hidden pr-2">
          <div className="flex h-10 shrink-0 items-center gap-2 border border-white/10 bg-[#121214] px-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-white">{selected?.ticker ?? 'No ticker'}</span>
                {selected ? <span className="font-mono text-xs tabular-nums text-zinc-500">{selected.date}</span> : null}
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
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
            onArmedClick={(payload) => {
              if (!armedAction) return;
              setPendingOrder({
                actionType: armedAction,
                price: payload.price,
                barTime: payload.barTime,
              });
            }}
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
