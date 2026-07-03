'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Trade } from '@/lib/types';
import { buildTradeMarkers, formatCurrency, formatR, getPnLColor } from '@/lib/ui-trade-utils';
import { readDrafts, writeDrafts } from '@/lib/drafts';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AnnotatableChart from '@/components/trading/AnnotatableChart';
import type { TradeMarker } from '@/lib/types';
import { useCandleData } from '@/hooks/use-candle-data';
import { bucketKey, isCrossDayTrade } from '@/lib/journal-aggregates';
import {
  buildTradeChartOptions,
  type TradeChartTimeframeKey,
} from '@/lib/chart-timeframes';
import { nyDateTimeToEpoch, parseAbsoluteTimestampMs } from '@/lib/time-utils';

const NOTES_DRAFTS_KEY = 'nexus-trade-notes-drafts';

interface TradeDetailSheetProps {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveNotes: (tradeId: string, notes: string) => Promise<void> | void;
  onCloseTrade?: (tradeId: string, exitPrice: number, exitTime: string) => Promise<void> | void;
}

function timeValue(sortKey: string, time: string, timestamp?: string | Date) {
  const parsedTimestamp = parseAbsoluteTimestampMs(timestamp);
  if (parsedTimestamp != null) return parsedTimestamp;

  const nyEpoch = nyDateTimeToEpoch(sortKey, time);
  if (nyEpoch != null) return nyEpoch;

  return 0;
}

function prettyNumber(value?: number | null, digits = 2) {
  if (value == null) return 'Not yet calculated';
  const absValue = Math.abs(value);
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${absValue.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function prettyPct(value?: number | null) {
  if (value == null) return 'Not yet calculated';
  return `${(value * 100).toFixed(1)}%`;
}

export default function TradeDetailSheet({ trade, open, onOpenChange, onSaveNotes, onCloseTrade }: TradeDetailSheetProps) {
  const [notes, setNotes] = useState(() => {
    const draft = trade ? readDrafts<string>(NOTES_DRAFTS_KEY)[trade.id] : undefined;
    return draft ?? trade?.notes ?? '';
  });
  const [hasDraft, setHasDraft] = useState(() =>
    trade ? readDrafts<string>(NOTES_DRAFTS_KEY)[trade.id] !== undefined : false,
  );
  const [timeframe, setTimeframe] = useState<TradeChartTimeframeKey>('5m');
  const [closeExitPrice, setCloseExitPrice] = useState('');
  const [closeExitTime, setCloseExitTime] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const chartOptions = useMemo(() => {
    if (!trade) return null;
    return buildTradeChartOptions(
      trade.sortKey,
      timeframe,
      isCrossDayTrade(trade) ? bucketKey(trade) : undefined,
    );
  }, [trade, timeframe]);

  const { candles, isLoading: loadingCandles, error: candlesError } = useCandleData(
    trade?.symbol ?? null,
    chartOptions ?? undefined,
  );

  const sortedExecutions = useMemo(() => {
    if (!trade) return [];
    const exitDay = isCrossDayTrade(trade) ? bucketKey(trade) : trade.sortKey;
    return [...(trade.rawExecutions ?? [])].sort(
      (a, b) =>
        timeValue(a.side === 'EXIT' ? exitDay : trade.sortKey, a.time, a.timestamp) -
        timeValue(b.side === 'EXIT' ? exitDay : trade.sortKey, b.time, b.timestamp),
    );
  }, [trade]);

  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    if (!trade) return [];
    return buildTradeMarkers(trade);
  }, [trade]);

  const tradeDateLabel = trade
    ? isCrossDayTrade(trade)
      ? `${format(new Date(`${trade.sortKey}T00:00:00`), 'MMM dd')} – ${format(new Date(`${bucketKey(trade)}T00:00:00`), 'MMM dd, yyyy')}`
      : format(new Date(`${trade.sortKey}T00:00:00`), 'MMM dd, yyyy')
    : '';
  const tradeTimeLabel = trade ? (trade.isOpen ? trade.entryTime : trade.exitTime) : '';

  const updateNotes = (html: string) => {
    setNotes(html);
    if (!trade) return;
    const drafts = readDrafts<string>(NOTES_DRAFTS_KEY);
    drafts[trade.id] = html;
    writeDrafts(NOTES_DRAFTS_KEY, drafts);
    setHasDraft(true);
  };

  const handleSave = async () => {
    if (!trade) return;
    try {
      await onSaveNotes(trade.id, notes);
      const drafts = readDrafts<string>(NOTES_DRAFTS_KEY);
      delete drafts[trade.id];
      writeDrafts(NOTES_DRAFTS_KEY, drafts);
      setHasDraft(false);
      toast.success('Notes saved');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save notes');
    }
  };

  const handleClosePosition = async () => {
    if (!trade || !onCloseTrade) return;
    const exitPrice = parseFloat(closeExitPrice);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      toast.error('Enter a valid exit price');
      return;
    }
    if (!closeExitTime.trim()) {
      toast.error('Enter a valid exit time');
      return;
    }
    setIsClosing(true);
    try {
      await onCloseTrade(trade.id, exitPrice, closeExitTime.trim());
      setCloseExitPrice('');
      setCloseExitTime('');
      toast.success('Position closed');
    } catch (error) {
      console.error(error);
      toast.error('Failed to close position');
    } finally {
      setIsClosing(false);
    }
  };

  const overviewItems = trade
    ? [
        ['Shares Traded', trade.totalQuantity.toString()],
        ['Closed Gross P/L', formatCurrency(trade.grossPnl)],
        ['Commissions + Fees', formatCurrency((trade.commission ?? 0) + (trade.fees ?? 0))],
        ['Closed Net P/L', formatCurrency(trade.netPnl)],
        ['Gross Return (R)', trade.initialRisk ? formatR(trade.grossPnl / trade.initialRisk) : '-'],
        ['Net Return (R)', trade.initialRisk ? formatR(trade.netPnl / trade.initialRisk) : '-'],
        ['Position MFE', prettyNumber(trade.mfe)],
        ['Position MAE', prettyNumber(trade.mae)],
        ['Best Exit P/L', prettyNumber(trade.bestExitPnl)],
        ['Exit Efficiency', prettyPct(trade.exitEfficiency)],
        ['Entry Time', trade.entryTime || '-'],
        ['Exit Time', trade.exitTime || '-'],
        ['Execution Count', String(trade.executionCount)],
        ['Initial Risk', trade.initialRisk ? formatCurrency(trade.initialRisk) : '-'],
      ]
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="min-h-0 w-full sm:max-w-3xl bg-card border-border text-foreground">
        <SheetHeader>
          <SheetTitle className="text-xl">Trade Details</SheetTitle>
        </SheetHeader>

        {!trade ? null : (
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm text-muted-foreground">
                  {tradeDateLabel}{tradeTimeLabel ? ` ${tradeTimeLabel}` : ''}
                </p>
                <p className="text-sm font-semibold">
                  {trade.symbol}{' '}
                  <span
                    className={`ml-1 rounded px-2 py-0.5 text-[12px] ${
                      trade.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {trade.direction}
                  </span>
                </p>
              </div>
              <div className="text-right">
                {trade.isOpen ? (
                  <span className="mb-1 inline-block rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-400">
                    OPEN
                  </span>
                ) : (
                  <p className={`text-sm font-semibold ${getPnLColor(trade.netPnl)}`}>{formatCurrency(trade.netPnl)}</p>
                )}
                <p className="text-[12px] text-muted-foreground">{trade.isOpen ? 'Open Position' : 'Net P/L'}</p>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
              <section className="space-y-3 rounded-xl border border-border bg-accent/50 p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-foreground">Notes</h3>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <RichTextEditor
                      value={notes}
                      onChange={updateNotes}
                    />
                    {hasDraft ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-500">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Unsaved draft saved in this browser — hit Save to store it.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button onClick={handleSave} className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20">
                      Save Notes
                    </Button>
                  </div>
                </div>
              </section>

              {trade.isOpen && onCloseTrade ? (
                <section className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <h3 className="text-base font-semibold uppercase tracking-wider text-amber-400">Close Position</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Exit Price</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={closeExitPrice}
                        onChange={(event) => setCloseExitPrice(event.target.value)}
                        className="bg-accent border-border h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Exit Time</label>
                      <Input
                        type="text"
                        placeholder="15:59:00"
                        value={closeExitTime}
                        onChange={(event) => setCloseExitTime(event.target.value)}
                        className="bg-accent border-border h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      onClick={handleClosePosition}
                      disabled={isClosing}
                      className="border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    >
                      {isClosing ? 'Closing...' : 'Close Position (Full)'}
                    </Button>
                  </div>
                </section>
              ) : null}

              <section className="space-y-3 rounded-xl border border-border bg-accent/50 p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-foreground">Chart</h3>
                <div className="space-y-3">
                  {loadingCandles ? (
                    <div className="flex h-[640px] items-center justify-center text-sm text-muted-foreground">Loading candles...</div>
                  ) : candlesError ? (
                    <div className="flex h-[640px] items-center justify-center text-sm text-muted-foreground">
                      {candlesError}
                    </div>
                  ) : candles.length === 0 ? (
                    <div className="flex h-[640px] items-center justify-center text-sm text-muted-foreground">
                      No candle data available for this trade window.
                    </div>
                  ) : (
                    <AnnotatableChart
                      candles={candles}
                      tradeMarkers={tradeMarkers}
                      scopeKey={`trade:${trade.id}:${timeframe}`}
                      timeframe={timeframe}
                      onTimeframeChange={setTimeframe}
                      baseHeight={640}
                      exactPriceMarkers
                      showTimeAxis
                      showSessionShading={timeframe !== '1d'}
                    />
                  )}
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-accent/50 p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-foreground">Executions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Time</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Commission</th>
                        <th className="px-3 py-2 text-right">Fees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedExecutions.map((execution) => (
                        <tr key={execution.id}>
                          <td className="px-3 py-2 font-mono">{execution.time}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded px-2 py-0.5 ${
                                execution.side === 'ENTRY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {execution.side}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{execution.qty}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(execution.price)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(execution.commission ?? 0)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(execution.fees ?? 0)}</td>
                        </tr>
                      ))}
                      {sortedExecutions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No execution rows available.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-accent/50 p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-foreground">Overview</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {overviewItems.map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{label}</p>
                      <p className="mt-1 text-sm font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
