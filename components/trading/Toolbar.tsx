'use client';

import Image from 'next/image';
import { Plus, Trash2, Upload, User, X } from 'lucide-react';

interface ToolbarProps {
  filteredTradesCount: number;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  clearAllFilters: () => void;
  useLocalStorage: boolean;
  error: string | null;
  user: { name?: string | null; email?: string | null; image?: string | null } | undefined;
  selectedCount: number;
  onDeleteSelected: () => void;
  onImportClick: () => void;
  onNewTradeClick: () => void;
  onSignOut: () => void;
}

export default function Toolbar({
  filteredTradesCount,
  activeFilterCount,
  hasActiveFilters,
  clearAllFilters,
  useLocalStorage,
  error,
  user,
  selectedCount,
  onDeleteSelected,
  onImportClick,
  onNewTradeClick,
  onSignOut,
}: ToolbarProps) {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/5 bg-[#0A0A0B]/80 px-8 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-medium tracking-tight">Nexus Terminal</h1>
        <div className="mx-2 h-4 w-px bg-white/10" />
        <div className="flex items-center gap-2 rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-500">
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

        <span className="text-[10px] uppercase tracking-widest text-zinc-600">{useLocalStorage ? 'Local Storage Mode' : 'Cloud Mode'}</span>
      </div>

      {error ? (
        <div className="mx-8 flex-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-1.5 text-xs font-medium text-rose-500">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-medium">{user?.name}</div>
            <div className="text-[10px] text-zinc-500">{user?.email}</div>
          </div>
          <button onClick={onSignOut} className="group relative">
            {user?.image ? (
              <Image src={user.image} alt={user.name ?? 'User'} width={32} height={32} className="h-8 w-8 rounded-full border border-white/10" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/20">
                <User className="h-4 w-4 text-emerald-500" />
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#0A0A0B] bg-rose-500 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        </div>

        {selectedCount > 0 ? (
          <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-500">{selectedCount} selected</span>
            <button
              onClick={onDeleteSelected}
              className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-500 transition-colors hover:bg-rose-500/20"
              title="Delete Selected"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <button
          onClick={onImportClick}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          <Upload className="h-4 w-4" />
          Bulk Import
        </button>

        <button
          onClick={onNewTradeClick}
          className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          New Trade
        </button>
      </div>
    </header>
  );
}
