'use client';

import { useEffect, useRef, useState } from 'react';

interface TldrResponse {
  ticker: string;
  tldr: string;
  findings: string[];
  actionSteps: string[];
  risks: string[];
  historicalContext?: string | null;
  hasHistoricalData?: boolean;
  generatedAt: string;
}

const tldrCache = new Map<string, TldrResponse>();

interface Props {
  ticker: string;
}

export default function ResearchTldr({ ticker }: Props) {
  const [data, setData] = useState<TldrResponse | null>(() => tldrCache.get(ticker) ?? null);
  const [loading, setLoading] = useState(() => Boolean(ticker && !tldrCache.has(ticker)));
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!ticker) return;

    if (tldrCache.has(ticker)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch('/api/askedgar/tldr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`TLDR request failed: ${res.status}`);
        return res.json() as Promise<TldrResponse>;
      })
      .then((result) => {
        tldrCache.set(ticker, result);
        setData(result);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'TLDR generation failed');
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [ticker]);

  if (loading) {
    return (
      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">TLDR</h4>
        <div className="text-sm text-zinc-500">Generating TLDR…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">TLDR</h4>
        <div className="text-sm text-rose-400">{error}</div>
      </div>
    );
  }
  if (!data) {
    return null;
  }

  const watchAndRisks = [...(data.actionSteps ?? []), ...(data.risks ?? [])];

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">TLDR</h4>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-sm text-zinc-200">{data.tldr}</p>
        </div>
      </div>

      {data.findings && data.findings.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-zinc-200">Key Findings</h4>
          <ul className="space-y-1">
            {data.findings.map((item, i) => (
              <li key={i} className="text-sm text-zinc-300">• {item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {watchAndRisks.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-zinc-200">Watch For &amp; Risks</h4>
          <ul className="space-y-1">
            {watchAndRisks.map((item, i) => (
              <li key={i} className="text-sm text-zinc-300">• {item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
