'use client';

import { useMemo } from 'react';

import type { Trade } from '@/lib/types';

interface WeeklyTradesPanelProps {
  trades: Trade[];
}

interface WeeklyTradeRow {
  id: string;
  ticker: string;
  tags: string[];
  r: number | null;
}

// R is only meaningful when the trade has a positive initial risk.
// Mirrors the rule used in `lib/journal-aggregates.ts`.
function computeRow(trade: Trade): WeeklyTradeRow {
  const r = trade.initialRisk && trade.initialRisk > 0 ? trade.netPnl / trade.initialRisk : null;
  return {
    id: trade.id,
    ticker: trade.symbol,
    tags: trade.tags ?? [],
    r,
  };
}

function formatR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

export default function WeeklyTradesPanel({ trades }: WeeklyTradesPanelProps) {
  // Sort chronologically by sortKey so the order matches the Trade Replay Charts
  // section below it — same trades, same visual order.
  const rows = useMemo(
    () =>
      trades
        .slice()
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.entryTime.localeCompare(b.entryTime))
        .map(computeRow),
    [trades],
  );

  const rowCount = rows.length;
  const showEmpty = rowCount === 0;

  // Three columns: ticker (narrow) · tags (wide) · R (narrow, right-aligned).
  const gridCols = 'grid-cols-[80px_minmax(160px,1fr)_70px]';

  return (
    <section className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Weekly Trades</h3>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <div className={`grid ${gridCols} gap-px bg-white/10`}>
          <div className="bg-[#121214] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Ticker
          </div>
          <div className="bg-[#121214] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Tags
          </div>
          <div className="bg-[#121214] px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            R
          </div>

          {showEmpty ? (
            <div className="col-span-3 bg-[#121214] px-3 py-4 text-xs italic text-zinc-500">
              No trades logged this week.
            </div>
          ) : (
            rows.map((row) => (
              <RowCells key={row.id} row={row} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function RowCells({ row }: { row: WeeklyTradeRow }) {
  const cellBase = 'bg-[#121214] px-3 py-2 text-xs';
  // R color follows the same convention used elsewhere in the app:
  // green for positive, rose for negative, muted for null.
  const rColor =
    row.r === null
      ? 'text-zinc-500'
      : row.r >= 0
        ? 'text-emerald-400'
        : 'text-rose-400';

  return (
    <>
      <div className={`${cellBase} font-medium text-white`}>{row.ticker}</div>
      <div className={cellBase}>
        {row.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </div>
      <div className={`${cellBase} text-right font-medium ${rColor}`}>
        {row.r === null ? '—' : formatR(row.r)}
      </div>
    </>
  );
}
