'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Plus, X } from 'lucide-react';
import type { Trade } from '@/lib/types';
import { formatCurrency, formatR, getPnLColor } from '@/lib/trading-utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

interface TradeTableProps {
  trades: Trade[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
  onTradeClick?: (trade: Trade) => void;
  globalTags: string[];
  readOnly?: boolean;
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
  globalTags,
  readOnly = false,
}: TradeTableProps) {
  const allSelected = trades.length > 0 && trades.every((trade) => selectedIds.has(trade.id));
  const [tagPopoverTradeId, setTagPopoverTradeId] = useState<string | null>(null);
  const [tagQuery, setTagQuery] = useState('');

  const tableTradeIds = useMemo(() => trades.map((trade) => trade.id), [trades]);

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#121214]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/5 bg-white/5 text-zinc-500 font-medium">
          <tr>
            {!readOnly ? (
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  className="rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500/20"
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
            <th className="px-4 py-3 text-right">PnL</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-white/5">
          {trades.map((trade) => {
            const availableTags = globalTags.filter((tag) => !(trade.tags ?? []).includes(tag));

            return (
              <tr
                key={trade.id}
                className={`transition-colors group ${onTradeClick && !readOnly ? 'hover:bg-white/5 cursor-pointer' : ''} ${
                  !readOnly && selectedIds.has(trade.id) ? 'bg-emerald-500/5' : ''
                }`}
                onClick={() => {
                  if (!readOnly) onTradeClick?.(trade);
                }}
              >
                {!readOnly ? (
                  <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500/20"
                      checked={selectedIds.has(trade.id)}
                      onChange={() => onToggleSelect(trade.id)}
                    />
                  </td>
                ) : null}

                <td className="px-4 py-3 text-zinc-400 font-mono whitespace-nowrap">{format(new Date(trade.date), 'MMM dd, yyyy')}</td>
                <td className="px-4 py-3 font-medium">{trade.symbol}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      trade.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                    }`}
                  >
                    {trade.direction}
                  </span>
                </td>

                <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                  <div className="flex flex-wrap gap-1 items-center max-w-[220px]">
                    {(trade.tags ?? []).map((tag) => (
                      <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-zinc-400 group/tag">
                        {tag}
                        {!readOnly ? (
                          <button
                            onClick={() => onRemoveTag(trade.id, tag)}
                            className="opacity-0 group-hover/tag:opacity-100 hover:text-rose-500 transition-opacity"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        ) : null}
                      </span>
                    ))}

                    {!readOnly ? (
                      <Popover open={tagPopoverTradeId === trade.id} onOpenChange={(open) => setTagPopoverTradeId(open ? trade.id : null)}>
                        <PopoverTrigger asChild>
                          <button className="p-1 hover:bg-white/10 rounded text-zinc-500 hover:text-emerald-500 transition-colors" title="Add Tag">
                            <Plus className="w-3 h-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-0 bg-[#18181b] border-white/10 text-white" align="start">
                          <Command className="bg-transparent">
                            <CommandInput
                              placeholder="Search or create tag..."
                              value={tagQuery}
                              onValueChange={setTagQuery}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && tagQuery.trim()) {
                                  onAddTag(trade.id, tagQuery.trim());
                                  setTagQuery('');
                                  setTagPopoverTradeId(null);
                                }
                              }}
                            />
                            <CommandList>
                              <CommandEmpty>{`Press Enter to create \"${tagQuery.trim()}\"`}</CommandEmpty>
                              <CommandGroup heading="Available Tags">
                                {availableTags.map((tag) => (
                                  <CommandItem
                                    key={tag}
                                    value={tag}
                                    onSelect={() => {
                                      onAddTag(trade.id, tag);
                                      setTagQuery('');
                                      setTagPopoverTradeId(null);
                                    }}
                                  >
                                    <span className="flex-1">{tag}</span>
                                    {onDeleteGlobalTag ? (
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onDeleteGlobalTag(tag);
                                        }}
                                        className="text-zinc-500 hover:text-rose-500"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    ) : null}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                </td>

                <td className="px-4 py-3 max-w-[220px] text-xs text-zinc-400 line-clamp-2">{trade.notes?.trim() || '-'}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(trade.avgEntryPrice)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(trade.avgExitPrice)}</td>
                <td className="px-4 py-3 text-right font-mono text-zinc-400">{trade.totalQuantity}</td>
                <td className="px-4 py-3 text-right font-mono text-zinc-500">{trade.initialRisk ? formatCurrency(trade.initialRisk) : '-'}</td>
                <td className={`px-4 py-3 text-right font-mono font-medium ${getPnLColor(trade.pnl)}`}>
                  <div className="flex flex-col items-end">
                    <span>{formatCurrency(trade.pnl)}</span>
                    {trade.initialRisk ? <span className="text-[10px] opacity-70">{formatR(trade.pnl / trade.initialRisk)}</span> : null}
                  </div>
                </td>
              </tr>
            );
          })}

          {trades.length === 0 ? (
            <tr>
              <td colSpan={readOnly ? 11 : 12} className="px-4 py-12 text-center text-zinc-500 italic">
                No trades found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
