'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import AskEdgarRawReport from '@/components/trading/AskEdgarRawReport';
import JarvisDilutionReport from '@/components/trading/JarvisDilutionReport';
import { Button } from '@/components/ui/button';
import type { DilutionResearchReport } from '@/lib/jarvis/types';

interface ResearchRow {
  id: string;
  ticker: string;
  generatedAt: string;
  reportJson: unknown;
  rawData: Record<string, unknown> | null;
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

type ResearchView = 'ai-reports' | 'daily-summaries';

function formatNumber(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export default function ResearchTab() {
  const [activeView, setActiveView] = useState<ResearchView>('ai-reports');
  const [ticker, setTicker] = useState('');
  const [dailyTicker, setDailyTicker] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadingDailyRows, setLoadingDailyRows] = useState(true);
  const [researchRows, setResearchRows] = useState<ResearchRow[]>([]);
  const [dailyRows, setDailyRows] = useState<DailySummaryRow[]>([]);

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
      const params = new URLSearchParams();
      const normalizedTicker = dailyTicker.trim().toUpperCase();
      if (normalizedTicker) {
        params.set('ticker', normalizedTicker);
      }
      if (startDate) {
        params.set('startDate', startDate);
      }
      if (endDate) {
        params.set('endDate', endDate);
      }

      const query = params.toString();
      const response = await fetch(query ? `/api/market-data/daily-summary?${query}` : '/api/market-data/daily-summary');
      if (!response.ok) throw new Error('Failed to fetch daily summaries');
      const payload = (await response.json()) as { rows?: DailySummaryRow[] };
      setDailyRows(payload.rows ?? []);
    } catch {
      setDailyRows([]);
    } finally {
      setLoadingDailyRows(false);
    }
  }, [dailyTicker, endDate, startDate]);

  useEffect(() => {
    void Promise.all([loadResearchData(), loadDailyRows()]);
  }, [loadResearchData, loadDailyRows]);

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
      const body: { ticker: string; date?: string; startDate?: string; endDate?: string } = { ticker: nextTicker };
      if (startDate && endDate) {
        body.startDate = startDate;
        body.endDate = endDate;
      } else {
        body.date = todayDate();
      }

      const response = await fetch('/api/market-data/daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Daily summary request failed');
      await loadDailyRows();
      setDailyTicker('');
    } finally {
      setLoadingDaily(false);
    }
  };

  return (
    <motion.section key="research" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-zinc-400">AI reports and daily ticker summaries.</p>
        <p className="rounded-lg border border-white/10 bg-[#121214] px-2.5 py-1 text-xs text-zinc-400">
          {loadingRows
            ? 'Loading reports...'
            : `${researchRows.length} saved report${researchRows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-[#121214] p-2">
        <button
          type="button"
          onClick={() => setActiveView('ai-reports')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${activeView === 'ai-reports' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
        >
          AI Reports
        </button>
        <button
          type="button"
          onClick={() => setActiveView('daily-summaries')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${activeView === 'daily-summaries' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
        >
          Daily Summaries
        </button>
      </div>

      {activeView === 'ai-reports' ? (
        <>
          <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={ticker}
                onChange={(event) => setTicker(event.target.value.toUpperCase())}
                placeholder="Ticker (e.g. AAPL)"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
              />
              <Button
                type="button"
                disabled={loadingResearch}
                onClick={() => void runResearch()}
                className="bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400"
              >
                {loadingResearch ? 'Running...' : 'New Report'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Run a new report by entering a single ticker symbol.</p>
          </div>

          <div className="space-y-3 rounded-xl border border-white/10 bg-[#121214] p-5">
            {loadingRows ? <p className="text-sm text-zinc-500">Loading research reports...</p> : null}
            {!loadingRows && researchRows.length === 0 ? <p className="text-sm text-zinc-500">No saved research reports yet.</p> : null}

            {researchRows.map((row) => (
              <details key={row.id} className="rounded-lg border border-white/10 bg-[#121214] p-4">
                <summary className="cursor-pointer text-sm font-medium text-zinc-200">{row.ticker} - {new Date(row.generatedAt).toLocaleString()}</summary>
                <div className="mt-3">
                  {isObject(row.rawData) ? (
                    <AskEdgarRawReport
                      ticker={row.ticker}
                      rawData={row.rawData as Record<string, { status: string; results: unknown[]; error?: string }>}
                      generatedAt={row.generatedAt}
                    />
                  ) : row.reportJson ? (
                    <JarvisDilutionReport report={row.reportJson as DilutionResearchReport} />
                  ) : (
                    <p className="text-sm text-zinc-500">No data available</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </>
      ) : null}

      {activeView === 'daily-summaries' ? (
        <>
          <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <input
                value={dailyTicker}
                onChange={(event) => setDailyTicker(event.target.value.toUpperCase())}
                placeholder="Ticker (e.g. AAPL)"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
              />
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200"
              />
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200"
              />
              <Button
                type="button"
                disabled={loadingDaily}
                onClick={() => void saveDailySummary()}
                className="bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400"
              >
                {loadingDaily ? 'Saving...' : 'Get Daily Summary'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Set start and end dates to fetch a range (max 30 days). If not set, defaults to today ({todayDate()}).</p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#121214] p-4">
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
    </motion.section>
  );
}
