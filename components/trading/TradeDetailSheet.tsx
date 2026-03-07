'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Trade } from '@/lib/types';
import { formatCurrency, formatR, getPnLColor } from '@/lib/trading-utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CandlestickChart, { type TradeMarker } from '@/components/trading/CandlestickChart';
import { useCandleData } from '@/hooks/use-candle-data';

interface TradeDetailSheetProps {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveNotes: (tradeId: string, notes: string) => Promise<void> | void;
}

type TimeframeKey = '1m' | '5m' | '15m' | '1d';
type DetailTab = 'overview' | 'chart' | 'executions' | 'notes';

const TIMEFRAME_CONFIG: Record<
  TimeframeKey,
  { label: string; periodType: string; period: string; frequencyType: string; frequency: string }
> = {
  '1m': { label: '1m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '1' },
  '5m': { label: '5m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '5' },
  '15m': { label: '15m', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '15' },
  '1d': { label: 'Daily', periodType: 'year', period: '1', frequencyType: 'daily', frequency: '1' },
};

const NOTE_TEMPLATES = [
  'Setup:\n',
  'Execution:\n',
  'Risk Management:\n',
  'Lesson Learned:\n',
];

const NY_TIME_ZONE = 'America/New_York';
const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parseSortKey(sortKey: string) {
  const match = sortKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseTimeValue(time: string) {
  const match = String(time ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

function getNyOffsetMs(atEpochMs: number) {
  const parts = NY_DATE_PARTS.formatToParts(new Date(atEpochMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - atEpochMs;
}

function nyDateTimeToEpoch(sortKey: string, time: string) {
  const dateParts = parseSortKey(sortKey);
  const timeParts = parseTimeValue(time);
  if (!dateParts || !timeParts) return null;

  const utcGuess = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    timeParts.seconds,
  );

  const offset = getNyOffsetMs(utcGuess);
  return utcGuess - offset;
}

function getMarketWindowMs(sortKey: string) {
  const start = nyDateTimeToEpoch(sortKey, '09:30:00');
  const end = nyDateTimeToEpoch(sortKey, '16:00:00');
  if (start == null || end == null) return {};

  return {
    startDate: String(start),
    endDate: String(end),
  };
}

function timeValue(sortKey: string, time: string, timestamp?: string | Date) {
  if (timestamp) {
    const parsed = new Date(timestamp).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  const nyEpoch = nyDateTimeToEpoch(sortKey, time);
  if (nyEpoch != null) return nyEpoch;

  const fallback = new Date(`${sortKey}T${time}`).getTime();
  return Number.isFinite(fallback) ? fallback : 0;
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

function executionCashDelta(trade: Trade, side: 'ENTRY' | 'EXIT', price: number, qty: number, commission = 0, fees = 0) {
  const cost = commission + fees;
  if (trade.direction === 'LONG') {
    return side === 'ENTRY' ? -price * qty - cost : price * qty - cost;
  }
  return side === 'ENTRY' ? price * qty - cost : -price * qty - cost;
}

export default function TradeDetailSheet({ trade, open, onOpenChange, onSaveNotes }: TradeDetailSheetProps) {
  const [notes, setNotes] = useState(trade?.notes ?? '');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('5m');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  const chartOptions = useMemo(() => {
    if (!trade) return null;
    const base = TIMEFRAME_CONFIG[timeframe];
    if (timeframe === '1d') return base;
    return { ...base, ...getMarketWindowMs(trade.sortKey) };
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
    return sortedExecutions.map((execution) => ({
      time: timeValue(trade.sortKey, execution.time, execution.timestamp),
      direction: execution.side === 'ENTRY' ? 'LONG' : 'SHORT',
      price: execution.price,
      label: execution.side,
    }));
  }, [trade, sortedExecutions]);

  const executionRows = useMemo(() => {
    if (!trade) return [];
    let running = 0;
    return sortedExecutions.map((execution) => {
      running += executionCashDelta(
        trade,
        execution.side,
        execution.price,
        execution.qty,
        execution.commission ?? 0,
        execution.fees ?? 0,
      );
      return { execution, running };
    });
  }, [trade, sortedExecutions]);

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

  const tabButtonClass = (tab: DetailTab) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      activeTab === tab ? 'bg-emerald-500 text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
    }`;

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
      <SheetContent side="right" className="w-full sm:max-w-3xl bg-[#121214] border-white/10 text-white">
        <SheetHeader>
          <SheetTitle>Trade Details</SheetTitle>
        </SheetHeader>

        {!trade ? null : (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3">
              <div>
                <p className="text-xs text-zinc-500">{format(new Date(trade.date), 'MMM dd, yyyy HH:mm')}</p>
                <p className="text-sm font-semibold">
                  {trade.symbol}{' '}
                  <span
                    className={`ml-1 rounded px-2 py-0.5 text-[10px] ${
                      trade.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {trade.direction}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${getPnLColor(trade.netPnl)}`}>{formatCurrency(trade.netPnl)}</p>
                <p className="text-[10px] text-zinc-500">Net PnL</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="flex min-w-max gap-2">
                <button className={tabButtonClass('overview')} onClick={() => setActiveTab('overview')}>Overview</button>
                <button className={tabButtonClass('chart')} onClick={() => setActiveTab('chart')}>Chart</button>
                <button className={tabButtonClass('executions')} onClick={() => setActiveTab('executions')}>Executions</button>
                <button className={tabButtonClass('notes')} onClick={() => setActiveTab('notes')}>Notes</button>
              </div>
            </div>

            {activeTab === 'overview' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {overviewItems.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
                      <p className="mt-1 text-sm font-medium">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end" />
              </div>
            ) : null}

            {activeTab === 'chart' ? (
              <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Chart</p>
                  <Select value={timeframe} onValueChange={(value) => setTimeframe(value as TimeframeKey)}>
                    <SelectTrigger className="h-8 w-28 bg-white/5 border-white/10 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#18181b] border-white/10 text-white">
                      {Object.entries(TIMEFRAME_CONFIG).map(([value, cfg]) => (
                        <SelectItem key={value} value={value}>
                          {cfg.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {loadingCandles ? (
                  <div className="flex h-[320px] items-center justify-center text-sm text-zinc-400">Loading candles...</div>
                ) : candlesError ? (
                  <div className="flex h-[320px] items-center justify-center text-sm text-zinc-400">
                    {candlesError}
                  </div>
                ) : candles.length === 0 ? (
                  <div className="flex h-[320px] items-center justify-center text-sm text-zinc-400">
                    No candle data available for this trade window.
                  </div>
                ) : (
                  <CandlestickChart candles={candles} tradeMarkers={tradeMarkers} height={320} />
                )}
              </div>
            ) : null}

            {activeTab === 'executions' ? (
              <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/5">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Side</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">Commission</th>
                      <th className="px-3 py-2 text-right">Fees</th>
                      <th className="px-3 py-2 text-right">Running PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executionRows.map(({ execution, running }) => (
                      <tr key={execution.id} className="border-b border-white/5 last:border-b-0">
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
                        <td className={`px-3 py-2 text-right font-mono ${getPnLColor(running)}`}>{formatCurrency(running)}</td>
                      </tr>
                    ))}
                    {executionRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">No execution rows available.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}

            {activeTab === 'notes' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {NOTE_TEMPLATES.map((template) => (
                    <button
                      key={template}
                      onClick={() => setNotes((prev) => `${prev}${prev ? '\n' : ''}${template}`)}
                      className="rounded bg-white/10 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/20"
                    >
                      Insert {template.trim().replace(':', '')}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trade-notes">Notes</Label>
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
                  <Button onClick={handleSave} className="bg-emerald-500 hover:bg-emerald-400 text-black">
                    Save Notes
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
