'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBacktestStats } from '@/hooks/use-backtest-stats';
import { FILTER_REGISTRY } from '@/lib/backtest-filters';
import { apiRequest } from '@/lib/trade-utils';
import { formatCurrency, formatR } from '@/lib/ui-trade-utils';

interface BacktestStatsViewProps {
  backtestId: string;
  onBack: () => void;
  onOpenInChart: (
    ticker: string,
    date: string,
    activeBacktest: { id: string | null; name: string | null; userId: string | null },
  ) => void;
  currentUserId: string | null;
}

function formatMetricNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toFixed(1);
}

function formatDateSpan(dates: string[]) {
  if (dates.length === 0) return '--';
  const sorted = [...dates].sort();
  return `${sorted[0]} - ${sorted[sorted.length - 1]}`;
}

function formatWinRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTotalReturnR(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

function formatHoldTime(mins: number | null): string {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return '--';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

export default function BacktestStatsView({
  backtestId,
  onBack,
  onOpenInChart,
  currentUserId,
}: BacktestStatsViewProps) {
  const {
    backtest,
    filteredReviews,
    aggregateStats,
    activeFilterIds,
    toggleFilter,
    dynamicFilters,
    isLoading,
    error,
    refetch,
  } = useBacktestStats(backtestId);

  const filterGroups = useMemo(() => {
    const groups = ['outcome', 'direction', 'gap', 'grade', 'setup'];
    const allFilters = [...FILTER_REGISTRY, ...dynamicFilters];
    return groups
      .map((group) => ({
        group,
        filters: allFilters.filter((filterDef) => filterDef.group === group),
      }))
      .filter((entry) => entry.filters.length > 0);
  }, [dynamicFilters]);

  const periodSpan = useMemo(
    () => formatDateSpan(filteredReviews.map((review) => review.session.date)),
    [filteredReviews],
  );

  const handleEditNotes = async (reviewId: string, currentNotes: string | null) => {
    const nextNotes = window.prompt('Edit notes', currentNotes ?? '');
    if (nextNotes == null) return;

    try {
      await apiRequest(`/api/backtest/sessions/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: nextNotes }),
      });
      toast.success('Notes updated');
      refetch();
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Could not update notes');
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!window.confirm('Delete this review?')) return;

    try {
      await apiRequest(`/api/backtest/sessions/${reviewId}`, {
        method: 'DELETE',
      });
      toast.success('Review deleted');
      refetch();
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Could not delete review');
    }
  };

  if (isLoading) {
    return <section className="flex h-[calc(100dvh-6.5rem)] flex-1 items-center justify-center text-sm text-muted-foreground">Loading stats...</section>;
  }

  if (error || !backtest || !aggregateStats) {
    return (
      <section className="flex h-[calc(100dvh-6.5rem)] flex-1 flex-col items-center justify-center gap-3 text-sm">
        <p className="text-rose-400">{error ?? 'Could not load backtest stats'}</p>
        <Button type="button" variant="ghost" onClick={onBack} className="text-muted-foreground hover:bg-accent hover:text-foreground">
          Back
        </Button>
      </section>
    );
  }

  return (
    <section className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onBack}
          className="text-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to backtest manager"
          title="Back to backtest manager"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-mono text-lg font-semibold text-foreground">{backtest.name}</h2>
            <p className="text-sm text-muted-foreground">
              by {backtest.ownerName ?? 'Unknown'}
              {backtest.sampleSetName ? ` · ${backtest.sampleSetName}` : ''}
              {periodSpan !== '--' ? ` · ${periodSpan}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Total Return', formatCurrency(aggregateStats.totalReturn)],
              ['Total Return (R)', formatTotalReturnR(aggregateStats.totalReturnR)],
              ['Avg R', formatMetricNumber(aggregateStats.expectancyR)],
              ['Win Rate', formatWinRate(aggregateStats.winRate)],
              ['Profit Factor', formatMetricNumber(aggregateStats.profitFactor)],
              ['Max Drawdown', formatCurrency(aggregateStats.maxDrawdown)],
              ['Avg Hold Time', formatHoldTime(aggregateStats.avgHoldMinutes)],
              ['Total Trades', String(aggregateStats.totalTrades)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border bg-popover p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                <div className="mt-2 font-mono text-lg text-foreground">{value}</div>
              </div>
            ))}
          </div>

          <div className="px-4">
            <div className="h-64 rounded-md border border-border bg-popover p-3">
              {aggregateStats.equityCurve.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No reviewed sessions in this backtest yet. Launch the chart to start reviewing.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={aggregateStats.equityCurve}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#71717a', fontSize: 11 }}
                      tickFormatter={(value) => {
                        const parsed = Date.parse(value);
                        return Number.isFinite(parsed) ? format(new Date(parsed), 'MM/dd') : value;
                      }}
                    />
                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={(value) => formatCurrency(Number(value))} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111319',
                        borderColor: 'rgba(255,255,255,0.1)',
                        color: '#fff',
                      }}
                      formatter={(value) => [formatCurrency(Number(value ?? 0)), 'Cumulative P/L']}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulativePnl"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-wrap gap-3">
              {filterGroups.map(({ group, filters }) => (
                <div key={group} className="flex flex-wrap items-center gap-2">
                  {filters.map((filterDef) => {
                    const active = activeFilterIds.has(filterDef.id);
                    return (
                      <button
                        key={filterDef.id}
                        type="button"
                        onClick={() => toggleFilter(filterDef.id)}
                        className={
                          active
                            ? 'rounded-md border border-emerald-300/40 bg-primary/20 px-2.5 py-1 text-xs text-emerald-300'
                            : 'rounded-md border border-border bg-accent px-2.5 py-1 text-xs text-muted-foreground'
                        }
                      >
                        {filterDef.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {filteredReviews.length === 0 ? (
              <div className="rounded-md border border-border bg-popover px-4 py-6 text-sm text-muted-foreground">
                No reviewed sessions in this backtest yet. Launch the chart to start reviewing.
              </div>
            ) : (
              <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-md border border-border bg-popover text-left">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {['Ticker', 'Date', 'Direction', 'P/L', 'R-Mult', 'Grade', 'Setup', 'Notes', ''].map((heading) => (
                      <th key={heading} className="border-b border-border px-3 py-2 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...filteredReviews]
                    .sort((a, b) => a.session.date.localeCompare(b.session.date))
                    .map((review) => {
                      const isOwner = review.session.userId === currentUserId;
                      const notesExcerpt = review.session.notes?.trim()
                        ? `${review.session.notes.trim().slice(0, 40)}${review.session.notes.trim().length > 40 ? '...' : ''}`
                        : '--';

                      return (
                        <tr key={review.session.id} className="text-sm text-foreground">
                          <td className="border-b border-border px-3 py-2 font-mono text-foreground">{review.session.ticker}</td>
                          <td className="border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground">{review.session.date}</td>
                          <td className="border-b border-border px-3 py-2">{review.stats.direction ?? '--'}</td>
                          <td className="border-b border-border px-3 py-2 font-mono">{formatCurrency(review.stats.realizedPnl)}</td>
                          <td className="border-b border-border px-3 py-2 font-mono">
                            {review.stats.rMultiple == null ? '--' : formatR(review.stats.rMultiple)}
                          </td>
                          <td className="border-b border-border px-3 py-2">{review.stats.grade ?? '--'}</td>
                          <td className="border-b border-border px-3 py-2">{review.stats.setupType ?? '--'}</td>
                          <td className="border-b border-border px-3 py-2 text-muted-foreground">{notesExcerpt}</td>
                          <td className="border-b border-border px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={() => onOpenInChart(review.session.ticker, review.session.date, {
                                  id: backtest.id,
                                  name: backtest.name,
                                  userId: backtest.ownerId ?? backtest.userId ?? null,
                                })}
                                className="h-7 border border-border bg-accent text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                              >
                                Open
                              </Button>
                              {isOwner ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      className="text-muted-foreground hover:bg-accent hover:text-foreground"
                                      aria-label={`Manage ${review.session.ticker} review`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="border-border bg-popover text-foreground">
                                    <DropdownMenuItem
                                      onSelect={() => void handleEditNotes(review.session.id, review.session.notes)}
                                      className="cursor-pointer text-xs"
                                    >
                                      Edit Notes
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => void handleDeleteReview(review.session.id)}
                                      className="cursor-pointer text-xs text-rose-300"
                                    >
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
