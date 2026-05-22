'use client';

import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { SampleSetListItem } from '@/hooks/use-backtest-manager';

interface NewBacktestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleSets: SampleSetListItem[];
  onSubmit: (body: { name: string; description?: string; sampleSetId?: string }) => Promise<void>;
}

export default function NewBacktestDialog({
  open,
  onOpenChange,
  sampleSets,
  onSubmit,
}: NewBacktestDialogProps) {
  const NONE_SAMPLE_SET = '__none__';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sampleSetId, setSampleSetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
      setSampleSetId(null);
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

    if (sampleSetId === null) {
      setError('Select Sample Set to Create Backtest');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || undefined,
        sampleSetId: sampleSetId === '' ? undefined : sampleSetId,
      });
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create backtest');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Backtest</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-backtest-name">Name</Label>
            <Input
              id="new-backtest-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-border bg-accent text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-backtest-description">Description</Label>
            <Textarea
              id="new-backtest-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 border-border bg-accent text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-backtest-sample-set">Sample Set</Label>
            <Select
              value={sampleSetId === null ? '' : (sampleSetId === '' ? NONE_SAMPLE_SET : sampleSetId)}
              onValueChange={(value) => setSampleSetId(value === NONE_SAMPLE_SET ? '' : value)}
            >
              <SelectTrigger
                aria-label="Sample Set"
                className="w-full border-border bg-black text-sm text-foreground"
              >
                <SelectValue placeholder="Select a sample set..." />
              </SelectTrigger>
              <SelectContent className="border-border bg-black text-foreground">
                <SelectItem value={NONE_SAMPLE_SET}>System Sheet</SelectItem>
                {sampleSets.map((sampleSet) => (
                  <SelectItem key={sampleSet.id} value={sampleSet.id}>
                    {sampleSet.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
