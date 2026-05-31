'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';

import TradeTagEditor from '@/components/trading/TradeTagEditor';
import type { Trade } from '@/lib/types';
import { formatCurrency, formatR, getPnLColor } from '@/lib/ui-trade-utils';

interface TradeTableProps {
  trades: Trade[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
  onTradeClick?: (trade: Trade) => void;
  onMergeTrades?: (ids: string[]) => void;
  globalTags: string[];
  readOnly?: boolean;
  hideSelection?: boolean;
  pnlMode?: 'net' | 'gross';
  positionFilter?: 'all' | 'open' | 'closed';
  onPositionFilterChange?: (filter: 'all' | 'open' | 'closed') => void;
}

export default function TradeTable({
  trades,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
  onTradeClick,
  onMergeTrades,
  globalTags,
  readOnly = false,
  hideSelection = false,
  pnlMode = 'net',
  positionFilter = 'all',
  onPositionFilterChange,
}: TradeTableProps) {
  const allSelected = trades.length > 0 && trades.every((trade) => selectedIds.has(trade.id));

  const tableTradeIds = useMemo(() => trades.map((trade) => trade.id), [trades]);
  const shouldScroll = trades.length > 20;
  const canMerge = !readOnly && onMergeTrades && selectedIds.size >= 2;

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        {onPositionFilterChange ? (
          <div className="flex items-center gap-1 rounded-lg border border-border bg-accent p-0.5">
            {(['all', 'open', 'closed'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => onPositionFilterChange(filter)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  positionFilter === filter
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        ) : <div />}
        {canMerge ? (
          <button
            type="button"
            onClick={() => onMergeTrades?.(Array.from(selectedIds))}
            className="px-3 py-1 rounded-md border border-border bg-accent text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Merge {selectedIds.size} trades
          </button>
        ) : null}
      </div>
      <div className={`overflow-x-auto rounded border border-border bg-card ${shouldScroll ? 'max-h-[46rem] overflow-y-auto' : ''}`}>
      <table className="w-full tabular-nums text-left text-sm">
        <thead className="border-b border-border bg-accent text-muted-foreground font-medium">
          <tr>
            {!readOnly && !hideSelection ? (
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  className="rounded border-border bg-accent text-primary focus:ring-ring"
                  checked={allSelected}
                  onChange={() => onSelectAll(tableTradeIds)}
                />
              </th>
            ) : null}
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Symbol</th>
            <th className="px-4 py-3">Side</th>
            <th className="px-4 py-3">Tags</th>
            <th className="px-4 py-3">Notes</th>
            <th className="px-4 py-3 text-right">Avg Entry</th>
            <th className="px-4 py-3 text-right">Avg Exit</th>
            <th className="px-4 py-3 text-right">Qty</th>
            <th className="px-4 py-3 text-right">Risk ($)</th>
            <th className="px-4 py-3 text-right">P/L</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {trades.map((trade) => {
            const pnlValue = pnlMode === 'gross' ? trade.grossPnl : trade.netPnl;

            return (
              <tr
                key={trade.id}
                className={`transition-colors group ${onTradeClick && !readOnly ? 'hover:bg-accent cursor-pointer' : ''} ${
                  !readOnly && selectedIds.has(trade.id) ? 'bg-primary/5' : ''
                }`}
                onClick={() => {
                  if (!readOnly) onTradeClick?.(trade);
                }}
              >
                {!readOnly && !hideSelection ? (
                  <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-border bg-accent text-primary focus:ring-ring"
                      checked={selectedIds.has(trade.id)}
                      onChange={() => onToggleSelect(trade.id)}
                    />
                  </td>
                ) : null}

                <td className="px-4 py-3 text-muted-foreground font-mono whitespace-nowrap">{format(new Date(trade.date), 'MMM dd, yyyy')}</td>
                <td className="px-4 py-3 font-medium">
                  <span>{trade.symbol}</span>
                  {trade.isOpen ? (
                    <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400">
                      OPEN
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-sm font-bold ${
                      trade.direction === 'LONG' ? 'text-emerald-500' : 'text-rose-500'
                    }`}
                  >
                    {trade.direction === 'LONG' ? 'L' : 'S'}
                  </span>
                </td>

                <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                  <TradeTagEditor
                    tags={trade.tags ?? []}
                    globalTags={globalTags}
                    readOnly={readOnly}
                    maxWidthClassName="max-w-[220px]"
                    onAddTag={(tag) => onAddTag(trade.id, tag)}
                    onRemoveTag={(tag) => onRemoveTag(trade.id, tag)}
                    onDeleteGlobalTag={onDeleteGlobalTag}
                  />
                </td>

                <td className="px-4 py-3 max-w-[220px] text-xs text-muted-foreground line-clamp-2">{trade.notes?.trim() || '-'}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(trade.avgEntryPrice)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(trade.avgExitPrice)}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">{trade.totalQuantity}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">{trade.initialRisk ? formatCurrency(trade.initialRisk) : '-'}</td>
                <td className={`px-4 py-3 text-right font-mono font-medium ${trade.isOpen ? 'text-muted-foreground' : getPnLColor(pnlValue)}`}>
                  <div className="flex flex-col items-end">
                    {trade.isOpen ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <>
                        <span>{formatCurrency(pnlValue)}</span>
                        {trade.initialRisk ? <span className="text-[10px] opacity-70">{formatR(pnlValue / trade.initialRisk)}</span> : null}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}

          {trades.length === 0 ? (
            <tr>
              <td colSpan={(readOnly || hideSelection) ? 10 : 11} className="px-4 py-12 text-center text-muted-foreground italic">
                No trades found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </>
  );
}
