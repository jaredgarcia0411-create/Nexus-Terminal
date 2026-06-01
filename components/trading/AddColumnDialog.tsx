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
import type { SheetColumnType } from '@/lib/sheets/columns';
import { USER_COLUMN_TYPES } from '@/lib/sheets/grid';

interface AddColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (column: { name: string; type: SheetColumnType; options?: string[] }) => Promise<void>;
}

export default function AddColumnDialog({ open, onOpenChange, onSubmit }: AddColumnDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<SheetColumnType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setType('text');
    setOptionsText('');
    setError(null);
    setSubmitting(false);
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }

    const options = type === 'select'
      ? optionsText.split(/[\n,]/).map((option) => option.trim()).filter(Boolean)
      : undefined;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, type, options });
      onOpenChange(false);
    } catch {
      setError('Could not add column');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Column</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="col-name">Name</Label>
            <Input
              id="col-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-border bg-accent text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="col-type">Type</Label>
            <select
              id="col-type"
              value={type}
              onChange={(event) => setType(event.target.value as SheetColumnType)}
              className="h-9 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground [color-scheme:dark]"
            >
              {USER_COLUMN_TYPES.map((columnType) => (
                <option key={columnType} value={columnType}>
                  {columnType}
                </option>
              ))}
            </select>
          </div>

          {type === 'select' ? (
            <div className="space-y-2">
              <Label htmlFor="col-options">Options (one per line or comma-separated)</Label>
              <textarea
                id="col-options"
                value={optionsText}
                onChange={(event) => setOptionsText(event.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-accent px-2 py-1.5 text-sm text-foreground"
              />
            </div>
          ) : null}

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
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
