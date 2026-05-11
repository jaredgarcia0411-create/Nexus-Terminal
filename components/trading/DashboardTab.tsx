'use client';

import { Maximize2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';

import DashboardScannerTable from '@/components/trading/DashboardScannerTable';
import MacroSummaryPanel from '@/components/trading/MacroSummaryPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface DashboardTabProps {
  onNavigateToResearch: (ticker: string) => void;
}

export default function DashboardTab({ onNavigateToResearch }: DashboardTabProps) {
  const [macroExpanded, setMacroExpanded] = useState(false);

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div>
        <h4 className="mb-2 text-lg font-semibold text-zinc-200">Scanners</h4>
        <DashboardScannerTable onNavigateToResearch={onNavigateToResearch} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-lg font-semibold text-zinc-200">Macro Summary</h4>
          <button
            type="button"
            onClick={() => setMacroExpanded(true)}
            aria-label="Expand macro summary"
            title="Expand"
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <MacroSummaryPanel />

        <Dialog open={macroExpanded} onOpenChange={setMacroExpanded}>
          <DialogContent className="scrollbar-hidden max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Macro Summary</DialogTitle>
            </DialogHeader>
            <MacroSummaryPanel />
          </DialogContent>
        </Dialog>
      </div>
    </motion.div>
  );
}
