'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, LineChart, Plus, Trash2 } from 'lucide-react';

import TradeTagEditor from '@/components/trading/TradeTagEditor';
import WatchlistSavePicker from '@/components/trading/WatchlistSavePicker';
import WatchlistReportInline from '@/components/trading/WatchlistReportInline';
import WatchlistTickerChart from '@/components/trading/WatchlistTickerChart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SampleSetRow } from '@/lib/sample-set-csv';

// Grade options mirror weekly review's GRADE_FIELD so the dropdowns feel identical.
export const WATCHLIST_GRADE_OPTIONS = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'] as const;

export interface WatchlistRow {
  id: string;
  ticker: string;
  tags: string[];
  grade: string;
  notes: string;
  // Set only when the row was created by the "+ Add to Watchlist" button on the
  // research page. Points at a research_reports.id row so the eye-icon viewer
  // can fetch the exact report from that day — even months later.
  reportId?: string;
  // YYYY-MM-DD of the daily review this row came from. Attached at aggregation
  // time (e.g. weekly review) so each row carries its own session date for the
  // Chart and Save columns when no editor-wide `date` prop is set.
  sourceDate?: string;
}

interface WatchlistEditorProps {
  title?: string;
  value: WatchlistRow[];
  onChange?: (next: WatchlistRow[]) => void;
  readOnly?: boolean;
  emptyState?: string;
  // YYYY-MM-DD of the daily review this watchlist belongs to. When provided,
  // the Chart column renders and each row can expand an inline chart for that
  // ticker on that day. Weekly aggregated watchlists pass no date — those rows
  // don't have a single consistent session, so the Chart column is omitted.
  date?: string;
  globalTags: string[];
  onDeleteGlobalTag?: (tagName: string) => void;
}

function newRowId(): string {
  // crypto.randomUUID isn't available in some old browsers but is in evergreen / Node 20+.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyRow(): WatchlistRow {
  return { id: newRowId(), ticker: '', tags: [], grade: '', notes: '' };
}

export default function WatchlistEditor({
  title = 'Watchlist',
  value,
  onChange,
  readOnly = false,
  emptyState = 'No tickers on the watchlist yet.',
  date,
  globalTags,
  onDeleteGlobalTag,
}: WatchlistEditorProps) {
  // Which watchlist row currently has its saved-report viewer expanded. Only one open at a time.
  const [reportOpenForRow, setReportOpenForRow] = useState<string | null>(null);
  // Mirrors reportOpenForRow but for the inline candlestick chart panel.
  const [chartOpenForRow, setChartOpenForRow] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [savePickerRows, setSavePickerRows] = useState<SampleSetRow[] | null>(null);
  const fieldIdPrefix = useId();
  // Show Chart/Save columns when the editor has a date (daily review) OR when
  // individual rows carry their own sourceDate (weekly aggregated watchlist).
  const hasRowDates = value.some((row) => Boolean(row.sourceDate));
  const showChartColumn = Boolean(date) || hasRowDates;
  const showSaveColumn = Boolean(date) || hasRowDates;
  const showSelectColumn = showSaveColumn && !readOnly;

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
      setSelectedRowIds((current) => {
        if (!current.has(rowId)) return current;
        const next = new Set(current);
        next.delete(rowId);
        return next;
      });
    },
    [onChange, value],
  );

  const selectedRows = useMemo(
    () => (showSelectColumn ? value.filter((row) => selectedRowIds.has(row.id)) : []),
    [selectedRowIds, showSelectColumn, value],
  );

  const toggleSelectedRow = useCallback((rowId: string) => {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const handleClickSave = useCallback((row: WatchlistRow) => {
    const effectiveDate = row.sourceDate ?? date;
    if (!row.ticker.trim() || !effectiveDate) return;
    setSavePickerRows([{ ticker: row.ticker.toUpperCase(), date: effectiveDate }]);
  }, [date]);

  const handleBulkSave = useCallback(() => {
    const targetRows = selectedRows
      .map((row) => {
        const effectiveDate = row.sourceDate ?? date;
        if (!row.ticker.trim() || !effectiveDate) return null;
        return { ticker: row.ticker.toUpperCase(), date: effectiveDate };
      })
      .filter((row): row is SampleSetRow => row !== null);
    if (targetRows.length === 0) return;
    setSavePickerRows(targetRows);
  }, [date, selectedRows]);

  const rowCount = value.length;
  const showEmpty = rowCount === 0;

  // Grid template: [select] · ticker (narrow) · tags · grade (narrow) · notes (wide) · report · [chart] · [save] · [delete].
  // Inline style instead of a Tailwind arbitrary class so the JIT scanner can't
  // miss the new column count — we hit that exact issue in WeeklyTradesPanel.
  // The delete column is editable-only; report column is always present and
  // shows a dash for rows without a saved reportId. The chart column only
  // appears when `date` is provided (daily reviews). Report/Chart widths fit
  // the new "Report"/"Chart" header labels.
  const selectColumn = showSelectColumn ? '28px ' : '';
  const baseColumns = '80px minmax(150px, 1fr) 70px minmax(160px, 2fr) 56px';
  const chartColumn = showChartColumn ? ' 56px' : '';
  const saveColumn = showSaveColumn ? ' 56px' : '';
  const deleteColumn = readOnly ? '' : ' 28px';
  const gridTemplateColumns = `${selectColumn}${baseColumns}${chartColumn}${saveColumn}${deleteColumn}`;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {!readOnly ? (
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
          >
            <Plus className="h-3 w-3" />
            Add Row
          </button>
        ) : null}
      </div>

      {selectedRows.length > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
          <span>
            {selectedRows.length} row{selectedRows.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkSave}
              className="rounded border border-primary/40 bg-primary/10 px-2 py-1 hover:bg-primary/20"
            >
              Save selected to sample set…
            </button>
            <button
              type="button"
              onClick={() => setSelectedRowIds(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid gap-px bg-accent" style={{ gridTemplateColumns }}>
          {/* Headers a step smaller than body text (text-xs / 12px). Body cells stay at text-sm (Notes column). */}
          {showSelectColumn ? <div className="bg-card" /> : null}
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Ticker
          </div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Tags
          </div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Grade
          </div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Notes
          </div>
          <div className="bg-card px-1 py-2 text-center text-xs font-semibold text-foreground">
            Report
          </div>
          {showChartColumn ? (
            <div className="bg-card px-1 py-2 text-center text-xs font-semibold text-foreground">
              Chart
            </div>
          ) : null}
          {showSaveColumn ? (
            <div className="bg-card px-1 py-2 text-center text-xs font-semibold text-foreground">
              Save
            </div>
          ) : null}
          {!readOnly ? <div className="bg-card" /> : null}

          {showEmpty ? (
            // gridColumn: '1 / -1' spans the row across all columns regardless of count —
            // works for both readOnly (5) and editable (6) layouts without separate classes.
            <div
              className="bg-card px-3 py-4 text-xs italic text-muted-foreground"
              style={{ gridColumn: '1 / -1' }}
            >
              {emptyState}
            </div>
          ) : (
            value.map((row) => (
              <Fragment key={row.id}>
                <RowCells
                  row={row}
                  readOnly={readOnly}
                  globalTags={globalTags}
                  onDeleteGlobalTag={onDeleteGlobalTag}
                  reportOpen={reportOpenForRow === row.id}
                  chartOpen={chartOpenForRow === row.id}
                  showChartColumn={showChartColumn}
                  showSaveColumn={showSaveColumn}
                  showSelectColumn={showSelectColumn}
                  isSelected={selectedRowIds.has(row.id)}
                  onChangeRow={(patch) => updateRow(row.id, patch)}
                  onRemoveRow={() => removeRow(row.id)}
                  onToggleReport={() => {
                    setReportOpenForRow((current) => (current === row.id ? null : row.id));
                    // Only one panel open per row at a time — opening the report closes the chart.
                    setChartOpenForRow((current) => (current === row.id ? null : current));
                  }}
                  onToggleChart={() => {
                    setChartOpenForRow((current) => (current === row.id ? null : row.id));
                    setReportOpenForRow((current) => (current === row.id ? null : current));
                  }}
                  onToggleSelected={() => toggleSelectedRow(row.id)}
                  onClickSave={() => handleClickSave(row)}
                  tickerInputId={`${fieldIdPrefix}-${row.id}-ticker`}
                  notesInputId={`${fieldIdPrefix}-${row.id}-notes`}
                />
                {/* AnimatePresence fades the inline report/chart panels in and out.
                    `initial`/`animate`/`exit` opacity drives the transition; `mode="wait"`
                    isn't needed because we render each row's panel independently. */}
                <AnimatePresence initial={false}>
                  {reportOpenForRow === row.id && row.reportId ? (
                    <motion.div
                      key={`report-${row.id}`}
                      className="overflow-hidden bg-card"
                      style={{ gridColumn: '1 / -1' }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                      <div className="p-3">
                        <WatchlistReportInline reportId={row.reportId} />
                      </div>
                    </motion.div>
                  ) : null}
                  {chartOpenForRow === row.id && showChartColumn && (row.sourceDate ?? date) && row.ticker ? (
                    <motion.div
                      key={`chart-${row.id}`}
                      className="overflow-hidden bg-card"
                      style={{ gridColumn: '1 / -1' }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                      <div className="p-3">
                        <WatchlistTickerChart ticker={row.ticker} date={(row.sourceDate ?? date)!} />
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </Fragment>
            ))
          )}
        </div>
      </div>

      {savePickerRows ? (
        <WatchlistSavePicker
          open
          onOpenChange={(open) => {
            if (!open) {
              setSavePickerRows(null);
              setSelectedRowIds(new Set());
            }
          }}
          seedRows={savePickerRows}
        />
      ) : null}
    </section>
  );
}

interface RowCellsProps {
  row: WatchlistRow;
  readOnly: boolean;
  globalTags: string[];
  onDeleteGlobalTag?: (tagName: string) => void;
  reportOpen: boolean;
  chartOpen: boolean;
  showChartColumn: boolean;
  showSaveColumn: boolean;
  showSelectColumn: boolean;
  isSelected: boolean;
  onChangeRow: (patch: Partial<WatchlistRow>) => void;
  onRemoveRow: () => void;
  onToggleReport: () => void;
  onToggleChart: () => void;
  onToggleSelected: () => void;
  onClickSave: () => void;
  tickerInputId: string;
  notesInputId: string;
}

function RowCells({
  row,
  readOnly,
  globalTags,
  onDeleteGlobalTag,
  reportOpen,
  chartOpen,
  showChartColumn,
  showSaveColumn,
  showSelectColumn,
  isSelected,
  onChangeRow,
  onRemoveRow,
  onToggleReport,
  onToggleChart,
  onToggleSelected,
  onClickSave,
  tickerInputId,
  notesInputId,
}: RowCellsProps) {
  // Cell base style — matches the dark calendar cells in the rest of the app.
  const cellBase = 'bg-card px-2 py-1.5';
  const addRowTag = (tag: string) => {
    const clean = tag.trim();
    if (!clean) return;
    onChangeRow({ tags: Array.from(new Set([...(row.tags ?? []), clean])) });
  };
  const removeRowTag = (tag: string) => {
    onChangeRow({ tags: (row.tags ?? []).filter((item) => item !== tag) });
  };

  if (readOnly) {
    return (
      <>
        {showSelectColumn ? <SelectCell checked={isSelected} onChange={onToggleSelected} /> : null}
        <div className={`${cellBase} font-mono text-sm font-semibold text-foreground`}>
          {row.ticker || '—'}
        </div>
        <div className={`${cellBase} text-sm text-foreground`}>
          <TradeTagEditor tags={row.tags ?? []} globalTags={globalTags} readOnly emptyLabel="—" />
        </div>
        <div className={`${cellBase} text-sm text-foreground`}>{row.grade || '—'}</div>
        <div className={`${cellBase} whitespace-pre-wrap text-sm text-foreground`}>
          {row.notes || '—'}
        </div>
        <ReportCell reportId={row.reportId} reportOpen={reportOpen} onToggle={onToggleReport} />
        {showChartColumn ? (
          <ChartCell ticker={row.ticker} chartOpen={chartOpen} onToggle={onToggleChart} />
        ) : null}
        {showSaveColumn ? <SaveCell ticker={row.ticker} onClick={onClickSave} /> : null}
      </>
    );
  }

  return (
    <>
      {showSelectColumn ? <SelectCell checked={isSelected} onChange={onToggleSelected} /> : null}

      <div className={cellBase}>
        <input
          id={tickerInputId}
          value={row.ticker}
          onChange={(event) => onChangeRow({ ticker: event.target.value.toUpperCase() })}
          placeholder="AAPL"
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-sm uppercase text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
        />
      </div>

      <div className={cellBase}>
        <TradeTagEditor
          tags={row.tags ?? []}
          globalTags={globalTags}
          onAddTag={addRowTag}
          onRemoveTag={removeRowTag}
          onDeleteGlobalTag={onDeleteGlobalTag}
          emptyLabel="—"
        />
      </div>

      <div className={cellBase}>
        <Select
          value={row.grade || undefined}
          onValueChange={(value) => onChangeRow({ grade: value })}
        >
          <SelectTrigger className="h-7 border-transparent bg-transparent px-1 text-sm text-foreground hover:border-emerald-500/30 hover:bg-accent">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-foreground">
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

      <ReportCell reportId={row.reportId} reportOpen={reportOpen} onToggle={onToggleReport} />

      {showChartColumn ? (
        <ChartCell ticker={row.ticker} chartOpen={chartOpen} onToggle={onToggleChart} />
      ) : null}

      {showSaveColumn ? <SaveCell ticker={row.ticker} onClick={onClickSave} /> : null}

      <div className={`${cellBase} flex items-center justify-center`}>
        <button
          type="button"
          onClick={onRemoveRow}
          className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
          title="Remove row"
          aria-label="Remove row"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </>
  );
}

function SelectCell({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-center bg-card px-1 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 rounded border-border bg-card accent-primary"
        aria-label="Select watchlist row"
      />
    </div>
  );
}

function ReportCell({
  reportId,
  reportOpen,
  onToggle,
}: {
  reportId: string | undefined;
  reportOpen: boolean;
  onToggle: () => void;
}) {
  if (!reportId) {
    return (
      <div className="flex items-center justify-center bg-card px-1 py-1.5 text-xs text-muted-foreground">
        —
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center bg-card px-1 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-md p-1 ${
          reportOpen ? 'bg-primary/15 text-primary' : 'text-primary hover:bg-accent hover:text-primary/80'
        }`}
        title={reportOpen ? 'Hide Report' : 'Show Report'}
        aria-label={reportOpen ? 'Hide Report' : 'Show Report'}
        aria-expanded={reportOpen}
      >
        <FileText className="h-4 w-4" />
      </button>
    </div>
  );
}

// Chart-icon counterpart to ReportCell. Unlike the report viewer (which needs a
// stored reportId), the chart only needs a ticker — any row with a non-empty
// ticker can render a chart for the daily review's date. Empty ticker rows
// show a muted dash so the column never looks broken.
function ChartCell({
  ticker,
  chartOpen,
  onToggle,
}: {
  ticker: string;
  chartOpen: boolean;
  onToggle: () => void;
}) {
  if (!ticker.trim()) {
    return (
      <div className="flex items-center justify-center bg-card px-1 py-1.5 text-xs text-muted-foreground">
        —
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center bg-card px-1 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-md p-1 ${
          chartOpen ? 'bg-primary/15 text-primary' : 'text-primary hover:bg-accent hover:text-primary/80'
        }`}
        title={chartOpen ? 'Hide Chart' : 'Show Chart'}
        aria-label={chartOpen ? 'Hide Chart' : 'Show Chart'}
        aria-expanded={chartOpen}
      >
        <LineChart className="h-4 w-4" />
      </button>
    </div>
  );
}

function SaveCell({ ticker, onClick }: { ticker: string; onClick: () => void }) {
  if (!ticker.trim()) {
    return (
      <div className="flex items-center justify-center bg-card px-1 py-1.5 text-xs text-muted-foreground">
        —
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center bg-card px-1 py-1.5">
      <button
        type="button"
        onClick={onClick}
        className="rounded-md p-1 text-primary hover:bg-accent hover:text-primary/80"
        title="Save to Sample Set"
        aria-label="Save to Sample Set"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
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
      className="block w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
    />
  );
}
