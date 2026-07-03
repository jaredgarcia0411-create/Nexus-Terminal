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
import { aggregateWeek } from '@/lib/journal-aggregates';
import { WEEKLY_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import { formatCurrency } from '@/lib/ui-trade-utils';
import type { Trade } from '@/lib/types';
import type { TemplateField } from '@/lib/validations/reviews';
import { coerceWatchlistRows, dedupeWatchlistRows, WATCHLIST_REPORT_KEY, type WatchlistRow } from '@/lib/watchlist';

const GRADE_FIELD: TemplateField = {
  id: 'grade',
  label: 'Grade',
  type: 'enum',
  required: false,
  options: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'],
};

const HOISTED_FIELD_IDS = new Set(['weeklyTotal', 'netResult', 'rTotal', 'grade']);

// Match DailyReportSheet's chart pagination so the two sheets feel identical.
const INITIAL_CHART_BATCH = 4;
const CHART_BATCH_STEP = 4;
const WEEKLY_DRAFTS_KEY = 'nexus-weekly-review-drafts';

function formatRTotal(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

interface WeeklyReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekStart: string | null;
  weekEnd: string | null;
  trades: Trade[];
  onSaved?: () => void;
  readOnly?: boolean;
  onTradeClick?: (trade: Trade) => void;
  // When true, fire window.print() once the review data has loaded. Used by
  // Archive's PDF export — paired with the .print-target stylesheet in
  // globals.css.
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

// Normalize a stored template (live template row or a review's frozen
// snapshot) against WEEKLY_DEFAULT_FIELDS. We do three things in memory so
// existing users see the latest canonical structure without having to hit
// "Reset to Defaults":
//   1. Append any default fields that are missing from the stored list (so
//      newly-added defaults like "Thoughts" appear).
//   2. Rewrite labels for known IDs to the canonical label (so renames like
//      "Goals next week" → "Goals For Next Week" propagate).
//   3. Move known IDs to the bottom in canonical order if they aren't
//      already (so reorders like Thoughts → Goals For Next Week stick).
// Fields whose IDs aren't in WEEKLY_DEFAULT_FIELDS are preserved as-is at
// their original position, so any custom field a user added survives.
const REPOSITION_FIELD_IDS = new Set(['thoughts', 'goalsNextWeek']);
function withMissingDefaults(fields: TemplateField[]): TemplateField[] {
  const defaultLabels = new Map(WEEKLY_DEFAULT_FIELDS.map((field) => [field.id, field.label]));
  const fieldsById = new Map(fields.map((field) => [field.id, field]));

  // 1 + 2: pass through stored fields in their current order, but rewrite
  // labels to canonical. Skip the fields we'll reposition at the end.
  const passthrough = fields
    .filter((field) => !REPOSITION_FIELD_IDS.has(field.id))
    .map((field) => {
      const canonicalLabel = defaultLabels.get(field.id);
      return canonicalLabel && canonicalLabel !== field.label
        ? { ...field, label: canonicalLabel }
        : field;
    });

  // 3: append the repositioned IDs in their canonical order. Use the
  // stored field's options/required if present; otherwise clone from
  // defaults so a brand-new field still renders.
  const repositioned = WEEKLY_DEFAULT_FIELDS
    .filter((def) => REPOSITION_FIELD_IDS.has(def.id))
    .map((def) => {
      const existing = fieldsById.get(def.id);
      if (existing) {
        return { ...existing, label: def.label };
      }
      return cloneTemplateFields([def])[0];
    });

  return [...passthrough, ...repositioned];
}

export default function WeeklyReviewSheet({
  open,
  onOpenChange,
  weekStart,
  weekEnd,
  trades,
  onSaved,
  readOnly = false,
  onTradeClick,
  printOnReady = false,
}: WeeklyReviewSheetProps) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [existing, setExisting] = useState<ReviewRow | null>(null);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [reportData, setReportData] = useState<Record<string, unknown>>({});
  const [aggregatedWatchlist, setAggregatedWatchlist] = useState<WatchlistRow[]>([]);
  const [tradeGrades, setTradeGrades] = useState<Record<string, string>>({});
  const [reportByKey, setReportByKey] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [chartCount, setChartCount] = useState(INITIAL_CHART_BATCH);
  // Mirror DailyReportSheet: every open defaults to 'view' so URLs render as
  // clickable anchors (TemplateFieldRenderer swaps the textarea for an
  // anchor-aware block when readOnly). Clicking "Edit Review" flips to 'edit'
  // to expose the inputs and the save button.
  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');

  const isExistingReport = existing !== null;
  // Parent `readOnly` (Archive's PDF export) forces read-only and hides
  // Edit entirely; otherwise viewMode drives it.
  const effectiveReadOnly = readOnly || viewMode === 'view';

  useEffect(() => {
    if (!open || !weekStart || !weekEnd) return;

    setLoading(true);
    setExisting(null);
    setTemplate(null);
    setFields([]);
    setReportData({});
    setAggregatedWatchlist([]);
    setTradeGrades({});
    setReportByKey(new Map());
    setEditingTemplate(false);
    setHasDraft(false);
    setChartCount(INITIAL_CHART_BATCH);
    // Always reset to view; user explicitly clicks "Edit Review" to mutate.
    setViewMode('view');

    void Promise.all([
      fetch(`/api/weekly-reviews?from=${weekStart}&to=${weekEnd}`).then((response) => response.json()),
      fetch('/api/report-templates?type=weekly').then((response) => response.json()),
      fetch(`/api/daily-reviews?from=${weekStart}&to=${weekEnd}`).then((response) => response.json()),
      fetch(`/api/sheets/research-rows?from=${weekStart}&to=${weekEnd}`).then((response) => response.json()),
    ])
      .then(([reviewsRes, templateRes, dailyRes, researchRowsRes]) => {
        const tmpl = templateRes.template as TemplateRow | undefined;
        const reviews = (reviewsRes.reviews ?? []) as ReviewRow[];
        const found = reviews[0] ?? null;
        const researchRows = (researchRowsRes as ResearchRowsResponse).rows ?? [];
        const nextReportByKey = new Map<string, string>();
        for (const row of researchRows) {
          if (row.reportId) nextReportByKey.set(`${row.ticker.trim().toUpperCase()}|${row.date}`, row.reportId);
        }
        setReportByKey(nextReportByKey);

        // Each daily review's reportData carries its own watchlist under WATCHLIST_REPORT_KEY.
        // Attach each daily's date as `sourceDate` so the aggregated rows still
        // know their session for the Chart and Save columns.
        const dailyReviews = (dailyRes?.reviews ?? []) as Array<{ date?: string; reportData?: Record<string, unknown> }>;
        const collected = dailyReviews
          .slice()
          .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
          .flatMap((daily) => coerceWatchlistRows(daily?.reportData?.[WATCHLIST_REPORT_KEY])
            .map((row) => (daily.date ? { ...row, sourceDate: daily.date } : row)));
        setAggregatedWatchlist(dedupeWatchlistRows(collected));

        setTemplate(tmpl ?? null);

        const agg = aggregateWeek(trades, weekStart, weekEnd);

        if (found) {
          setExisting(found);
          setFields(withMissingDefaults(cloneTemplateFields(found.templateSnapshot)));
          const merged: Record<string, unknown> = { ...found.reportData };
          if (merged.netResult == null) merged.netResult = formatCurrency(agg.netResult);
          if (merged.rTotal == null) merged.rTotal = formatRTotal(agg.rTotal);
          setReportData(merged);
          setTradeGrades(coerceTradeGrades(found.reportData?.[TRADE_GRADES_REPORT_KEY]));
        } else if (tmpl) {
          setFields(withMissingDefaults(cloneTemplateFields(tmpl.fields)));
          setReportData({
            netResult: formatCurrency(agg.netResult),
            rTotal: formatRTotal(agg.rTotal),
          });
          setTradeGrades({});
        }

        // Re-pin auto fields after the draft so stale saved P/L can't shadow live aggregates.
        // Skip entirely when the parent forces read-only (Archive / PDF export). Restoring a
        // draft drops into Edit mode so the pill + Save button show.
        const draft = weekStart && !readOnly
          ? readDrafts<Record<string, unknown>>(WEEKLY_DRAFTS_KEY)[weekStart]
          : undefined;
        if (draft && weekStart) {
          const weekAgg = aggregateWeek(trades, weekStart, weekEnd);
          setReportData((prev) => ({
            ...prev,
            ...draft,
            netResult: formatCurrency(weekAgg.netResult),
            rTotal: formatRTotal(weekAgg.rTotal),
          }));
          setHasDraft(true);
          setViewMode('edit');
        }
      })
      .finally(() => setLoading(false));
  }, [open, readOnly, weekEnd, weekStart, trades]);

  const agg = useMemo(
    () => (weekStart && weekEnd ? aggregateWeek(trades, weekStart, weekEnd) : null),
    [trades, weekEnd, weekStart],
  );
  // Mirror DailyReportSheet: every trade in the week's tradeIds gets a replay chart.
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
    if (!weekStart) return;
    const drafts = readDrafts<Record<string, unknown>>(WEEKLY_DRAFTS_KEY);
    drafts[weekStart] = next;
    writeDrafts(WEEKLY_DRAFTS_KEY, drafts);
    setHasDraft(true);
  };

  const handleSave = async () => {
    if (!weekStart || !weekEnd || !template) return;
    setSaving(true);
    try {
      const agg = aggregateWeek(trades, weekStart, weekEnd);
      const response = await fetch('/api/weekly-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart,
          weekEnd,
          templateId: template.id,
          templateSnapshot: fields,
          reportData: { ...reportData, [TRADE_GRADES_REPORT_KEY]: tradeGrades },
          tradeIds: agg.tradeIds,
        }),
      });

      if (!response.ok) throw new Error('Save failed');

      toast.success('Weekly review saved');
      if (weekStart) {
        const drafts = readDrafts<Record<string, unknown>>(WEEKLY_DRAFTS_KEY);
        delete drafts[weekStart];
        writeDrafts(WEEKLY_DRAFTS_KEY, drafts);
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
    const nextFields = cloneTemplateFields(WEEKLY_DEFAULT_FIELDS);
    setFields(nextFields);

    try {
      const response = await fetch('/api/report-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'weekly', fields: nextFields }),
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
    try {
      const response = await fetch('/api/report-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'weekly', fields }),
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
            Weekly Review
            {weekStart
              ? ` — ${format(new Date(`${weekStart}T00:00:00`), 'MMM d')} – ${
                  weekEnd ? format(new Date(`${weekEnd}T00:00:00`), 'MMM d, yyyy') : ''
                }`
              : ''}
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

            {aggregatedWatchlist.length > 0 ? <ArchivedWatchlist rows={aggregatedWatchlist} /> : null}

            <WeeklyTradesPanel
              trades={chartTrades}
              readOnly={effectiveReadOnly}
              grades={tradeGrades}
              onGradeChange={(tradeId, grade) => setTradeGrades((prev) => ({ ...prev, [tradeId]: grade }))}
              reportByKey={reportByKey}
              onOpenTrade={onTradeClick}
            />

            {agg ? (
              <div className="grid gap-3 md:grid-cols-2">
                {agg.perDayR.length > 0 ? (
                  <RBarStrip perDayR={agg.perDayR} />
                ) : (
                  <div className="rounded-xl border border-border bg-accent p-4 text-xs text-muted-foreground">
                    No trades logged this week.
                  </div>
                )}
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-accent p-4">
                    <p className="text-sm font-medium capitalize text-foreground">
                      Total for the Week
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      Net {formatCurrency(agg.netResult)} · {formatRTotal(agg.rTotal)} · {agg.tradeIds.length} trade
                      {agg.tradeIds.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <TemplateFieldRenderer
                    field={GRADE_FIELD}
                    value={reportData.grade}
                    readOnly={effectiveReadOnly}
                    onChange={(nextValue) => updateReportField('grade', nextValue)}
                  />
                </div>
              </div>
            ) : null}

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
              {fields
                .filter((field) => !HOISTED_FIELD_IDS.has(field.id))
                .map((field) => (
                  <TemplateFieldRenderer
                    key={`${weekStart ?? 'new'}-${field.id}`}
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

function RBarStrip({ perDayR }: { perDayR: { date: string; r: number }[] }) {
  const maxAbsR = Math.max(...perDayR.map((day) => Math.abs(day.r)), 0.01);

  return (
    <div className="rounded-xl border border-border bg-accent p-4">
      <p className="mb-3 text-sm font-medium capitalize text-foreground">R by Day</p>
      <div className="flex items-end gap-2">
        {perDayR.map(({ date, r }) => {
          const heightPx = Math.round((Math.abs(r) / maxAbsR) * 48);
          const label = format(new Date(`${date}T00:00:00`), 'EEE');

          return (
            <div key={date} className="flex flex-col items-center gap-1">
              <div
                style={{ height: `${heightPx}px`, minHeight: '4px' }}
                className={`w-8 rounded-sm ${r >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                title={`${label}: ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`}
              />
              <span className="text-[9px] text-muted-foreground">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
