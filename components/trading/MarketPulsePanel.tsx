'use client';

import { useEffect, useRef, useState } from 'react';

type MarketStrength = 'strong' | 'mixed' | 'weak';
type Confidence = 'high' | 'medium' | 'low';

interface MarketPulseLeader {
  ticker: string;
  changePct: number;
  volume: number;
  dollarVolume: number;
  sector?: string | null;
}

interface MarketPulseReport {
  tradingDate: string;
  marketStrength: MarketStrength;
  confidence: Confidence;
  tldr: string[];
  summary: string;
  breadth: {
    advancers: number;
    decliners: number;
    unchanged: number;
    advancerPct: number;
    upVolumePct: number | null;
  };
  rolling30: {
    tradingDays: number;
    avgAdvancerPct: number | null;
    medianAdvancerPct: number | null;
    strongDays: number;
    weakDays: number;
    newHigh30dAvg: number | null;
    newLow30dAvg: number | null;
  };
  overview90?: {
    tradingDays: number;
    trend: 'improving' | 'flat' | 'deteriorating';
    strongestDate: string | null;
    weakestDate: string | null;
    note: string;
  };
  leaders: MarketPulseLeader[];
  laggards: MarketPulseLeader[];
  sectorNotes: string[];
  riskFlags: string[];
  sourceIndex: Array<{ id: string; label: string; source: 'massive' | 'tradingview' | 'computed'; asOf: string }>;
}

interface ApiResponse {
  pulse: {
    generated_at: string | null;
    content: MarketPulseReport;
    status: string;
    deliveryError: string | null;
  } | null;
}

let cachedReport: { report: MarketPulseReport; generatedAt: string | null } | null = null;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h5 className="mb-1 text-sm font-semibold text-foreground">{children}</h5>;
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function strengthClass(strength: MarketStrength): string {
  if (strength === 'strong') return 'text-emerald-300 bg-emerald-500/10';
  if (strength === 'weak') return 'text-rose-300 bg-rose-500/10';
  return 'text-amber-300 bg-amber-500/10';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-accent px-2 py-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function LeaderList({ title, rows }: { title: string; rows: MarketPulseLeader[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <SectionHeading>{title}</SectionHeading>
      <ul className="space-y-1 text-sm text-foreground">
        {rows.slice(0, 3).map((row) => (
          <li key={`${title}-${row.ticker}`} className="flex items-center justify-between gap-3">
            <span>
              <span className="font-semibold">{row.ticker}</span>
              {row.sector ? <span> · {row.sector}</span> : null}
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {formatPct(row.changePct)}
              <span className="ml-2 text-muted-foreground">{formatCompact(row.volume)} vol</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MarketPulsePanel() {
  const [report, setReport] = useState<MarketPulseReport | null>(cachedReport?.report ?? null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(cachedReport?.generatedAt ?? null);
  const [status, setStatus] = useState<'idle' | 'loading'>(cachedReport ? 'idle' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (cachedReport) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch('/api/agents/market-pulse/latest', { signal: controller.signal });
        if (!res.ok) throw new Error(`Market pulse fetch failed: ${res.status}`);
        const payload = (await res.json()) as ApiResponse;

        if (payload.pulse?.content) {
          cachedReport = {
            report: payload.pulse.content,
            generatedAt: payload.pulse.generated_at,
          };
          setReport(payload.pulse.content);
          setGeneratedAt(payload.pulse.generated_at);
        }
        setStatus('idle');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Market pulse unavailable');
        setStatus('idle');
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="rounded border border-border bg-accent px-4 py-6 text-center text-sm text-muted-foreground">
        Loading market pulse...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-border bg-accent px-4 py-6 text-center text-sm text-rose-400">
        {error}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded border border-border bg-accent px-4 py-6 text-center text-sm text-muted-foreground">
        Market pulse not available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded border border-border bg-accent p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Strength</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${strengthClass(report.marketStrength)}`}>
            {report.marketStrength}
          </span>
          <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">Confidence</span>
          <span className="rounded bg-card/40 px-2 py-0.5 text-xs font-medium uppercase text-foreground">
            {report.confidence}
          </span>
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{report.tradingDate}</span>
          {generatedAt ? <span>· {new Date(generatedAt).toLocaleString()}</span> : null}
        </span>
      </div>

      {report.tldr.length > 0 ? (
        <div>
          <SectionHeading>TLDR</SectionHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {report.tldr.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.summary ? (
        <div>
          <SectionHeading>Summary</SectionHeading>
          <p className="text-sm text-foreground">{report.summary}</p>
        </div>
      ) : null}

      <div>
        <SectionHeading>One-Day Breadth</SectionHeading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Advancers" value={String(report.breadth.advancers)} />
          <Metric label="Decliners" value={String(report.breadth.decliners)} />
          <Metric label="Advancer %" value={formatPct(report.breadth.advancerPct)} />
          <Metric label="Up Volume" value={formatPct(report.breadth.upVolumePct)} />
        </div>
      </div>

      <div>
        <SectionHeading>Rolling 30</SectionHeading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Days" value={String(report.rolling30.tradingDays)} />
          <Metric label="Avg Adv %" value={formatPct(report.rolling30.avgAdvancerPct)} />
          <Metric label="Strong/Weak" value={`${report.rolling30.strongDays}/${report.rolling30.weakDays}`} />
          <Metric label="NH/NL Avg" value={`${report.rolling30.newHigh30dAvg ?? 'n/a'}/${report.rolling30.newLow30dAvg ?? 'n/a'}`} />
        </div>
      </div>

      {report.overview90 ? (
        <div>
          <SectionHeading>90-Day Overview</SectionHeading>
          <p className="text-sm text-foreground">
            <span className="font-semibold capitalize">{report.overview90.trend}</span>
            <span> · </span>
            {report.overview90.note}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <LeaderList title="Leaders" rows={report.leaders} />
        <LeaderList title="Laggards" rows={report.laggards} />
      </div>

      {report.riskFlags.length > 0 ? (
        <div>
          <SectionHeading>Risk Flags</SectionHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {report.riskFlags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
