'use client';

import { motion } from 'motion/react';
import { Search, Tag as TagIcon } from 'lucide-react';
import TradeTable from '@/components/trading/TradeTable';
import type { Trade } from '@/lib/types';

interface JournalTabProps {
  filteredTrades: Trade[];
  selectedIds: Set<string>;
  globalTags: string[];
  searchQuery: string;
  riskInput: string;
  bulkTagInput: string;
  onSearchQueryChange: (value: string) => void;
  onRiskInputChange: (value: string) => void;
  onBulkTagInputChange: (value: string) => void;
  onApplyRisk: () => void;
  onBulkAddTag: () => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag: (tagName: string) => void;
  onTradeClick: (trade: Trade) => void;
}

export default function JournalTab({
  filteredTrades,
  selectedIds,
  globalTags,
  searchQuery,
  riskInput,
  bulkTagInput,
  onSearchQueryChange,
  onRiskInputChange,
  onBulkTagInputChange,
  onApplyRisk,
  onBulkAddTag,
  onToggleSelect,
  onSelectAll,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
  onTradeClick,
}: JournalTabProps) {
  return (
    <motion.div key="journal" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex flex-col gap-6 rounded-2xl border border-white/5 bg-[#121214] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold">Trading Journal</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                className="w-64 rounded-lg border border-white/10 bg-white/5 py-1.5 pl-10 pr-4 text-sm transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
              />
            </div>
          </div>

          {selectedIds.size > 0 ? (
            <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                <span className="text-[10px] font-bold uppercase text-zinc-500">Set Risk:</span>
                <input
                  type="number"
                  placeholder="$500"
                  value={riskInput}
                  onChange={(event) => onRiskInputChange(event.target.value)}
                  className="w-16 border-b border-white/10 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
                />
                <button onClick={onApplyRisk} className="text-[10px] font-bold uppercase text-emerald-500 hover:text-emerald-400">
                  Apply
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                <TagIcon className="h-3 w-3 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Add Tag..."
                  value={bulkTagInput}
                  onChange={(event) => onBulkTagInputChange(event.target.value)}
                  className="w-20 border-b border-white/10 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
                />
                <button onClick={onBulkAddTag} className="text-[10px] font-bold uppercase text-emerald-500 hover:text-emerald-400">
                  Add
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <TradeTable
        trades={filteredTrades}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onSelectAll={onSelectAll}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        onDeleteGlobalTag={onDeleteGlobalTag}
        onTradeClick={onTradeClick}
        globalTags={globalTags}
      />
    </motion.div>
  );
}
