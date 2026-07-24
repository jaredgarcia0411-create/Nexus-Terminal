'use client';

import { Fragment, useState } from 'react';
import { LineChart, Plus, X } from 'lucide-react';

import ReviewTickerChart from '@/components/trading/ReviewTickerChart';
import TradeTagEditor, { TAG_TEXT_CLASS } from '@/components/trading/TradeTagEditor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WATCHLIST_GRADE_OPTIONS } from '@/lib/grades';
import { newMissedSetupId, type MissedSetupRow } from '@/lib/missed-setups';

interface MissedSetupsPanelProps {
  rows: MissedSetupRow[];
  // Review date (daily). Chart anchors to row.sourceDate ?? date.
  date: string;
  readOnly?: boolean;
  globalTags?: string[];
  onChange?: (rows: MissedSetupRow[]) => void;
}

export default function MissedSetupsPanel({
  rows,
  date,
  readOnly = false,
  globalTags = [],
  onChange,
}: MissedSetupsPanelProps) {
  const [openChartId, setOpenChartId] = useState<string | null>(null);

  const editable = !readOnly && !!onChange;
  const gridTemplateColumns = '84px minmax(150px, 1fr) 78px 64px 40px';

  const updateRow = (id: string, patch: Partial<MissedSetupRow>) => {
    onChange?.(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const addRow = () => {
    onChange?.([...rows, { id: newMissedSetupId(), ticker: '', tags: [], grade: '' }]);
  };
  const removeRow = (id: string) => {
    onChange?.(rows.filter((row) => row.id !== id));
    setOpenChartId((current) => (current === id ? null : current));
  };
  const addTag = (id: string, tag: string) => {
    const row = rows.find((currentRow) => currentRow.id === id);
    if (!row || row.tags.includes(tag)) return;
    updateRow(id, { tags: [...row.tags, tag] });
  };
  const removeTag = (id: string, tag: string) => {
    const row = rows.find((currentRow) => currentRow.id === id);
    if (!row) return;
    updateRow(id, { tags: row.tags.filter((currentTag) => currentTag !== tag) });
  };

  // In read-only weekly mode with nothing to show, render nothing.
  if (readOnly && rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Missed Setups</h3>
        {editable ? (
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add setup
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid gap-px bg-accent" style={{ gridTemplateColumns }}>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">Ticker</div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">Tags</div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">Grade</div>
          <div className="bg-card px-1 py-2 text-center text-xs font-semibold text-foreground">Chart</div>
          <div className="bg-card px-3 py-2" />

          {rows.length === 0 ? (
            <div className="bg-card px-3 py-4 text-xs italic text-muted-foreground" style={{ gridColumn: '1 / -1' }}>
              No missed setups logged. Add setups you should have taken.
            </div>
          ) : (
            rows.map((row) => {
              const ticker = row.ticker.trim().toUpperCase();
              const chartOpen = openChartId === row.id;
              const canChart = ticker.length > 0;
              return (
                <Fragment key={row.id}>
                  <div className="bg-card px-3 py-2 text-sm">
                    {editable ? (
                      <input
                        value={row.ticker}
                        onChange={(event) => updateRow(row.id, { ticker: event.target.value.toUpperCase() })}
                        placeholder="—"
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium uppercase text-foreground hover:border-emerald-500/30 hover:bg-accent focus:border-emerald-500/40 focus:outline-none"
                      />
                    ) : (
                      <span className="font-medium text-foreground">{row.ticker || '—'}</span>
                    )}
                  </div>
                  <div className="bg-card px-3 py-2">
                    {editable ? (
                      <TradeTagEditor
                        tags={row.tags}
                        globalTags={globalTags}
                        onAddTag={(tag) => addTag(row.id, tag)}
                        onRemoveTag={(tag) => removeTag(row.id, tag)}
                      />
                    ) : row.tags.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {row.tags.map((tag) => (
                          <span key={tag} className={TAG_TEXT_CLASS}>{tag}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="bg-card px-3 py-2 text-sm">
                    {editable ? (
                      <Select value={row.grade || undefined} onValueChange={(value) => updateRow(row.id, { grade: value })}>
                        <SelectTrigger className="h-7 w-full border-transparent bg-transparent px-1 text-sm text-foreground hover:border-emerald-500/30 hover:bg-accent">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-card text-foreground">
                          {WATCHLIST_GRADE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-foreground">{row.grade || '—'}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-center bg-card px-1 py-1.5">
                    {canChart ? (
                      <button
                        type="button"
                        onClick={() => setOpenChartId((current) => (current === row.id ? null : row.id))}
                        className={`rounded-md p-1 ${chartOpen ? 'bg-primary/15 text-primary' : 'text-primary hover:bg-accent hover:text-primary/80'}`}
                        title={chartOpen ? 'Hide Chart' : 'Show Chart'}
                        aria-label={chartOpen ? 'Hide chart' : 'Show chart'}
                        aria-expanded={chartOpen}
                      >
                        <LineChart className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="flex items-center justify-center bg-card px-1 py-1.5">
                    {editable ? (
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="rounded p-0.5 text-rose-400 hover:bg-rose-500/20"
                        title="Remove setup"
                        aria-label="Remove setup"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  {chartOpen && canChart ? (
                    <div className="bg-card p-3" style={{ gridColumn: '1 / -1' }}>
                      <ReviewTickerChart
                        ticker={ticker}
                        sortKey={row.sourceDate ?? date}
                        scopeKey={`missed:${row.sourceDate ?? date}:${ticker}`}
                      />
                    </div>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
