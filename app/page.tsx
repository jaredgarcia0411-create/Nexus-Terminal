'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { signOut } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';

import NewTradeDialog from '@/components/trading/NewTradeDialog';
import TradeDetailSheet from '@/components/trading/TradeDetailSheet';
import Sidebar, { type TabKey } from '@/components/trading/Sidebar';
import Toolbar from '@/components/trading/Toolbar';
import DashboardTab from '@/components/trading/DashboardTab';
import ManagementTab from '@/components/trading/ManagementTab';
import SheetsTab from '@/components/trading/SheetsTab';
import ResearchTab from '@/components/trading/ResearchTab';
import CommandPalette from '@/components/trading/CommandPalette';
import { TabErrorBoundary } from '@/components/ui/TabErrorBoundary';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTrades } from '@/hooks/use-trades';
import type { Trade } from '@/lib/types';

const VALID_TABS: TabKey[] = ['dashboard', 'trades', 'journal', 'charts', 'sheets', 'research'];

const BacktestingTab = dynamic(() => import('@/components/trading/BacktestingTab'), {
  ssr: false,
  loading: () => <div className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] items-center justify-center text-sm text-muted-foreground">Loading charts...</div>,
});

const TAB_TITLES: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  trades: 'Trades',
  journal: 'Journal',
  charts: 'Charts',
  sheets: 'Sheets',
  research: 'Research',
};

export default function NexusTerminal() {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') {
      return 'dashboard';
    }

    const tabParam = new URLSearchParams(window.location.search).get('tab');
    const normalized = tabParam === 'management' ? 'trades' : tabParam;
    return normalized && VALID_TABS.includes(normalized as TabKey) ? (normalized as TabKey) : 'dashboard';
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

  // Keep the active tab in the URL so a refresh (or a bookmarked/shared link)
  // restores the same tab instead of falling back to Dashboard. Dashboard is
  // the default, so we leave the URL bare for it to keep things clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get('tab');

    if (activeTab === 'dashboard') {
      if (current === null) return;
      params.delete('tab');
    } else {
      if (current === activeTab) return;
      params.set('tab', activeTab);
    }

    const qs = params.toString();
    window.history.pushState({}, '', qs ? `?${qs}` : '/');
  }, [activeTab]);

  // When the user hits Back/Forward, sync the tab to whatever the URL now says.
  useEffect(() => {
    const onPopState = () => {
      const tabParam = new URLSearchParams(window.location.search).get('tab');
      const normalized = tabParam === 'management' ? 'trades' : tabParam;
      setActiveTab(
        normalized && VALID_TABS.includes(normalized as TabKey) ? (normalized as TabKey) : 'dashboard',
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
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
    handleCoverPosition,
    handleDeleteSelected,
    handleApplyRisk,
    handleSetDefaultRisk,
    handleSaveNotes,
    handleCloseTrade,
    handleMergeTrades,
    handleAddTag,
    handleRemoveTag,
    handleApplyTradeTags,
    handleCreateTag,
    handleDeleteGlobalTag,
    handleRenameGlobalTag,
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
    fetchTradeDetail(selectedTradeId).catch(() => {
      toast.error('Failed to load trade details');
    });
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

  // Trades + Journal are two top-level tabs backed by the same sub-tab
  // container; only the `group` prop differs. Spreading one object keeps the
  // two render sites from duplicating the whole prop list.
  const tradeWorkspaceProps = {
    trades,
    filteredTrades,
    globalTags,
    selectedIds,
    selectedFilterTags,
    setSelectedFilterTags,
    searchQuery,
    riskInput,
    defaultRiskInput,
    bulkTagInput,
    performanceMetric,
    setPerformanceMetric,
    setSearchQuery,
    setRiskInput,
    setDefaultRiskInput,
    setBulkTagInput,
    handleApplyRisk,
    handleSetDefaultRisk,
    handleBulkAddTag,
    handleToggleSelect,
    handleSelectAll,
    handleAddTag,
    handleRemoveTag,
    handleApplyTradeTags,
    handleCreateTag,
    handleDeleteGlobalTag,
    handleRenameGlobalTag,
    onMergeTrades: handleMergeTrades,
    positionFilter,
    onPositionFilterChange: setPositionFilter,
    onTradeClick: (trade: Trade) => setSelectedTradeId(trade.id),
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

        <div
          className={
            activeTab === 'charts' || activeTab === 'research' || activeTab === 'sheets'
              ? 'px-3 py-4'
              : activeTab === 'trades' || activeTab === 'journal'
                ? 'mx-auto max-w-7xl px-4 py-4 md:px-8'
                : 'mx-auto max-w-7xl p-4 md:p-8'
          }
        >
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

            {activeTab === 'trades' ? (
              <TabErrorBoundary name="Trades">
                <ManagementTab key="trades" {...tradeWorkspaceProps} group="trades" />
              </TabErrorBoundary>
            ) : null}

            {activeTab === 'journal' ? (
              <TabErrorBoundary name="Journal">
                <ManagementTab key="journal" {...tradeWorkspaceProps} group="journal" />
              </TabErrorBoundary>
            ) : null}

            {activeTab === 'sheets' ? (
              <TabErrorBoundary name="Sheets">
                <SheetsTab />
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

      <NewTradeDialog
        open={isManualTradeOpen}
        onOpenChange={setIsManualTradeOpen}
        onCreateTrade={handleCreateManualTrade}
        openPositions={trades.filter((trade) => trade.isOpen)}
        onCoverPosition={handleCoverPosition}
      />
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
