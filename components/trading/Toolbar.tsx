'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Plus, Trash2, User, X } from 'lucide-react';
import ImportDropdown from '@/components/trading/ImportDropdown';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ToolbarProps {
  filteredTradesCount: number;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  clearAllFilters: () => void;
  useLocalStorage: boolean;
  error: string | null;
  user: { name?: string | null; email?: string | null; image?: string | null } | undefined;
  filterPreset: 'all' | '30' | '60' | '90';
  selectedCount: number;
  onDeleteSelected: () => void;
  onFilterPresetChange: (value: 'all' | '30' | '60' | '90') => void;
  onImportClick: () => void;
  onFolderImportClick: () => void;
  onNewTradeClick: () => void;
}

export default function Toolbar({
  filteredTradesCount,
  activeFilterCount,
  hasActiveFilters,
  clearAllFilters,
  useLocalStorage,
  error,
  user,
  filterPreset,
  selectedCount,
  onDeleteSelected,
  onFilterPresetChange,
  onImportClick,
  onFolderImportClick,
  onNewTradeClick,
}: ToolbarProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center gap-2 border-b border-white/5 bg-[#0A0A0B]/80 px-4 py-2 backdrop-blur-md sm:h-16 sm:flex-nowrap sm:justify-between sm:gap-3 sm:px-8 sm:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <h1 className="shrink-0 text-lg font-medium tracking-tight">Nexus Terminal</h1>
          <div className="mx-1 hidden h-4 w-px bg-white/10 sm:mx-2 sm:block" />
          <div className="flex shrink-0 items-center gap-2 rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-500">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            {filteredTradesCount} TRADES LOGGED
          </div>

          {hasActiveFilters ? (
            <div className="flex items-center gap-2 rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-400">
              <span>Filtered ({activeFilterCount})</span>
              <button onClick={clearAllFilters} className="text-emerald-300 transition-colors hover:text-white" title="Clear filters">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}

          {!isMobile ? (
            <span className="text-[10px] uppercase tracking-widest text-zinc-600">{useLocalStorage ? 'Local Storage Mode' : 'Cloud Mode'}</span>
          ) : null}

          <div className="ml-0 flex items-center gap-1 sm:ml-2">
            {[
              { id: 'all', label: 'All' },
              { id: '30', label: '30D' },
              { id: '60', label: '60D' },
              { id: '90', label: '90D' },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => onFilterPresetChange(preset.id as 'all' | '30' | '60' | '90')}
                className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors sm:px-2.5 ${
                  filterPreset === preset.id
                    ? 'bg-emerald-500 text-black'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                }`}
                title={`Filter ${preset.label}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {!isMobile ? (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-medium">{user?.name}</div>
              <div className="text-[10px] text-zinc-500">{user?.email}</div>
            </div>
            <div>
              {user?.image ? (
                <Image src={user.image} alt={user.name ?? 'User'} width={32} height={32} className="h-8 w-8 rounded-full border border-white/10" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/20">
                  <User className="h-4 w-4 text-emerald-500" />
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {selectedCount > 0 ? (
            <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-2 sm:gap-3">
              <span className="text-xs font-medium text-zinc-500">{selectedCount} selected</span>
              <button
                onClick={() => setConfirmDeleteOpen(true)}
                className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-500 transition-colors hover:bg-rose-500/20"
                title="Delete Selected"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <ImportDropdown onImportFiles={onImportClick} onImportFolder={onFolderImportClick} />

          <Button
            onClick={onNewTradeClick}
            className="flex items-center gap-2 bg-emerald-500 px-4 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            New Trade
          </Button>
        </div>

        {error ? (
          <div className="w-full rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-1.5 text-xs font-medium text-rose-500 sm:order-none sm:mx-8 sm:flex-1">
            {error}
          </div>
        ) : null}
      </header>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="border-white/10 bg-[#121214] text-white">
          <DialogHeader>
            <DialogTitle>Delete selected trades?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400">{selectedCount} trade(s) will be permanently deleted. This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)} className="bg-white/10 hover:bg-white/20">
              Cancel
            </Button>
            <Button
              onClick={() => {
                onDeleteSelected();
                setConfirmDeleteOpen(false);
              }}
              className="bg-rose-500 text-white hover:bg-rose-400"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
