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
import type { SheetColumn, SheetColumnType } from '@/lib/sheets/columns';
import { USER_COLUMN_TYPES } from '@/lib/sheets/grid';

interface EditColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  column: SheetColumn | null;
  onSubmit: (next: { name: string; type: SheetColumnType; options?: string[] }) => Promise<void>;
}

export default function EditColumnDialog({
  open,
  onOpenChange,
  column,
  onSubmit,
}: EditColumnDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<SheetColumnType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !column) return;
    setName(column.name);
    setType(column.type);
    setOptionsText((column.options ?? []).join('\n'));
    setError(null);
    setSubmitting(false);
  }, [column, open]);

  const handleSubmit = async () => {
    if (!column) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }

    const options = type === 'select' || type === 'multiselect'
      ? optionsText.split(/[\n,]/).map((option) => option.trim()).filter(Boolean)
      : undefined;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, type, options });
      onOpenChange(false);
    } catch {
      setError('Could not update column');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Column</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-col-name">Name</Label>
            <Input
              id="edit-col-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-border bg-accent text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-col-type">Type</Label>
            <select
              id="edit-col-type"
              value={type}
              onChange={(event) => setType(event.target.value as SheetColumnType)}
              className="h-9 w-full rounded-md border border-border bg-popover px-2 text-sm text-popover-foreground [color-scheme:dark]"
            >
              {USER_COLUMN_TYPES.map((columnType) => (
                <option key={columnType} value={columnType}>
                  {columnType}
                </option>
              ))}
            </select>
          </div>

          {type === 'select' || type === 'multiselect' ? (
            <div className="space-y-2">
              <Label htmlFor="edit-col-options">Options (one per line or comma-separated)</Label>
              <textarea
                id="edit-col-options"
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
            disabled={submitting || !column}
            onClick={() => void handleSubmit()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
