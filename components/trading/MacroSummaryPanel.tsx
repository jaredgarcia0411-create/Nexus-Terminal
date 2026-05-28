'use client';

import { useEffect, useRef, useState } from 'react';

// Local mirror of MacroSummaryReport (lib/agents/types.ts). Duplicated rather
// than imported so this client component doesn't pull the agent module into
// the browser bundle. Keep in sync with the source of truth.
type Bias = 'bullish' | 'bearish' | 'neutral';
type Confidence = 'high' | 'medium' | 'low';
type Impact = 'positive' | 'negative' | 'mixed';
type Rating = 'green' | 'yellow' | 'red';

interface MacroDriver {
  driver: string;
  impact: Impact;
  sourceRefs: string[];
}

interface KeyLevel {
  ticker: string;
  support: string;
  resistance: string;
  note: string;
}

interface FredDataPoint {
  seriesId: string;
  label: string;
  date: string;
  value: number | null;
}

interface ScheduledCatalyst {
  event: string;
  date: string | null;
  expectedImpact: string;
}

interface ScenarioAnalysis {
  consensus: string;
  disruption: string;
}

interface CrossAssetEntry {
  ticker: string;
  price: number | null;
  changePercent: number | null;
}

interface MacroSource {
  id: string;
  title: string;
  url: string | null;
  fetchedAt: string;
}

interface SentimentDataPoint {
  score: number;
  classification: string;
  source: string;
}

interface MacroSummaryReport {
  tradingDate: string;
  marketBias: Bias;
  summary: string;
  riskAssessment: string;
  drivers: MacroDriver[];
  crossAssetSnapshot: CrossAssetEntry[];
  keyLevels: KeyLevel[];
  ratesOutlook: string;
  fredData: FredDataPoint[];
  sentimentData?: SentimentDataPoint;
  scheduledCatalysts: ScheduledCatalyst[];
  sectorRotation: string[];
  scenarioAnalysis: ScenarioAnalysis;
  deskImplications: string[];
  sourceIndex: MacroSource[];
  confidence: Confidence;
  tldr: string[];
  deltas?: string[];
}

interface ApiResponse {
  summary: {
    generated_at: string | null;
    content: MacroSummaryReport;
    status: string;
    deliveryError: string | null;
  } | null;
}

// Module-level cache so flipping tabs doesn't refetch the same report.
let cachedReport: { report: MacroSummaryReport; generatedAt: string | null } | null = null;

function impactToRating(impact: Impact): Rating {
  if (impact === 'positive') return 'green';
  if (impact === 'negative') return 'red';
  return 'yellow';
}

function dotClass(rating: Rating): string {
  if (rating === 'red') return 'bg-rose-500';
  if (rating === 'yellow') return 'bg-amber-500';
  return 'bg-emerald-500';
}

function RatingDot({ rating }: { rating: Rating }) {
  return (
    <span
      role="img"
      aria-label={`${rating} rating`}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(rating)}`}
    />
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h5 className="mb-1 text-sm font-semibold text-foreground">{children}</h5>;
}

function formatFredValue(point: FredDataPoint): string {
  if (point.value === null) return 'n/a';
  if (point.seriesId === 'T10Y2Y') {
    const bp = Math.round(point.value * 100);
    return `${bp >= 0 ? '+' : ''}${bp}bp`;
  }
  return `${point.value.toFixed(2)}%`;
}

function formatChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export default function MacroSummaryPanel() {
  const [report, setReport] = useState<MacroSummaryReport | null>(cachedReport?.report ?? null);
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
        const res = await fetch('/api/agents/macro-summary/latest', { signal: controller.signal });
        if (!res.ok) throw new Error(`Macro summary fetch failed: ${res.status}`);
        const payload = (await res.json()) as ApiResponse;

        if (payload.summary?.content) {
          cachedReport = {
            report: payload.summary.content,
            generatedAt: payload.summary.generated_at,
          };
          setReport(payload.summary.content);
          setGeneratedAt(payload.summary.generated_at);
        }
        setStatus('idle');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Macro summary unavailable');
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
        Loading macro briefing…
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
        Macro briefing not available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded border border-border bg-accent p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Bias</span>
          <span className="rounded bg-card/40 px-2 py-0.5 text-xs font-medium uppercase text-foreground">
            {report.marketBias}
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

      {report.riskAssessment ? (
        <div>
          <SectionHeading>Risk Assessment</SectionHeading>
          <p className="text-sm text-foreground">{report.riskAssessment}</p>
        </div>
      ) : null}

      {report.drivers.length > 0 ? (
        <div>
          <SectionHeading>Top Drivers</SectionHeading>
          <ul className="space-y-1">
            {report.drivers.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <RatingDot rating={impactToRating(d.impact)} />
                <span className="text-sm text-foreground">{d.driver}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.keyLevels.length > 0 ? (
        <div>
          <SectionHeading>Key Levels</SectionHeading>
          <ul className="space-y-1 text-sm text-foreground">
            {report.keyLevels.map((level, i) => (
              <li key={i}>
                <span className="font-semibold">{level.ticker}</span>
                <span> · </span>
                <span>{level.support} / {level.resistance}</span>
                {level.note ? <span> — {level.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(report.fredData.length > 0 || report.ratesOutlook) ? (
        <div>
          <SectionHeading>Rates</SectionHeading>
          {report.fredData.length > 0 ? (
            <p className="text-sm text-foreground">
              {report.fredData.map((p) => `${p.label}: ${formatFredValue(p)}`).join(' | ')}
            </p>
          ) : null}
          {report.ratesOutlook ? (
            <p className="mt-1 text-sm text-foreground">{report.ratesOutlook}</p>
          ) : null}
        </div>
      ) : null}

      {report.sentimentData ? (
        <div>
          <SectionHeading>Fear &amp; Greed</SectionHeading>
          <p className="text-sm text-foreground">
            {report.sentimentData.score}/100 — {report.sentimentData.classification}
            <span> ({report.sentimentData.source})</span>
          </p>
        </div>
      ) : null}

      {report.scheduledCatalysts.length > 0 ? (
        <div>
          <SectionHeading>Scheduled Catalysts</SectionHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {report.scheduledCatalysts.map((c, i) => (
              <li key={i}>
                {c.date ? <span>{c.date} · </span> : null}
                <span>{c.event}</span>
                {c.expectedImpact ? <span> — {c.expectedImpact}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.sectorRotation.length > 0 ? (
        <div>
          <SectionHeading>Sector Rotation</SectionHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {report.sectorRotation.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(report.scenarioAnalysis?.consensus || report.scenarioAnalysis?.disruption) ? (
        <div>
          <SectionHeading>Scenario Analysis</SectionHeading>
          {report.scenarioAnalysis.consensus ? (
            <p className="text-sm text-foreground">
              <span className="font-semibold">Consensus: </span>
              {report.scenarioAnalysis.consensus}
            </p>
          ) : null}
          {report.scenarioAnalysis.disruption ? (
            <p className="mt-1 text-sm text-foreground">
              <span className="font-semibold">Disruption: </span>
              {report.scenarioAnalysis.disruption}
            </p>
          ) : null}
        </div>
      ) : null}

      {report.deskImplications.length > 0 ? (
        <div>
          <SectionHeading>Desk Implications</SectionHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {report.deskImplications.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.crossAssetSnapshot.length > 0 ? (
        <div>
          <SectionHeading>Cross-Asset Snapshot</SectionHeading>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {report.crossAssetSnapshot.map((entry) => (
              <div
                key={entry.ticker}
                className="rounded border border-border bg-accent px-2 py-1 text-xs text-foreground"
              >
                <div className="font-semibold">{entry.ticker}</div>
                <div className="flex items-center justify-between gap-2">
                  <span>{entry.price !== null ? entry.price.toFixed(2) : 'n/a'}</span>
                  <span
                    className={
                      entry.changePercent === null
                        ? 'text-muted-foreground'
                        : entry.changePercent >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                    }
                  >
                    {formatChange(entry.changePercent)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {report.deltas && report.deltas.length > 0 ? (
        <div>
          <SectionHeading>Deltas</SectionHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {report.deltas.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.sourceIndex.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Sources: {report.sourceIndex.length}
        </p>
      ) : null}
    </div>
  );
}
