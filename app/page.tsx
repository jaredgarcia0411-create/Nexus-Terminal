'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';

import NewTradeDialog from '@/components/trading/NewTradeDialog';
import TradeDetailSheet from '@/components/trading/TradeDetailSheet';
import Sidebar, { type TabKey } from '@/components/trading/Sidebar';
import Toolbar from '@/components/trading/Toolbar';
import DashboardTab from '@/components/trading/DashboardTab';
import JournalTab from '@/components/trading/JournalTab';
import PerformanceTab from '@/components/trading/PerformanceTab';
import FilterTab from '@/components/trading/FilterTab';
import BacktestingTab from '@/components/trading/BacktestingTab';
import { useTrades } from '@/hooks/use-trades';

export default function NexusTerminal() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [performanceMetric, setPerformanceMetric] = useState<'$' | 'R'>('$');
  const [isManualTradeOpen, setIsManualTradeOpen] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);

  const {
    user,
    trades,
    globalTags,
    filteredTrades,
    isImporting,
    mounted,
    error,
    useLocalStorage,
    importInputRef,
    selectedIds,
    startDate,
    endDate,
    riskInput,
    filterPreset,
    selectedFilterTags,
    bulkTagInput,
    searchQuery,
    hasActiveFilters,
    activeFilterCount,
    clearAllFilters,
    setStartDate,
    setEndDate,
    setRiskInput,
    setFilterPreset,
    setSelectedFilterTags,
    setBulkTagInput,
    setSearchQuery,
    handleToggleSelect,
    handleSelectAll,
    handleCreateManualTrade,
    handleDeleteSelected,
    handleApplyRisk,
    handleSaveNotes,
    handleAddTag,
    handleRemoveTag,
    handleDeleteGlobalTag,
    handleBulkAddTag,
    handleClearAllData,
    handleFileUpload,
  } = useTrades();

  const selectedTrade = useMemo(() => trades.find((trade) => trade.id === selectedTradeId) ?? null, [selectedTradeId, trades]);

  const handleSignOut = () => {
    signOut().catch(() => {
      toast.error('Could not sign out');
    });
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[#0A0A0B] font-sans text-[#E4E4E7] selection:bg-emerald-500/30">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        trades={trades}
        onClearAllData={handleClearAllData}
        onSignOut={handleSignOut}
      />

      <main className="pl-16">
        <Toolbar
          filteredTradesCount={filteredTrades.length}
          activeFilterCount={activeFilterCount}
          hasActiveFilters={hasActiveFilters}
          clearAllFilters={clearAllFilters}
          useLocalStorage={useLocalStorage}
          error={error}
          user={user}
          selectedCount={selectedIds.size}
          onDeleteSelected={handleDeleteSelected}
          onImportClick={() => importInputRef.current?.click()}
          onNewTradeClick={() => setIsManualTradeOpen(true)}
          onSignOut={handleSignOut}
        />
        <input ref={importInputRef} type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />

        <div className="mx-auto max-w-7xl p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' ? (
              <DashboardTab
                trades={trades}
                filteredTrades={filteredTrades}
                performanceMetric={performanceMetric}
                selectedIds={selectedIds}
                globalTags={globalTags}
                onImportClick={() => importInputRef.current?.click()}
                onNewTradeClick={() => setIsManualTradeOpen(true)}
                onSetActiveTab={() => setActiveTab('journal')}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                onDeleteGlobalTag={handleDeleteGlobalTag}
                onTradeClick={(trade) => setSelectedTradeId(trade.id)}
              />
            ) : null}

            {activeTab === 'journal' ? (
              <JournalTab
                filteredTrades={filteredTrades}
                selectedIds={selectedIds}
                globalTags={globalTags}
                searchQuery={searchQuery}
                riskInput={riskInput}
                bulkTagInput={bulkTagInput}
                onSearchQueryChange={setSearchQuery}
                onRiskInputChange={setRiskInput}
                onBulkTagInputChange={setBulkTagInput}
                onApplyRisk={handleApplyRisk}
                onBulkAddTag={handleBulkAddTag}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                onDeleteGlobalTag={handleDeleteGlobalTag}
                onTradeClick={(trade) => setSelectedTradeId(trade.id)}
              />
            ) : null}

            {activeTab === 'performance' ? (
              <PerformanceTab
                filteredTrades={filteredTrades}
                performanceMetric={performanceMetric}
                onMetricChange={setPerformanceMetric}
              />
            ) : null}

            {activeTab === 'filter' ? (
              <FilterTab
                filteredTrades={filteredTrades}
                selectedIds={selectedIds}
                globalTags={globalTags}
                startDate={startDate}
                endDate={endDate}
                filterPreset={filterPreset}
                selectedFilterTags={selectedFilterTags}
                hasActiveFilters={hasActiveFilters}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onFilterPresetChange={setFilterPreset}
                onToggleFilterTag={(tag) => {
                  setSelectedFilterTags((prev) => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag);
                    else next.add(tag);
                    return next;
                  });
                }}
                onDeleteGlobalTag={handleDeleteGlobalTag}
                onClearAllFilters={clearAllFilters}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                onTradeClick={(trade) => setSelectedTradeId(trade.id)}
              />
            ) : null}

            {activeTab === 'backtesting' ? <BacktestingTab /> : null}
          </AnimatePresence>
        </div>
      </main>

      <NewTradeDialog open={isManualTradeOpen} onOpenChange={setIsManualTradeOpen} onCreateTrade={handleCreateManualTrade} />
      <TradeDetailSheet
        key={selectedTrade?.id ?? 'no-trade'}
        trade={selectedTrade}
        open={!!selectedTrade}
        onOpenChange={(open) => {
          if (!open) setSelectedTradeId(null);
        }}
        onSaveNotes={handleSaveNotes}
      />

      {isImporting ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#121214] p-8 shadow-2xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
            <p className="text-sm font-medium">Processing Trade Data...</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
