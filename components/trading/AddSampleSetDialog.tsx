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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SampleSetRow } from '@/lib/sample-set-csv';

interface AddSampleSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: { name: string; rows: SampleSetRow[] }) => Promise<void>;
  initialSeedRows?: SampleSetRow[];
}

export default function AddSampleSetDialog({
  open,
  onOpenChange,
  onSubmit,
  initialSeedRows,
}: AddSampleSetDialogProps) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<SampleSetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setRows([]);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    if (rows.length === 0) {
      setError('Stage at least one row');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({ name: trimmedName, rows });
      onOpenChange(false);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Could not create sample set';
      setError(
        message.includes('A sample set with that name already exists')
          ? 'A sample set with that name already exists. Rename it or use Add Row from Backtest Manager.'
          : message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Sample Set</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sample-set-name">Name</Label>
            <Input
              id="sample-set-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-border bg-accent text-foreground"
            />
          </div>

          <SampleSetRowsBuilder
            rows={rows}
            onChange={setRows}
            initialSeed={initialSeedRows}
          />

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
            Add Sample
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
