'use client';

import { useEffect, useState } from 'react';

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

interface AddSampleSetRowsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleSetName: string;
  onSubmit: (rows: SampleSetRow[]) => Promise<void>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function AddSampleSetRowsDialog({
  open,
  onOpenChange,
  sampleSetName,
  onSubmit,
}: AddSampleSetRowsDialogProps) {
  const [ticker, setTicker] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset fields whenever the dialog closes so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setTicker('');
      setDate('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    const trimmedTicker = ticker.trim().toUpperCase();
    const trimmedDate = date.trim();

    if (!trimmedTicker) {
      setError('Ticker is required');
      return;
    }
    if (!DATE_PATTERN.test(trimmedDate)) {
      setError('Date must be YYYY-MM-DD');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit([{ ticker: trimmedTicker, date: trimmedDate }]);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not add row');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#121214] text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add to &quot;{sampleSetName}&quot;</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="append-row-ticker">Ticker</Label>
            <Input
              id="append-row-ticker"
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="AAPL"
              className="border-white/10 bg-white/5 text-zinc-100"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="append-row-date">Date</Label>
            <Input
              id="append-row-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="border-white/10 bg-white/5 text-zinc-100 [color-scheme:dark]"
            />
          </div>

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
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
