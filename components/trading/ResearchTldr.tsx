'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface TldrResponse {
  ticker: string;
  tldr: string;
  findings: string[];
  actionSteps: string[];
  risks: string[];
  historicalContext: string | null;
  hasHistoricalData: boolean;
}

interface Props {
  ticker: string;
}

export default function ResearchTldr({ ticker }: Props) {
  const [data, setData] = useState<TldrResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateTldr = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/askedgar/tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (!response.ok) throw new Error(`TLDR failed: ${response.status}`);
      const result = (await response.json()) as TldrResponse;
      setData(result);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'TLDR generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Jarvis TLDR</h3>
        <Button
          type="button"
          disabled={loading}
          onClick={() => {
            void generateTldr();
          }}
          className="bg-emerald-500 px-3 py-1 text-sm font-semibold text-black hover:bg-emerald-400"
        >
          {loading ? 'Generating...' : 'Generate TLDR'}
        </Button>
      </div>

      {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}

      {data ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-sm text-zinc-200">{data.tldr}</p>
          </div>

          {data.findings.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-zinc-400">Key Findings</p>
              <ul className="mt-1 space-y-1">
                {data.findings.map((finding, index) => (
                  <li key={index} className="text-sm text-zinc-300">- {finding}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.actionSteps.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-zinc-400">Watch For</p>
              <ul className="mt-1 space-y-1">
                {data.actionSteps.map((step, index) => (
                  <li key={index} className="text-sm text-amber-300">- {step}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.risks.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-zinc-400">Risks</p>
              <ul className="mt-1 space-y-1">
                {data.risks.map((risk, index) => (
                  <li key={index} className="text-sm text-rose-300">- {risk}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.historicalContext ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-sm font-medium text-zinc-400">Historical Context</p>
              <p className="mt-1 text-sm text-zinc-300">{data.historicalContext}</p>
            </div>
          ) : !data.hasHistoricalData ? (
            <p className="text-sm text-zinc-500">No historical data — import Discord reports to enable historical tracking</p>
          ) : null}
        </div>
      ) : !loading ? (
        <p className="mt-2 text-sm text-zinc-500">Click &quot;Generate TLDR&quot; for an AI-powered dilution risk summary</p>
      ) : null}
    </div>
  );
}
