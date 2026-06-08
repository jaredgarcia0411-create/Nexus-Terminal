'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

import ArchiveTab from '@/components/trading/ArchiveTab';
import CareerPnlTab from '@/components/trading/CareerPnlTab';
import JournalTab from '@/components/trading/JournalTab';
import PlaybookTab from '@/components/trading/PlaybookTab';
import PerformanceTab from '@/components/trading/PerformanceTab';
import ResearchSubNav from '@/components/trading/ResearchSubNav';
import TradesTab from '@/components/trading/TradesTab';
import type { Trade } from '@/lib/types';

type SubTabKey = 'calendar' | 'history' | 'performance' | 'playbook' | 'career-pnl' | 'reviews';

// Two top-level tabs share this container. `group` selects which sub-tabs show.
const TRADES_SUB_TABS: Array<{ key: SubTabKey; label: string }> = [
  { key: 'history', label: 'History' },
  { key: 'performance', label: 'Performance' },
  { key: 'career-pnl', label: 'Career P/L' },
  { key: 'playbook', label: 'Playbook' },
];

const JOURNAL_SUB_TABS: Array<{ key: SubTabKey; label: string }> = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'reviews', label: 'Reviews' },
];

// Remember the last sub-tab per group so a refresh returns where you were.
const TRADES_SUBTAB_KEY = 'nexus.trades.subTab';
const JOURNAL_SUBTAB_KEY = 'nexus.journal.subTab';

interface ManagementTabProps {
  trades: Trade[];
  filteredTrades: Trade[];
  globalTags: string[];
  selectedIds: Set<string>;
  selectedFilterTags: Set<string>;
  setSelectedFilterTags: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
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
  handleApplyTradeTags: (assignments: Array<{ tradeId: string; tags: string[] }>) => Promise<void>;
  handleCreateTag: (tagName: string) => void;
  handleDeleteGlobalTag: (tagName: string) => void;
  handleRenameGlobalTag: (from: string, to: string) => Promise<void>;
  onMergeTrades?: (ids: string[]) => void;
  positionFilter?: 'all' | 'open' | 'closed';
  onPositionFilterChange?: (filter: 'all' | 'open' | 'closed') => void;
  onTradeClick: (trade: Trade) => void;
  group: 'trades' | 'journal';
}

export default function ManagementTab(props: ManagementTabProps) {
  const { group } = props;
  const subTabs = group === 'trades' ? TRADES_SUB_TABS : JOURNAL_SUB_TABS;
  const storageKey = group === 'trades' ? TRADES_SUBTAB_KEY : JOURNAL_SUBTAB_KEY;
  const defaultSubTab: SubTabKey = group === 'trades' ? 'history' : 'calendar';

  // Sub-tab state lives here (not lifted) so app/page.tsx stays simple.
  // Hydrate from localStorage when the stored value is valid for this group.
  const [activeSubTab, setActiveSubTab] = useState<SubTabKey>(() => {
    if (typeof window === 'undefined') return defaultSubTab;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && subTabs.some((t) => t.key === stored)) return stored as SubTabKey;
    } catch {
      // Ignore storage failures (private browsing etc.).
    }
    return defaultSubTab;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, activeSubTab);
    } catch {
      // Ignore storage failures — non-critical preference.
    }
  }, [storageKey, activeSubTab]);

  return (
    <motion.div
      key={group}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-2"
    >
      <ResearchSubNav tabs={subTabs} activeTab={activeSubTab} onTabChange={setActiveSubTab} />

      {activeSubTab === 'calendar' ? (
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
          onApplyTradeTags={props.handleApplyTradeTags}
          onCreateTag={props.handleCreateTag}
          onDeleteGlobalTag={props.handleDeleteGlobalTag}
          onTradeClick={props.onTradeClick}
        />
      ) : null}

      {activeSubTab === 'history' ? (
        <TradesTab
          filteredTrades={props.filteredTrades}
          selectedIds={props.selectedIds}
          globalTags={props.globalTags}
          selectedFilterTags={props.selectedFilterTags}
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
          onRenameGlobalTag={props.handleRenameGlobalTag}
          onToggleSelect={props.handleToggleSelect}
          onSelectAll={props.handleSelectAll}
          onAddTag={props.handleAddTag}
          onRemoveTag={props.handleRemoveTag}
          onMergeTrades={props.onMergeTrades}
          onTradeClick={props.onTradeClick}
          positionFilter={props.positionFilter}
          onPositionFilterChange={props.onPositionFilterChange}
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

      {activeSubTab === 'playbook' ? <PlaybookTab trades={props.trades} globalTags={props.globalTags} /> : null}

      {activeSubTab === 'career-pnl' ? <CareerPnlTab /> : null}

      {activeSubTab === 'reviews' ? <ArchiveTab trades={props.trades} /> : null}
    </motion.div>
  );
}
