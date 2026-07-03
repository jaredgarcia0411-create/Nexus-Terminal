'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import ArchivedWatchlist from '@/components/trading/ArchivedWatchlist';
import JournalTradeChart from '@/components/trading/JournalTradeChart';
import TemplateFieldRenderer from '@/components/trading/TemplateFieldRenderer';
import WeeklyTradesPanel from '@/components/trading/WeeklyTradesPanel';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { prefetchTradeExecutions } from '@/hooks/use-trade-executions';
import { readDrafts, writeDrafts } from '@/lib/drafts';
import { TRADE_GRADES_REPORT_KEY } from '@/lib/grades';
import { aggregateDay } from '@/lib/journal-aggregates';
import { DAILY_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import type { Trade } from '@/lib/types';
import { formatCurrency } from '@/lib/ui-trade-utils';
import { coerceWatchlistRows, WATCHLIST_REPORT_KEY, type WatchlistRow } from '@/lib/watchlist';
import type { TemplateField } from '@/lib/validations/reviews';

const INITIAL_CHART_BATCH = 4;
const CHART_BATCH_STEP = 4;
const DAILY_DRAFTS_KEY = 'nexus-daily-review-drafts';

interface DailyReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string | null;
  trades: Trade[];
  onSaved?: () => void;
  readOnly?: boolean;
  globalTags?: string[];
  onAddTag?: (tradeId: string, tagName: string) => void;
  onRemoveTag?: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
  onTradeClick?: (trade: Trade) => void;
  // When true, fire window.print() once the review data has loaded. Used by
  // Archive's PDF export — the print stylesheet (globals.css) hides
  // everything except this sheet's content.
  printOnReady?: boolean;
}

interface TemplateRow {
  id: string;
  fields: TemplateField[];
}

interface ReviewRow {
  id: string;
  templateId: string | null;
  templateSnapshot: TemplateField[];
  reportData: Record<string, unknown>;
  tradeIds: string[];
}

interface ResearchRowsResponse {
  rows?: Array<{ ticker: string; date: string; reportId?: string }>;
}

function cloneTemplateFields(fields: TemplateField[]): TemplateField[] {
  return fields.map((field) => ({
    ...field,
    options: field.options ? [...field.options] : undefined,
  }));
}

function coerceTradeGrades(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, string> = {};
  for (const [tradeId, grade] of Object.entries(input)) {
    if (typeof grade === 'string') result[tradeId] = grade;
  }
  return result;
}

export default function DailyReportSheet({
  open,
  onOpenChange,
  date,
  trades,
  onSaved,
  readOnly = false,
  globalTags = [],
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
  onTradeClick,
  printOnReady = false,
}: DailyReportSheetProps) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [existing, setExisting] = useState<ReviewRow | null>(null);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [reportData, setReportData] = useState<Record<string, unknown>>({});
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);
  const [tradeGrades, setTradeGrades] = useState<Record<string, string>>({});
  const [reportByKey, setReportByKey] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [chartCount, setChartCount] = useState(INITIAL_CHART_BATCH);
  // All sheets — saved or fresh — open in 'view' so URLs render as clickable
  // anchors (the textarea swap happens via the `readOnly` prop on the
  // renderers). Clicking "Edit Review" flips to 'edit' to expose the inputs
  // and the save button.
  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');

  const isExistingReport = existing !== null;
  // The parent `readOnly` prop (Archive's PDF export) forces read-only and
  // hides the Edit button entirely. Otherwise viewMode drives it.
  const effectiveReadOnly = readOnly || viewMode === 'view';

  useEffect(() => {
    if (!open || !date) return;

    setLoading(true);
    setExisting(null);
    setTemplate(null);
    setFields([]);
    setReportData({});
    setWatchlist([]);
    setTradeGrades({});
    setReportByKey(new Map());
    setEditingTemplate(false);
    setHasDraft(false);
    setChartCount(INITIAL_CHART_BATCH);
    // Always reset to view; user explicitly clicks "Edit Review" to mutate.
    setViewMode('view');

    void Promise.all([
      fetch(`/api/daily-reviews?from=${date}&to=${date}`).then((response) => response.json()),
      fetch('/api/report-templates?type=daily').then((response) => response.json()),
      fetch(`/api/sheets/research-rows?from=${date}&to=${date}`).then((response) => response.json()),
    ])
      .then(([reviewsRes, templateRes, researchRowsRes]) => {
        const tmpl = templateRes.template as TemplateRow | undefined;
        const reviews = (reviewsRes.reviews ?? []) as ReviewRow[];
        const found = reviews[0] ?? null;
        const researchRows = (researchRowsRes as ResearchRowsResponse).rows ?? [];
        const nextReportByKey = new Map<string, string>();
        for (const row of researchRows) {
          if (row.reportId) nextReportByKey.set(`${row.ticker.trim().toUpperCase()}|${row.date}`, row.reportId);
        }
        setReportByKey(nextReportByKey);

        setTemplate(tmpl ?? null);

        if (found) {
          setExisting(found);
          setFields(cloneTemplateFields(found.templateSnapshot));
          const agg = aggregateDay(trades, date);
          // Auto fields are read-only (see TemplateFieldRenderer) — always overwrite so stale saved zeros don't shadow fresh aggregates.
          const merged: Record<string, unknown> = {
            ...found.reportData,
            grossResult: formatCurrency(agg.grossResult),
            netResult: formatCurrency(agg.netResult),
            rTotal: `${agg.rTotal.toFixed(2)}R`,
          };
          setReportData(merged);
          setWatchlist(coerceWatchlistRows(found.reportData?.[WATCHLIST_REPORT_KEY]));
          setTradeGrades(coerceTradeGrades(found.reportData?.[TRADE_GRADES_REPORT_KEY]));
        } else if (tmpl) {
          setFields(cloneTemplateFields(tmpl.fields));
          const agg = aggregateDay(trades, date);
          const initialData: Record<string, unknown> = {
            grossResult: formatCurrency(agg.grossResult),
            netResult: formatCurrency(agg.netResult),
            rTotal: `${agg.rTotal.toFixed(2)}R`,
          };
          setReportData(initialData);
          setWatchlist([]);
          setTradeGrades({});
        }

        // Re-pin auto fields after the draft so stale saved P/L can't shadow live aggregates.
        // Skip entirely when the parent forces read-only (Archive / PDF export). Restoring a
        // draft drops into Edit mode so the pill + Save button show.
        const draft = date && !readOnly ? readDrafts<Record<string, unknown>>(DAILY_DRAFTS_KEY)[date] : undefined;
        if (draft && date) {
          const dayAgg = aggregateDay(trades, date);
          setReportData((prev) => ({
            ...prev,
            ...draft,
            grossResult: formatCurrency(dayAgg.grossResult),
            netResult: formatCurrency(dayAgg.netResult),
            rTotal: `${dayAgg.rTotal.toFixed(2)}R`,
          }));
          setHasDraft(true);
          setViewMode('edit');
        }
      })
      .finally(() => setLoading(false));
  }, [open, date, readOnly, trades]);

  const agg = useMemo(() => (date ? aggregateDay(trades, date) : null), [date, trades]);
  const chartTrades = useMemo(
    () => (agg ? trades.filter((trade) => agg.tradeIds.includes(trade.id)) : []),
    [agg, trades],
  );

  // Auto-print once data has loaded. The 200ms delay gives the sheet
  // animation time to settle so charts and layout are committed to the DOM
  // before the browser snapshots the page for print.
  useEffect(() => {
    if (!printOnReady || !open || loading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Executions were dropped from the bulk trades payload, so make sure the
    // replay charts have their per-fill markers loaded before we snapshot for print.
    void prefetchTradeExecutions(chartTrades.slice(0, chartCount).map((trade) => trade.id))
      .then(() => {
        if (cancelled) return;
        timer = setTimeout(() => window.print(), 200);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [printOnReady, open, loading, chartTrades, chartCount]);

  const updateReportField = (id: string, nextValue: unknown) => {
    const next = { ...reportData, [id]: nextValue };
    setReportData(next);
    if (!date) return;
    const drafts = readDrafts<Record<string, unknown>>(DAILY_DRAFTS_KEY);
    drafts[date] = next;
    writeDrafts(DAILY_DRAFTS_KEY, drafts);
    setHasDraft(true);
  };

  const handleSave = async () => {
    if (!date || !template) return;
    setSaving(true);
    try {
      const agg = aggregateDay(trades, date);
      const response = await fetch('/api/daily-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          templateId: template.id,
          templateSnapshot: fields,
          reportData: { ...reportData, [TRADE_GRADES_REPORT_KEY]: tradeGrades },
          tradeIds: agg.tradeIds,
        }),
      });

      if (!response.ok) throw new Error('Save failed');

      toast.success('Daily review saved');
      if (date) {
        const drafts = readDrafts<Record<string, unknown>>(DAILY_DRAFTS_KEY);
        delete drafts[date];
        writeDrafts(DAILY_DRAFTS_KEY, drafts);
      }
      setHasDraft(false);
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error('Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const handleResetTemplate = async () => {
    const nextFields = cloneTemplateFields(DAILY_DEFAULT_FIELDS);
    setFields(nextFields);

    try {
      const response = await fetch('/api/report-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'daily', fields: nextFields }),
      });

      if (!response.ok) throw new Error('Reset failed');

      const data = (await response.json()) as { template: TemplateRow };
      setTemplate(data.template);
      setFields(cloneTemplateFields(data.template.fields));
      toast.success('Template reset');
    } catch {
      toast.error('Failed to reset template');
    }
  };

  const saveTemplate = async () => {
    if (!template) return;

    try {
      const response = await fetch('/api/report-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'daily', fields }),
      });

      if (!response.ok) throw new Error('Save failed');

      const data = (await response.json()) as { template: TemplateRow };
      setTemplate(data.template);
      setFields(cloneTemplateFields(data.template.fields));
      setEditingTemplate(false);
      toast.success('Template saved');
    } catch {
      toast.error('Failed to save template');
    }
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const copy = [...fields];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= copy.length) return;
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    setFields(copy);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="print-target w-full overflow-y-auto border-border bg-card text-foreground sm:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle className="text-base font-semibold">
            Daily Review — {date ? format(new Date(`${date}T00:00:00`), 'EEEE, MMM d yyyy') : ''}
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="mt-4 space-y-6 p-4">
            {!readOnly ? (
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setEditingTemplate((flag) => !flag)}
                  className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit Template
                </Button>
                {viewMode === 'view' ? (
                  <Button
                    onClick={() => setViewMode('edit')}
                    className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    Edit Review
                  </Button>
                ) : (
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    {saving ? 'Saving…' : isExistingReport ? 'Update Review' : 'Save Review'}
                  </Button>
                )}
              </div>
            ) : null}

            {hasDraft && viewMode === 'edit' ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                Unsaved draft saved in this browser — hit {isExistingReport ? 'Update' : 'Save'} Review to store it.
              </p>
            ) : null}

            {watchlist.length > 0 ? <ArchivedWatchlist rows={watchlist} /> : null}

            <WeeklyTradesPanel
              trades={chartTrades}
              title="Daily Trades"
              emptyState="No trades logged today."
              globalTags={globalTags}
              readOnly={effectiveReadOnly || !onAddTag || !onRemoveTag}
              onAddTag={onAddTag}
              onRemoveTag={onRemoveTag}
              onDeleteGlobalTag={onDeleteGlobalTag}
              grades={tradeGrades}
              onGradeChange={(tradeId, grade) => setTradeGrades((prev) => ({ ...prev, [tradeId]: grade }))}
              reportByKey={reportByKey}
              onOpenTrade={onTradeClick}
            />

            {editingTemplate && !readOnly ? (
              <div className="space-y-3 rounded-xl border border-border bg-accent p-4">
                <p className="text-sm font-medium capitalize text-foreground">Edit Template</p>
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveField(index, -1)} className="rounded p-0.5 hover:bg-accent">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button onClick={() => moveField(index, 1)} className="rounded p-0.5 hover:bg-accent">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <input
                      value={field.label}
                      onChange={(event) => {
                        const copy = [...fields];
                        copy[index] = { ...copy[index], label: event.target.value };
                        setFields(copy);
                      }}
                      className="flex-1 rounded border border-border bg-accent px-2 py-1 text-xs text-foreground focus:outline-none"
                    />
                    <span className="w-12 text-center text-[10px] text-muted-foreground">{field.type}</span>
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => {
                          const copy = [...fields];
                          copy[index] = { ...copy[index], required: event.target.checked };
                          setFields(copy);
                        }}
                        className="accent-primary"
                      />
                      Req
                    </label>
                    <button
                      onClick={() => removeField(index)}
                      className="rounded p-0.5 text-rose-400 hover:bg-rose-500/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={saveTemplate}
                    className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    Save Template
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleResetTemplate}
                    className="border-border bg-accent text-muted-foreground hover:bg-accent"
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              {fields.map((field) => (
                <TemplateFieldRenderer
                  key={`${date ?? 'new'}-${field.id}`}
                  field={field}
                  value={reportData[field.id]}
                  readOnly={effectiveReadOnly}
                  onChange={(nextValue) => updateReportField(field.id, nextValue)}
                />
              ))}
            </div>

            {chartTrades.length > 0 ? (
              <div className="space-y-3 rounded-xl border border-border bg-card p-3">
                <p className="text-sm font-medium capitalize text-foreground">Trade Replay Charts</p>
                <div className="space-y-3">
                  {chartTrades.slice(0, chartCount).map((trade) => (
                    <div key={trade.id} className="space-y-1">
                      <p className="text-xs font-semibold text-foreground">
                        {trade.symbol} ({trade.direction})
                      </p>
                      <JournalTradeChart trade={trade} />
                    </div>
                  ))}
                  {chartTrades.length > chartCount ? (
                    <div className="flex justify-center">
                      <button
                        onClick={() => setChartCount((count) => Math.min(chartTrades.length, count + CHART_BATCH_STEP))}
                        className="rounded-lg border border-border bg-accent px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                      >
                        Load {Math.min(CHART_BATCH_STEP, chartTrades.length - chartCount)} more charts
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
