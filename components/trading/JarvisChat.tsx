'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JarvisStructuredResponse from '@/components/trading/JarvisStructuredResponse';
import type { DilutionResearchReport } from '@/lib/jarvis/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  payload?: {
    reportJson?: unknown;
    researchTldr?: {
      tldr: string;
      findings: string[];
      actionSteps: string[];
      risks: string[];
    };
    warnings?: string[];
    fromCache?: boolean;
    tradeAnalysis?: {
      strengths: string[];
      weaknesses: string[];
      patterns: string[];
      action_items: string[];
    };
  };
}

interface StreamDonePayload {
  fullText?: string;
  session_id?: string;
}

async function streamChatMessage(
  message: string,
  sessionId: string | undefined,
  onToken: (text: string) => void,
  onDone: (payload: StreamDonePayload) => void,
  onError: (error: string) => void,
): Promise<boolean> {
  const response = await fetch('/api/jarvis/chat?stream=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId || undefined }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    onError(payload.error ?? `Request failed (${response.status})`);
    return true;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json().catch(() => ({}))) as { redirect?: boolean; error?: string };
    if (payload.redirect) return false;
    onError(payload.error ?? 'Jarvis unavailable');
    return true;
  }

  if (!response.body) {
    onError('Stream unavailable');
    return true;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n');
      let eventName = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        if (line.startsWith('data: ')) eventData = line.slice(6);
      }

      if (!eventData) continue;

      try {
        const parsed = JSON.parse(eventData) as { text?: string; message?: string; fullText?: string; session_id?: string };
        if (eventName === 'token' && typeof parsed.text === 'string') {
          onToken(parsed.text);
        } else if (eventName === 'done') {
          onDone({ fullText: parsed.fullText, session_id: parsed.session_id });
        } else if (eventName === 'error') {
          onError(parsed.message ?? 'Stream interrupted');
        }
      } catch {
        // Ignore malformed chunks.
      }
    }
  }

  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDilutionResearchReport(value: unknown): value is DilutionResearchReport {
  if (!isObject(value)) return false;

  return (
    typeof value.ticker === 'string'
    && typeof value.generatedAt === 'string'
    && isObject(value.header)
    && Array.isArray(value.dataSources)
    && Array.isArray(value.news)
    && Array.isArray(value.catalysts)
    && isObject(value.dilution)
    && isObject(value.offeringFrequency)
    && isObject(value.offeringAbility)
    && isObject(value.cashNeed)
    && isObject(value.overallOfferingRisk)
    && isObject(value.scamRisk)
    && Array.isArray(value.agreements)
    && Array.isArray(value.historicalFloat)
    && Array.isArray(value.reverseSplits)
    && Array.isArray(value.filingTitles)
  );
}

// localStorage key includes today's date so stale data auto-expires
function todayKey(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}`;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function JarvisChat() {
  const [sessionId, setSessionId] = useState<string>(() =>
    loadFromStorage(todayKey('jarvis-session'), ''),
  );
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadFromStorage(todayKey('jarvis-messages'), []),
  );
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Persist messages & sessionId to localStorage whenever they change
  const isInitialMount = useRef(true);
  const persist = useCallback(() => {
    localStorage.setItem(todayKey('jarvis-messages'), JSON.stringify(messages));
    localStorage.setItem(todayKey('jarvis-session'), JSON.stringify(sessionId));
  }, [messages, sessionId]);

  useEffect(() => {
    // Skip the very first render (we just loaded from storage)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    persist();
  }, [persist]);

  const prefixHint = useMemo(() => {
    if (input.startsWith('/r')) return 'Hint: /research TICKER';
    if (input.startsWith('/a')) return 'Hint: /analyze';
    return '';
  }, [input]);

  const onSend = async () => {
    const message = input.trim();
    if (!message || loading) return;

    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', text: message }, { role: 'assistant', text: '' }]);
    setInput('');

    try {
      setIsStreaming(true);
      let redirectToLegacy = false;

      const streamed = await streamChatMessage(
        message,
        sessionId || undefined,
        (token) => {
          setMessages((prev) => {
            const next = [...prev];
            const index = next.length - 1;
            if (index >= 0 && next[index].role === 'assistant') {
              next[index] = {
                ...next[index],
                text: `${next[index].text}${token}`,
              };
            }
            return next;
          });
        },
        ({ fullText, session_id }) => {
          if (session_id) {
            setSessionId(session_id);
          }

          if (typeof fullText === 'string') {
            setMessages((prev) => {
              const next = [...prev];
              const index = next.length - 1;
              if (index >= 0 && next[index].role === 'assistant') {
                next[index] = {
                  ...next[index],
                  text: fullText,
                };
              }
              return next;
            });
          }
        },
        (errorMessage) => {
          setMessages((prev) => {
            const next = [...prev];
            const index = next.length - 1;
            if (index >= 0 && next[index].role === 'assistant') {
              next[index] = {
                ...next[index],
                text: errorMessage,
              };
            }
            return next;
          });
        },
      );

      if (!streamed) {
        redirectToLegacy = true;
      }

      if (!redirectToLegacy) {
        return;
      }

      setMessages((prev) => {
        const next = [...prev];
        if (next[next.length - 1]?.role === 'assistant' && next[next.length - 1]?.text === '') {
          next.pop();
        }
        return next;
      });

      const response = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: sessionId || undefined }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        session_id?: string;
        reportJson?: unknown;
        researchTldr?: NonNullable<ChatMessage['payload']>['researchTldr'];
        warnings?: string[];
        fromCache?: boolean;
        tradeAnalysis?: NonNullable<ChatMessage['payload']>['tradeAnalysis'];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Jarvis unavailable');
      }

      if (payload.session_id) {
        setSessionId(payload.session_id);
      }

      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: payload.message ?? '',
        payload: {
          reportJson: payload.reportJson,
          researchTldr: payload.researchTldr,
          warnings: payload.warnings,
          fromCache: payload.fromCache,
          tradeAnalysis: payload.tradeAnalysis,
        },
      }]);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Jarvis unavailable';
      setMessages((prev) => {
        const next = [...prev];
        const index = next.length - 1;
        if (index >= 0 && next[index].role === 'assistant') {
          next[index] = {
            ...next[index],
            text: messageText,
          };
          return next;
        }
        return [...prev, { role: 'assistant', text: messageText }];
      });
    } finally {
      setIsStreaming(false);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3">
        {messages.length === 0 ? <p className="text-sm text-zinc-500">Ask Jarvis about your trades, or use /research TICKER.</p> : null}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-6 rounded-lg bg-emerald-500/10 p-3' : 'mr-6 rounded-lg border border-white/10 bg-[#121214] p-3'}>
            {message.role === 'assistant' && message.payload?.tradeAnalysis ? (
              <div className="space-y-2 text-sm text-zinc-200">
                <p><strong>Strengths:</strong> {message.payload.tradeAnalysis.strengths.join('; ') || 'None'}</p>
                <p><strong>Weaknesses:</strong> {message.payload.tradeAnalysis.weaknesses.join('; ') || 'None'}</p>
                <p><strong>Patterns:</strong> {message.payload.tradeAnalysis.patterns.join('; ') || 'None'}</p>
                <p><strong>Action Items:</strong> {message.payload.tradeAnalysis.action_items.join('; ') || 'None'}</p>
              </div>
            ) : message.role === 'assistant' && message.payload?.researchTldr ? (
              <div className="mt-2 space-y-3 text-sm">
                <p className="text-zinc-200">{message.payload.researchTldr.tldr}</p>

                {message.payload.researchTldr.findings.length > 0 ? (
                  <div>
                    <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Key Findings</h4>
                    <ul className="list-inside list-disc space-y-0.5 text-zinc-300">
                      {message.payload.researchTldr.findings.map((finding, findingIndex) => <li key={`finding-${findingIndex}`}>{finding}</li>)}
                    </ul>
                  </div>
                ) : null}

                {message.payload.researchTldr.actionSteps.length > 0 ? (
                  <div>
                    <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Action Steps</h4>
                    <ul className="list-inside list-disc space-y-0.5 text-emerald-400/80">
                      {message.payload.researchTldr.actionSteps.map((action, actionIndex) => <li key={`action-${actionIndex}`}>{action}</li>)}
                    </ul>
                  </div>
                ) : null}

                {message.payload.researchTldr.risks.length > 0 ? (
                  <div>
                    <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Risk Flags</h4>
                    <ul className="list-inside list-disc space-y-0.5 text-rose-400/80">
                      {message.payload.researchTldr.risks.map((risk, riskIndex) => <li key={`risk-${riskIndex}`}>{risk}</li>)}
                    </ul>
                  </div>
                ) : null}

                <div className="flex gap-2 text-xs">
                  <span className={message.payload.fromCache ? 'text-zinc-500' : 'text-emerald-500'}>
                    {message.payload.fromCache ? 'cached' : 'fresh'}
                  </span>
                  {message.payload.warnings && message.payload.warnings.length > 0 ? (
                    <span className="text-amber-500">{message.payload.warnings.length} warning(s)</span>
                  ) : null}
                </div>
              </div>
            ) : message.role === 'assistant' && message.payload?.reportJson ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {typeof message.payload.fromCache === 'boolean' ? (
                    <span className={`rounded-full border px-2 py-0.5 ${message.payload.fromCache ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
                      Source: {message.payload.fromCache ? 'Cache' : 'Fresh'}
                    </span>
                  ) : null}
                  {message.payload.warnings && message.payload.warnings.length > 0 ? (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                      {message.payload.warnings.length} warning{message.payload.warnings.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>

                {isDilutionResearchReport(message.payload.reportJson) ? (
                  <JarvisStructuredResponse
                    message={message.text}
                    warnings={message.payload.warnings}
                    dilutionReport={message.payload.reportJson}
                  />
                ) : (
                  <JarvisStructuredResponse
                    message="Research report generated, but the payload is incomplete or unstructured."
                    warnings={message.payload.warnings}
                    rawPayload={message.payload.reportJson}
                  />
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-zinc-100">
                {message.text}
                {isStreaming && loading && index === messages.length - 1 ? <span className="animate-pulse text-emerald-500">|</span> : null}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#121214] p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          rows={3}
          placeholder="Message Jarvis..."
          className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-zinc-500">{prefixHint || 'Commands: /research TICKER, /analyze'}</p>
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={loading}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-60"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
