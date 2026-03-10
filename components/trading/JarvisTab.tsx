'use client';

import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, CalendarClock, Globe, Search, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import type { Trade } from '@/lib/types';
import { type JarvisMode, type JarvisResponse, toJarvisTradeInput } from '@/lib/jarvis-types';
import { sourcePacks } from '@/lib/jarvis-source-packs';
import JarvisStructuredResponse from '@/components/trading/JarvisStructuredResponse';
import JarvisDocuments from '@/components/trading/JarvisDocuments';

function getPackIcon(icon: 'Newspaper' | 'CalendarClock' | 'Globe' | 'Search') {
  if (icon === 'CalendarClock') return CalendarClock;
  if (icon === 'Search') return Search;
  return Globe;
}

interface JarvisTabProps {
  trades: Trade[];
}

export default function JarvisTab({ trades }: JarvisTabProps) {
  const [panelView, setPanelView] = useState<'assistant' | 'documents'>('assistant');
  const [mode, setMode] = useState<JarvisMode>('assistant');
  const [prompt, setPrompt] = useState('');
  const [selectedPackId, setSelectedPackId] = useState('');
  const [dilutionTicker, setDilutionTicker] = useState('');
  const [response, setResponse] = useState<JarvisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const dilutionTickerInputRef = useRef<HTMLInputElement>(null);

  const todayLabel = useMemo(() => format(new Date(), 'EEEE, MMM d'), []);
  const selectedPack = useMemo(() => sourcePacks.find((pack) => pack.id === selectedPackId) ?? null, [selectedPackId]);

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
          sourcePackId: selectedPackId || undefined,
          trades: trades.map(toJarvisTradeInput),
          ticker: nextMode === 'dilution-research' ? dilutionTicker.trim().toUpperCase() : undefined,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as JarvisResponse & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? 'Jarvis is unavailable right now');
      }

      setResponse({
        message: payload.message,
        sourceSummary: payload.sourceSummary,
        sources: payload.sources,
        warnings: payload.warnings,
        structured: payload.structured,
        macroSummary: payload.macroSummary,
        dilutionReport: payload.dilutionReport,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Jarvis is unavailable right now';
      setResponse({ message });
    } finally {
      setLoading(false);
    }
  };

  const selectPack = (nextPackId: string) => {
    setSelectedPackId(nextPackId);
    const pack = sourcePacks.find((entry) => entry.id === nextPackId);
    if (pack) {
      setPrompt(pack.promptTemplate);
    }
  };

  const cards: Array<{ mode: JarvisMode; label: string; description: string; icon: typeof Bot }> = [
    {
      mode: 'assistant',
      label: 'Ask Jarvis',
      description: 'Ask for help, workflows, and market context with optional website scraping.',
      icon: Sparkles,
    },
    {
      mode: 'macro-summary',
      label: 'Macro Summary',
      description: 'Get a macro market overview across US, EU, Asia, and global markets.',
      icon: Globe,
    },
    {
      mode: 'dilution-research',
      label: 'Dilution Research',
      description: 'SEC dilution risk report via AskEdgar.',
      icon: Search,
    },
  ];

  const handleCardClick = (nextMode: JarvisMode) => {
    setMode(nextMode);

    if (nextMode === 'macro-summary') {
      selectPack('macro-daily');
    } else if (nextMode === 'dilution-research') {
      selectPack('dilution-research');
      dilutionTickerInputRef.current?.focus();
    } else {
      setSelectedPackId('');
      setPrompt('');
    }
  };

  return (
    <motion.div key="jarvis" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPanelView('assistant')}
          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${panelView === 'assistant' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200' : 'border-white/10 text-zinc-300 hover:bg-white/10'}`}
        >
          Assistant
        </button>
        <button
          type="button"
          onClick={() => setPanelView('documents')}
          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${panelView === 'documents' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200' : 'border-white/10 text-zinc-300 hover:bg-white/10'}`}
        >
          Documents
        </button>
      </div>

      {panelView === 'documents' ? <JarvisDocuments /> : null}

      {panelView === 'assistant' ? (
        <>
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
              onClick={() => handleCardClick(card.mode)}
              className={`rounded-xl border p-4 text-left transition-colors ${isActive ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-[#121214] hover:border-white/20'}`}
            >
              <Icon className="mb-3 h-5 w-5 text-emerald-400" />
              <p className="text-sm font-semibold text-white">{card.label}</p>
              <p className="mt-1 text-xs text-zinc-400">{card.description}</p>
            </button>
          );
        })}
      </div>

      {mode === 'dilution-research' || dilutionTicker.trim().length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
          <label htmlFor="dilution-ticker" className="mb-2 block text-xs uppercase tracking-wider text-zinc-500">Ticker</label>
          <input
            id="dilution-ticker"
            ref={dilutionTickerInputRef}
            value={dilutionTicker}
            onChange={(event) => setDilutionTicker(event.target.value.toUpperCase())}
            placeholder="e.g. MULN"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
          />
        </div>
      ) : null}

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
            <label className="mb-2 block text-xs uppercase tracking-wider text-zinc-500">Source Presets</label>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex flex-wrap gap-2">
                {sourcePacks.map((pack) => {
                  const Icon = getPackIcon(pack.icon);
                  const isActive = selectedPackId === pack.id;
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => selectPack(pack.id)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${isActive ? 'border-emerald-500/50 bg-emerald-500/20' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                    >
                      <div className="flex items-center gap-2 text-xs text-zinc-300">
                        <Icon className="h-4 w-4 text-emerald-300" />
                        {pack.name}
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-400">{pack.description}</p>
                    </button>
                  );
                })}
              </div>
              {selectedPack ? (
                <p className="mt-3 text-xs text-zinc-400">Prompt template loaded from pack: <span className="text-zinc-200">{selectedPack.promptTemplate}</span></p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => runJarvis(mode)}
            disabled={loading}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Thinking...' : 'Run Jarvis'}
          </button>
          <button
            onClick={() => {
              setPrompt('');
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
          <JarvisStructuredResponse
            message={response.message}
            structured={response.structured}
            warnings={response.warnings}
            sourceSummary={response.sourceSummary}
            sources={response.sources}
            macroSummary={response.macroSummary}
            dilutionReport={response.dilutionReport}
          />
        ) : (
          <p className="text-sm text-zinc-500">Run one of the actions above to get started.</p>
        )}
      </div>
        </>
      ) : null}
    </motion.div>
  );
}
