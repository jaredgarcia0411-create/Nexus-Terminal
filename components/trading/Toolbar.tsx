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
      <header className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center gap-2 border-b border-border bg-background/80 px-4 py-2 backdrop-blur-md sm:h-16 sm:flex-nowrap sm:justify-between sm:gap-3 sm:px-8 sm:py-0">
        {/* Left: Animated Page Title */}
        <div className="flex min-w-0 flex-1 items-center">
          <motion.h1
            key={pageTitle}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="text-2xl font-semibold text-foreground"
          >
            {pageTitle}
          </motion.h1>
        </div>

        {/* Right: Delete Button + Time Filters */}
        <div className="flex items-center gap-2 sm:gap-3">
          {selectedCount > 0 ? (
            <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-2 sm:gap-3">
              <span className="text-xs font-medium text-muted-foreground">{selectedCount} selected</span>
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
          {activeTab !== 'dashboard' && activeTab !== 'research' && activeTab !== 'charts' ? (
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
                  className={`h-8 rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
                    filterPreset === preset.id
                      ? 'bg-card/60 text-foreground'
                      : 'bg-accent text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                  title={`Filter ${preset.label}`}
                >
                  {preset.label}
                </button>
              ))}

              {!isMobile ? (
                <>
                  <div className="mx-1 hidden h-4 w-px bg-accent sm:block" />
                  <div className="flex h-8 items-center gap-1 rounded-lg border border-border bg-accent pl-2 pr-1.5">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="date"
                      value={startDate}
                      onChange={(event) => onStartDateChange(event.target.value)}
                      className="w-[6.25rem] bg-transparent text-xs text-muted-foreground [color-scheme:dark] focus:outline-none"
                      title="Start date"
                    />
                    <span className="text-xs text-muted-foreground">—</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(event) => onEndDateChange(event.target.value)}
                      className="w-[6.25rem] bg-transparent text-xs text-muted-foreground [color-scheme:dark] focus:outline-none"
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
        <DialogContent className="border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Delete selected trades?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{selectedCount} trade(s) will be permanently deleted. This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)} className="bg-accent hover:bg-accent/80">
              Cancel
            </Button>
            <Button
              onClick={() => {
                onDeleteSelected();
                setConfirmDeleteOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
