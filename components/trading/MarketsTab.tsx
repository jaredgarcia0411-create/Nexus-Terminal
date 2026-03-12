'use client';

import { useCallback, useEffect, useState } from 'react';
import JarvisMacroSummary from '@/components/trading/JarvisMacroSummary';
import type { JarvisMacroSummaryOutput } from '@/lib/jarvis/types';

export default function MarketsTab() {
  const [macroSummary, setMacroSummary] = useState<JarvisMacroSummaryOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const loadMacroSummary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/jarvis/macro-summary/latest');
      if (!response.ok) throw new Error('Failed to load macro summary');
      const payload = (await response.json()) as { latest?: JarvisMacroSummaryOutput | null };
      setMacroSummary(payload.latest ?? null);
      setLastLoadedAt(new Date());
    } catch {
      setMacroSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMacroSummary();
  }, [loadMacroSummary]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Markets</h1>
        <button
          type="button"
          onClick={() => void loadMacroSummary()}
          disabled={loading}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#111113] px-4 py-3">
        <p className="text-sm text-zinc-400">Latest macro market summary from Jarvis.</p>
        {lastLoadedAt ? <p className="mt-1 text-xs text-zinc-500">Updated {lastLoadedAt.toLocaleTimeString()}</p> : null}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-5">
        {loading ? <p className="text-sm text-zinc-500">Loading markets summary...</p> : null}
        {!loading && macroSummary ? <JarvisMacroSummary macroSummary={macroSummary} /> : null}
        {!loading && !macroSummary ? <p className="text-sm text-zinc-500">No macro summary available yet.</p> : null}
      </div>
    </section>
  );
}
