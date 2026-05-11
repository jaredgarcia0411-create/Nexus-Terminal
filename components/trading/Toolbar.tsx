'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ToolbarProps {
  pageTitle: string;
  activeTab: string;
  error: string | null;
  filterPreset: 'all' | '30' | '60' | '90';
  selectedCount: number;
  onDeleteSelected: () => void;
  onFilterPresetChange: (value: 'all' | '30' | '60' | '90') => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

export default function Toolbar({
  pageTitle,
  activeTab,
  error,
  filterPreset,
  selectedCount,
  onDeleteSelected,
  onFilterPresetChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: ToolbarProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center gap-2 border-b border-white/5 bg-[#0A0A0B]/80 px-4 py-2 backdrop-blur-md sm:h-16 sm:flex-nowrap sm:justify-between sm:gap-3 sm:px-8 sm:py-0">
        {/* Left: Animated Page Title */}
        <div className="flex min-w-0 flex-1 items-center">
          <motion.h1
            key={pageTitle}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="text-2xl font-semibold text-white"
          >
            {pageTitle}
          </motion.h1>
        </div>

        {/* Right: Delete Button + Time Filters */}
        <div className="flex items-center gap-2 sm:gap-3">
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

          {/* Time Filters - Far Right */}
          {activeTab !== 'dashboard' && activeTab !== 'research' && activeTab !== 'backtesting' ? (
            <div className="flex items-center gap-1">
              {[
                { id: 'all', label: 'All' },
                { id: '30', label: '30D' },
                { id: '60', label: '60D' },
                { id: '90', label: '90D' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onFilterPresetChange(preset.id as 'all' | '30' | '60' | '90')}
                  className={`h-[38px] rounded-md px-3 text-xs font-semibold transition-colors ${
                    filterPreset === preset.id
                      ? 'bg-emerald-500 text-black'
                      : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                  }`}
                  title={`Filter ${preset.label}`}
                >
                  {preset.label}
                </button>
              ))}

              {!isMobile ? (
                <>
                  <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" />
                  <div className="flex h-[38px] items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
                    <CalendarIcon className="h-4 w-4 text-zinc-500" />
                    <input
                      type="date"
                      value={startDate}
                      onChange={(event) => onStartDateChange(event.target.value)}
                      className="bg-transparent text-sm text-zinc-400 [color-scheme:dark] focus:outline-none"
                      title="Start date"
                    />
                    <span className="text-sm text-zinc-600">—</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(event) => onEndDateChange(event.target.value)}
                      className="bg-transparent text-sm text-zinc-400 [color-scheme:dark] focus:outline-none"
                      title="End date"
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
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
