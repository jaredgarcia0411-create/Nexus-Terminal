'use client';

import { useEffect, useState } from 'react';

import { ResearchReportBody, type ResearchReport } from '@/components/trading/ResearchReportPanel';

interface Props {
  reportId: string;
}

interface ApiResponse {
  id: string;
  ticker: string;
  report: ResearchReport;
  generatedAt: string | null;
  modelUsed: string | null;
}

// Module-level cache. Reports are immutable once written, so once we've fetched
// a report by id it never needs to refetch within the session — repeated
// expand/collapse, multiple watchlist rows pointing at the same report id, etc.
const cache = new Map<string, { report: ResearchReport; generatedAt: string | null }>();

// Fetches a single report row by primary key and renders the rated-row body.
// Hits /api/research-report/by-id (no freshness filter) so old saved reports
// still resolve months later when the parent watchlist row is still around.
export default function WatchlistReportInline({ reportId }: Props) {
  const hit = cache.get(reportId);
  const [report, setReport] = useState<ResearchReport | null>(hit?.report ?? null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(hit?.generatedAt ?? null);
  const [loading, setLoading] = useState(!hit);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Cache hit was already applied at mount via useState initial values above —
    // no work to do for this reportId.
    if (cache.has(reportId)) return;

    let aborted = false;

    fetch(`/api/research-report/by-id?id=${encodeURIComponent(reportId)}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error('Report not found.');
          throw new Error(`Lookup failed: ${res.status}`);
        }
        const data = (await res.json()) as ApiResponse;
        if (aborted) return;
        cache.set(reportId, { report: data.report, generatedAt: data.generatedAt });
        setReport(data.report);
        setGeneratedAt(data.generatedAt);
      })
      .catch((err) => {
        if (aborted) return;
        setError(err instanceof Error ? err.message : 'Report unavailable.');
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });

    return () => {
      aborted = true;
    };
  }, [reportId]);

  if (loading) {
    return (
      <div className="rounded border border-border bg-accent px-4 py-6 text-center text-sm text-muted-foreground">
        Loading report…
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

  if (!report) return null;

  return <ResearchReportBody report={report} generatedAt={generatedAt} />;
}
