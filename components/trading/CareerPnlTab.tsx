'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/trading-utils';

interface CareerPnlEntry {
  id: number;
  month: string; // YYYY-MM-DD, always day=01
  amount: number;
  notes: string | null;
}

interface CareerPnlResponse {
  entries: CareerPnlEntry[];
}

// Sorting helper: ASC by month for the chart (earliest left), DESC for the
// table (newest first).
function sortAsc(entries: CareerPnlEntry[]) {
  return [...entries].sort((a, b) => a.month.localeCompare(b.month));
}

function sortDesc(entries: CareerPnlEntry[]) {
  return [...entries].sort((a, b) => b.month.localeCompare(a.month));
}

function todayMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export default function CareerPnlTab() {
  const [entries, setEntries] = useState<CareerPnlEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftMonth, setDraftMonth] = useState<string>(todayMonthStart());
  const [draftAmount, setDraftAmount] = useState<string>('');
  const [draftNotes, setDraftNotes] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/career-pnl');
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const data = (await res.json()) as CareerPnlResponse;
        if (!cancelled) setEntries(data.entries ?? []);
      } catch (error) {
        console.error(error);
        if (!cancelled) toast.error('Failed to load career P/L');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cumulative chart data: running sum of amounts in chronological order.
  // Using AreaChart matches PerformanceCharts equity-curve style.
  const chartData = useMemo(() => {
    let cumulative = 0;
    return sortAsc(entries).map((entry) => {
      cumulative += entry.amount;
      return {
        month: entry.month,
        label: format(parseISO(entry.month), 'MMM yyyy'),
        amount: entry.amount,
        cumulative,
      };
    });
  }, [entries]);

  const totalCumulative = chartData.length > 0 ? chartData[chartData.length - 1].cumulative : 0;

  const handleAdd = async () => {
    const amountNum = Number(draftAmount);
    if (!Number.isFinite(amountNum)) {
      toast.error('Amount must be a number');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftMonth)) {
      toast.error('Month is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/career-pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: draftMonth,
          amount: amountNum,
          notes: draftNotes.trim() ? draftNotes.trim() : undefined,
        }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      const data = (await res.json()) as { entry: CareerPnlEntry };

      // Upsert into local state — replace by id if existing, else add.
      setEntries((current) => {
        const filtered = current.filter((e) => e.id !== data.entry.id && e.month !== data.entry.month);
        return [...filtered, data.entry];
      });

      // Reset form to next blank entry but keep the month picker on the
      // current month so adding consecutive months is fast.
      setDraftAmount('');
      setDraftNotes('');
      toast.success('Saved');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this month?')) return;
    try {
      const res = await fetch(`/api/career-pnl?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      setEntries((current) => current.filter((e) => e.id !== id));
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete');
    }
  };

  return (
    <motion.div
      key="career-pnl"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-4 px-1"
    >
      {/* Header tile: total cumulative */}
      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">Career P/L</p>
            <p className={`mt-1 text-3xl font-semibold ${totalCumulative > 0 ? 'text-emerald-400' : totalCumulative < 0 ? 'text-rose-400' : 'text-zinc-200'}`}>
              {formatCurrency(totalCumulative)}
            </p>
          </div>
          <p className="text-xs text-zinc-500">{entries.length} {entries.length === 1 ? 'month logged' : 'months logged'}</p>
        </div>

        {/* Equity curve. height fixed so it doesn't get squashed inside the parent grid. */}
        <div className="mt-4 h-64 w-full">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              {loading ? 'Loading…' : 'Add your first month below to see the curve.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="careerPnlFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  tickFormatter={(value: number) => formatCurrency(value)}
                  width={80}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#121214', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                  formatter={(value) => formatCurrency(Number(value))}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#careerPnlFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Add row */}
      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <p className="text-sm font-medium text-white">Add Month</p>
        <div className="mt-3 grid grid-cols-[160px_minmax(120px,180px)_1fr_auto] gap-3">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">Month</p>
            <input
              type="month"
              value={draftMonth.slice(0, 7)}
              onChange={(event) => setDraftMonth(`${event.target.value}-01`)}
              className="h-9 w-full rounded-md border border-white/10 bg-white/5 px-2 text-sm text-zinc-100 [color-scheme:dark]"
            />
          </div>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">Amount</p>
            <Input
              type="number"
              step="0.01"
              value={draftAmount}
              onChange={(event) => setDraftAmount(event.target.value)}
              placeholder="e.g. 1500 or -250.50"
              className="h-9 border-white/10 bg-white/5 text-sm"
            />
          </div>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">Notes (optional)</p>
            <Input
              value={draftNotes}
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder="What's included this month?"
              className="h-9 border-white/10 bg-white/5 text-sm"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleAdd}
              disabled={saving}
              className="h-9 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
            >
              <Plus className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Table of months */}
      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <p className="text-sm font-medium text-white">All Months</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-zinc-500">
              <tr className="border-b border-white/5">
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 text-right" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="text-zinc-200">
              {sortDesc(entries).map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 last:border-b-0">
                  <td className="px-3 py-2 font-medium">{format(parseISO(entry.month), 'MMMM yyyy')}</td>
                  <td className={`px-3 py-2 text-right font-mono ${entry.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCurrency(entry.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        entry.amount >= 0
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {entry.amount >= 0 ? 'Green' : 'Red'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{entry.notes ?? ''}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      className="rounded p-1 text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                      aria-label="Delete month"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                    No months logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
