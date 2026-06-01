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

interface SheetFormDialogProps {
  open: boolean;
  mode: 'create' | 'rename';
  initialName?: string;
  initialDate?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { name: string; sheetDate?: string }) => Promise<void>;
}

export default function SheetFormDialog({
  open,
  mode,
  initialName,
  initialDate,
  onOpenChange,
  onSubmit,
}: SheetFormDialogProps) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName ?? '');
    setDate(initialDate ?? '');
    setError(null);
    setSubmitting(false);
  }, [open, initialName, initialDate]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, sheetDate: date || undefined });
      onOpenChange(false);
    } catch {
      setError('Could not save sheet');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Sheet' : 'Rename Sheet'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sheet-name">Name</Label>
            <Input
              id="sheet-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-border bg-accent text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sheet-date">Date (optional)</Label>
            <Input
              id="sheet-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="border-border bg-accent text-foreground [color-scheme:dark]"
            />
          </div>

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
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
