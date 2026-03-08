'use client';

import { useEffect, useMemo, useState } from 'react';
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
import TradesTab from '@/components/trading/TradesTab';
import JarvisTab from '@/components/trading/JarvisTab';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTrades } from '@/hooks/use-trades';

export default function NexusTerminal() {
  const isMobile = useIsMobile();
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
    folderInputRef,
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
    handleFolderUpload,
    fetchTradeDetail,
  } = useTrades();

  const selectedTrade = useMemo(() => trades.find((trade) => trade.id === selectedTradeId) ?? null, [selectedTradeId, trades]);

  useEffect(() => {
    if (!selectedTradeId) return;
    void fetchTradeDetail(selectedTradeId);
  }, [selectedTradeId, fetchTradeDetail]);

  const handleSignOut = () => {
    signOut({ callbackUrl: '/login' }).catch(() => {
      toast.error('Could not sign out');
    });
  };

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] font-sans text-[#E4E4E7]">
        <div className="mx-auto max-w-7xl p-8">
          <div className="flex h-16 items-center justify-between border-b border-white/5 bg-[#0A0A0B]">
            <div className="h-6 w-44 animate-pulse rounded bg-white/10" />
            <div className="h-6 w-24 animate-pulse rounded bg-white/10" />
          </div>

          <div className="mt-6 space-y-4">
            <div className="h-8 w-48 animate-pulse rounded bg-white/10" />
            <div className="h-40 animate-pulse rounded border border-white/5 bg-[#121214]" />
            <div className="h-10 w-72 animate-pulse rounded bg-white/10" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="h-36 animate-pulse rounded border border-white/5 bg-[#121214]" />
              <div className="h-36 animate-pulse rounded border border-white/5 bg-[#121214]" />
              <div className="h-36 animate-pulse rounded border border-white/5 bg-[#121214]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

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

      <main className={isMobile ? 'pb-16' : 'pl-56'}>
        <Toolbar
          useLocalStorage={useLocalStorage}
          error={error}
          user={user}
          filterPreset={filterPreset}
          selectedCount={selectedIds.size}
          onDeleteSelected={handleDeleteSelected}
          onFilterPresetChange={setFilterPreset}
          onImportClick={() => importInputRef.current?.click()}
          onFolderImportClick={() => folderInputRef.current?.click()}
          onNewTradeClick={() => setIsManualTradeOpen(true)}
        />
        <input ref={importInputRef} type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />
        {/* @ts-expect-error webkitdirectory is non-standard but widely supported */}
        <input ref={folderInputRef} type="file" accept=".csv" multiple webkitdirectory="" className="hidden" onChange={handleFolderUpload} />

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
              <TradesTab
                filteredTrades={filteredTrades}
                activeFilterCount={activeFilterCount}
                selectedIds={selectedIds}
                globalTags={globalTags}
                startDate={startDate}
                endDate={endDate}
                selectedFilterTags={selectedFilterTags}
                hasActiveFilters={hasActiveFilters}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
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
                riskInput={riskInput}
                bulkTagInput={bulkTagInput}
                onRiskInputChange={setRiskInput}
                onBulkTagInputChange={setBulkTagInput}
                onApplyRisk={handleApplyRisk}
                onBulkAddTag={handleBulkAddTag}
              />
            ) : null}

            {activeTab === 'jarvis' ? <JarvisTab trades={trades} /> : null}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="alertdialog" aria-label="Processing trade data">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#121214] p-8 shadow-2xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
            <p className="text-sm font-medium" aria-live="assertive">Processing Trade Data...</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
