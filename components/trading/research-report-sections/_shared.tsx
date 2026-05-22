'use client';

import { useState } from 'react';

import { formatDate } from '@/lib/askedgar-utils';
import type { ResearchSnapshotFiling } from '@/lib/types';

export function NoDataBadge({ label = 'No data' }: { label?: string }) {
  return (
    <span className="inline-flex rounded-md border border-zinc-700 bg-card/60 px-2 py-1 text-sm text-muted-foreground">
      {label}
    </span>
  );
}

export function compareFiledAtDesc(a: { filedAt: string | null }, b: { filedAt: string | null }) {
  if (!a.filedAt && !b.filedAt) return 0;
  if (!a.filedAt) return 1;
  if (!b.filedAt) return -1;
  return b.filedAt.localeCompare(a.filedAt);
}

// Heuristic for "this headline needs a Show more toggle". 120 chars ≈ two
// comfortable lines at the table's typical width — anything longer would be
// clipped by line-clamp-2 anyway, so we only show the button when there's
// actually something hidden.
const FILING_HEADLINE_TRUNCATE_AT = 120;

export function FilingsRow({ filing }: { filing: ResearchSnapshotFiling }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = (filing.title?.length ?? 0) > FILING_HEADLINE_TRUNCATE_AT;
  const clamp = isLong && !expanded;

  const titleNode = filing.url ? (
    <a
      href={filing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
    >
      {filing.title}
    </a>
  ) : (
    <span className="text-foreground">{filing.title}</span>
  );

  return (
    <tr className="border-b border-border align-top text-muted-foreground">
      {/* whitespace-nowrap so form types like "20-F" never wrap to a second line */}
      <td className="px-3 py-2 align-top whitespace-nowrap font-bold text-foreground">
        {filing.formType}
      </td>
      <td className="px-3 py-2 text-center align-top">
        <div className={clamp ? 'line-clamp-2' : ''}>{titleNode}</div>
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {expanded ? 'Show less' : 'Show full headline'}
          </button>
        ) : null}
      </td>
      {/* text-right pushes the date to the right edge so it reads symmetric
          against the form-type column on the left and the card border. */}
      <td className="px-3 py-2 align-top whitespace-nowrap text-right">{formatDate(filing.filedAt)}</td>
    </tr>
  );
}

export function FilingsTable({ filings }: { filings: ResearchSnapshotFiling[] }) {
  if (filings.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-center">Headline</th>
            <th className="px-3 py-2 text-right">Filed At</th>
          </tr>
        </thead>
        <tbody>
          {filings.map((filing, index) => (
            <FilingsRow key={`${filing.accessionNumber ?? filing.title}-${index}`} filing={filing} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
