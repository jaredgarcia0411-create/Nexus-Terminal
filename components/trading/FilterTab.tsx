'use client';

import { motion } from 'motion/react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import TradeTable from '@/components/trading/TradeTable';
import { Button } from '@/components/ui/button';
import type { Trade } from '@/lib/types';

interface FilterTabProps {
  filteredTrades: Trade[];
  selectedIds: Set<string>;
  globalTags: string[];
  startDate: string;
  endDate: string;
  selectedFilterTags: Set<string>;
  hasActiveFilters: boolean;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onToggleFilterTag: (tag: string) => void;
  onDeleteGlobalTag: (tagName: string) => void;
  onClearAllFilters: () => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onTradeClick: (trade: Trade) => void;
}

export default function FilterTab({
  filteredTrades,
  selectedIds,
  globalTags,
  startDate,
  endDate,
  selectedFilterTags,
  hasActiveFilters,
  onStartDateChange,
  onEndDateChange,
  onToggleFilterTag,
  onDeleteGlobalTag,
  onClearAllFilters,
  onToggleSelect,
  onSelectAll,
  onAddTag,
  onRemoveTag,
  onTradeClick,
}: FilterTabProps) {
  return (
    <motion.div key="filter" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
      <div className="flex flex-col gap-6 rounded-2xl border border-white/5 bg-[#121214] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Advanced Filters</h2>
          <div className="flex shrink-0 items-center gap-2 rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-500">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            {filteredTrades.length} TRADES LOGGED
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Date Range</h3>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <CalendarIcon className="h-4 w-4 text-zinc-500" />
              <input type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} className="bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]" />
              <span className="text-zinc-600">to</span>
              <input type="date" value={endDate} onChange={(event) => onEndDateChange(event.target.value)} className="bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]" />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Tag Filters</h3>
            <div className="flex flex-wrap gap-2">
              {globalTags.map((tag) => (
                <div
                  key={tag}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
                    selectedFilterTags.has(tag)
                      ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-500'
                      : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10'
                  }`}
                  onClick={() => onToggleFilterTag(tag)}
                >
                  <span>{tag}</span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteGlobalTag(tag);
                    }}
                    className="rounded p-0.5 text-zinc-600 transition-colors hover:bg-rose-500/20 hover:text-rose-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {globalTags.length === 0 ? <span className="text-sm italic text-zinc-600">No tags created yet.</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Filtered Results ({filteredTrades.length})</h3>
          {hasActiveFilters ? (
            <Button variant="ghost" onClick={onClearAllFilters} className="text-xs font-medium text-rose-500 hover:text-rose-400">
              Clear All Filters
            </Button>
          ) : null}
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
          readOnly
        />
      </div>
    </motion.div>
  );
}
