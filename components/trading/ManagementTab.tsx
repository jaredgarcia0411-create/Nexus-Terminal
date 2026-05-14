'use client';

import { useState } from 'react';
import { motion } from 'motion/react';

import ArchiveTab from '@/components/trading/ArchiveTab';
import CareerPnlTab from '@/components/trading/CareerPnlTab';
import JournalTab from '@/components/trading/JournalTab';
import PerformanceTab from '@/components/trading/PerformanceTab';
import ResearchSubNav from '@/components/trading/ResearchSubNav';
import TradesTab from '@/components/trading/TradesTab';
import type { Trade } from '@/lib/types';

type SubTabKey = 'journal' | 'trades' | 'performance' | 'career-pnl' | 'archive';

// Order matches the spec: Journal first, then Trades (formerly the standalone
// "Management"/Trades tab), Performance, Career P/L, Archive.
const SUB_TABS: Array<{ key: SubTabKey; label: string }> = [
  { key: 'journal', label: 'Journal' },
  { key: 'trades', label: 'Trades' },
  { key: 'performance', label: 'Performance' },
  { key: 'career-pnl', label: 'Career P/L' },
  { key: 'archive', label: 'Archive' },
];

interface ManagementTabProps {
  trades: Trade[];
  filteredTrades: Trade[];
  globalTags: string[];
  selectedIds: Set<string>;
  selectedFilterTags: Set<string>;
  setSelectedFilterTags: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  clearAllFilters: () => void;
  searchQuery: string;
  riskInput: string;
  defaultRiskInput: string;
  bulkTagInput: string;
  performanceMetric: '$' | 'R';
  setPerformanceMetric: (metric: '$' | 'R') => void;
  setSearchQuery: (value: string) => void;
  setRiskInput: (value: string) => void;
  setDefaultRiskInput: (value: string) => void;
  setBulkTagInput: (value: string) => void;
  handleApplyRisk: () => void;
  handleSetDefaultRisk: () => void;
  handleBulkAddTag: () => void;
  handleToggleSelect: (id: string) => void;
  handleSelectAll: (ids: string[]) => void;
  handleAddTag: (tradeId: string, tagName: string) => void;
  handleRemoveTag: (tradeId: string, tagName: string) => void;
  handleDeleteGlobalTag: (tagName: string) => void;
  onTradeClick: (trade: Trade) => void;
}

export default function ManagementTab(props: ManagementTabProps) {
  // Default to Journal per the spec; sub-tab state lives here (not lifted) so
  // app/page.tsx stays simple.
  const [activeSubTab, setActiveSubTab] = useState<SubTabKey>('journal');

  return (
    <motion.div
      key="management"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-2"
    >
      <ResearchSubNav tabs={SUB_TABS} activeTab={activeSubTab} onTabChange={setActiveSubTab} />

      {activeSubTab === 'journal' ? (
        <JournalTab
          filteredTrades={props.filteredTrades}
          selectedIds={props.selectedIds}
          globalTags={props.globalTags}
          searchQuery={props.searchQuery}
          riskInput={props.riskInput}
          bulkTagInput={props.bulkTagInput}
          onSearchQueryChange={props.setSearchQuery}
          onRiskInputChange={props.setRiskInput}
          onBulkTagInputChange={props.setBulkTagInput}
          onApplyRisk={props.handleApplyRisk}
          onBulkAddTag={props.handleBulkAddTag}
          onToggleSelect={props.handleToggleSelect}
          onSelectAll={props.handleSelectAll}
          onAddTag={props.handleAddTag}
          onRemoveTag={props.handleRemoveTag}
          onDeleteGlobalTag={props.handleDeleteGlobalTag}
          onTradeClick={props.onTradeClick}
        />
      ) : null}

      {activeSubTab === 'trades' ? (
        <TradesTab
          filteredTrades={props.filteredTrades}
          activeFilterCount={props.activeFilterCount}
          selectedIds={props.selectedIds}
          globalTags={props.globalTags}
          selectedFilterTags={props.selectedFilterTags}
          hasActiveFilters={props.hasActiveFilters}
          searchQuery={props.searchQuery}
          onToggleFilterTag={(tag) => {
            props.setSelectedFilterTags((prev) => {
              const next = new Set(prev);
              if (next.has(tag)) next.delete(tag);
              else next.add(tag);
              return next;
            });
          }}
          onClearFilterTags={() => props.setSelectedFilterTags(new Set())}
          onDeleteGlobalTag={props.handleDeleteGlobalTag}
          onClearAllFilters={props.clearAllFilters}
          onToggleSelect={props.handleToggleSelect}
          onSelectAll={props.handleSelectAll}
          onAddTag={props.handleAddTag}
          onRemoveTag={props.handleRemoveTag}
          onTradeClick={props.onTradeClick}
          riskInput={props.riskInput}
          defaultRiskInput={props.defaultRiskInput}
          bulkTagInput={props.bulkTagInput}
          onSearchQueryChange={props.setSearchQuery}
          onRiskInputChange={props.setRiskInput}
          onDefaultRiskInputChange={props.setDefaultRiskInput}
          onBulkTagInputChange={props.setBulkTagInput}
          onApplyRisk={props.handleApplyRisk}
          onSetDefaultRisk={props.handleSetDefaultRisk}
          onBulkAddTag={props.handleBulkAddTag}
        />
      ) : null}

      {activeSubTab === 'performance' ? (
        <PerformanceTab
          filteredTrades={props.filteredTrades}
          globalTags={props.globalTags}
          performanceMetric={props.performanceMetric}
          onMetricChange={props.setPerformanceMetric}
          onTradeClick={props.onTradeClick}
        />
      ) : null}

      {activeSubTab === 'career-pnl' ? <CareerPnlTab /> : null}

      {activeSubTab === 'archive' ? <ArchiveTab trades={props.trades} /> : null}
    </motion.div>
  );
}
