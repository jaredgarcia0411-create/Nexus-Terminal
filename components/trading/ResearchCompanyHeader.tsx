'use client';

import type { ResearchSnapshotHeader } from '@/lib/types';

interface Props {
  ticker: string;
  companyName: string | null;
  header: ResearchSnapshotHeader;
  // When true, render only the ticker + company name. Used on tabs without a chart so the panel doesn't
  // sit alone with a wide stats column next to a blank space.
  compact?: boolean;
}

function formatCompact(value: unknown): string {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(num)) return 'N/A';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

function statRow(label: string, value: string) {
  return (
    <div className="flex justify-between gap-2">
      <span className="shrink-0 text-white">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  );
}

export default function ResearchCompanyHeader({ ticker, companyName, header, compact = false }: Props) {
  const marketCap = header.marketCap;
  const outstanding = header.outstandingShares;
  const float = header.float;
  const exchange = header.exchange;
  const ipoDate = header.ipoDate;
  const industry = header.industry;
  const country = header.country;

  return (
    <div className="flex h-full flex-col gap-3 border-r border-white/10 bg-[#0f0f11] px-4 py-3">
      {/* Ticker + Company Name */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-zinc-100">{ticker}</span>
          {country ? <span className="text-[11px] text-zinc-500">{String(country)}</span> : null}
        </div>
        {companyName ? (
          <p className="mt-0.5 text-base font-bold leading-snug text-zinc-200">{companyName}</p>
        ) : null}
      </div>

      {/* Company Stats — hidden on tabs without a chart so we don't render a tall stat column next to nothing. */}
      {!compact ? (
        <div className="flex flex-col gap-1 text-sm">
          {statRow('MCap', `$${formatCompact(marketCap)}`)}
          {statRow('OS', formatCompact(outstanding))}
          {statRow('Float', formatCompact(float))}
          {exchange ? statRow('Exchange', String(exchange)) : null}
          {ipoDate ? statRow('IPO', String(ipoDate)) : null}
          {industry ? statRow('Industry', String(industry)) : null}
        </div>
      ) : null}

    </div>
  );
}
