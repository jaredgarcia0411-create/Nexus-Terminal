'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import AddSampleSetDialog from '@/components/trading/AddSampleSetDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { SampleSetRow } from '@/lib/sample-set-csv';
import { apiRequest } from '@/lib/trade-utils';

interface WatchlistSavePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seedRows: SampleSetRow[];
}

type SampleSetListItem = {
  id: string;
  name: string;
  rowCount: number;
  ownerId: string;
  ownerName: string | null;
};

export default function WatchlistSavePicker({
  open,
  onOpenChange,
  seedRows,
}: WatchlistSavePickerProps) {
  const [sampleSets, setSampleSets] = useState<SampleSetListItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [appending, setAppending] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let aborted = false;

    void apiRequest<{ sampleSets: SampleSetListItem[]; currentUserId: string }>(
      '/api/sample-sets',
    )
      .then((payload) => {
        if (aborted) return;
        setSampleSets(payload.sampleSets ?? []);
        setCurrentUserId(payload.currentUserId ?? null);
      })
      .catch(() => {
        if (!aborted) setSampleSets([]);
      });

    return () => {
      aborted = true;
    };
  }, [open]);

  const sortedSets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = sampleSets.filter((set) => {
      if (!query) return true;
      return (
        set.name.toLowerCase().includes(query)
        || (set.ownerName ?? '').toLowerCase().includes(query)
      );
    });

    return [...filtered].sort((a, b) => {
      const aMine = a.ownerId === currentUserId ? 0 : 1;
      const bMine = b.ownerId === currentUserId ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return a.name.localeCompare(b.name);
    });
  }, [currentUserId, sampleSets, search]);

  const handlePick = async (set: SampleSetListItem) => {
    setAppending(set.id);

    try {
      const payload = await apiRequest<{ skippedCount: number }>(
        `/api/sample-sets/${set.id}`,
        { method: 'PATCH', body: JSON.stringify({ appendRows: seedRows }) },
      );
      const skippedCount = payload.skippedCount ?? 0;
      const added = seedRows.length - skippedCount;

      toast.success(
        added > 0
          ? `Added ${added} row${added === 1 ? '' : 's'} to "${set.name}"${skippedCount > 0 ? ` (${skippedCount} dupes skipped)` : ''}`
          : `All ${seedRows.length} row${seedRows.length === 1 ? '' : 's'} already in "${set.name}"`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save to sample set');
    } finally {
      setAppending(null);
    }
  };

  return (
    <>
      <Dialog open={open && !createOpen} onOpenChange={onOpenChange}>
        <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to Sample Set</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Sample Sets"
              className="flex-1 border-border bg-accent text-foreground"
            />
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-[6px] border border-emerald-500/30 bg-emerald-500/5 px-3 text-sm text-emerald-300 hover:bg-primary/10"
            >
              <Plus className="h-4 w-4" />
              Create New Sample Set
            </button>
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {sortedSets.length === 0 ? (
              <p className="px-3 py-4 text-xs italic text-muted-foreground">No sample sets found.</p>
            ) : (
              sortedSets.map((set) => {
                const isMine = set.ownerId === currentUserId;
                return (
                  <button
                    key={set.id}
                    type="button"
                    disabled={appending === set.id}
                    onClick={() => void handlePick(set)}
                    className="flex w-full items-center justify-between rounded border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-accent disabled:opacity-40"
                  >
                    <span className="flex flex-col">
                      <span className="font-mono">{set.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {set.rowCount} row{set.rowCount === 1 ? '' : 's'}
                        {isMine ? ' - yours' : ` - by ${set.ownerName ?? 'Unknown'}`}
                      </span>
                    </span>
                    {appending === set.id ? <span className="text-xs text-muted-foreground">Adding...</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AddSampleSetDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) onOpenChange(false);
        }}
        initialSeedRows={seedRows}
        onSubmit={async (body) => {
          const payload = await apiRequest<{ sampleSet: { name: string }; skippedCount: number }>(
            '/api/sample-sets',
            { method: 'POST', body: JSON.stringify(body) },
          );
          toast.success(
            `Created "${payload.sampleSet.name}"${payload.skippedCount > 0 ? ` (${payload.skippedCount} dupes skipped)` : ''}`,
          );
        }}
      />
    </>
  );
}
