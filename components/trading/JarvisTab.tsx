'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, Globe, LineChart, Newspaper, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import type { Trade } from '@/lib/types';

type JarvisMode = 'daily-summary' | 'trade-analysis' | 'assistant';

type JarvisResponse = {
  message: string;
  sourceSummary?: string;
};

interface JarvisTabProps {
  trades: Trade[];
}

export default function JarvisTab({ trades }: JarvisTabProps) {
  const [mode, setMode] = useState<JarvisMode>('assistant');
  const [prompt, setPrompt] = useState('');
  const [url, setUrl] = useState('');
  const [response, setResponse] = useState<JarvisResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const todayLabel = useMemo(() => format(new Date(), 'EEEE, MMM d'), []);

  const runJarvis = async (nextMode: JarvisMode) => {
    setMode(nextMode);
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: nextMode,
          prompt: prompt.trim(),
          url: url.trim(),
          trades,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as JarvisResponse & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? 'Jarvis is unavailable right now');
      }

      setResponse({ message: payload.message, sourceSummary: payload.sourceSummary });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Jarvis is unavailable right now';
      setResponse({ message });
    } finally {
      setLoading(false);
    }
  };

  const cards: Array<{ mode: JarvisMode; label: string; description: string; icon: typeof Bot }> = [
    {
      mode: 'daily-summary',
      label: 'Daily Summary',
      description: 'Get a concise snapshot of your trading activity and performance today.',
      icon: Newspaper,
    },
    {
      mode: 'trade-analysis',
      label: 'Analyze Trades',
      description: 'Review your recent trades, spot strengths, and identify risk patterns.',
      icon: LineChart,
    },
    {
      mode: 'assistant',
      label: 'Ask Jarvis',
      description: 'Ask for help, workflows, and market context with optional website scraping.',
      icon: Sparkles,
    },
  ];

  return (
    <motion.div key="jarvis" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-400">Jarvis Online</p>
            <h2 className="mt-1 text-2xl font-semibold">Your Personal Trading Assistant</h2>
            <p className="mt-1 text-sm text-zinc-400">{todayLabel} - summaries, analysis, and on-demand research.</p>
          </div>
          <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300">
            {trades.length} trade(s) in memory
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const isActive = mode === card.mode;
          return (
            <button
              key={card.mode}
              onClick={() => runJarvis(card.mode)}
              className={`rounded-xl border p-4 text-left transition-colors ${isActive ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-[#121214] hover:border-white/20'}`}
            >
              <Icon className="mb-3 h-5 w-5 text-emerald-400" />
              <p className="text-sm font-semibold text-white">{card.label}</p>
              <p className="mt-1 text-xs text-zinc-400">{card.description}</p>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-wider text-zinc-500">Ask Jarvis</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              placeholder="Example: Review my last 20 trades and suggest one concrete improvement for tomorrow."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs uppercase tracking-wider text-zinc-500">Optional Website URL</label>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
                <Globe className="h-3.5 w-3.5" />
                Jarvis can scrape one page for context
              </div>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/news"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => runJarvis('assistant')}
            disabled={loading}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Thinking...' : 'Run Jarvis'}
          </button>
          <button
            onClick={() => {
              setPrompt('');
              setUrl('');
              setResponse(null);
            }}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/10"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
        <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Jarvis Response</p>
        {response ? (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">{response.message}</p>
            {response.sourceSummary ? (
              <p className="text-xs text-zinc-400">Source: {response.sourceSummary}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Run one of the actions above to get started.</p>
        )}
      </div>
    </motion.div>
  );
}
