'use client';

import { useCallback, useEffect, useState } from 'react';

interface ResearchRow {
  id: string;
  ticker: string;
  generatedAt: string;
  reportJson: unknown;
}

interface DailySummaryRow {
  id: string;
  ticker: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  preMarket: number | null;
  afterHours: number | null;
  fetchedAt: string;
}

interface SavedTickerRow {
  id: string;
  ticker: string;
  category: string;
  notes: string | null;
  createdAt: string;
}

type ResearchView = 'ai-reports' | 'daily-summaries' | 'saved-tickers';

function formatNumber(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ResearchTab() {
  const [activeView, setActiveView] = useState<ResearchView>('ai-reports');
  const [ticker, setTicker] = useState('');
  const [dailyTicker, setDailyTicker] = useState('');
  const [savedTicker, setSavedTicker] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingSavedTicker, setLoadingSavedTicker] = useState(false);
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadingDailyRows, setLoadingDailyRows] = useState(true);
  const [loadingSavedRows, setLoadingSavedRows] = useState(true);
  const [researchRows, setResearchRows] = useState<ResearchRow[]>([]);
  const [dailyRows, setDailyRows] = useState<DailySummaryRow[]>([]);
  const [savedRows, setSavedRows] = useState<SavedTickerRow[]>([]);

  const loadResearchData = useCallback(async () => {
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

  const loadDailyRows = useCallback(async () => {
    setLoadingDailyRows(true);
    try {
      const response = await fetch('/api/market-data/daily-summary');
      if (!response.ok) throw new Error('Failed to fetch daily summaries');
      const payload = (await response.json()) as { rows?: DailySummaryRow[] };
      setDailyRows(payload.rows ?? []);
    } catch {
      setDailyRows([]);
    } finally {
      setLoadingDailyRows(false);
    }
  }, []);

  const loadSavedRows = useCallback(async () => {
    setLoadingSavedRows(true);
    try {
      const response = await fetch('/api/saved-tickers');
      if (!response.ok) throw new Error('Failed to fetch saved tickers');
      const payload = (await response.json()) as { rows?: SavedTickerRow[] };
      setSavedRows(payload.rows ?? []);
    } catch {
      setSavedRows([]);
    } finally {
      setLoadingSavedRows(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadResearchData(), loadDailyRows(), loadSavedRows()]);
  }, [loadResearchData, loadDailyRows, loadSavedRows]);

  const runResearch = async (force = false) => {
    const nextTicker = ticker.trim().toUpperCase();
    if (!nextTicker || loadingResearch) return;

    setLoadingResearch(true);
    try {
      const response = await fetch('/api/jarvis/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: nextTicker, force }),
      });
      if (!response.ok) throw new Error('Research request failed');
      await loadResearchData();
      setTicker('');
    } finally {
      setLoadingResearch(false);
    }
  };

  const saveDailySummary = async () => {
    const nextTicker = dailyTicker.trim().toUpperCase();
    if (!nextTicker || loadingDaily) return;

    setLoadingDaily(true);
    try {
      const response = await fetch('/api/market-data/daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: nextTicker, date: todayDate() }),
      });
      if (!response.ok) throw new Error('Daily summary request failed');
      await loadDailyRows();
      setDailyTicker('');
    } finally {
      setLoadingDaily(false);
    }
  };

  const addSavedTicker = async () => {
    const nextTicker = savedTicker.trim().toUpperCase();
    if (!nextTicker || loadingSavedTicker) return;

    setLoadingSavedTicker(true);
    try {
      const response = await fetch('/api/saved-tickers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: nextTicker, category: 'watchlist', notes: savedNotes }),
      });
      if (!response.ok) throw new Error('Failed to save ticker');
      await loadSavedRows();
      setSavedTicker('');
      setSavedNotes('');
    } finally {
      setLoadingSavedTicker(false);
    }
  };

  const removeSavedTicker = async (id: string) => {
    await fetch(`/api/saved-tickers?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadSavedRows();
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Research</h1>
          <p className="text-sm text-zinc-400">AI reports, daily ticker summaries, and saved ticker watchlist.</p>
        </div>
        <p className="rounded-lg border border-white/10 bg-[#111113] px-2.5 py-1 text-xs text-zinc-400">
          {loadingRows
            ? 'Loading reports...'
            : `${researchRows.length} saved report${researchRows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-[#111113] p-2">
        <button
          type="button"
          onClick={() => setActiveView('ai-reports')}
          className={`rounded-md px-3 py-1.5 text-xs ${activeView === 'ai-reports' ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-300 hover:bg-white/5'}`}
        >
          AI Reports
        </button>
        <button
          type="button"
          onClick={() => setActiveView('daily-summaries')}
          className={`rounded-md px-3 py-1.5 text-xs ${activeView === 'daily-summaries' ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-300 hover:bg-white/5'}`}
        >
          Daily Summaries
        </button>
        <button
          type="button"
          onClick={() => setActiveView('saved-tickers')}
          className={`rounded-md px-3 py-1.5 text-xs ${activeView === 'saved-tickers' ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-300 hover:bg-white/5'}`}
        >
          Saved Tickers
        </button>
      </div>

      {activeView === 'ai-reports' ? (
        <>
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
                onClick={() => void runResearch(false)}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {loadingResearch ? 'Running...' : 'New Report'}
              </button>
              <button
                type="button"
                disabled={loadingResearch}
                onClick={() => void runResearch(true)}
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-60"
              >
                {loadingResearch ? 'Running...' : 'Refresh (Ignore Cache)'}
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
        </>
      ) : null}

      {activeView === 'daily-summaries' ? (
        <>
          <div className="rounded-xl border border-white/10 bg-[#111113] p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={dailyTicker}
                onChange={(event) => setDailyTicker(event.target.value.toUpperCase())}
                placeholder="Ticker (e.g. AAPL)"
                className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-emerald-500/40"
              />
              <button
                type="button"
                disabled={loadingDaily}
                onClick={() => void saveDailySummary()}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {loadingDaily ? 'Saving...' : 'Get Daily Summary'}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Defaults to today ({todayDate()}) and stores one record per ticker/date.</p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-4">
            {loadingDailyRows ? <p className="text-sm text-zinc-500">Loading daily summaries...</p> : null}
            {!loadingDailyRows && dailyRows.length === 0 ? <p className="text-sm text-zinc-500">No daily summaries saved yet.</p> : null}
            {!loadingDailyRows && dailyRows.length > 0 ? (
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-zinc-400">
                    <th className="px-2 py-2">Ticker</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Open</th>
                    <th className="px-2 py-2">High</th>
                    <th className="px-2 py-2">Low</th>
                    <th className="px-2 py-2">Close</th>
                    <th className="px-2 py-2">Volume</th>
                    <th className="px-2 py-2">Pre</th>
                    <th className="px-2 py-2">After</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 text-zinc-200">
                      <td className="px-2 py-2 font-medium">{row.ticker}</td>
                      <td className="px-2 py-2">{row.date}</td>
                      <td className="px-2 py-2">{formatNumber(row.open)}</td>
                      <td className="px-2 py-2">{formatNumber(row.high)}</td>
                      <td className="px-2 py-2">{formatNumber(row.low)}</td>
                      <td className="px-2 py-2">{formatNumber(row.close)}</td>
                      <td className="px-2 py-2">{formatNumber(row.volume, 0)}</td>
                      <td className="px-2 py-2">{formatNumber(row.preMarket)}</td>
                      <td className="px-2 py-2">{formatNumber(row.afterHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </>
      ) : null}

      {activeView === 'saved-tickers' ? (
        <>
          <div className="rounded-xl border border-white/10 bg-[#111113] p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input
                value={savedTicker}
                onChange={(event) => setSavedTicker(event.target.value.toUpperCase())}
                placeholder="Ticker"
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-emerald-500/40"
              />
              <input
                value={savedNotes}
                onChange={(event) => setSavedNotes(event.target.value)}
                placeholder="Optional note"
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-emerald-500/40"
              />
              <button
                type="button"
                disabled={loadingSavedTicker}
                onClick={() => void addSavedTicker()}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {loadingSavedTicker ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-4">
            {loadingSavedRows ? <p className="text-sm text-zinc-500">Loading saved tickers...</p> : null}
            {!loadingSavedRows && savedRows.length === 0 ? <p className="text-sm text-zinc-500">No saved tickers yet.</p> : null}

            {savedRows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#121214] px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{row.ticker}</p>
                  <p className="text-xs text-zinc-500">{row.notes?.trim() || 'No notes'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeSavedTicker(row.id)}
                  className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
