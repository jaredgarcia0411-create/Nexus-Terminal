'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Trade } from '@/lib/types';
import { buildTradeMarkers, formatCurrency, formatR, getPnLColor } from '@/lib/trading-utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CandlestickChart from '@/components/trading/CandlestickChart';
import type { TradeMarker } from '@/lib/types';
import { useCandleData } from '@/hooks/use-candle-data';
import {
  buildTradeChartOptions,
  TRADE_CHART_TIMEFRAME_CONFIG,
  type TradeChartTimeframeKey,
} from '@/lib/chart-timeframes';
import { nyDateTimeToEpoch, parseAbsoluteTimestampMs } from '@/lib/time-utils';

interface TradeDetailSheetProps {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveNotes: (tradeId: string, notes: string) => Promise<void> | void;
  onCloseTrade?: (tradeId: string, exitPrice: number, exitTime: string) => Promise<void>;
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
  const [notes, setNotes] = useState(trade?.notes ?? '');
  const [timeframe, setTimeframe] = useState<TradeChartTimeframeKey>('5m');
  const [closeExitPrice, setCloseExitPrice] = useState('');
  const [closeExitTime, setCloseExitTime] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const chartOptions = useMemo(() => {
    if (!trade) return null;
    return buildTradeChartOptions(trade.sortKey, timeframe);
  }, [trade, timeframe]);

  const { candles, isLoading: loadingCandles, error: candlesError } = useCandleData(
    trade?.symbol ?? null,
    chartOptions ?? undefined,
  );

  const sortedExecutions = useMemo(() => {
    if (!trade) return [];
    return [...(trade.rawExecutions ?? [])].sort(
      (a, b) => timeValue(trade.sortKey, a.time, a.timestamp) - timeValue(trade.sortKey, b.time, b.timestamp),
    );
  }, [trade]);

  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    if (!trade) return [];
    return buildTradeMarkers(trade);
  }, [trade]);

  const handleSave = async () => {
    if (!trade) return;
    try {
      await onSaveNotes(trade.id, notes);
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
        ['Closed Gross PnL', formatCurrency(trade.grossPnl)],
        ['Commissions + Fees', formatCurrency((trade.commission ?? 0) + (trade.fees ?? 0))],
        ['Closed Net PnL', formatCurrency(trade.netPnl)],
        ['Gross Return (R)', trade.initialRisk ? formatR(trade.grossPnl / trade.initialRisk) : '-'],
        ['Net Return (R)', trade.initialRisk ? formatR(trade.netPnl / trade.initialRisk) : '-'],
        ['Position MFE', prettyNumber(trade.mfe)],
        ['Position MAE', prettyNumber(trade.mae)],
        ['Best Exit PnL', prettyNumber(trade.bestExitPnl)],
        ['Exit Efficiency', prettyPct(trade.exitEfficiency)],
        ['Entry Time', trade.entryTime || '-'],
        ['Exit Time', trade.exitTime || '-'],
        ['Execution Count', String(trade.executionCount)],
        ['Initial Risk', trade.initialRisk ? formatCurrency(trade.initialRisk) : '-'],
      ]
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="min-h-0 w-full sm:max-w-3xl bg-[#121214] border-white/10 text-white">
        <SheetHeader>
          <SheetTitle className="text-xl">Trade Details</SheetTitle>
        </SheetHeader>

        {!trade ? null : (
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm text-zinc-500">{format(new Date(trade.date), 'MMM dd, yyyy HH:mm')}</p>
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
                <p className="text-[12px] text-zinc-500">{trade.isOpen ? 'Open Position' : 'Net PnL'}</p>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
              <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-white">Overview</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {overviewItems.map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[12px] uppercase tracking-wider text-zinc-500">{label}</p>
                      <p className="mt-1 text-sm font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              </section>

              {trade.isOpen && onCloseTrade ? (
                <section className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <h3 className="text-base font-semibold uppercase tracking-wider text-amber-400">Close Position</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wider text-zinc-500">Exit Price</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={closeExitPrice}
                        onChange={(event) => setCloseExitPrice(event.target.value)}
                        className="bg-white/5 border-white/10 h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wider text-zinc-500">Exit Time</label>
                      <Input
                        type="text"
                        placeholder="15:59:00"
                        value={closeExitTime}
                        onChange={(event) => setCloseExitTime(event.target.value)}
                        className="bg-white/5 border-white/10 h-8 text-sm"
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

              <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-white">Chart</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-end gap-4">
                    <Select value={timeframe} onValueChange={(value) => setTimeframe(value as TradeChartTimeframeKey)}>
                      <SelectTrigger className="h-8 w-28 bg-white/5 border-white/10 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#121214] border-white/10 text-white">
                        {Object.entries(TRADE_CHART_TIMEFRAME_CONFIG).map(([value, cfg]) => (
                          <SelectItem key={value} value={value}>
                            {cfg.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {loadingCandles ? (
                    <div className="flex h-[640px] items-center justify-center text-sm text-zinc-400">Loading candles...</div>
                  ) : candlesError ? (
                    <div className="flex h-[640px] items-center justify-center text-sm text-zinc-400">
                      {candlesError}
                    </div>
                  ) : candles.length === 0 ? (
                    <div className="flex h-[640px] items-center justify-center text-sm text-zinc-400">
                      No candle data available for this trade window.
                    </div>
                  ) : (
                    <CandlestickChart
                      candles={candles}
                      tradeMarkers={tradeMarkers}
                      height={640}
                      exactPriceMarkers
                      showTimeAxis
                      showSessionShading={timeframe !== '1d'}
                    />
                  )}
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-white">Executions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-zinc-500">
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
                          <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No execution rows available.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-base font-semibold uppercase tracking-wider text-white">Notes</h3>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Textarea
                      id="trade-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={10}
                      className="bg-white/5 border-white/10"
                      placeholder="Add notes about setup quality, execution, emotions, and lessons learned..."
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button onClick={handleSave} className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">
                      Save Notes
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
