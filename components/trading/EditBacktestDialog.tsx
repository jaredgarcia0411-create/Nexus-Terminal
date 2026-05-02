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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { BacktestListItem, SampleSetListItem } from '@/hooks/use-backtest-manager';

const NONE_SAMPLE_SET = '__none__';

interface EditBacktestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backtest: BacktestListItem;
  sampleSets: SampleSetListItem[];
  onSubmit: (body: { name?: string; description?: string | null; sampleSetId?: string | null }) => Promise<void>;
}

export default function EditBacktestDialog({
  open,
  onOpenChange,
  backtest,
  sampleSets,
  onSubmit,
}: EditBacktestDialogProps) {
  const [name, setName] = useState(backtest.name);
  const [description, setDescription] = useState(backtest.description ?? '');
  const [sampleSetId, setSampleSetId] = useState(backtest.sampleSetId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(backtest.name);
    setDescription(backtest.description ?? '');
    setSampleSetId(backtest.sampleSetId ?? '');
    setError(null);
    setIsSubmitting(false);
  }, [backtest, open]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || null,
        sampleSetId: sampleSetId || null,
      });
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not update backtest');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#121214] text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Backtest</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-backtest-name">Name</Label>
            <Input
              id="edit-backtest-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-white/10 bg-white/5 text-zinc-100"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-backtest-description">Description</Label>
            <Textarea
              id="edit-backtest-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 border-white/10 bg-white/5 text-zinc-100"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-backtest-sample-set">Sample Set</Label>
            <Select
              value={sampleSetId || NONE_SAMPLE_SET}
              onValueChange={(value) => setSampleSetId(value === NONE_SAMPLE_SET ? '' : value)}
            >
              <SelectTrigger
                aria-label="Sample Set"
                className="w-full border-white/10 bg-black text-sm text-zinc-100"
              >
                <SelectValue placeholder="System Sheet" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-black text-white">
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
            className="bg-white/10 hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            className="bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
