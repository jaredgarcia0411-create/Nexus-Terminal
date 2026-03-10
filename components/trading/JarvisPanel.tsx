'use client';

import { useEffect, useState } from 'react';
import JarvisChat from '@/components/trading/JarvisChat';
import JarvisMacroSummary from '@/components/trading/JarvisMacroSummary';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { JarvisMacroSummaryOutput } from '@/lib/jarvis/types';
import type { Trade } from '@/lib/types';

interface JarvisPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trades: Trade[];
}

interface ResearchRow {
  id: string;
  ticker: string;
  generatedAt: string;
  reportJson: unknown;
}

export default function JarvisPanel({ open, onOpenChange, trades }: JarvisPanelProps) {
  const [tab, setTab] = useState<'chat' | 'research' | 'macro'>('chat');
  const [ticker, setTicker] = useState('');
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [researchRows, setResearchRows] = useState<ResearchRow[]>([]);
  const [macroSummary, setMacroSummary] = useState<JarvisMacroSummaryOutput | null>(null);

  const loadData = async () => {
    const [researchRes, macroRes] = await Promise.all([
      fetch('/api/jarvis/research').catch(() => null),
      fetch('/api/jarvis/cron/macro-summary').catch(() => null),
    ]);

    if (researchRes?.ok) {
      const payload = (await researchRes.json()) as { rows?: ResearchRow[] };
      setResearchRows(payload.rows ?? []);
    }

    if (macroRes?.ok) {
      const payload = (await macroRes.json()) as { latest?: JarvisMacroSummaryOutput | null };
      setMacroSummary(payload.latest ?? null);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadData();
  }, [open]);

  const runResearch = async () => {
    const nextTicker = ticker.trim().toUpperCase();
    if (!nextTicker) return;

    setLoadingResearch(true);
    try {
      const response = await fetch('/api/jarvis/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: nextTicker }),
      });
      if (!response.ok) throw new Error('Research request failed');
      await loadData();
      setTicker('');
      setTab('research');
    } finally {
      setLoadingResearch(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-2xl border-white/10 bg-[#0A0A0B] p-0 text-zinc-100 sm:max-w-2xl">
        <SheetHeader className="border-b border-white/10">
          <SheetTitle>Jarvis</SheetTitle>
          <SheetDescription>Trading context assistant with chat, research, and macro summaries.</SheetDescription>
          <p className="text-xs text-zinc-500">{trades.length} trades loaded in workspace</p>
        </SheetHeader>

        <div className="flex h-[calc(100vh-130px)] flex-col p-4">
          <div className="mb-3 flex gap-2">
            {(['chat', 'research', 'macro'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-lg border px-3 py-1.5 text-xs capitalize ${tab === key ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-zinc-300'}`}
              >
                {key}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {tab === 'chat' ? <JarvisChat /> : null}

            {tab === 'research' ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={ticker}
                    onChange={(event) => setTicker(event.target.value.toUpperCase())}
                    placeholder="Ticker (e.g. AAPL)"
                    className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-emerald-500/40"
                  />
                  <button
                    type="button"
                    disabled={loadingResearch}
                    onClick={() => void runResearch()}
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
                  >
                    {loadingResearch ? 'Running...' : 'New Report'}
                  </button>
                </div>

                <div className="max-h-[55vh] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3">
                  {researchRows.length === 0 ? <p className="text-sm text-zinc-500">No saved research reports yet.</p> : null}
                  {researchRows.map((row) => (
                    <details key={row.id} className="rounded-lg border border-white/10 bg-[#121214] p-3">
                      <summary className="cursor-pointer text-sm">{row.ticker} - {new Date(row.generatedAt).toLocaleString()}</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-zinc-300">{JSON.stringify(row.reportJson, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              </div>
            ) : null}

            {tab === 'macro' ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                {macroSummary ? <JarvisMacroSummary macroSummary={macroSummary} /> : <p className="text-sm text-zinc-500">No macro summary available yet.</p>}
              </div>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
