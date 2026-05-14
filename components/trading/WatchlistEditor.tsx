'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Grade options mirror weekly review's GRADE_FIELD so the dropdowns feel identical.
export const WATCHLIST_GRADE_OPTIONS = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'] as const;

export interface WatchlistRow {
  id: string;
  ticker: string;
  thesis: string;
  grade: string;
  notes: string;
}

interface WatchlistEditorProps {
  title?: string;
  value: WatchlistRow[];
  onChange?: (next: WatchlistRow[]) => void;
  readOnly?: boolean;
  emptyState?: string;
}

function newRowId(): string {
  // crypto.randomUUID isn't available in some old browsers but is in evergreen / Node 20+.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyRow(): WatchlistRow {
  return { id: newRowId(), ticker: '', thesis: '', grade: '', notes: '' };
}

export default function WatchlistEditor({
  title = 'Watchlist',
  value,
  onChange,
  readOnly = false,
  emptyState = 'No tickers on the watchlist yet.',
}: WatchlistEditorProps) {
  const [theses, setTheses] = useState<string[]>([]);
  // Track which row's thesis popover is open. Only one open at a time.
  const [thesisOpenForRow, setThesisOpenForRow] = useState<string | null>(null);
  const [thesisQuery, setThesisQuery] = useState('');
  const fieldIdPrefix = useId();

  // Load saved theses on mount; we re-fetch when this component remounts inside a
  // newly-opened sheet, which matches the rest of the app.
  useEffect(() => {
    if (readOnly) return;
    let aborted = false;
    void fetch('/api/watchlist-theses')
      .then((response) => (response.ok ? response.json() : { theses: [] }))
      .then((data) => {
        if (aborted) return;
        const list = Array.isArray(data?.theses) ? (data.theses as string[]) : [];
        setTheses(list);
      })
      .catch(() => {
        if (!aborted) setTheses([]);
      });
    return () => {
      aborted = true;
    };
  }, [readOnly]);

  const updateRow = useCallback(
    (rowId: string, patch: Partial<WatchlistRow>) => {
      if (!onChange) return;
      onChange(value.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
    },
    [onChange, value],
  );

  const addRow = useCallback(() => {
    onChange?.([...value, emptyRow()]);
  }, [onChange, value]);

  const removeRow = useCallback(
    (rowId: string) => {
      onChange?.(value.filter((row) => row.id !== rowId));
    },
    [onChange, value],
  );

  const upsertThesis = useCallback(
    async (rowId: string, raw: string) => {
      const name = raw.trim();
      if (!name) return;
      updateRow(rowId, { thesis: name });
      setThesisOpenForRow(null);
      setThesisQuery('');

      if (theses.includes(name)) return;
      // Optimistically add to the local list — POST is fire-and-forget; the row already has the value.
      setTheses((current) => [...current, name].sort((a, b) => a.localeCompare(b)));
      try {
        await fetch('/api/watchlist-theses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
      } catch {
        // Network failure here only means the option won't autocomplete next time;
        // the row's thesis text is already saved with the daily review.
      }
    },
    [theses, updateRow],
  );

  const deleteThesisOption = useCallback(async (name: string) => {
    setTheses((current) => current.filter((option) => option !== name));
    try {
      await fetch('/api/watchlist-theses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch {
      // Silent — the option will reappear on next refresh if delete failed server-side.
    }
  }, []);

  const rowCount = value.length;
  const showEmpty = rowCount === 0;

  // Grid template: ticker (narrow) · thesis · grade (narrow) · notes (wide) · delete (icon).
  const gridCols = readOnly
    ? 'grid-cols-[80px_minmax(140px,1fr)_70px_minmax(160px,2fr)]'
    : 'grid-cols-[80px_minmax(140px,1fr)_70px_minmax(160px,2fr)_28px]';

  return (
    <section className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {!readOnly ? (
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-500 hover:bg-emerald-500/20"
          >
            <Plus className="h-3 w-3" />
            Add Row
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <div className={`grid ${gridCols} gap-px bg-white/10`}>
          <div className="bg-[#121214] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Ticker
          </div>
          <div className="bg-[#121214] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Thesis
          </div>
          <div className="bg-[#121214] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Grade
          </div>
          <div className="bg-[#121214] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Notes
          </div>
          {!readOnly ? <div className="bg-[#121214]" /> : null}

          {showEmpty ? (
            <div
              className={`bg-[#121214] px-3 py-4 text-xs italic text-zinc-500 ${
                readOnly ? 'col-span-4' : 'col-span-5'
              }`}
            >
              {emptyState}
            </div>
          ) : (
            value.map((row) => (
              <RowCells
                key={row.id}
                row={row}
                readOnly={readOnly}
                theses={theses}
                thesisOpen={thesisOpenForRow === row.id}
                thesisQuery={thesisOpenForRow === row.id ? thesisQuery : ''}
                onOpenThesis={(open) => {
                  setThesisOpenForRow(open ? row.id : null);
                  if (!open) setThesisQuery('');
                }}
                onThesisQueryChange={setThesisQuery}
                onPickThesis={(name) => void upsertThesis(row.id, name)}
                onDeleteThesisOption={(name) => void deleteThesisOption(name)}
                onChangeRow={(patch) => updateRow(row.id, patch)}
                onRemoveRow={() => removeRow(row.id)}
                tickerInputId={`${fieldIdPrefix}-${row.id}-ticker`}
                notesInputId={`${fieldIdPrefix}-${row.id}-notes`}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

interface RowCellsProps {
  row: WatchlistRow;
  readOnly: boolean;
  theses: string[];
  thesisOpen: boolean;
  thesisQuery: string;
  onOpenThesis: (open: boolean) => void;
  onThesisQueryChange: (next: string) => void;
  onPickThesis: (name: string) => void;
  onDeleteThesisOption: (name: string) => void;
  onChangeRow: (patch: Partial<WatchlistRow>) => void;
  onRemoveRow: () => void;
  tickerInputId: string;
  notesInputId: string;
}

function RowCells({
  row,
  readOnly,
  theses,
  thesisOpen,
  thesisQuery,
  onOpenThesis,
  onThesisQueryChange,
  onPickThesis,
  onDeleteThesisOption,
  onChangeRow,
  onRemoveRow,
  tickerInputId,
  notesInputId,
}: RowCellsProps) {
  const filteredTheses = useMemo(() => {
    const q = thesisQuery.trim().toLowerCase();
    if (!q) return theses;
    return theses.filter((option) => option.toLowerCase().includes(q));
  }, [theses, thesisQuery]);

  // Cell base style — matches the dark calendar cells in the rest of the app.
  const cellBase = 'bg-[#121214] px-2 py-1.5';

  if (readOnly) {
    return (
      <>
        <div className={`${cellBase} font-mono text-xs font-semibold text-zinc-100`}>
          {row.ticker || '—'}
        </div>
        <div className={`${cellBase} text-xs text-zinc-200`}>{row.thesis || '—'}</div>
        <div className={`${cellBase} text-xs text-zinc-200`}>{row.grade || '—'}</div>
        <div className={`${cellBase} whitespace-pre-wrap text-sm text-zinc-300`}>
          {row.notes || '—'}
        </div>
      </>
    );
  }

  return (
    <>
      <div className={cellBase}>
        <input
          id={tickerInputId}
          value={row.ticker}
          onChange={(event) => onChangeRow({ ticker: event.target.value.toUpperCase() })}
          placeholder="AAPL"
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs uppercase text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none"
        />
      </div>

      <div className={cellBase}>
        <Popover open={thesisOpen} onOpenChange={onOpenThesis}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-full truncate rounded border border-transparent px-1 py-0.5 text-left text-xs text-zinc-200 hover:border-emerald-500/30 hover:bg-white/5"
            >
              {row.thesis || <span className="text-zinc-600">Select thesis…</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-64 border-white/10 bg-[#18181b] p-0 text-white"
            align="start"
          >
            <Command className="bg-transparent">
              <CommandInput
                placeholder="Search or create thesis…"
                value={thesisQuery}
                onValueChange={onThesisQueryChange}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && thesisQuery.trim()) {
                    event.preventDefault();
                    onPickThesis(thesisQuery.trim());
                  }
                }}
              />
              <CommandList>
                <CommandEmpty>
                  {thesisQuery.trim()
                    ? `Press Enter to create "${thesisQuery.trim()}"`
                    : 'No saved theses yet.'}
                </CommandEmpty>
                {filteredTheses.length > 0 ? (
                  <CommandGroup heading="Saved Theses">
                    {filteredTheses.map((option) => (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => onPickThesis(option)}
                      >
                        <span className="flex-1">{option}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteThesisOption(option);
                          }}
                          className="text-zinc-500 hover:text-rose-500"
                          title="Remove from saved list"
                          aria-label={`Remove ${option} from saved theses`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className={cellBase}>
        <Select
          value={row.grade || undefined}
          onValueChange={(value) => onChangeRow({ grade: value })}
        >
          <SelectTrigger className="h-7 border-transparent bg-transparent px-1 text-xs text-zinc-200 hover:border-emerald-500/30 hover:bg-white/5">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-[#18181b] text-white">
            {WATCHLIST_GRADE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className={cellBase}>
        <AutoGrowNotes
          id={notesInputId}
          value={row.notes}
          onChange={(next) => onChangeRow({ notes: next })}
        />
      </div>

      <div className={`${cellBase} flex items-center justify-center`}>
        <button
          type="button"
          onClick={onRemoveRow}
          className="rounded p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
          title="Remove row"
          aria-label="Remove row"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </>
  );
}

interface AutoGrowNotesProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
}

// Textarea that grows to fit its content. The effect resets height to 'auto' so it
// can shrink when text is deleted, then sets it to scrollHeight (the exact pixel
// height the browser would need to show every line without a scrollbar).
function AutoGrowNotes({ id, value, onChange }: AutoGrowNotesProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={1}
      placeholder="Quick notes…"
      className="block w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none"
    />
  );
}
