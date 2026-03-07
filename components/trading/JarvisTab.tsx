'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, CalendarClock, Globe, LineChart, Newspaper, Plus, Sparkles, X } from 'lucide-react';
import { format } from 'date-fns';
import type { Trade } from '@/lib/types';
import { isUrlAllowed } from '@/lib/jarvis-allowlist';
import { type JarvisMode, type JarvisResponse, toJarvisTradeInput } from '@/lib/jarvis-types';
import { sourcePacks } from '@/lib/jarvis-source-packs';
import JarvisStructuredResponse from '@/components/trading/JarvisStructuredResponse';
import JarvisDocuments from '@/components/trading/JarvisDocuments';

const MAX_SCRAPE_URLS = 5;

type JarvisInputMode = 'manual' | 'pack';

type UrlEntry = {
  lineNumber: number;
  value: string;
  isValid: boolean;
  isAllowed: boolean;
};

function getPackIcon(icon: 'Newspaper' | 'CalendarClock' | 'Globe') {
  if (icon === 'CalendarClock') return CalendarClock;
  if (icon === 'Newspaper') return Newspaper;
  return Globe;
}

function toUrlEntries(lines: string[]) {
  return lines
    .map((line, index) => {
      const value = line.trim();
      if (!value) return null;

      const isValid = isScrapeUrlValid(value);
      const allowResult = isValid ? isUrlAllowed(value) : { allowed: false };

      return {
        lineNumber: index + 1,
        value,
        isValid,
        isAllowed: allowResult.allowed,
      };
    })
  .filter((entry): entry is UrlEntry => entry !== null);
}

function toLineStatus(entries: UrlEntry[]) {
  const statusByLine = new Map<number, UrlEntry>();
  for (const entry of entries) {
    statusByLine.set(entry.lineNumber, entry);
  }

  return statusByLine;
}


function isScrapeUrlValid(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface JarvisTabProps {
  trades: Trade[];
}

export default function JarvisTab({ trades }: JarvisTabProps) {
  const [panelView, setPanelView] = useState<'assistant' | 'documents'>('assistant');
  const [mode, setMode] = useState<JarvisMode>('assistant');
  const [prompt, setPrompt] = useState('');
  const [urlLines, setUrlLines] = useState<string[]>(['']);
  const [inputMode, setInputMode] = useState<JarvisInputMode>('manual');
  const [selectedPackId, setSelectedPackId] = useState('');
  const [rememberedUrls, setRememberedUrls] = useState<string[]>([]);
  const [response, setResponse] = useState<JarvisResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const todayLabel = useMemo(() => format(new Date(), 'EEEE, MMM d'), []);
  const selectedPack = useMemo(() => sourcePacks.find((pack) => pack.id === selectedPackId) ?? null, [selectedPackId]);
  const urlEntries = useMemo(
    () => toUrlEntries(urlLines),
    [urlLines],
  );

  const urlStatusByLine = useMemo(() => toLineStatus(urlEntries), [urlEntries]);

  const invalidUrlEntries = useMemo(
    () => urlEntries.filter((entry) => !entry.isValid),
    [urlEntries],
  );

  const validUniqueUrls = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];

    for (const entry of urlEntries) {
      if (!entry.isValid || seen.has(entry.value)) continue;
      seen.add(entry.value);
      values.push(entry.value);
    }

    return values;
  }, [urlEntries]);

  const urlsForRequest = useMemo(
    () => validUniqueUrls.slice(0, MAX_SCRAPE_URLS),
    [validUniqueUrls],
  );

  const ignoredDuplicateCount = useMemo(() => {
    const validCount = urlEntries.filter((entry) => entry.isValid).length;
    return validCount - validUniqueUrls.length;
  }, [urlEntries, validUniqueUrls]);

  const overflowCount = Math.max(validUniqueUrls.length - MAX_SCRAPE_URLS, 0);

  const shouldRememberUrlInputs = inputMode === 'manual' && urlsForRequest.length > 0;

  const rememberedUrlStatus = useMemo(
    () =>
      rememberedUrls.map((url) => ({
        url,
        blocked: isScrapeUrlValid(url) ? !isUrlAllowed(url).allowed : true,
      })),
    [rememberedUrls],
  );

  const blockedRememberedCount = rememberedUrlStatus.filter((entry) => entry.blocked).length;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/jarvis')
      .then((res) => (res.ok ? res.json() : { urls: [] }))
      .then((payload: { urls?: string[] }) => {
        if (cancelled) return;
        setRememberedUrls(Array.isArray(payload.urls) ? payload.urls.filter((url) => typeof url === 'string') : []);
      })
      .catch(() => {
        if (!cancelled) setRememberedUrls([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setLineValue = (index: number, nextValue: string) => {
    setUrlLines((current) => current.map((value, lineIndex) => (lineIndex === index ? nextValue : value)));
  };

  const addLine = () => {
    setUrlLines((current) => (current.length >= MAX_SCRAPE_URLS ? current : [...current, '']));
  };

  const removeLine = (index: number) => {
    setUrlLines((current) => {
      if (current.length === 1) return [''];
      return current.filter((_, lineIndex) => lineIndex !== index);
    });
  };

  const applyRememberedUrl = (url: string) => {
    setUrlLines((current) => {
      const normalizedCurrent = current.map((line) => line.trim());
      if (normalizedCurrent.includes(url)) return current;

      const firstEmpty = current.findIndex((line) => line.trim().length === 0);
      if (firstEmpty >= 0) {
        return current.map((line, index) => (index === firstEmpty ? url : line));
      }

      if (current.length < MAX_SCRAPE_URLS) {
        return [...current, url];
      }

      return current;
    });
  };

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
          urls: inputMode === 'manual' ? urlsForRequest : undefined,
          sourcePackId: inputMode === 'pack' ? selectedPackId : undefined,
          trades: trades.map(toJarvisTradeInput),
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as JarvisResponse & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? 'Jarvis is unavailable right now');
      }

      if (shouldRememberUrlInputs) {
        setRememberedUrls((current) => {
          const merged = [...urlsForRequest, ...current];
          const deduped: string[] = [];
          for (const url of merged) {
            if (!deduped.includes(url)) deduped.push(url);
            if (deduped.length >= 20) break;
          }
          return deduped;
        });
      }

      setResponse({
        message: payload.message,
        sourceSummary: payload.sourceSummary,
        sources: payload.sources,
        warnings: payload.warnings,
        structured: payload.structured,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Jarvis is unavailable right now';
      setResponse({ message });
    } finally {
      setLoading(false);
    }
  };

  const selectPack = (nextPackId: string) => {
    setInputMode('pack');
    setSelectedPackId(nextPackId);
    const pack = sourcePacks.find((entry) => entry.id === nextPackId);
    if (pack) {
      setPrompt(pack.promptTemplate);
      setUrlLines(['']);
    }
  };

  const selectManualMode = () => {
    setInputMode('manual');
    setSelectedPackId('');
    setUrlLines((current) => (current.length === 0 ? [''] : current));
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
            <label className="mb-2 block text-xs uppercase tracking-wider text-zinc-500">Source Input</label>

            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectManualMode}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors ${inputMode === 'manual' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200' : 'border-white/10 text-zinc-300 hover:bg-white/10'}`}
              >
                Manual URLs
              </button>
              <button
                type="button"
                onClick={() => setInputMode('pack')}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors ${inputMode === 'pack' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200' : 'border-white/10 text-zinc-300 hover:bg-white/10'}`}
              >
                Source Pack
              </button>
            </div>

            <div className={`rounded-xl border bg-white/5 px-3 py-2 ${invalidUrlEntries.length > 0 ? 'border-amber-500/30' : 'border-white/10'}`}>
              {inputMode === 'manual' ? (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-zinc-400">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5" />
                      Jarvis can scrape up to 5 pages for context
                    </div>
                    <span>{urlsForRequest.length}/{MAX_SCRAPE_URLS}</span>
                  </div>
                  <div className="space-y-2">
                    {urlLines.map((line, index) => {
                      const status = urlStatusByLine.get(index + 1);
                      const isInvalid = !!status && !status.isValid;
                      const isBlocked = !!status && status.isValid && !status.isAllowed;

                      return (
                        <div key={`url-line-${index}`}>
                          <div className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${isInvalid ? 'border-amber-500/40 bg-amber-500/10' : isBlocked ? 'border-amber-500/60 bg-amber-500/5' : 'border-white/10 bg-black/20'}`}>
                            <span className="w-5 text-center text-[11px] text-zinc-500">{index + 1}</span>
                            <input
                              value={line}
                              onChange={(event) => setLineValue(index, event.target.value)}
                              placeholder="https://example.com/news"
                              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                            />
                            <button
                              type="button"
                              onClick={() => removeLine(index)}
                              className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
                              aria-label={`Remove URL line ${index + 1}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {isInvalid ? <p className="mt-1 text-[11px] text-amber-300">Use a full `http://` or `https://` URL.</p> : null}
                          {isBlocked ? <p className="mt-1 text-[11px] text-amber-200">Domain is not allowlisted. Ask support to add it.</p> : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={addLine}
                      disabled={urlLines.length >= MAX_SCRAPE_URLS}
                      className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add URL
                    </button>
                    <button
                      type="button"
                      onClick={() => setUrlLines([''])}
                      className="rounded border border-white/10 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/10"
                    >
                      Clear URLs
                    </button>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-zinc-400">Valid URLs queued: {urlsForRequest.length}</p>
                    {ignoredDuplicateCount > 0 ? <p className="text-zinc-500">Duplicate URLs ignored: {ignoredDuplicateCount}</p> : null}
                    {overflowCount > 0 ? <p className="text-amber-300">{overflowCount} valid URL(s) exceed limit and will be skipped.</p> : null}
                    {invalidUrlEntries.length > 0 ? (
                      <p className="text-amber-300">
                        Invalid URL format on line(s): {invalidUrlEntries.map((entry) => entry.lineNumber).join(', ')}. Use full `http://` or `https://` links.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <label className="mb-2 block text-xs uppercase tracking-wider text-zinc-500">Source Presets</label>
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
                </>
              )}
            </div>

            {rememberedUrlStatus.length > 0 ? (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">Remembered URLs</p>
                <div className="flex flex-wrap gap-2">
                  {rememberedUrlStatus.map((entry) => (
                    <button
                      key={entry.url}
                      type="button"
                      onClick={() => applyRememberedUrl(entry.url)}
                      className={`max-w-full truncate rounded-full border px-3 py-1 text-xs transition-colors hover:bg-emerald-500/20 ${entry.blocked ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 line-through decoration-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}
                      title={entry.url}
                    >
                      {entry.url}
                    </button>
                  ))}
                </div>
                {blockedRememberedCount > 0 ? <p className="mt-2 text-[11px] text-amber-300">{blockedRememberedCount} remembered URL(s) blocked by allowlist.</p> : null}
              </div>
            ) : null}
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
              setUrlLines(['']);
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
