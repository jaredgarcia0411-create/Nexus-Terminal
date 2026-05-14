'use client';

import { motion } from 'motion/react';
import { Search, X } from 'lucide-react';
import TradeTable from '@/components/trading/TradeTable';
import TagFilterDropdown from '@/components/trading/TagFilterDropdown';
import { Button } from '@/components/ui/button';
import type { Trade } from '@/lib/types';

interface TradesTabProps {
  filteredTrades: Trade[];
  activeFilterCount: number;
  selectedIds: Set<string>;
  globalTags: string[];
  selectedFilterTags: Set<string>;
  hasActiveFilters: boolean;
  searchQuery: string;
  riskInput: string;
  defaultRiskInput: string;
  bulkTagInput: string;
  onSearchQueryChange: (value: string) => void;
  onToggleFilterTag: (tag: string) => void;
  onClearFilterTags: () => void;
  onDeleteGlobalTag: (tagName: string) => void;
  onClearAllFilters: () => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onTradeClick: (trade: Trade) => void;
  onRiskInputChange: (value: string) => void;
  onDefaultRiskInputChange: (value: string) => void;
  onBulkTagInputChange: (value: string) => void;
  onApplyRisk: () => void;
  onSetDefaultRisk: () => void;
  onBulkAddTag: () => void;
}

export default function TradesTab({
  filteredTrades,
  activeFilterCount,
  selectedIds,
  globalTags,
  selectedFilterTags,
  hasActiveFilters,
  searchQuery,
  defaultRiskInput,
  onSearchQueryChange,
  onToggleFilterTag,
  onClearFilterTags,
  onDeleteGlobalTag,
  onClearAllFilters,
  onToggleSelect,
  onSelectAll,
  onAddTag,
  onRemoveTag,
  onTradeClick,
  riskInput,
  onDefaultRiskInputChange,
  bulkTagInput,
  onRiskInputChange,
  onBulkTagInputChange,
  onApplyRisk,
  onSetDefaultRisk,
  onBulkAddTag,
}: TradesTabProps) {
  return (
    <motion.div key="filter" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
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
          <div className="flex flex-wrap items-center gap-2">
            {hasActiveFilters ? (
              <div className="flex items-center gap-2 rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-400">
                <span>Filtered ({activeFilterCount})</span>
                <button onClick={onClearAllFilters} className="text-emerald-300 transition-colors hover:text-white" title="Clear filters">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Add risk ($) to selected"
              value={riskInput}
              onChange={(e) => onRiskInputChange(e.target.value)}
              className="w-full md:w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
            />
            <Button onClick={onApplyRisk} className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">
              Apply Risk
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Set automatic risk ($)"
              value={defaultRiskInput}
              onChange={(event) => onDefaultRiskInputChange(event.target.value)}
              className="w-full md:w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
            />
            <Button onClick={onSetDefaultRisk} className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">
              Set Auto Risk
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Tag Filters</h3>
          <div className="flex flex-wrap items-center gap-3">
            <TagFilterDropdown
              globalTags={globalTags}
              selectedTags={selectedFilterTags}
              onToggleTag={onToggleFilterTag}
              onClearTags={onClearFilterTags}
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Add tag to selected"
                value={bulkTagInput}
                onChange={(e) => onBulkTagInputChange(e.target.value)}
                className="w-full md:w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
              />
              <Button onClick={onBulkAddTag} className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">
                Add Tag
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Trades ({filteredTrades.length})</h3>
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
          readOnly={false}
        />
      </div>
    </motion.div>
  );
}
