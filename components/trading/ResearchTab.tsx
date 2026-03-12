'use client';

import { useCallback, useEffect, useState } from 'react';

interface ResearchRow {
  id: string;
  ticker: string;
  generatedAt: string;
  reportJson: unknown;
}

export default function ResearchTab() {
  const [ticker, setTicker] = useState('');
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [loadingRows, setLoadingRows] = useState(true);
  const [researchRows, setResearchRows] = useState<ResearchRow[]>([]);

  const loadData = useCallback(async () => {
    setLoadingRows(true);
    try {
      const response = await fetch('/api/jarvis/research');
      if (!response.ok) throw new Error('Failed to fetch research reports');
      const payload = (await response.json()) as { rows?: ResearchRow[] };
      setResearchRows(payload.rows ?? []);
    } catch {
      setResearchRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runResearch = async () => {
    const nextTicker = ticker.trim().toUpperCase();
    if (!nextTicker || loadingResearch) return;

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
    } finally {
      setLoadingResearch(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <h1 className="text-2xl font-semibold text-white">Research</h1>
        <p className="text-sm text-zinc-400">Generate and review Jarvis research reports.</p>
        </div>
        <p className="rounded-lg border border-white/10 bg-[#111113] px-2.5 py-1 text-xs text-zinc-400">
          {loadingRows ? 'Loading reports...' : `${researchRows.length} saved report${researchRows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#111113] p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
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
        <p className="mt-2 text-xs text-zinc-500">Run a new report by entering a single ticker symbol.</p>
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-5">
        {loadingRows ? <p className="text-sm text-zinc-500">Loading research reports...</p> : null}
        {!loadingRows && researchRows.length === 0 ? <p className="text-sm text-zinc-500">No saved research reports yet.</p> : null}

        {researchRows.map((row) => (
          <details key={row.id} className="rounded-lg border border-white/10 bg-[#121214] p-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-200">{row.ticker} - {new Date(row.generatedAt).toLocaleString()}</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-300">{JSON.stringify(row.reportJson, null, 2)}</pre>
          </details>
        ))}
      </div>
    </section>
  );
}
