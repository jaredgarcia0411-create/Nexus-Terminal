'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import JournalTradeChart from '@/components/trading/JournalTradeChart';
import TemplateFieldRenderer from '@/components/trading/TemplateFieldRenderer';
import WatchlistEditor, { type WatchlistRow } from '@/components/trading/WatchlistEditor';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { aggregateDay } from '@/lib/journal-aggregates';
import { DAILY_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import type { Trade } from '@/lib/types';
import { formatCurrency } from '@/lib/trading-utils';
import { coerceWatchlistRows, WATCHLIST_REPORT_KEY } from '@/lib/watchlist';
import type { TemplateField } from '@/lib/validations/reviews';

const INITIAL_CHART_BATCH = 4;
const CHART_BATCH_STEP = 4;

interface DailyReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string | null;
  trades: Trade[];
  onSaved?: () => void;
  readOnly?: boolean;
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

export default function DailyReportSheet({
  open,
  onOpenChange,
  date,
  trades,
  onSaved,
  readOnly = false,
}: DailyReportSheetProps) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [existing, setExisting] = useState<ReviewRow | null>(null);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [reportData, setReportData] = useState<Record<string, unknown>>({});
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [chartCount, setChartCount] = useState(INITIAL_CHART_BATCH);

  const isExistingReport = existing !== null;

  useEffect(() => {
    if (!open || !date) return;

    setLoading(true);
    setExisting(null);
    setTemplate(null);
    setFields([]);
    setReportData({});
    setWatchlist([]);
    setEditingTemplate(false);
    setChartCount(INITIAL_CHART_BATCH);

    void Promise.all([
      fetch(`/api/daily-reviews?from=${date}&to=${date}`).then((response) => response.json()),
      fetch('/api/report-templates?type=daily').then((response) => response.json()),
    ])
      .then(([reviewsRes, templateRes]) => {
        const tmpl = templateRes.template as TemplateRow | undefined;
        const reviews = (reviewsRes.reviews ?? []) as ReviewRow[];
        const found = reviews[0] ?? null;

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
        }
      })
      .finally(() => setLoading(false));
  }, [open, date, trades]);

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
          reportData: { ...reportData, [WATCHLIST_REPORT_KEY]: watchlist },
          tradeIds: agg.tradeIds,
        }),
      });

      if (!response.ok) throw new Error('Save failed');

      toast.success('Daily review saved');
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

  const agg = date ? aggregateDay(trades, date) : null;
  const chartTrades = agg ? trades.filter((trade) => agg.tradeIds.includes(trade.id)) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-white/10 bg-[#121214] text-white sm:max-w-3xl"
      >
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold">
              Daily Review — {date ? format(new Date(`${date}T00:00:00`), 'EEEE, MMM d yyyy') : ''}
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
            <WatchlistEditor
              value={watchlist}
              onChange={readOnly ? undefined : setWatchlist}
              readOnly={readOnly}
            />

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
                    className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
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
              {fields.map((field) => (
                <TemplateFieldRenderer
                  key={field.id}
                  field={field}
                  value={reportData[field.id]}
                  readOnly={readOnly}
                  onChange={(nextValue) => setReportData((prev) => ({ ...prev, [field.id]: nextValue }))}
                />
              ))}
            </div>

            {chartTrades.length > 0 ? (
              <div className="space-y-3 rounded-xl border border-white/10 bg-[#121214] p-3">
                <p className="text-sm font-medium capitalize text-white">Trade Replay Charts</p>
                <div className="space-y-3">
                  {chartTrades.slice(0, chartCount).map((trade) => (
                    <div key={trade.id} className="space-y-1">
                      <p className="text-xs font-semibold text-white">
                        {trade.symbol} ({trade.direction})
                      </p>
                      <JournalTradeChart trade={trade} timeframe="5m" />
                    </div>
                  ))}
                  {chartTrades.length > chartCount ? (
                    <div className="flex justify-center">
                      <button
                        onClick={() => setChartCount((count) => Math.min(chartTrades.length, count + CHART_BATCH_STEP))}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10"
                      >
                        Load {Math.min(CHART_BATCH_STEP, chartTrades.length - chartCount)} more charts
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!readOnly ? (
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                >
                  {saving ? 'Saving…' : isExistingReport ? 'Update Review' : 'Save Review'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
