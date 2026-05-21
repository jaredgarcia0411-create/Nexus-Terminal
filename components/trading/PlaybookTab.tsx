'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EMPTY_PLAYBOOK_SECTIONS, PLAYBOOK_SECTION_ORDER } from '@/lib/playbook-defaults';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';
import type { PlaybookSections } from '@/lib/validations/playbook';

interface Strategy {
  id: string;
  name: string;
  description: string;
  tag: string;
  sections: PlaybookSections;
  createdAt: string;
  updatedAt: string;
}

interface PlaybookTabProps {
  trades: Trade[];
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

export default function PlaybookTab({ trades }: PlaybookTabProps) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/playbook');
        if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
        const data = (await response.json()) as { strategies: Strategy[] };

        if (!cancelled) {
          const nextStrategies = data.strategies ?? [];
          setStrategies(nextStrategies);
          if (nextStrategies.length > 0) {
            setSelectedId(nextStrategies[0].id);
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
          sections: EMPTY_PLAYBOOK_SECTIONS,
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
      toast.success('Deleted');
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete');
    }
  };

  const updateSelected = (patch: Partial<Strategy>) => {
    if (!selected) return;
    setStrategies((current) => current.map((strategy) => (
      strategy.id === selected.id ? { ...strategy, ...patch } : strategy
    )));
  };

  const updateSection = (key: keyof PlaybookSections, value: string) => {
    if (!selected) return;
    updateSelected({ sections: { ...selected.sections, [key]: value } });
  };

  return (
    <motion.div
      key="playbook"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="grid grid-cols-1 gap-4 px-1 lg:grid-cols-[280px_1fr]"
    >
      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-white">Strategies</p>
          <p className="text-xs text-zinc-500">
            {strategies.length} {strategies.length === 1 ? 'strategy' : 'strategies'}
          </p>
        </div>

        <Button
          onClick={handleCreate}
          disabled={saving}
          className="mt-3 w-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New Strategy
        </Button>

        <div className="mt-3 flex flex-col gap-2">
          {strategies.map((strategy) => (
            <button
              key={strategy.id}
              type="button"
              onClick={() => setSelectedId(strategy.id)}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                strategy.id === selectedId
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-white/5 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">{strategy.name}</p>
                <p className="truncate text-xs text-zinc-500">{strategy.description || '--'}</p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-500" />
            </button>
          ))}

          {strategies.length === 0 && !loading ? (
            <p className="px-1 py-4 text-center text-xs text-zinc-500">
              Create your first strategy with the button above.
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        {!selected ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            {loading ? 'Loading...' : 'Select a strategy on the left, or create a new one.'}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Input
                  value={selected.name}
                  onChange={(event) => updateSelected({ name: event.target.value })}
                  placeholder="Strategy name"
                  className="h-10 border-white/10 bg-white/5 text-base font-medium"
                />
                <Input
                  value={selected.description}
                  onChange={(event) => updateSelected({ description: event.target.value })}
                  placeholder="One-line description"
                  className="mt-2 h-9 border-white/10 bg-white/5 text-sm text-zinc-300"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="h-9 border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  Save
                </Button>
                <Button
                  onClick={handleDelete}
                  variant="ghost"
                  className="h-9 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">
                Trade Tag (matches your existing trade tags exactly)
              </p>
              <Input
                value={selected.tag}
                onChange={(event) => updateSelected({ tag: event.target.value })}
                placeholder="e.g. ParabolicShort"
                className="h-9 border-white/10 bg-white/5 text-sm"
              />
            </div>

            {PLAYBOOK_SECTION_ORDER.map((section) => (
              <div key={section.key}>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">
                  {section.label}
                </p>
                <Textarea
                  value={selected.sections[section.key]}
                  onChange={(event) => updateSection(section.key, event.target.value)}
                  placeholder={section.placeholder}
                  className="min-h-[80px] border-white/10 bg-white/5 text-sm"
                />
              </div>
            ))}

            <div className="rounded-lg border border-white/5 bg-white/5 p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-white">Recent Trades</p>
                <p className="text-xs text-zinc-500">
                  {selected.tag ? `tag: ${selected.tag}` : 'set a tag above to populate'}
                </p>
              </div>

              {selected.tag && stats.count > 0 ? (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
                  <span>{stats.count} trades</span>
                  <span>
                    Win rate: <span className="font-mono text-zinc-200">{stats.winRate.toFixed(0)}%</span>
                  </span>
                  <span>
                    Avg R:{' '}
                    <span className="font-mono text-zinc-200">
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
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr className="border-b border-white/5">
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Symbol</th>
                      <th className="px-2 py-1.5">Dir</th>
                      <th className="px-2 py-1.5 text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    {lastTen.map((trade) => (
                      <tr key={trade.id} className="border-b border-white/5 last:border-b-0">
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
                <p className="mt-3 text-xs text-zinc-500">No trades found with this tag yet.</p>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
