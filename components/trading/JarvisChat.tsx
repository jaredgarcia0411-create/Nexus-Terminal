'use client';

import { useMemo, useState } from 'react';
import JarvisStructuredResponse from '@/components/trading/JarvisStructuredResponse';
import type { DilutionResearchReport } from '@/lib/jarvis/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  payload?: {
    reportJson?: unknown;
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

function fallbackReportText(reportJson: unknown) {
  if (typeof reportJson === 'string') return reportJson;
  if (reportJson == null) return 'No report data returned.';
  try {
    return JSON.stringify(reportJson, null, 2);
  } catch {
    return 'Unable to render report payload.';
  }
}

export default function JarvisChat() {
  const [sessionId, setSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const prefixHint = useMemo(() => {
    if (input.startsWith('/r')) return 'Hint: /research TICKER';
    if (input.startsWith('/a')) return 'Hint: /analyze';
    return '';
  }, [input]);

  const onSend = async () => {
    const message = input.trim();
    if (!message || loading) return;

    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');

    try {
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
          warnings: payload.warnings,
          fromCache: payload.fromCache,
          tradeAnalysis: payload.tradeAnalysis,
        },
      }]);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Jarvis unavailable';
      setMessages((prev) => [...prev, { role: 'assistant', text: messageText }]);
    } finally {
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
            ) : message.role === 'assistant' && message.payload?.reportJson ? (
              isDilutionResearchReport(message.payload.reportJson) ? (
                <JarvisStructuredResponse
                  message={message.text}
                  warnings={message.payload.warnings}
                  dilutionReport={message.payload.reportJson}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-zinc-100">{fallbackReportText(message.payload.reportJson)}</p>
              )
            ) : (
              <p className="whitespace-pre-wrap text-sm text-zinc-100">{message.text}</p>
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
