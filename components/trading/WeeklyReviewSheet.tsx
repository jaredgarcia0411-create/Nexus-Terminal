'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import TemplateFieldRenderer from '@/components/trading/TemplateFieldRenderer';
import WatchlistEditor, { type WatchlistRow } from '@/components/trading/WatchlistEditor';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { aggregateWeek } from '@/lib/journal-aggregates';
import { WEEKLY_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';
import type { TemplateField } from '@/lib/validations/reviews';
import { coerceWatchlistRows, dedupeWatchlistRows, WATCHLIST_REPORT_KEY } from '@/lib/watchlist';

const GRADE_FIELD: TemplateField = {
  id: 'grade',
  label: 'Grade',
  type: 'enum',
  required: false,
  options: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'],
};

const HOISTED_FIELD_IDS = new Set(['weeklyTotal', 'netResult', 'rTotal', 'grade']);

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

function cloneTemplateFields(fields: TemplateField[]): TemplateField[] {
  return fields.map((field) => ({
    ...field,
    options: field.options ? [...field.options] : undefined,
  }));
}

export default function WeeklyReviewSheet({
  open,
  onOpenChange,
  weekStart,
  weekEnd,
  trades,
  onSaved,
  readOnly = false,
  printOnReady = false,
}: WeeklyReviewSheetProps) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [existing, setExisting] = useState<ReviewRow | null>(null);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [reportData, setReportData] = useState<Record<string, unknown>>({});
  const [aggregatedWatchlist, setAggregatedWatchlist] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);

  const isExistingReport = existing !== null;

  useEffect(() => {
    if (!open || !weekStart || !weekEnd) return;

    setLoading(true);
    setExisting(null);
    setTemplate(null);
    setFields([]);
    setReportData({});
    setAggregatedWatchlist([]);
    setEditingTemplate(false);

    void Promise.all([
      fetch(`/api/weekly-reviews?from=${weekStart}&to=${weekEnd}`).then((response) => response.json()),
      fetch('/api/report-templates?type=weekly').then((response) => response.json()),
      fetch(`/api/daily-reviews?from=${weekStart}&to=${weekEnd}`).then((response) => response.json()),
    ])
      .then(([reviewsRes, templateRes, dailyRes]) => {
        const tmpl = templateRes.template as TemplateRow | undefined;
        const reviews = (reviewsRes.reviews ?? []) as ReviewRow[];
        const found = reviews[0] ?? null;
        // Each daily review's reportData carries its own watchlist under WATCHLIST_REPORT_KEY.
        const dailyReviews = (dailyRes?.reviews ?? []) as Array<{ date?: string; reportData?: Record<string, unknown> }>;
        const collected = dailyReviews
          .slice()
          .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
          .flatMap((row) => coerceWatchlistRows(row?.reportData?.[WATCHLIST_REPORT_KEY]));
        setAggregatedWatchlist(dedupeWatchlistRows(collected));

        setTemplate(tmpl ?? null);

        const agg = aggregateWeek(trades, weekStart, weekEnd);

        if (found) {
          setExisting(found);
          setFields(cloneTemplateFields(found.templateSnapshot));
          const merged: Record<string, unknown> = { ...found.reportData };
          if (merged.netResult == null) merged.netResult = formatCurrency(agg.netResult);
          if (merged.rTotal == null) merged.rTotal = formatRTotal(agg.rTotal);
          setReportData(merged);
        } else if (tmpl) {
          setFields(cloneTemplateFields(tmpl.fields));
          setReportData({
            netResult: formatCurrency(agg.netResult),
            rTotal: formatRTotal(agg.rTotal),
          });
        }
      })
      .finally(() => setLoading(false));
  }, [open, weekEnd, weekStart, trades]);

  // Auto-print once data has loaded. The 200ms delay gives the sheet
  // animation time to settle so charts and layout are committed to the DOM
  // before the browser snapshots the page for print.
  useEffect(() => {
    if (!printOnReady || !open || loading) return;
    const timer = setTimeout(() => window.print(), 200);
    return () => clearTimeout(timer);
  }, [printOnReady, open, loading]);

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
          reportData,
          tradeIds: agg.tradeIds,
        }),
      });

      if (!response.ok) throw new Error('Save failed');

      toast.success('Weekly review saved');
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

  const agg = weekStart && weekEnd ? aggregateWeek(trades, weekStart, weekEnd) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="print-target w-full overflow-y-auto border-white/10 bg-[#121214] text-white sm:max-w-3xl"
      >
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold">
              Weekly Review
              {weekStart
                ? ` — ${format(new Date(`${weekStart}T00:00:00`), 'MMM d')} – ${
                    weekEnd ? format(new Date(`${weekEnd}T00:00:00`), 'MMM d, yyyy') : ''
                  }`
                : ''}
            </SheetTitle>
            {!isExistingReport && !readOnly ? (
              <button
                onClick={() => setEditingTemplate(!editingTemplate)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                title="Edit template"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="mt-4 space-y-6 p-4">
            {!readOnly ? (
              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                >
                  {saving ? 'Saving…' : isExistingReport ? 'Update Review' : 'Save Review'}
                </Button>
              </div>
            ) : null}

            <WatchlistEditor
              title="Weekly Watchlist"
              value={aggregatedWatchlist}
              readOnly
              emptyState="No watchlist entries logged in the daily reviews this week."
            />

            {agg ? (
              <div className="grid gap-3 md:grid-cols-2">
                {agg.perDayR.length > 0 ? (
                  <RBarStrip perDayR={agg.perDayR} />
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-zinc-500">
                    No trades logged this week.
                  </div>
                )}
                <div className="space-y-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium capitalize text-white">
                      Total for the Week
                    </p>
                    <p className="mt-2 text-sm font-medium text-zinc-100">
                      Net {formatCurrency(agg.netResult)} · {formatRTotal(agg.rTotal)} · {agg.tradeIds.length} trade
                      {agg.tradeIds.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <TemplateFieldRenderer
                    field={GRADE_FIELD}
                    value={reportData.grade}
                    readOnly={readOnly}
                    onChange={(nextValue) => setReportData((prev) => ({ ...prev, grade: nextValue }))}
                  />
                </div>
              </div>
            ) : null}

            {editingTemplate && !isExistingReport && !readOnly ? (
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium capitalize text-white">Edit Template</p>
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121214] p-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveField(index, -1)} className="rounded p-0.5 hover:bg-white/10">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button onClick={() => moveField(index, 1)} className="rounded p-0.5 hover:bg-white/10">
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
                      className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                    />
                    <span className="w-12 text-center text-[10px] text-zinc-500">{field.type}</span>
                    <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => {
                          const copy = [...fields];
                          copy[index] = { ...copy[index], required: event.target.checked };
                          setFields(copy);
                        }}
                        className="accent-emerald-500"
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
                    className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                  >
                    Save Template
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleResetTemplate}
                    className="border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
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
                    key={field.id}
                    field={field}
                    value={reportData[field.id]}
                    readOnly={readOnly}
                    onChange={(nextValue) => setReportData((prev) => ({ ...prev, [field.id]: nextValue }))}
                  />
                ))}
            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RBarStrip({ perDayR }: { perDayR: { date: string; r: number }[] }) {
  const maxAbsR = Math.max(...perDayR.map((day) => Math.abs(day.r)), 0.01);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-sm font-medium capitalize text-white">R by Day</p>
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
              <span className="text-[9px] text-zinc-500">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
