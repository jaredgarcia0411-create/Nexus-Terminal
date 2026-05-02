'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Search, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

import AddSampleSetDialog from '@/components/trading/AddSampleSetDialog';
import EditBacktestDialog from '@/components/trading/EditBacktestDialog';
import NewBacktestDialog from '@/components/trading/NewBacktestDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useBacktestManager,
  type BacktestListItem,
} from '@/hooks/use-backtest-manager';

interface BacktestManagerViewProps {
  onLaunchChart: (backtest: { id: string; name: string; ownerId: string } | null) => void;
  onViewStats: (backtestId: string) => void;
}

function formatRelativeTimestamp(value: string | null) {
  if (!value) return 'No activity';

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'No activity';

  return `${formatDistanceToNow(new Date(parsed), { addSuffix: true })}`;
}

export default function BacktestManagerView({
  onLaunchChart,
  onViewStats,
}: BacktestManagerViewProps) {
  const {
    sampleSets,
    filteredBacktests,
    filteredSampleSets,
    isLoading,
    error,
    backtestSearch,
    setBacktestSearch,
    sampleSetSearch,
    setSampleSetSearch,
    sortKey,
    setSortKey,
    currentUserId,
    createBacktest,
    updateBacktest,
    deleteBacktest,
    createSampleSet,
    deleteSampleSet,
  } = useBacktestManager();

  const [newBacktestOpen, setNewBacktestOpen] = useState(false);
  const [addSampleOpen, setAddSampleOpen] = useState(false);
  const [editingBacktest, setEditingBacktest] = useState<BacktestListItem | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncInputRef = useRef<HTMLInputElement>(null);

  const handleSyncSheetFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSyncing(true);
    setSyncStatus(null);

    try {
      const text = await file.text();
      const { parseSystemSheet } = await import('@/lib/system-sheet-parser');
      const { rows, warnings } = parseSystemSheet(text);

      if (rows.length === 0) {
        throw new Error(`No rows parsed (${warnings.length} warning(s))`);
      }

      const response = await fetch('/api/system-sheet/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Sync failed with status ${response.status}`);
      }

      setSyncStatus('Synced');
      toast.success('System sheet synced');
      if (warnings.length > 0) {
        toast.warning(`${warnings.length} warning(s) during sync`);
      }
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'System sheet sync failed';
      setSyncStatus('Failed');
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteBacktest = async (backtest: BacktestListItem) => {
    if (!window.confirm(`Delete "${backtest.name}"?`)) return;
    try {
      await deleteBacktest(backtest.id);
      toast.success('Backtest deleted');
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Could not delete backtest');
    }
  };

  const handleDeleteSampleSet = async (sampleSetId: string, sampleSetName: string) => {
    if (!window.confirm(`Delete "${sampleSetName}"?`)) return;
    try {
      await deleteSampleSet(sampleSetId);
      toast.success('Sample set deleted');
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Could not delete sample set');
    }
  };

  return (
    <section className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] flex-1 flex-col overflow-hidden bg-[#0A0A0B]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="font-mono text-lg font-semibold text-white">Backtest Manager</h2>
          <p className="text-sm text-zinc-500">Named backtests, shared sample sets, and review stats.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => onLaunchChart(null)}
            className="bg-emerald-500 text-black hover:bg-emerald-400"
          >
            <TrendingUp className="h-4 w-4" />
            Launch Chart
          </Button>
          <Button
            type="button"
            onClick={() => setNewBacktestOpen(true)}
            className="bg-emerald-500 text-black hover:bg-emerald-400"
          >
            + New Backtest
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 p-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
        <div className="flex min-h-0 flex-col rounded-md border border-white/10 bg-[#111319]">
          <div className="border-b border-white/10 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-mono text-sm font-semibold text-white">Saved Tests</h3>
              <Select
                value={sortKey}
                onValueChange={(value) => setSortKey(value as 'updatedAt' | 'createdAt' | 'name' | 'author')}
              >
                <SelectTrigger
                  className="h-8 w-[8.75rem] bg-black text-xs text-zinc-100"
                  aria-label="Sort backtests"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-black text-white">
                  <SelectItem value="updatedAt">Last updated</SelectItem>
                  <SelectItem value="createdAt">Created</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="author">Author</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <Input
                  value={backtestSearch}
                  onChange={(event) => setBacktestSearch(event.target.value)}
                  placeholder="Search backtests"
                  className="h-8 border-white/10 bg-white/5 pl-8 text-xs text-zinc-100 placeholder:text-zinc-600"
                />
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? <div className="px-4 py-6 text-sm text-zinc-500">Loading backtests...</div> : null}
            {!isLoading && error ? <div className="px-4 py-6 text-sm text-rose-400">{error}</div> : null}
            {!isLoading && !error && filteredBacktests.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-500">No backtests yet. Create one to get started.</div>
            ) : null}

            <div className="flex flex-col">
              {filteredBacktests.map((backtest) => {
                const isOwner = currentUserId === backtest.ownerId;
                const isUncategorized = backtest.id.startsWith('uncat-');

                return (
                  <article key={backtest.id} className="border-b border-white/10 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-mono text-sm font-semibold text-white">{backtest.name}</h3>
                          <span className="text-xs text-zinc-500">by {backtest.ownerName ?? 'Unknown'}</span>
                        </div>
                        <p className="text-xs text-zinc-500">
                          {backtest.reviewCount} review{backtest.reviewCount === 1 ? '' : 's'} ·{' '}
                          {backtest.sampleSetName ?? 'No sample set'}
                        </p>
                        {backtest.description ? (
                          <p className="line-clamp-2 text-sm text-zinc-300">{backtest.description}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[11px] text-zinc-500">
                        {formatRelativeTimestamp(backtest.updatedAt)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => onViewStats(backtest.id)}
                        className="h-7 border border-white/10 bg-white/5 text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white"
                      >
                        View Stats
                      </Button>
                      {!isUncategorized ? (
                        <Button
                          type="button"
                          size="xs"
                          onClick={() => onLaunchChart({ id: backtest.id, name: backtest.name, ownerId: backtest.ownerId })}
                          className="h-7 bg-emerald-500 text-[11px] text-black hover:bg-emerald-400"
                        >
                          Launch Chart
                        </Button>
                      ) : null}
                      {isOwner && !isUncategorized ? (
                        <div className="ml-auto flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setEditingBacktest(backtest)}
                            className="h-7 border border-white/10 bg-white/5 text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white"
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => void handleDeleteBacktest(backtest)}
                            className="h-7 border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300 hover:bg-rose-500/20 hover:text-rose-200"
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="border-t border-white/10 p-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={syncing}
                onClick={() => syncInputRef.current?.click()}
                className="h-8 border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {syncing ? 'Syncing...' : 'Sync Sheet'}
              </Button>
              <span className="text-xs text-zinc-500">{syncStatus ?? 'Import the latest system sheet.'}</span>
            </div>
            <input
              ref={syncInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleSyncSheetFile}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-md border border-white/10 bg-[#111319]">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-mono text-sm font-semibold text-white">Sample Sets</h3>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setAddSampleOpen(true)}
                className="h-8 border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
              >
                + Add Sample
              </Button>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <Input
                value={sampleSetSearch}
                onChange={(event) => setSampleSetSearch(event.target.value)}
                placeholder="Search sample sets"
                className="h-8 border-white/10 bg-white/5 pl-8 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!isLoading && filteredSampleSets.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-500">No sample sets yet. Add one to import a trade list.</div>
            ) : null}

            <div className="flex flex-col">
              {filteredSampleSets.map((sampleSet) => {
                const isOwner = currentUserId === sampleSet.ownerId;

                return (
                  <article key={sampleSet.id} className="border-b border-white/10 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <h3 className="truncate font-mono text-sm font-semibold text-white">{sampleSet.name}</h3>
                        <p className="text-xs text-zinc-500">{sampleSet.rowCount} rows</p>
                      </div>
                      {isOwner ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => void handleDeleteSampleSet(sampleSet.id, sampleSet.name)}
                          className="h-7 shrink-0 border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300 hover:bg-rose-500/20 hover:text-rose-200"
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <NewBacktestDialog
        open={newBacktestOpen}
        onOpenChange={setNewBacktestOpen}
        sampleSets={sampleSets}
        onSubmit={async (body) => {
          await createBacktest(body);
          toast.success('Backtest created');
        }}
      />

      <AddSampleSetDialog
        open={addSampleOpen}
        onOpenChange={setAddSampleOpen}
        onSubmit={async (body) => {
          await createSampleSet(body);
          toast.success('Sample set added');
        }}
      />

      {editingBacktest ? (
        <EditBacktestDialog
          open={editingBacktest != null}
          onOpenChange={(open) => {
            if (!open) setEditingBacktest(null);
          }}
          backtest={editingBacktest}
          sampleSets={sampleSets}
          onSubmit={async (body) => {
            await updateBacktest(editingBacktest.id, body);
            toast.success('Backtest updated');
          }}
        />
      ) : null}
    </section>
  );
}
