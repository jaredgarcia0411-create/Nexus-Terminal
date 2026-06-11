'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, ChevronRight, ChevronUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PLAYBOOK_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import { emptySectionsForTemplate } from '@/lib/playbook-defaults';
import { formatCurrency } from '@/lib/ui-trade-utils';
import type { Trade } from '@/lib/types';
import type { PlaybookSections } from '@/lib/validations/playbook';
import type { TemplateField } from '@/lib/validations/reviews';

interface Strategy {
  id: string;
  name: string;
  description: string;
  tag: string;
  sections: PlaybookSections;
  createdAt: string;
  updatedAt: string;
}

interface TemplateRow {
  id: string;
  fields: TemplateField[];
}

interface PlaybookTabProps {
  trades: Trade[];
  globalTags: string[];
}

interface TagStats {
  count: number;
  wins: number;
  winRate: number;
  avgR: number | null;
  totalPnl: number;
}

function computeStats(matching: Trade[]): TagStats {
  if (matching.length === 0) {
    return { count: 0, wins: 0, winRate: 0, avgR: null, totalPnl: 0 };
  }

  const wins = matching.filter((trade) => (trade.netPnl ?? 0) > 0).length;
  const winRate = (wins / matching.length) * 100;
  const totalPnl = matching.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0);
  const rValues = matching
    .filter((trade) => typeof trade.initialRisk === 'number' && trade.initialRisk > 0)
    .map((trade) => (trade.netPnl ?? 0) / (trade.initialRisk as number));
  const avgR = rValues.length > 0 ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null;

  return { count: matching.length, wins, winRate, avgR, totalPnl };
}

function cloneTemplateFields(fields: TemplateField[]): TemplateField[] {
  return fields.map((field) => ({
    ...field,
    options: field.options ? [...field.options] : undefined,
  }));
}

// Generates a stable-ish id for a brand-new section the user adds in the
// template editor. ID just needs to be unique across the current fields list;
// reportData is keyed by these IDs so a clean slug + counter is enough.
function nextFieldId(existing: TemplateField[]): string {
  const base = 'section';
  let counter = existing.length + 1;
  while (existing.some((field) => field.id === `${base}${counter}`)) {
    counter += 1;
  }
  return `${base}${counter}`;
}

const DRAFTS_KEY = 'nexus-playbook-drafts';
type StrategyDraft = Pick<Strategy, 'name' | 'description' | 'tag' | 'sections'>;

function readDrafts(): Record<string, StrategyDraft> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StrategyDraft>) : {};
  } catch {
    return {};
  }
}

function writeDrafts(drafts: Record<string, StrategyDraft>): void {
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore storage failures (private browsing / quota).
  }
}

export default function PlaybookTab({ trades, globalTags }: PlaybookTabProps) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<TemplateField[]>(PLAYBOOK_DEFAULT_FIELDS);
  const [editingTemplate, setEditingTemplate] = useState(false);
  // Strategy ids that currently have an unsaved local draft (drives the pill).
  const [draftedIds, setDraftedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [stratResponse, templateResponse] = await Promise.all([
          fetch('/api/playbook'),
          fetch('/api/report-templates?type=playbook'),
        ]);

        if (!stratResponse.ok) throw new Error(`fetch failed: ${stratResponse.status}`);
        const stratData = (await stratResponse.json()) as { strategies: Strategy[] };

        let tmpl: TemplateRow | null = null;
        if (templateResponse.ok) {
          const tmplData = (await templateResponse.json()) as { template: TemplateRow | null };
          tmpl = tmplData.template ?? null;
        }

        if (!cancelled) {
          const fetched = stratData.strategies ?? [];
          const drafts = readDrafts();
          const validIds = new Set(fetched.map((strategy) => strategy.id));
          // Drop drafts whose strategy no longer exists, then persist if changed.
          let pruned = false;
          for (const id of Object.keys(drafts)) {
            if (!validIds.has(id)) {
              delete drafts[id];
              pruned = true;
            }
          }
          if (pruned) writeDrafts(drafts);
          const nextStrategies = fetched.map((strategy) => (
            drafts[strategy.id] ? { ...strategy, ...drafts[strategy.id] } : strategy
          ));
          setStrategies(nextStrategies);
          setDraftedIds(new Set(Object.keys(drafts)));
          if (nextStrategies.length > 0) {
            setSelectedId(nextStrategies[0].id);
          }
          if (tmpl) {
            setFields(cloneTemplateFields(tmpl.fields));
          }
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) toast.error('Failed to load playbook');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedId) ?? null,
    [strategies, selectedId],
  );

  const matchingTrades = useMemo(() => {
    if (!selected || !selected.tag) return [] as Trade[];

    return trades
      .filter((trade) => trade.tags.includes(selected.tag))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [trades, selected]);

  const stats = useMemo(() => computeStats(matchingTrades), [matchingTrades]);
  const lastTen = matchingTrades.slice(0, 10);

  const handleCreate = async () => {
    setSaving(true);

    try {
      const response = await fetch('/api/playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Strategy',
          description: '',
          tag: '',
          sections: emptySectionsForTemplate(fields),
        }),
      });
      if (!response.ok) throw new Error(`create failed: ${response.status}`);

      const data = (await response.json()) as { strategy: Strategy };
      setStrategies((current) => [...current, data.strategy]);
      setSelectedId(data.strategy.id);
      toast.success('Strategy created');
    } catch (error) {
      console.error(error);
      toast.error('Failed to create strategy');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);

    try {
      const response = await fetch(`/api/playbook?id=${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selected.name,
          description: selected.description,
          tag: selected.tag,
          sections: selected.sections,
        }),
      });
      if (!response.ok) throw new Error(`save failed: ${response.status}`);

      const data = (await response.json()) as { strategy: Strategy };
      setStrategies((current) => current.map((strategy) => (
        strategy.id === data.strategy.id ? data.strategy : strategy
      )));
      const drafts = readDrafts();
      delete drafts[data.strategy.id];
      writeDrafts(drafts);
      setDraftedIds((current) => {
        if (!current.has(data.strategy.id)) return current;
        const next = new Set(current);
        next.delete(data.strategy.id);
        return next;
      });
      toast.success('Saved');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete strategy "${selected.name}"?`)) return;

    try {
      const response = await fetch(`/api/playbook?id=${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`delete failed: ${response.status}`);

      setStrategies((current) => {
        const next = current.filter((strategy) => strategy.id !== selected.id);
        setSelectedId(next.length > 0 ? next[0].id : null);
        return next;
      });
      const drafts = readDrafts();
      delete drafts[selected.id];
      writeDrafts(drafts);
      setDraftedIds((current) => {
        if (!current.has(selected.id)) return current;
        const next = new Set(current);
        next.delete(selected.id);
        return next;
      });
      toast.success('Deleted');
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete');
    }
  };

  const updateSelected = (patch: Partial<Strategy>) => {
    if (!selected) return;
    const merged = { ...selected, ...patch };
    setStrategies((current) => current.map((strategy) => (
      strategy.id === selected.id ? merged : strategy
    )));
    const drafts = readDrafts();
    drafts[selected.id] = {
      name: merged.name,
      description: merged.description,
      tag: merged.tag,
      sections: merged.sections,
    };
    writeDrafts(drafts);
    setDraftedIds((current) => (
      current.has(selected.id) ? current : new Set(current).add(selected.id)
    ));
  };

  const updateSection = (key: string, value: string) => {
    if (!selected) return;
    updateSelected({ sections: { ...selected.sections, [key]: value } });
  };

  // --- Template editor handlers ------------------------------------------

  const saveTemplate = async () => {
    if (fields.length === 0) {
      toast.error('Template needs at least one section');
      return;
    }

    try {
      const response = await fetch('/api/report-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'playbook', fields }),
      });

      if (!response.ok) throw new Error('Save failed');

      const data = (await response.json()) as { template: TemplateRow };
      setFields(cloneTemplateFields(data.template.fields));
      setEditingTemplate(false);
      toast.success('Template saved');
    } catch {
      toast.error('Failed to save template');
    }
  };

  const handleResetTemplate = async () => {
    const nextFields = cloneTemplateFields(PLAYBOOK_DEFAULT_FIELDS);
    setFields(nextFields);

    try {
      const response = await fetch('/api/report-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'playbook', fields: nextFields }),
      });

      if (!response.ok) throw new Error('Reset failed');

      const data = (await response.json()) as { template: TemplateRow };
      setFields(cloneTemplateFields(data.template.fields));
      toast.success('Template reset');
    } catch {
      toast.error('Failed to reset template');
    }
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const copy = [...fields];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= copy.length) return;
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    setFields(copy);
  };

  const addField = () => {
    setFields((current) => [
      ...current,
      { id: nextFieldId(current), label: 'New Section', type: 'text', required: false },
    ]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <motion.div
      key="playbook"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="grid grid-cols-1 gap-4 px-1 lg:grid-cols-[280px_1fr]"
    >
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium capitalize text-foreground">Strategies</p>
          <Button
            onClick={handleCreate}
            disabled={saving}
            className="h-9 border border-primary/40 bg-primary/10 px-3 text-primary hover:bg-primary/20"
          >
            <Plus className="mr-1 h-4 w-4" />
            New Strategy
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {strategies.map((strategy) => (
            <button
              key={strategy.id}
              type="button"
              onClick={() => setSelectedId(strategy.id)}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                strategy.id === selectedId
                  ? 'border-border bg-accent'
                  : 'border-border bg-accent hover:bg-accent'
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{strategy.name}</p>
                <p className="truncate text-xs text-muted-foreground">{strategy.description || '--'}</p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </button>
          ))}

          {strategies.length === 0 && !loading ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              Create your first strategy with the button above.
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        {!selected ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            {loading ? 'Loading...' : 'Select a strategy on the left, or create a new one.'}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  value={selected.name}
                  onChange={(event) => updateSelected({ name: event.target.value })}
                  placeholder="Strategy Name"
                  className="h-9 flex-1 border-border bg-accent text-base font-medium"
                />
                <div className="flex w-44 shrink-0 items-center gap-2">
                  <Select
                    value={selected.tag}
                    onValueChange={(nextValue) => updateSelected({ tag: nextValue })}
                  >
                    <SelectTrigger className="h-9 flex-1 border-border bg-accent text-sm text-foreground">
                      <SelectValue placeholder={globalTags.length === 0 ? 'No tags available' : 'Select a Tag'} />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-card text-foreground">
                      {globalTags.map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          {tag}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selected.tag ? (
                    <button
                      type="button"
                      onClick={() => updateSelected({ tag: '' })}
                      aria-label="Clear tag"
                      title="Clear tag"
                      className="inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-accent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="h-9 border border-primary/40 bg-primary/10 px-3 text-primary hover:bg-primary/20"
                >
                  <Save className="mr-1 h-4 w-4" />
                  Save
                </Button>
                <button
                  type="button"
                  onClick={handleDelete}
                  aria-label="Delete strategy"
                  title="Delete strategy"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rose-500/40 text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {/* Description row: edit-template button sits to the right at
                  the same height (h-9) so it lines up with the inputs above. */}
              <div className="flex items-center gap-2">
                <Input
                  value={selected.description}
                  onChange={(event) => updateSelected({ description: event.target.value })}
                  placeholder="One-line description"
                  className="h-9 flex-1 border-border bg-accent text-sm text-foreground"
                />
                <Button
                  onClick={() => setEditingTemplate((flag) => !flag)}
                  className="h-9 border border-primary/40 bg-primary/10 px-3 text-primary hover:bg-primary/20"
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit Template
                </Button>
              </div>
            </div>

            {draftedIds.has(selected.id) ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                Unsaved draft saved in this browser - hit Save to store it.
              </p>
            ) : null}

            {editingTemplate ? (
              <div className="space-y-3 rounded-md border border-border bg-accent p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium capitalize text-foreground">Edit Template</p>
                  <p className="text-xs text-muted-foreground">
                    Sections apply to every strategy in your playbook.
                  </p>
                </div>
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-card p-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveField(index, -1)}
                        className="rounded p-0.5 hover:bg-accent"
                        aria-label="Move up"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(index, 1)}
                        className="rounded p-0.5 hover:bg-accent"
                        aria-label="Move down"
                      >
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
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      className="rounded p-0.5 text-rose-400 hover:bg-rose-500/20"
                      aria-label="Remove section"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={addField}
                    className="border border-border bg-accent text-muted-foreground hover:bg-accent"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Section
                  </Button>
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

            {fields.map((field) => (
              <div key={field.id} className="space-y-1">
                <p className="text-xs font-medium capitalize text-foreground">
                  {field.label}
                </p>
                <RichTextEditor
                  key={`${selected.id}-${field.id}`}
                  value={selected.sections[field.id] ?? ''}
                  onChange={(html) => updateSection(field.id, html)}
                />
              </div>
            ))}

            <div className="rounded-md border border-border bg-accent p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium capitalize text-foreground">Recent Trades</p>
                <p className="text-xs text-muted-foreground">
                  {selected.tag ? `tag: ${selected.tag}` : 'set a tag above to populate'}
                </p>
              </div>

              {selected.tag && stats.count > 0 ? (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>{stats.count} trades</span>
                  <span>
                    Win rate: <span className="font-mono text-foreground">{stats.winRate.toFixed(0)}%</span>
                  </span>
                  <span>
                    Avg R:{' '}
                    <span className="font-mono text-foreground">
                      {stats.avgR === null ? '--' : stats.avgR.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    Total P/L:{' '}
                    <span className={`font-mono ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(stats.totalPnl)}
                    </span>
                  </span>
                </div>
              ) : null}

              {selected.tag && lastTen.length > 0 ? (
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Symbol</th>
                      <th className="px-2 py-1.5">Dir</th>
                      <th className="px-2 py-1.5 text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    {lastTen.map((trade) => (
                      <tr key={trade.id} className="border-b border-border last:border-b-0">
                        <td className="px-2 py-1.5 font-mono">{trade.sortKey}</td>
                        <td className="px-2 py-1.5 font-medium">{trade.symbol}</td>
                        <td className="px-2 py-1.5">{trade.direction}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${(trade.netPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatCurrency(trade.netPnl ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : selected.tag && stats.count === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">No trades found with this tag yet.</p>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
