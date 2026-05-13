'use client';

import { useMemo, useState } from 'react';
import { Eye, RotateCcw, Trash2 } from 'lucide-react';

import type { SimPosition } from '@/lib/backtest-math';
import { formatCurrency, formatR, getPnLColor } from '@/lib/trading-utils';
import type { BacktestAction, BacktestSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

function computeAvgExit(actions: BacktestAction[]) {
  let shares = 0;
  let total = 0;

  for (const action of actions) {
    if (action.actionType === 'SELL' || action.actionType === 'COVER') {
      shares += action.shares;
      total += action.shares * action.price;
    }
  }

  return shares > 0 ? total / shares : null;
}

function formatLedgerTime(barTime: string) {
  const parsed = Date.parse(barTime);
  if (!Number.isFinite(parsed)) return barTime;
  return new Date(parsed).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatReviewLabel(review: BacktestSession) {
  const reviewedAt = review.reviewedAt ? Date.parse(String(review.reviewedAt)) : NaN;
  const reviewedText = Number.isFinite(reviewedAt)
    ? new Date(reviewedAt).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    : review.date;

  return review.label?.trim() ? `${review.label} · ${reviewedText}` : reviewedText;
}

function statusLabel(position: SimPosition, actionsLength: number) {
  if (position.direction === 'LONG' && position.totalShares > 0) return 'OPEN LONG';
  if (position.direction === 'SHORT' && position.totalShares > 0) return 'OPEN SHORT';
  if (actionsLength > 0) return 'CLOSED';
  return 'FLAT';
}

interface BacktestSimPanelProps {
  ticker: string | null;
  date: string | null;
  riskDollars: number;
  activeBacktest: { id: string; name: string; userId: string } | null;
  currentUserId: string | null;
  session: BacktestSession | null;
  actions: BacktestAction[];
  position: SimPosition;
  reviews: BacktestSession[];
  isLoading: boolean;
  isMutating: boolean;
  isReadOnly: boolean;
  error: string | null;
  onRiskCommit: (riskDollars: number) => Promise<void> | void;
  onUndoLast: () => Promise<void> | void;
  onClear: () => Promise<void> | void;
  onSaveReview: (label?: string, notes?: string) => Promise<void> | void;
  onLoadReview: (reviewId: string) => Promise<void> | void;
  onDeleteReview: (reviewId: string) => Promise<void> | void;
}

export default function BacktestSimPanel({
  ticker,
  date,
  riskDollars,
  activeBacktest,
  currentUserId,
  session,
  actions,
  position,
  reviews,
  isLoading,
  isMutating,
  isReadOnly,
  error,
  onRiskCommit,
  onUndoLast,
  onClear,
  onSaveReview,
  onLoadReview,
  onDeleteReview,
}: BacktestSimPanelProps) {
  const [clearOpen, setClearOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLabel, setReviewLabel] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  // LOAD REVIEW widens named backtest launches to every returned ticker/date
  // review, while uncategorized launches stay scoped to the current viewer's
  // own free-form reviews.
  const visibleReviews = useMemo(() => {
    if (activeBacktest) {
      return reviews;
    }
    return reviews.filter((review) => review.backtestId == null && review.userId === currentUserId);
  }, [activeBacktest, currentUserId, reviews]);
  const effectiveSelectedReviewId = isReadOnly && session ? session.id : selectedReviewId;
  const selectedReview = effectiveSelectedReviewId
    ? visibleReviews.find((review) => review.id === effectiveSelectedReviewId) ?? null
    : null;

  const currentOpenRisk = position.avgEntry != null && position.stop != null && position.totalShares > 0
    ? Math.abs(position.avgEntry - position.stop) * position.totalShares
    : 0;
  const displayStop = position.stop ?? position.lastSetStop;
  const avgExit = useMemo(() => computeAvgExit(actions), [actions]);
  const simPnl = position.realizedPnl;
  const status = statusLabel(position, actions.length);
  const pnlClass = getPnLColor(simPnl);
  const posValue = position.avgEntry != null ? position.avgEntry * position.totalShares : 0;
  const saveLabel = activeBacktest && activeBacktest.userId === currentUserId
    ? `SAVE TO ${activeBacktest.name.toUpperCase().slice(0, 15)}${activeBacktest.name.length > 15 ? '...' : ''}`
    : 'SAVE REVIEW';

  const commitRisk = async (rawValue: string) => {
    const nextRisk = Number(rawValue);
    if (!Number.isFinite(nextRisk) || nextRisk <= 0 || nextRisk === riskDollars) {
      return;
    }

    await onRiskCommit(nextRisk);
  };

  const saveReview = async () => {
    await onSaveReview(reviewLabel.trim() || undefined, reviewNotes.trim() || undefined);
    setReviewOpen(false);
    setReviewLabel('');
    setReviewNotes('');
    setSelectedReviewId(null);
  };

  return (
    <section className="flex flex-col bg-[#0A0A0B]">
      {isReadOnly ? (
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#111319] px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <Eye className="h-3.5 w-3.5 text-emerald-400" />
            <span>Viewing review</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!session || isMutating}
            onClick={() => setDeleteOpen(true)}
            className="border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
            title="Delete review"
            aria-label="Delete review"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="backtest-risk">R$</Label>
            <Input
              key={`${session?.id ?? 'draft'}:${riskDollars}:${isReadOnly ? 'ro' : 'rw'}`}
              id="backtest-risk"
              type="number"
              step="1"
              defaultValue={riskDollars > 0 ? String(Math.round(riskDollars)) : ''}
              disabled={!ticker || !date || isReadOnly || isLoading}
              onBlur={(event) => void commitRisk(event.currentTarget.value)}
              className="h-8 border-white/10 bg-white/5 font-mono text-xs text-zinc-100"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="flex h-8 items-center rounded-md border border-white/10 bg-white/5 px-3 font-mono text-xs text-zinc-100">
              {status}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <div className="text-zinc-500">AVG ENTRY</div>
            <div className="font-mono tabular-nums text-zinc-100">{position.avgEntry != null ? formatCurrency(position.avgEntry) : '-'}</div>
          </div>
          <div>
            <div className="text-zinc-500">SHARES</div>
            <div className="font-mono tabular-nums text-zinc-100">{position.totalShares || '-'}</div>
          </div>
          <div>
            <div className="text-zinc-500">STOP</div>
            <div className="font-mono tabular-nums text-zinc-100">{displayStop != null ? formatCurrency(displayStop) : '-'}</div>
          </div>
          <div>
            <div className="text-zinc-500">RISK</div>
            <div className="font-mono tabular-nums text-zinc-100">
              {currentOpenRisk > 0
                ? `${formatCurrency(currentOpenRisk)} ${formatR(currentOpenRisk / riskDollars)}`
                : '-'}
            </div>
          </div>
          <div>
            <div className="text-zinc-500">AVG EXIT</div>
            <div className="font-mono tabular-nums text-zinc-100">{avgExit != null ? formatCurrency(avgExit) : '-'}</div>
          </div>
          <div>
            <div className="text-zinc-500">LAST EXIT</div>
            <div className="font-mono tabular-nums text-zinc-100">{position.lastExitPrice != null ? formatCurrency(position.lastExitPrice) : '-'}</div>
          </div>
          <div>
            <div className="text-zinc-500">SIM PNL</div>
            <div className={`font-mono tabular-nums ${pnlClass}`}>
              {actions.length > 0 ? `${formatCurrency(simPnl)} ${formatR(simPnl / riskDollars)}` : '-'}
            </div>
          </div>
          <div>
            <div className="text-zinc-500">POS VALUE</div>
            <div className="font-mono tabular-nums text-zinc-100">{position.totalShares > 0 ? formatCurrency(posValue) : '-'}</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">Ledger</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isReadOnly || actions.length === 0 || isMutating}
              onClick={() => void onUndoLast()}
              className="h-7 border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" />
              Undo last
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-white/10 bg-[#111319]">
            {actions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-zinc-500">No simulation actions yet</div>
            ) : (
              <div className="divide-y divide-white/5">
                {actions.map((action) => (
                  <div key={action.id} className="px-3 py-2 text-xs">
                    <div className="font-mono text-zinc-400">{formatLedgerTime(action.barTime)}</div>
                    <div className="mt-0.5 font-mono tabular-nums text-zinc-100">
                      {action.actionType} · {action.shares} @ {formatCurrency(action.price)}
                      {action.stopPrice != null ? ` · stop ${formatCurrency(action.stopPrice)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!session || isMutating || (!isReadOnly && actions.length === 0)}
            onClick={() => setClearOpen(true)}
            className="h-8 border border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button
            type="button"
            disabled={!session || actions.length === 0 || isReadOnly || isMutating}
            onClick={() => setReviewOpen(true)}
            className="h-8 bg-emerald-500/10 text-xs text-white hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {saveLabel}
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={!ticker || !date || visibleReviews.length === 0 || isLoading}
              className="h-8 w-full justify-between border border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {selectedReview
                ? formatReviewLabel(selectedReview)
                : 'LOAD REVIEW'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[240px] border-white/10 bg-[#111319] text-white">
            {visibleReviews.map((review) => (
              <DropdownMenuItem
                key={review.id}
              onSelect={() => {
                setSelectedReviewId(review.id);
                void onLoadReview(review.id);
                }}
                className="cursor-pointer text-xs"
              >
                {formatReviewLabel(review)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {ticker && date ? (
          <div className="font-mono text-[11px] text-zinc-500">
            {ticker} · {date}
          </div>
        ) : null}

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      </div>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="border-white/10 bg-[#121214] text-white">
          <DialogHeader>
            <DialogTitle>{isReadOnly ? 'Clear review view?' : 'Clear simulation?'}</DialogTitle>
            <DialogDescription className="text-sm text-zinc-400">
              {isReadOnly
                ? 'Exit this saved review view? The saved review will remain available.'
                : `Remove all simulation executions for ${ticker ?? '-'} ${date ?? '-'}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setClearOpen(false)} className="bg-white/10 hover:bg-white/20">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setSelectedReviewId(null);
                void onClear();
                setClearOpen(false);
              }}
              className="bg-rose-500 text-white hover:bg-rose-400"
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="border-white/10 bg-[#121214] text-white">
          <DialogHeader>
            <DialogTitle>Delete review?</DialogTitle>
            <DialogDescription className="text-sm text-zinc-400">
              Permanently delete this saved review and its execution ledger. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)} className="bg-white/10 hover:bg-white/20">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!session || isMutating}
              onClick={() => {
                if (!session) return;
                setSelectedReviewId(null);
                void onDeleteReview(session.id);
                setDeleteOpen(false);
              }}
              className="bg-rose-500 text-white hover:bg-rose-400 disabled:opacity-40"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="border-white/10 bg-[#121214] text-white">
          <DialogHeader>
            <DialogTitle>Save Review</DialogTitle>
            <DialogDescription className="text-sm text-zinc-400">
              Save the current simulation ledger as a read-only review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="backtest-review-label">Label</Label>
              <Input
                id="backtest-review-label"
                value={reviewLabel}
                onChange={(event) => setReviewLabel(event.target.value)}
                className="border-white/10 bg-white/5 text-zinc-100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backtest-review-notes">Notes</Label>
              <Textarea
                id="backtest-review-notes"
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
                className="min-h-24 border-white/10 bg-white/5 text-zinc-100"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setReviewOpen(false)} className="bg-white/10 hover:bg-white/20">
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveReview()} className="bg-emerald-500/10 text-white hover:bg-emerald-500/20">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
