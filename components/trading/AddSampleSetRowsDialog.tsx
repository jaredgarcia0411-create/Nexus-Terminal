'use client';

import { useEffect, useState } from 'react';

import SampleSetRowsBuilder from '@/components/trading/SampleSetRowsBuilder';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SampleSetRow } from '@/lib/sample-set-csv';

interface AddSampleSetRowsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleSetName: string;
  onSubmit: (rows: SampleSetRow[]) => Promise<void>;
}

export default function AddSampleSetRowsDialog({
  open,
  onOpenChange,
  sampleSetName,
  onSubmit,
}: AddSampleSetRowsDialogProps) {
  const [rows, setRows] = useState<SampleSetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setRows([]);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (rows.length === 0) {
      setError('Stage at least one row');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(rows);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not add rows');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#121214] text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add to &quot;{sampleSetName}&quot;</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <SampleSetRowsBuilder rows={rows} onChange={setRows} />
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="bg-white/10 hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || rows.length === 0}
            onClick={() => void handleSubmit()}
            className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            Add Rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
