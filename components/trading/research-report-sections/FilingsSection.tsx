'use client';

import { useState } from 'react';

import type { FilingBucket, ResearchSnapshotFiling } from '@/lib/types';

import { compareFiledAtDesc, FilingsRow } from './_shared';

interface Props {
  filings: ResearchSnapshotFiling[];
}

type FilingViewKey = 'all' | 'chronological' | FilingBucket;

const FILING_BUCKET_LABELS: Record<FilingBucket, string> = {
  financials: 'Financials',
  news: 'News',
  registrations: 'Registrations',
  prospectus: 'Prospectus',
  proxies: 'Proxies',
  ownerships: 'Ownerships',
  other: 'Other',
};

const FILING_TAB_OPTIONS: Array<{ key: FilingViewKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'chronological', label: 'Chronological' },
  { key: 'financials', label: 'Financials' },
  { key: 'news', label: 'News' },
  { key: 'registrations', label: 'Registrations' },
  { key: 'prospectus', label: 'Prospectus' },
  { key: 'proxies', label: 'Proxies' },
  { key: 'ownerships', label: 'Ownerships' },
  { key: 'other', label: 'Other' },
];

const FILING_ALL_BUCKETS: FilingBucket[] = [
  'financials',
  'news',
  'registrations',
  'prospectus',
  'proxies',
  'ownerships',
];

const FILING_TAB_BASE_CLASS = 'grid place-items-center rounded-sm px-2.5 py-1 text-sm transition-colors';
const FILING_TAB_ACTIVE_CLASS = 'bg-accent text-foreground';
const FILING_TAB_INACTIVE_CLASS = 'text-muted-foreground hover:bg-accent hover:text-foreground';
// Cap each card around 6 rows tall. Past that, the inner area scrolls with a
// thin scrollbar instead of paginating. 280px ≈ 6 rows + sticky header on
// typical row heights; the cards in the 2-col grid stay the same height even
// when their row counts differ.
const FILING_CARD_MAX_HEIGHT = 280;
const FILING_CARD_MAX_HEIGHT_EXPANDED = 560;

function BucketCard({ title, filings, maxHeight = FILING_CARD_MAX_HEIGHT }: { title: string; filings: ResearchSnapshotFiling[]; maxHeight?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card/70 px-3 py-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>

      {filings.length === 0 ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">No filings.</div>
      ) : (
        <div
          className="scrollbar-thin overflow-y-auto"
          style={{ maxHeight: `${maxHeight}px` }}
        >
          <table className="min-w-full">
            {/* Sticky needs to live on each <th>, not on <thead> or <tr> —
                most browsers ignore position:sticky on table-row-group /
                table-row. The bg must be fully opaque (bg-card, no alpha)
                so scrolled rows can't bleed through under the header.
                box-shadow stands in for a bottom border because table-cell
                borders collapse with the next row in default border-collapse
                tables, which made the divider disappear on scroll. */}
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left font-medium shadow-[inset_0_-1px_0_0_var(--border)]">Type</th>
                <th className="sticky top-0 z-10 bg-card px-3 py-2 text-center font-medium shadow-[inset_0_-1px_0_0_var(--border)]">Headline</th>
                <th className="sticky top-0 z-10 bg-card px-3 py-2 text-right font-medium shadow-[inset_0_-1px_0_0_var(--border)]">Filed At</th>
              </tr>
            </thead>
            <tbody>
              {filings.map((filing, index) => (
                <FilingsRow key={`${filing.accessionNumber ?? filing.title}-${index}`} filing={filing} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilingsView({ filings }: { filings: ResearchSnapshotFiling[] }) {
  const [bucket, setBucket] = useState<FilingViewKey>('all');
  const chronological = [...filings].sort(compareFiledAtDesc);

  const tabRow = (
    <div className="flex flex-wrap gap-1">
      {FILING_TAB_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => setBucket(option.key)}
          className={`${FILING_TAB_BASE_CLASS} ${bucket === option.key ? FILING_TAB_ACTIVE_CLASS : FILING_TAB_INACTIVE_CLASS}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  if (bucket === 'all') {
    return (
      <div className="space-y-4">
        {tabRow}
        {/* 2-col grid on lg+ mirrors the screenshot. Each card is independent
            so its pagination doesn't affect neighbors. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {FILING_ALL_BUCKETS.map((bucketKey) => (
            <BucketCard
              key={bucketKey}
              title={FILING_BUCKET_LABELS[bucketKey]}
              filings={chronological.filter((filing) => filing.bucket === bucketKey)}
            />
          ))}
        </div>
      </div>
    );
  }

  const filtered = bucket === 'chronological'
    ? chronological
    : chronological.filter((filing) => filing.bucket === bucket);
  const cardTitle = bucket === 'chronological' ? 'All Filings' : FILING_BUCKET_LABELS[bucket];

  return (
    <div className="space-y-4">
      {tabRow}
      <BucketCard title={cardTitle} filings={filtered} maxHeight={FILING_CARD_MAX_HEIGHT_EXPANDED} />
    </div>
  );
}

export default function FilingsSection({ filings }: Props) {
  return (
    <div className="p-3 text-sm">
      <FilingsView filings={filings} />
    </div>
  );
}
