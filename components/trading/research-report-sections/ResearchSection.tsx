'use client';

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';

import ResearchReportPanel from '@/components/trading/ResearchReportPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  ticker: string;
}

export default function ResearchSection({ ticker }: Props) {
  const [reportExpanded, setReportExpanded] = useState(false);

  return (
    <div className="space-y-4 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-lg font-semibold text-foreground">Research Report</h4>
        <button
          type="button"
          onClick={() => setReportExpanded(true)}
          aria-label="Expand research report"
          title="Expand"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <ResearchReportPanel ticker={ticker} />

      {/* Same panel rendered inside a Dialog when expanded. ResearchReportPanel's
          module-level cache means the dialog instance gets the same report data
          immediately — no refetch. */}
      <Dialog open={reportExpanded} onOpenChange={setReportExpanded}>
        <DialogContent className="scrollbar-hidden max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Research Report — {ticker}</DialogTitle>
          </DialogHeader>
          <ResearchReportPanel ticker={ticker} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
