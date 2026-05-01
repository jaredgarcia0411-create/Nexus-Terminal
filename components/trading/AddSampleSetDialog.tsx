'use client';

import { useEffect, useState, type ChangeEvent } from 'react';

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
import { parseSampleSetCsv, type SampleSetRow } from '@/lib/sample-set-csv';

interface AddSampleSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: { name: string; rows: SampleSetRow[] }) => Promise<void>;
}

export default function AddSampleSetDialog({
  open,
  onOpenChange,
  onSubmit,
}: AddSampleSetDialogProps) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<SampleSetRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setRows([]);
      setSkippedCount(0);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseSampleSetCsv(text);
      setRows(parsed.rows);
      setSkippedCount(parsed.skippedCount);
      setError(parsed.rows.length === 0 ? 'No valid rows found' : null);
    } catch (parseError) {
      setRows([]);
      setSkippedCount(0);
      setError(parseError instanceof Error ? parseError.message : 'Could not parse CSV');
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    if (rows.length === 0) {
      setError('No valid rows found');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({ name: trimmedName, rows });
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create sample set');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#121214] text-white sm:max-w-lg">
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
              className="border-white/10 bg-white/5 text-zinc-100"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sample-set-file">CSV</Label>
            <Input
              id="sample-set-file"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="border-white/10 bg-white/5 text-zinc-100 file:mr-3 file:border-0 file:bg-transparent file:text-zinc-300"
            />
            <p className="text-xs text-zinc-500">
              {rows.length > 0
                ? `Imported ${rows.length} rows, skipped ${skippedCount} (invalid).`
                : 'CSV must include ticker and date columns.'}
            </p>
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
            disabled={isSubmitting || rows.length === 0}
            onClick={() => void handleSubmit()}
            className="bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40"
          >
            Add Sample
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
