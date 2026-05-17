'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { parseSampleSetCsv, type SampleSetRow } from '@/lib/sample-set-csv';
import { mergeDedupedRows } from '@/lib/sample-set-rows';
import { apiRequest } from '@/lib/trade-utils';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface SampleSetRowsBuilderProps {
  rows: SampleSetRow[];
  onChange: (next: SampleSetRow[]) => void;
  initialSeed?: SampleSetRow[];
}

type ImportStatus = {
  added: number;
  skipped: number;
};

function rowKey(row: SampleSetRow) {
  return `${row.ticker.toUpperCase()}|${row.date}`;
}

export default function SampleSetRowsBuilder({
  rows,
  onChange,
  initialSeed,
}: SampleSetRowsBuilderProps) {
  const [manualTicker, setManualTicker] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [lastCsvImport, setLastCsvImport] = useState<ImportStatus | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFetching, setTagFetching] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [lastTagImport, setLastTagImport] = useState<ImportStatus | null>(null);
  const [dupesSkipped, setDupesSkipped] = useState(0);
  const seededRef = useRef(false);

  const stagedRows = useMemo(
    () => mergeDedupedRows([], rows).merged,
    [rows],
  );

  useEffect(() => {
    if (seededRef.current || !initialSeed || initialSeed.length === 0) return;
    seededRef.current = true;
    const { merged, skippedCount } = mergeDedupedRows(stagedRows, initialSeed);
    setDupesSkipped((current) => current + skippedCount);
    onChange(merged);
  }, [initialSeed, onChange, stagedRows]);

  useEffect(() => {
    let aborted = false;

    void fetch('/api/tags')
      .then((response) => (response.ok ? response.json() : { tags: [] }))
      .then((data) => {
        if (aborted) return;
        const list = Array.isArray(data?.tags) ? (data.tags as string[]) : [];
        setAllTags(list);
      })
      .catch(() => {
        if (!aborted) setAllTags([]);
      });

    return () => {
      aborted = true;
    };
  }, []);

  const applyRows = (incoming: SampleSetRow[], extraSkipped = 0) => {
    const { merged, skippedCount } = mergeDedupedRows(stagedRows, incoming);
    const skipped = skippedCount + extraSkipped;
    if (skipped > 0) setDupesSkipped((current) => current + skipped);
    onChange(merged);
    return {
      added: merged.length - stagedRows.length,
      skipped,
    };
  };

  const handleCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setCsvError(null);
    setLastCsvImport(null);

    try {
      const text = await file.text();
      const parsed = parseSampleSetCsv(text);
      const status = applyRows(parsed.rows, parsed.skippedCount);
      setLastCsvImport(status);
      if (status.added === 0 && status.skipped === 0) {
        setCsvError('No valid rows found');
      }
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : 'Could not parse CSV');
    }
  };

  const handleManualAdd = () => {
    const ticker = manualTicker.trim().toUpperCase();
    const date = manualDate.trim();

    if (!ticker) {
      setManualError('Ticker is required');
      return;
    }
    if (!DATE_PATTERN.test(date)) {
      setManualError('Date must be YYYY-MM-DD');
      return;
    }

    const status = applyRows([{ ticker, date }]);
    setManualTicker('');
    setManualDate('');
    setManualError(status.skipped > 0 ? `${ticker} ${date} already in list` : null);
  };

  const handleAddFromTags = async () => {
    if (selectedTags.length === 0) return;

    setTagFetching(true);
    setTagError(null);
    setLastTagImport(null);

    try {
      const payload = await apiRequest<{ rows: SampleSetRow[]; skippedCount: number }>(
        '/api/sample-sets/from-tags',
        { method: 'POST', body: JSON.stringify({ tags: selectedTags }) },
      );
      const status = applyRows(payload.rows, payload.skippedCount);
      setLastTagImport(status);
      if (status.added === 0) {
        setTagError('No new rows for the selected tag(s)');
      } else {
        setSelectedTags([]);
      }
    } catch (error) {
      setTagError(error instanceof Error ? error.message : 'Could not load tag rows');
    } finally {
      setTagFetching(false);
    }
  };

  const removeRow = (key: string) => {
    onChange(stagedRows.filter((row) => rowKey(row) !== key));
  };

  const sortedRows = useMemo(
    () => [...stagedRows].sort((a, b) => (
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.ticker.localeCompare(b.ticker)
    )),
    [stagedRows],
  );

  return (
    <div className="space-y-4">
      {dupesSkipped > 0 ? (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          Skipped {dupesSkipped} duplicate or invalid row{dupesSkipped === 1 ? '' : 's'}.
        </div>
      ) : null}

      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <Label className="text-xs font-semibold text-white">From CSV</Label>
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void handleCsv(event)}
          className="border-white/10 bg-white/5 text-zinc-100 file:mr-3 file:border-0 file:bg-transparent file:text-zinc-300"
        />
        {lastCsvImport ? (
          <p className="text-xs text-zinc-500">
            Added {lastCsvImport.added}
            {lastCsvImport.skipped > 0 ? `, skipped ${lastCsvImport.skipped}` : ''}.
          </p>
        ) : null}
        {csvError ? <p className="text-xs text-rose-400">{csvError}</p> : null}
      </section>

      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <Label className="text-xs font-semibold text-white">Manual entry</Label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            value={manualTicker}
            onChange={(event) => setManualTicker(event.target.value.toUpperCase())}
            placeholder="AAPL"
            className="border-white/10 bg-white/5 text-zinc-100"
          />
          <Input
            type="date"
            value={manualDate}
            onChange={(event) => setManualDate(event.target.value)}
            className="border-white/10 bg-white/5 text-zinc-100 [color-scheme:dark]"
          />
          <Button
            type="button"
            onClick={handleManualAdd}
            className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
        {manualError ? <p className="text-xs text-rose-400">{manualError}</p> : null}
      </section>

      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <Label className="text-xs font-semibold text-white">From tags</Label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="min-w-0 justify-start border border-white/10 bg-white/5 text-left text-zinc-200 hover:bg-white/10"
              >
                <span className="truncate">
                  {selectedTags.length > 0 ? selectedTags.join(', ') : 'Select tag(s)'}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 border-white/10 bg-[#18181b] p-0 text-white" align="start">
              <Command className="bg-transparent">
                <CommandInput placeholder="Search tags" />
                <CommandList>
                  <CommandEmpty>No tags found.</CommandEmpty>
                  <CommandGroup>
                    {allTags.map((tag) => {
                      const selected = selectedTags.includes(tag);
                      return (
                        <CommandItem
                          key={tag}
                          value={tag}
                          onSelect={() => {
                            setSelectedTags((current) => (
                              current.includes(tag)
                                ? current.filter((value) => value !== tag)
                                : [...current, tag]
                            ));
                          }}
                        >
                          <span className="flex-1 truncate">{tag}</span>
                          {selected ? <X className="h-3 w-3 text-emerald-400" /> : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            disabled={selectedTags.length === 0 || tagFetching}
            onClick={() => void handleAddFromTags()}
            className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {tagFetching ? 'Loading' : 'Add to set'}
          </Button>
        </div>
        {lastTagImport ? (
          <p className="text-xs text-zinc-500">
            Added {lastTagImport.added}
            {lastTagImport.skipped > 0 ? `, skipped ${lastTagImport.skipped}` : ''}.
          </p>
        ) : null}
        {tagError ? <p className="text-xs text-rose-400">{tagError}</p> : null}
      </section>

      <section className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs font-semibold text-white">
            Staging ({stagedRows.length} row{stagedRows.length === 1 ? '' : 's'})
          </Label>
          {stagedRows.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-zinc-500 hover:text-rose-400"
            >
              Clear all
            </button>
          ) : null}
        </div>
        {stagedRows.length === 0 ? (
          <p className="text-xs italic text-zinc-500">No rows staged yet.</p>
        ) : (
          <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
            {sortedRows.map((row) => {
              const key = rowKey(row);
              return (
                <li
                  key={key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded border border-white/5 bg-[#121214] px-2 py-1 text-xs"
                >
                  <span className="truncate font-mono text-zinc-100">{row.ticker}</span>
                  <span className="font-mono tabular-nums text-zinc-400">{row.date}</span>
                  <button
                    type="button"
                    onClick={() => removeRow(key)}
                    className="rounded p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                    aria-label={`Remove ${row.ticker} ${row.date}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
