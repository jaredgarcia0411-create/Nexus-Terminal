'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PlaceBacktestActionInput } from '@/hooks/use-backtest-session';
import { sizeForAdd, sizeForOpen, type SimPosition } from '@/lib/backtest-math';
import { formatCurrency } from '@/lib/trading-utils';
import type { BacktestActionType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const OPEN_SIZE_OPTIONS = [25, 50, 75, 100] as const;
const CLOSE_SIZE_OPTIONS = [10, 25, 33, 50, 75, 100] as const;

export type BacktestOrderDraft = {
  actionType: BacktestActionType;
  price: number;
  barTime: string;
};

type PreviewState =
  | {
      shares: number;
      stopPrice: number | null;
      totalRisk: number | null;
      resultingAvgEntry: number | null;
      realizedPnl: number | null;
    }
  | null;

function formatTimestamp(barTime: string) {
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

function buildPreview(
  order: BacktestOrderDraft | null,
  position: SimPosition,
  riskDollars: number,
  stopInput: string,
  sizePercent: number,
) {
  if (!order) return { preview: null as PreviewState, error: null as string | null };

  try {
    if (order.actionType === 'LONG' || order.actionType === 'SHORT') {
      const stopPrice = Number(stopInput);
      if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
        return { preview: null as PreviewState, error: null as string | null };
      }

      const fullSize = sizeForOpen(riskDollars, order.price, stopPrice, order.actionType);
      const shares = Math.min(
        fullSize.shares,
        Math.max(1, Math.floor(fullSize.shares * (sizePercent / 100))),
      );
      return {
        preview: {
          shares,
          stopPrice,
          totalRisk: shares * Math.abs(order.price - stopPrice),
          resultingAvgEntry: order.price,
          realizedPnl: null,
        },
        error: null as string | null,
      };
    }

    if (order.actionType === 'LONG_ADD' || order.actionType === 'SHORT_ADD') {
      const stopPrice = Number(stopInput);
      if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
        return { preview: null as PreviewState, error: null as string | null };
      }

      const result = sizeForAdd(position, stopPrice, order.price);
      return {
        preview: {
          shares: result.shares,
          stopPrice,
          totalRisk: result.resultingTotalRisk,
          resultingAvgEntry: result.resultingAvgEntry,
          realizedPnl: null,
        },
        error: null as string | null,
      };
    }

    if ((order.actionType === 'SELL' || order.actionType === 'COVER') && position.avgEntry != null && position.totalShares > 0) {
      const shares = sizePercent >= 100
        ? position.totalShares
        : Math.min(position.totalShares, Math.max(1, Math.floor(position.totalShares * (sizePercent / 100))));
      const realizedPnl = order.actionType === 'SELL'
        ? (order.price - position.avgEntry) * shares
        : (position.avgEntry - order.price) * shares;

      return {
        preview: {
          shares,
          stopPrice: null,
          totalRisk: null,
          resultingAvgEntry: null,
          realizedPnl,
        },
        error: null as string | null,
      };
    }

    return { preview: null as PreviewState, error: 'Action is not valid for the current position' };
  } catch (error) {
    return {
      preview: null as PreviewState,
      error: error instanceof Error ? error.message : 'Could not size this order',
    };
  }
}

interface BacktestPlaceOrderDialogProps {
  open: boolean;
  order: BacktestOrderDraft | null;
  position: SimPosition;
  riskDollars: number;
  onOpenChange: (open: boolean) => void;
  onPlace: (input: PlaceBacktestActionInput) => Promise<void> | void;
}

export default function BacktestPlaceOrderDialog({
  open,
  order,
  position,
  riskDollars,
  onOpenChange,
  onPlace,
}: BacktestPlaceOrderDialogProps) {
  const [stopInput, setStopInput] = useState('');
  const [sizePercent, setSizePercent] = useState(100);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setStopInput('');
    setSizePercent(100);
    setSubmitError(null);
    setIsSubmitting(false);
  }, [open, order]);

  const { preview, error } = useMemo(
    () => buildPreview(order, position, riskDollars, stopInput, sizePercent),
    [order, position, riskDollars, sizePercent, stopInput],
  );

  const sizeOptions = order?.actionType === 'SELL' || order?.actionType === 'COVER'
    ? CLOSE_SIZE_OPTIONS
    : OPEN_SIZE_OPTIONS;

  const placeOrder = async () => {
    if (!order || !preview) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onPlace({
        actionType: order.actionType,
        price: order.price,
        shares: preview.shares,
        stopPrice: preview.stopPrice,
        barTime: order.barTime,
      });
      onOpenChange(false);
    } catch (placeError) {
      setSubmitError(placeError instanceof Error ? placeError.message : 'Could not place order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Place {order?.actionType.replace('_', ' ')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Action</Label>
              <div className="rounded-md border border-border bg-accent px-3 py-2 text-sm text-foreground">
                {order?.actionType.replace('_', ' ') ?? '-'}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Entry Price</Label>
              <div className="rounded-md border border-border bg-accent px-3 py-2 font-mono text-sm tabular-nums text-foreground">
                {order ? formatCurrency(order.price) : '-'}
              </div>
            </div>
          </div>

          {order ? <p className="font-mono text-[11px] text-muted-foreground">{formatTimestamp(order.barTime)}</p> : null}

          {order?.actionType === 'LONG' || order?.actionType === 'SHORT' || order?.actionType === 'LONG_ADD' || order?.actionType === 'SHORT_ADD' ? (
            <div className="space-y-2">
              <Label htmlFor="backtest-stop">
                {order.actionType === 'LONG_ADD' || order.actionType === 'SHORT_ADD' ? 'New Stop' : 'Stop'}
              </Label>
              <Input
                id="backtest-stop"
                type="number"
                step="0.01"
                value={stopInput}
                onChange={(event) => setStopInput(event.target.value)}
                className="border-border bg-accent text-foreground"
              />
            </div>
          ) : null}

          {order?.actionType === 'LONG' || order?.actionType === 'SHORT' || order?.actionType === 'SELL' || order?.actionType === 'COVER' ? (
            <div className="space-y-2">
              <Label>% Size</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {sizeOptions.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setSizePercent(option)}
                    className={sizePercent === option
                      ? 'border border-primary/40 bg-primary/15 text-primary hover:bg-primary/20'
                      : 'border border-border bg-accent text-muted-foreground hover:bg-accent hover:text-foreground'}
                  >
                    {option}%
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-background p-3 text-sm">
            {preview ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Shares</span>
                  <span className="font-mono tabular-nums text-foreground">{preview.shares}</span>
                </div>
                {preview.totalRisk != null ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total Risk</span>
                    <span className="font-mono tabular-nums text-foreground">{formatCurrency(preview.totalRisk)}</span>
                  </div>
                ) : null}
                {preview.resultingAvgEntry != null ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Resulting Avg Entry</span>
                    <span className="font-mono tabular-nums text-foreground">{formatCurrency(preview.resultingAvgEntry)}</span>
                  </div>
                ) : null}
                {preview.realizedPnl != null ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Realized P&amp;L</span>
                    <span className={`font-mono tabular-nums ${preview.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(preview.realizedPnl)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-muted-foreground">Enter the remaining fields to preview this action.</div>
            )}
          </div>

          {error ? <p className="text-sm text-amber-400">{error}</p> : null}
          {submitError ? <p className="text-sm text-rose-400">{submitError}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="bg-accent hover:bg-accent/80"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!preview || isSubmitting}
            onClick={() => void placeOrder()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
          >
            Place
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
