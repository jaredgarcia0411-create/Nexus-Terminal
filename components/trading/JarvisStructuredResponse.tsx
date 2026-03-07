import React from 'react';
import type { JarvisSourceContext, JarvisStructuredResponse } from '@/lib/jarvis-types';

interface JarvisStructuredResponseProps {
  message: string;
  structured?: JarvisStructuredResponse;
  warnings?: string[];
  sourceSummary?: string;
  sources?: JarvisSourceContext[];
}

function relevanceLabel(score: number) {
  if (score >= 0.75) return 'High relevance';
  if (score >= 0.45) return 'Medium relevance';
  return 'Low relevance';
}

export default function JarvisStructuredResponse({ message, structured, warnings, sourceSummary, sources }: JarvisStructuredResponseProps) {
  return (
    <div className="space-y-4">
      {structured ? (
        <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="rounded-lg border border-emerald-500/25 bg-black/25 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">TL;DR</p>
            <p className="mt-1 text-sm text-zinc-100">{structured.tldr}</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">Findings</p>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-100">
                {structured.findings.map((item, index) => (
                  <li key={`jarvis-finding-${index}-${item}`} className="flex gap-2">
                    <span className="text-zinc-500">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">Action Steps</p>
              <ol className="mt-2 space-y-1.5 text-sm text-zinc-100">
                {structured.actionSteps.map((item, index) => (
                  <li key={`jarvis-action-${index}-${item}`} className="flex gap-2">
                    <span className="text-zinc-500">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200">Risks</p>
            <ul className="mt-2 space-y-1.5 text-sm text-amber-100">
              {structured.risks.map((item, index) => (
                <li key={`jarvis-risk-${index}-${item}`} className="flex gap-2">
                  <span className="text-amber-300">!</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">{message}</p>
      )}

      {warnings && warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-100">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Warnings</p>
          <ul className="mt-2 space-y-1 text-xs">
            {warnings.map((warning, index) => (
              <li key={`jarvis-warning-${index}`} className="leading-relaxed">• {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sourceSummary ? (
        <p className="text-xs text-zinc-400">Source Summary: {sourceSummary}</p>
      ) : null}

      {sources && sources.length > 0 ? (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Source Links</p>
          <div className="space-y-2">
            {sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-white/10 bg-black/20 p-3 transition-colors hover:border-emerald-500/40"
              >
                <p className="text-sm text-zinc-100">{source.title || source.host}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-zinc-300">{source.host}</span>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">{relevanceLabel(source.relevance)}</span>
                  {source.tickers.slice(0, 3).map((ticker) => (
                    <span key={`${source.url}-${ticker}`} className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
                      {ticker}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-zinc-400">{source.excerpt}</p>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
