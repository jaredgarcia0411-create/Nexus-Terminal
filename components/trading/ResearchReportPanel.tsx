'use client';

import { useEffect, useRef, useState } from 'react';

// The structural shape of the agent's research report. Mirrors researchReportSchema
// from lib/agents/blueprints/small-cap-research.ts. Kept as a local type instead of
// importing the Zod-inferred type so this client component doesn't pull the agent
// module into the browser bundle.
type Rating = 'green' | 'yellow' | 'red';

interface RatedSection {
  rating: Rating;
  explanation: string;
}

interface RatedCatalyst {
  catalyst: string;
  rating: Rating;
}

// Exported so the watchlist's by-id viewer can type the response from
// /api/research-report/by-id without duplicating the shape.
export interface ResearchReport {
  ticker: string;
  newsWhyRunning: RatedSection;
  themeMatch: RatedSection;
  otherCatalysts: RatedCatalyst[];
  chartHistory: RatedSection;
  dilution: RatedSection;
  offeringFrequency: RatedSection;
  offeringAbility: RatedSection;
  cashNeed: RatedSection;
  overallOfferingRisk: RatedSection;
  jmt415Commentary: string | null;
  gapStatsTable: Array<{ date: string; gapPct: number; open: number; close: number }>;
  financialCommentary: { rating: Rating; explanation: string; source: 'verbatim' | 'llm' };
  confidence: 'high' | 'medium' | 'low';
  evidenceIds: string[];
}

interface ApiResponse {
  ticker: string;
  // Server-issued primary key of the research_reports row backing this response.
  // Null when no fresh report exists (the GET-no-cache case). The watchlist
  // "+ Add" button captures this to bind a specific report to a watchlist row.
  id: string | null;
  report: ResearchReport | null;
  generatedAt: string | null;
  cached: boolean;
  modelUsed?: string | null;
}

interface Props {
  ticker: string;
}

// Module-level cache mirrors the auto-TLDR's pattern - keyed by ticker, persists across remounts
// within a session so flipping between tickers doesn't refetch immediately.
// id is the research_reports row id — captured so the "+ Add to Watchlist" button can pin
// a watchlist row to this exact report without a second round-trip.
const reportCache = new Map<string, { id: string | null; report: ResearchReport; generatedAt: string | null }>();

// Lets sibling components (e.g. the watchlist "+ Add" button on the research page) read the
// already-cached report id for a ticker without re-fetching. Returns null if the panel hasn't
// run for this ticker yet or the server returned no fresh report.
export function getCachedReportId(ticker: string): string | null {
  return reportCache.get(ticker)?.id ?? null;
}

// Tracks in-flight prefetches so multiple callers for the same ticker share one network round-trip.
const prefetchInFlight = new Map<string, Promise<void>>();

// Warms reportCache for a ticker by running the same GET-then-POST flow the panel uses on mount.
// Called by ResearchTickerView as soon as a ticker loads so the Research tab renders instantly when clicked.
export function prefetchResearchReport(ticker: string): Promise<void> {
  if (!ticker) return Promise.resolve();
  if (reportCache.has(ticker)) return Promise.resolve();
  const existing = prefetchInFlight.get(ticker);
  if (existing) return existing;

  const task = (async () => {
    try {
      const getRes = await fetch(`/api/research-report?ticker=${encodeURIComponent(ticker)}`);
      if (!getRes.ok) return;
      const getPayload = (await getRes.json()) as ApiResponse;
      if (getPayload.report) {
        reportCache.set(ticker, { id: getPayload.id, report: getPayload.report, generatedAt: getPayload.generatedAt });
        return;
      }
      const postRes = await fetch('/api/research-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (!postRes.ok) return;
      const postPayload = (await postRes.json()) as ApiResponse;
      if (postPayload.report) {
        reportCache.set(ticker, { id: postPayload.id, report: postPayload.report, generatedAt: postPayload.generatedAt });
      }
    } catch {
      // Prefetch failures are silent — the panel itself will retry and surface the error when the user clicks the tab.
    } finally {
      prefetchInFlight.delete(ticker);
    }
  })();

  prefetchInFlight.set(ticker, task);
  return task;
}

function dotClass(rating: Rating): string {
  if (rating === 'red') return 'bg-rose-500';
  if (rating === 'yellow') return 'bg-amber-500';
  return 'bg-emerald-500';
}

function RatingDot({ rating }: { rating: Rating }) {
  // 10px filled circle. aria-label keeps the signal accessible to screen readers since
  // we dropped the text label.
  return (
    <span
      role="img"
      aria-label={`${rating} rating`}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(rating)}`}
    />
  );
}

// Detects a bullet-formatted explanation (every non-empty line starts with "- ",
// "• ", or "* "). If so, renders as a <ul>; otherwise falls back to a paragraph.
// This lets the LLM control the layout via prompt formatting (currently only
// dilution.explanation is asked to return bullets) without a schema change, and
// keeps stale 16h-cached paragraph reports rendering correctly.
function ExplanationBody({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const bulletPattern = /^[-•*]\s+/;
  const isBulletList = lines.length > 1 && lines.every((l) => bulletPattern.test(l));

  if (isBulletList) {
    return (
      <ul className="space-y-1 text-sm text-zinc-300">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-zinc-500">•</span>
            <span>{line.replace(bulletPattern, '')}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <p className="text-sm text-zinc-300">{text}</p>;
}

function RatedRow({ label, section }: { label: string; section: RatedSection }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-zinc-200">{label}</span>
        <RatingDot rating={section.rating} />
      </div>
      <ExplanationBody text={section.explanation} />
    </div>
  );
}

export default function ResearchReportPanel({ ticker }: Props) {
  const cached = reportCache.get(ticker);
  const [report, setReport] = useState<ResearchReport | null>(cached?.report ?? null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(cached?.generatedAt ?? null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'generating'>(cached ? 'idle' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!ticker) return;

    // Session cache hit - no network round-trip.
    const hit = reportCache.get(ticker);
    if (hit) {
      setReport(hit.report);
      setGeneratedAt(hit.generatedAt);
      setStatus('idle');
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setError(null);
    setReport(null);
    setGeneratedAt(null);

    (async () => {
      try {
        // 1. Probe the server cache.
        const getRes = await fetch(
          `/api/research-report?ticker=${encodeURIComponent(ticker)}`,
          { signal: controller.signal },
        );
        if (!getRes.ok) throw new Error(`Lookup failed: ${getRes.status}`);
        const getPayload = (await getRes.json()) as ApiResponse;

        if (getPayload.report) {
          reportCache.set(ticker, { id: getPayload.id, report: getPayload.report, generatedAt: getPayload.generatedAt });
          setReport(getPayload.report);
          setGeneratedAt(getPayload.generatedAt);
          setStatus('idle');
          return;
        }

        // 2. No fresh row in the 16h window - auto-generate.
        setStatus('generating');
        const postRes = await fetch('/api/research-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
          signal: controller.signal,
        });
        if (!postRes.ok) throw new Error(`Generation failed: ${postRes.status}`);
        const postPayload = (await postRes.json()) as ApiResponse;
        if (postPayload.report) {
          reportCache.set(ticker, { id: postPayload.id, report: postPayload.report, generatedAt: postPayload.generatedAt });
          setReport(postPayload.report);
          setGeneratedAt(postPayload.generatedAt);
        }
        setStatus('idle');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Report unavailable');
        setStatus('idle');
      }
    })();

    return () => {
      controller.abort();
    };
  }, [ticker]);

  if (status === 'loading') {
    return (
      <div className="rounded border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-zinc-500">
        Loading report…
      </div>
    );
  }

  if (status === 'generating') {
    return (
      <div className="rounded border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-zinc-500">
        Generating Research Report…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-rose-400">
        {error}
      </div>
    );
  }

  if (!report) {
    return null;
  }

  return <ResearchReportBody report={report} generatedAt={generatedAt} />;
}

// Pure render: takes an already-loaded report and shows the rated-row layout.
// Exported so the watchlist eye-icon viewer can render the same body without
// duplicating the JSX. Keeps fetch/cache logic separate from presentation.
export function ResearchReportBody({
  report,
  generatedAt,
}: {
  report: ResearchReport;
  generatedAt: string | null;
}) {
  return (
    <div className="space-y-4 rounded border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Confidence</span>
          <span className="rounded bg-zinc-700/40 px-2 py-0.5 text-xs font-medium uppercase text-zinc-200">
            {report.confidence}
          </span>
        </span>
        {generatedAt ? <span className="text-xs text-zinc-500">{new Date(generatedAt).toLocaleString()}</span> : null}
      </div>

      <RatedRow label="Overall Offering Risk" section={report.overallOfferingRisk} />
      <RatedRow label="News / Why It's Running" section={report.newsWhyRunning} />
      <RatedRow label="Theme Match" section={report.themeMatch} />
      <RatedRow label="Chart History" section={report.chartHistory} />
      <RatedRow label="Dilution" section={report.dilution} />
      <RatedRow label="Offering Frequency" section={report.offeringFrequency} />
      <RatedRow label="Offering Ability" section={report.offeringAbility} />
      <RatedRow label="Cash Need" section={report.cashNeed} />

      {report.otherCatalysts.length > 0 ? (
        <div>
          <h5 className="mb-1 text-sm font-semibold text-zinc-200">Other Catalysts</h5>
          <ul className="space-y-1">
            {report.otherCatalysts.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-sm text-zinc-300">{c.catalyst}</span>
                <RatingDot rating={c.rating} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <div className="flex items-center gap-2">
          <h5 className="text-sm font-semibold text-zinc-200">Financial Commentary</h5>
          <RatingDot rating={report.financialCommentary.rating} />
        </div>
        <p className="mt-1 text-sm text-zinc-300">
          {report.financialCommentary.explanation}
          {report.financialCommentary.source === 'verbatim' ? (
            <span className="ml-1 text-xs text-zinc-500">(verbatim from filings)</span>
          ) : null}
        </p>
      </div>

      {report.jmt415Commentary ? (
        <div>
          <h5 className="mb-1 text-sm font-semibold text-zinc-200">JMT415 Commentary</h5>
          <p className="text-sm text-zinc-300">{report.jmt415Commentary}</p>
        </div>
      ) : null}

      {report.evidenceIds.length > 0 ? (
        <p className="text-xs text-zinc-500">Evidence: {report.evidenceIds.join(', ')}</p>
      ) : null}
    </div>
  );
}
