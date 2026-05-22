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
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card text-foreground sm:max-w-md">
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
            className="bg-accent hover:bg-accent/80"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || rows.length === 0}
            onClick={() => void handleSubmit()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            Add Rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
