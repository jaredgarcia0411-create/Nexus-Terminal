'use client';

import { useMemo } from 'react';

import TradeTagEditor from '@/components/trading/TradeTagEditor';
import type { Trade } from '@/lib/types';

interface WeeklyTradesPanelProps {
  trades: Trade[];
  // Header + empty-state are overridable so the same panel can serve the
  // Daily Review (passes "Daily Trades" / "No trades logged today.").
  title?: string;
  emptyState?: string;
  globalTags?: string[];
  readOnly?: boolean;
  onAddTag?: (tradeId: string, tagName: string) => void;
  onRemoveTag?: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
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

export default function WeeklyTradesPanel({
  trades,
  title = 'Weekly Trades',
  emptyState = 'No trades logged this week.',
  globalTags = [],
  readOnly = true,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
}: WeeklyTradesPanelProps) {
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
  // Using inline gridTemplateColumns instead of a Tailwind arbitrary class —
  // Tailwind's JIT can miss dynamic class strings in newly-added files until
  // the dev server is restarted, and we hit that here.
  const gridTemplateColumns = '80px minmax(160px, 1fr) 70px';

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid gap-px bg-accent" style={{ gridTemplateColumns }}>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Ticker
          </div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Tags
          </div>
          <div className="bg-card px-3 py-2 text-right text-xs font-semibold text-foreground">
            R
          </div>

          {showEmpty ? (
            <div className="col-span-3 bg-card px-3 py-4 text-xs italic text-muted-foreground">
              {emptyState}
            </div>
          ) : (
            rows.map((row) => (
              <RowCells
                key={row.id}
                row={row}
                globalTags={globalTags}
                readOnly={readOnly}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
                onDeleteGlobalTag={onDeleteGlobalTag}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function RowCells({
  row,
  globalTags,
  readOnly,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
}: {
  row: WeeklyTradeRow;
  globalTags: string[];
  readOnly: boolean;
  onAddTag?: (tradeId: string, tagName: string) => void;
  onRemoveTag?: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
}) {
  const cellBase = 'bg-card px-3 py-2 text-sm';
  // R color follows the same convention used elsewhere in the app:
  // green for positive, rose for negative, muted for null.
  const rColor =
    row.r === null
      ? 'text-muted-foreground'
      : row.r >= 0
        ? 'text-emerald-400'
        : 'text-rose-400';

  return (
    <>
      <div className={`${cellBase} font-medium text-foreground`}>{row.ticker}</div>
      <div className={cellBase}>
        {!readOnly && onAddTag && onRemoveTag ? (
          <TradeTagEditor
            tags={row.tags}
            globalTags={globalTags}
            onAddTag={(tag) => onAddTag(row.id, tag)}
            onRemoveTag={(tag) => onRemoveTag(row.id, tag)}
            onDeleteGlobalTag={onDeleteGlobalTag}
          />
        ) : row.tags.length > 0 ? (
          <TradeTagEditor tags={row.tags} globalTags={globalTags} readOnly emptyLabel="—" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div className={`${cellBase} text-right font-medium ${rColor}`}>
        {row.r === null ? '—' : formatR(row.r)}
      </div>
    </>
  );
}
