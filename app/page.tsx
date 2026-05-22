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
import ManagementTab from '@/components/trading/ManagementTab';
import BacktestingTab from '@/components/trading/BacktestingTab';
import ResearchTab from '@/components/trading/ResearchTab';
import CommandPalette from '@/components/trading/CommandPalette';
import { TabErrorBoundary } from '@/components/ui/TabErrorBoundary';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTrades } from '@/hooks/use-trades';

const VALID_TABS: TabKey[] = ['dashboard', 'management', 'charts', 'research'];

const TAB_TITLES: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  management: 'Management',
  charts: 'Charts',
  research: 'Research',
};

export default function NexusTerminal() {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') {
      return 'dashboard';
    }

    const tabParam = new URLSearchParams(window.location.search).get('tab');
    return tabParam && VALID_TABS.includes(tabParam as TabKey) ? (tabParam as TabKey) : 'dashboard';
  });
  const [performanceMetric, setPerformanceMetric] = useState<'$' | 'R'>('$');
  const [isManualTradeOpen, setIsManualTradeOpen] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingResearchTicker, setPendingResearchTicker] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('sidebarCollapsed');
    return stored === 'true';
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');

    if (tabParam && VALID_TABS.includes(tabParam as TabKey)) {
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const {
    user,
    trades,
    globalTags,
    filteredTrades,
    isImporting,
    mounted,
    error,
    importInputRef,
    folderInputRef,
    traderVueInputRef,
    selectedIds,
    startDate,
    endDate,
    riskInput,
    defaultRiskInput,
    filterPreset,
    selectedFilterTags,
    positionFilter,
    bulkTagInput,
    searchQuery,
    setStartDate,
    setEndDate,
    setRiskInput,
    setDefaultRiskInput,
    setFilterPreset,
    setSelectedFilterTags,
    setPositionFilter,
    setBulkTagInput,
    setSearchQuery,
    handleToggleSelect,
    handleSelectAll,
    handleCreateManualTrade,
    handleDeleteSelected,
    handleApplyRisk,
    handleSetDefaultRisk,
    handleSaveNotes,
    handleCloseTrade,
    handleMergeTrades,
    handleAddTag,
    handleRemoveTag,
    handleDeleteGlobalTag,
    handleBulkAddTag,
    handleClearAllData,
    handleFileUpload,
    handleFolderUpload,
    handleTraderVueImport,
    fetchTradeDetail,
  } = useTrades();

  const selectedTrade = useMemo(() => trades.find((trade) => trade.id === selectedTradeId) ?? null, [selectedTradeId, trades]);

  useGlobalShortcuts({ setActiveTab, setCommandPaletteOpen });

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
      <div className="min-h-screen bg-background font-sans text-foreground">
        <div className="mx-auto max-w-7xl p-8">
          <div className="flex h-16 items-center justify-between border-b border-border bg-background">
            <div className="h-6 w-44 animate-pulse rounded bg-accent" />
            <div className="h-6 w-24 animate-pulse rounded bg-accent" />
          </div>

          <div className="mt-6 space-y-4">
            <div className="h-8 w-48 animate-pulse rounded bg-accent" />
            <div className="h-40 animate-pulse rounded border border-border bg-card" />
            <div className="h-10 w-72 animate-pulse rounded bg-accent" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="h-36 animate-pulse rounded border border-border bg-card" />
              <div className="h-36 animate-pulse rounded border border-border bg-card" />
              <div className="h-36 animate-pulse rounded border border-border bg-card" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleToggleSidebarCollapse = () => {
    const newValue = !sidebarCollapsed;
    setSidebarCollapsed(newValue);
    localStorage.setItem('sidebarCollapsed', String(newValue));
  };

  return (
    <div className="min-h-screen bg-background font-sans text-foreground selection:bg-emerald-500/30">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        trades={trades}
        onClearAllData={handleClearAllData}
        onSignOut={handleSignOut}
        onNewTradeClick={() => setIsManualTradeOpen(true)}
        onImportClick={() => importInputRef.current?.click()}
        onFolderImportClick={() => folderInputRef.current?.click()}
        onTraderVueImportClick={() => traderVueInputRef.current?.click()}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebarCollapse}
      />

      <main className={isMobile ? 'pb-16' : sidebarCollapsed ? 'pl-16' : 'pl-56'}>
      <Toolbar
        activeTab={activeTab}
        pageTitle={TAB_TITLES[activeTab]}
        error={error}
        filterPreset={filterPreset}
        selectedCount={selectedIds.size}
        onDeleteSelected={handleDeleteSelected}
        onFilterPresetChange={setFilterPreset}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />
        <input ref={importInputRef} type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />
        {/* @ts-expect-error webkitdirectory is non-standard but widely supported */}
        <input ref={folderInputRef} type="file" accept=".csv" multiple webkitdirectory="" className="hidden" onChange={handleFolderUpload} />
        <input ref={traderVueInputRef} type="file" accept=".csv" multiple className="hidden" onChange={handleTraderVueImport} />

        <div className={activeTab === 'charts' || activeTab === 'research' ? 'px-3 py-4' : 'mx-auto max-w-7xl p-8'}>
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' ? (
              <TabErrorBoundary name="Dashboard">
                <DashboardTab
                  onNavigateToResearch={(ticker) => {
                    setPendingResearchTicker(ticker);
                    setActiveTab('research');
                  }}
                />
              </TabErrorBoundary>
            ) : null}

            {activeTab === 'management' ? (
              <TabErrorBoundary name="Management">
                <ManagementTab
                  trades={trades}
                  filteredTrades={filteredTrades}
                  globalTags={globalTags}
                  selectedIds={selectedIds}
                  selectedFilterTags={selectedFilterTags}
                  setSelectedFilterTags={setSelectedFilterTags}
                  searchQuery={searchQuery}
                  riskInput={riskInput}
                  defaultRiskInput={defaultRiskInput}
                  bulkTagInput={bulkTagInput}
                  performanceMetric={performanceMetric}
                  setPerformanceMetric={setPerformanceMetric}
                  setSearchQuery={setSearchQuery}
                  setRiskInput={setRiskInput}
                  setDefaultRiskInput={setDefaultRiskInput}
                  setBulkTagInput={setBulkTagInput}
                  handleApplyRisk={handleApplyRisk}
                  handleSetDefaultRisk={handleSetDefaultRisk}
                  handleBulkAddTag={handleBulkAddTag}
                  handleToggleSelect={handleToggleSelect}
                  handleSelectAll={handleSelectAll}
                  handleAddTag={handleAddTag}
                  handleRemoveTag={handleRemoveTag}
                  handleDeleteGlobalTag={handleDeleteGlobalTag}
                  onMergeTrades={handleMergeTrades}
                  positionFilter={positionFilter}
                  onPositionFilterChange={setPositionFilter}
                  onTradeClick={(trade) => setSelectedTradeId(trade.id)}
                />
              </TabErrorBoundary>
            ) : null}

            {activeTab === 'charts' ? (
              <TabErrorBoundary name="Charts">
                <BacktestingTab />
              </TabErrorBoundary>
            ) : null}

            {activeTab === 'research' ? (
              <TabErrorBoundary name="Research">
                <ResearchTab
                  pendingResearchTicker={pendingResearchTicker}
                  onClearPendingTicker={() => setPendingResearchTicker(null)}
                />
              </TabErrorBoundary>
            ) : null}
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
        onCloseTrade={handleCloseTrade}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        setActiveTab={setActiveTab}
        onNewTradeClick={() => setIsManualTradeOpen(true)}
        onImportClick={() => importInputRef.current?.click()}
      />

      {isImporting ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm" role="alertdialog" aria-label="Processing trade data">
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 shadow-2xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
            <p className="text-sm font-medium" aria-live="assertive">Processing Trade Data...</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
