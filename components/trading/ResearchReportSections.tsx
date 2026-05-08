'use client';

import { Maximize2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

import DilutionRatingTile, { DilutionRatingPanel } from '@/components/trading/DilutionRatingTile';
import ResearchReportPanel from '@/components/trading/ResearchReportPanel';
import ResearchTldr from '@/components/trading/ResearchTldr';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  babyShelfBadge,
  formatDate,
  formatMoney,
  formatNumber,
  getWarrantStatus,
  toStringValue,
} from '@/lib/askedgar-utils';
import type {
  FilingBucket,
  ResearchSnapshot,
  ResearchSnapshotAgreement,
  ResearchSnapshotFiling,
  ResearchSnapshotGapStat,
  ResearchSnapshotHistoricalFloatRow,
  ResearchSnapshotNewsItem,
  ResearchSnapshotOffering,
  ResearchSnapshotOwnershipGroup,
  ResearchSnapshotRegistration,
  ResearchSnapshotReverseSplit,
  ResearchSnapshotSplitStatus,
  ResearchSnapshotWarrant,
} from '@/lib/types';

interface Props {
  ticker: string;
  data: ResearchSnapshot;
  activeTab: TabKey;
  onSelectGapDate?: (date: string) => void;
}

type TabKey = 'overview' | 'dilution' | 'news' | 'filings' | 'gap-stats';
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

function NoDataBadge({ label = 'No data' }: { label?: string }) {
  return (
    <span className="inline-flex rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-sm text-zinc-400">
      {label}
    </span>
  );
}

function compareFiledAtDesc(a: { filedAt: string | null }, b: { filedAt: string | null }) {
  if (!a.filedAt && !b.filedAt) return 0;
  if (!a.filedAt) return 1;
  if (!b.filedAt) return -1;
  return b.filedAt.localeCompare(a.filedAt);
}

function NewsArticle({ item }: { item: ResearchSnapshotNewsItem }) {
  const [open, setOpen] = useState(false);
  const formType = item.formType ?? 'News';
  const isGrok = formType.toLowerCase().includes('grok');

  return (
    <div className="p-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full cursor-pointer text-left text-base font-bold text-zinc-200"
      >
        {item.title}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="mt-2 space-y-2"
          >
            <div className="flex items-center gap-2">
              {isGrok ? (
                <span className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-sm text-violet-300">
                  {formType}
                </span>
              ) : (
                <span className="text-sm text-white">{formType}</span>
              )}
              <span className="text-zinc-500">{formatDate(item.filedAt)}</span>
            </div>
            <p className="text-sm text-zinc-300">{item.summary || 'N/A'}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function FilingsTable({ filings }: { filings: ResearchSnapshotFiling[] }) {
  if (filings.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Type</th>
            <th className="py-2 pr-3 text-left">Headline</th>
            <th className="py-2 text-left">Filed At</th>
          </tr>
        </thead>
        <tbody>
          {filings.map((filing, index) => (
            <tr key={`${filing.accessionNumber ?? filing.title}-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">
                <span className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-sm text-white">
                  {filing.formType}
                </span>
              </td>
              <td className="py-2 pr-3">
                {filing.url ? (
                  <a
                    href={filing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-200 underline-offset-2 transition-colors hover:text-emerald-400 hover:underline"
                  >
                    {filing.title}
                  </a>
                ) : (
                  <span className="text-zinc-200">{filing.title}</span>
                )}
              </td>
              <td className="py-2">{formatDate(filing.filedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilingsView({ filings }: { filings: ResearchSnapshotFiling[] }) {
  const [bucket, setBucket] = useState<FilingViewKey>('all');
  const chronological = [...filings].sort(compareFiledAtDesc);

  if (bucket === 'all') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1">
          {FILING_TAB_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setBucket(option.key)}
              className={`rounded px-2.5 py-1 text-sm transition-colors ${
                bucket === option.key ? 'bg-emerald-500/10 text-emerald-500' : 'text-white hover:bg-white/10'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {FILING_ALL_BUCKETS.map((bucketKey) => (
          <div key={bucketKey} className="space-y-2">
            <h4 className="font-medium text-zinc-300">{FILING_BUCKET_LABELS[bucketKey]}</h4>
            <FilingsTable filings={chronological.filter((filing) => filing.bucket === bucketKey)} />
          </div>
        ))}
      </div>
    );
  }

  const filtered = bucket === 'chronological'
    ? chronological
    : chronological.filter((filing) => filing.bucket === bucket);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {FILING_TAB_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setBucket(option.key)}
            className={`rounded px-2.5 py-1 text-sm transition-colors ${
              bucket === option.key ? 'bg-emerald-500/10 text-emerald-500' : 'text-white hover:bg-white/10'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <FilingsTable filings={filtered} />
    </div>
  );
}

function ProgramSection({
  title,
  rows,
  emptyLabel,
  remainingLabel,
}: {
  title: string;
  rows: ResearchSnapshotRegistration[];
  emptyLabel: string;
  remainingLabel: string;
}) {
  return (
    <div>
      <h4 className="mb-2 text-base font-semibold text-zinc-200">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-2 text-zinc-400">{emptyLabel}</p>
      ) : (
        <div className="divide-y divide-white/5">
          {rows.map((row, index) => {
            const badge = babyShelfBadge(row);
            return (
              <div key={`${title}-${index}`} className="py-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${row.isEffective ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'}`}>
                    {row.isEffective ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-zinc-200">{row.headline}</span>
                  {badge ? <span className={`ml-auto rounded border px-2 py-0.5 text-sm font-medium whitespace-nowrap ${badge.colorClass}`}>{badge.label}</span> : null}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div><span className="text-zinc-500">Total Registered:</span> <span className="text-zinc-200">{formatMoney(row.offeringAmount)}</span></div>
                  <div><span className="text-zinc-500">Raised So Far:</span> <span className="text-zinc-200">{formatMoney(row.totalRaised)}</span></div>
                  <div><span className="text-zinc-500">{remainingLabel}:</span> <span className="font-medium text-amber-300">{formatMoney(row.amountRemainingAtm)}</span></div>
                  {row.bank ? <div><span className="text-zinc-500">Bank:</span> <span className="text-zinc-200">{row.bank}</span></div> : null}
                </div>
                <div className="mt-1 text-zinc-500">Filed: {formatDate(row.filedAt)} | Expires: {formatDate(row.expirationDate)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WarrantSection({
  title,
  warrants,
  currentPrice,
  priceLabel,
  emptyLabel,
}: {
  title: string;
  warrants: ResearchSnapshotWarrant[];
  currentPrice: number | null;
  priceLabel: string;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-zinc-300">{title}</h4>
      {warrants.length === 0 ? (
        <p className="text-sm text-zinc-500">{emptyLabel}</p>
      ) : (
        <div className="scrollbar-hidden overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="py-2 pr-3 text-left">Details</th>
                <th className="py-2 pr-3 text-left">Remaining</th>
                <th className="py-2 pr-3 text-left">{priceLabel}</th>
                <th className="py-2 pr-3 text-left">Registered</th>
                <th className="py-2 pr-3 text-left">Exercisable</th>
                <th className="py-2 pr-3 text-left">Expires</th>
                <th className="py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {warrants.map((warrant, index) => {
                const status = getWarrantStatus(warrant, currentPrice);
                const priceValue = warrant.isPrefunded ? warrant.prefundedCost : warrant.exercisePrice;
                return (
                  <tr key={`${title}-${index}`} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-zinc-300">{warrant.details}</td>
                    <td className="py-2 pr-3 text-zinc-200">{formatNumber(warrant.remaining)}</td>
                    <td className="py-2 pr-3 text-zinc-200">{formatMoney(priceValue)}</td>
                    <td className="py-2 pr-3 text-zinc-300">{toStringValue(warrant.registered)}</td>
                    <td className="py-2 pr-3 text-zinc-300">{formatDate(warrant.exercisableDate)}</td>
                    <td className="py-2 pr-3 text-zinc-300">{formatDate(warrant.expirationDate)}</td>
                    <td className="py-2"><span className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${status.colorClass}`}>{status.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ShelfRegistrationsTable({ rows }: { rows: ResearchSnapshotRegistration[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Headline</th>
            <th className="py-2 pr-3 text-left">ATM</th>
            <th className="py-2 pr-3 text-left">Amount</th>
            <th className="py-2 pr-3 text-left">Remaining</th>
            <th className="py-2 pr-3 text-left">Baby Shelf</th>
            <th className="py-2 text-left">Filed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`registration-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">{row.headline}</td>
              <td className="py-2 pr-3">{row.isAtm ? <span className="text-amber-300">Yes</span> : 'No'}</td>
              <td className="py-2 pr-3">{formatMoney(row.offeringAmount)}</td>
              <td className="py-2 pr-3">{formatMoney(row.amountRemainingAtm)}</td>
              <td className="py-2 pr-3">{row.overBabyShelf ? <span className="text-rose-300">Over Limit</span> : 'OK'}</td>
              <td className="py-2">{formatDate(row.filedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoricalFloatTable({ rows }: { rows: ResearchSnapshotHistoricalFloatRow[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Date</th>
            <th className="py-2 pr-3 text-left">Outstanding</th>
            <th className="py-2 pr-3 text-left">Float</th>
            <th className="py-2 text-left">Tradable Float</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`historical-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">{formatDate(row.date)}</td>
              <td className="py-2 pr-3">{formatNumber(row.outstanding)}</td>
              <td className="py-2 pr-3">{formatNumber(row.float)}</td>
              <td className="py-2">{formatNumber(row.tradableFloat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReverseSplitsTable({ rows }: { rows: ResearchSnapshotReverseSplit[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Date</th>
            <th className="py-2 text-left">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`split-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">{formatDate(row.date)}</td>
              <td className="py-2">{toStringValue(row.ratio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SplitStatusesTable({ rows }: { rows: ResearchSnapshotSplitStatus[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Status</th>
            <th className="py-2 pr-3 text-left">Ratio</th>
            <th className="py-2 pr-3 text-left">Vote Date</th>
            <th className="py-2 pr-3 text-left">Effective Date</th>
            <th className="py-2 text-left">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`split-status-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">{toStringValue(row.actionType)}</td>
              <td className="py-2 pr-3">
                {row.splitFrom != null && row.splitTo != null ? `${row.splitFrom}:${row.splitTo}` : '—'}
              </td>
              <td className="py-2 pr-3">{formatDate(row.voteDate)}</td>
              <td className="py-2 pr-3">{formatDate(row.effectiveDate)}</td>
              <td className="py-2">{toStringValue(row.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgreementsTable({ rows }: { rows: ResearchSnapshotAgreement[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Type</th>
            <th className="py-2 pr-3 text-left">Investor</th>
            <th className="py-2 pr-3 text-left">Date</th>
            <th className="py-2 text-left">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`agreement-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">{toStringValue(row.type)}</td>
              <td className="py-2 pr-3">{toStringValue(row.investor)}</td>
              <td className="py-2 pr-3">{formatDate(row.date)}</td>
              <td className="py-2">{toStringValue(row.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PastOfferingsTable({ rows }: { rows: ResearchSnapshotOffering[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Date</th>
            <th className="py-2 pr-3 text-left">Type</th>
            <th className="py-2 pr-3 text-left">Shares</th>
            <th className="py-2 pr-3 text-left">Price</th>
            <th className="py-2 text-left">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`offering-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">{formatDate(row.filedAt)}</td>
              <td className="py-2 pr-3">{toStringValue(row.offeringType)}</td>
              <td className="py-2 pr-3">{formatNumber(row.sharesAmount)}</td>
              <td className="py-2 pr-3">{formatMoney(row.sharePrice)}</td>
              <td className="py-2">{formatMoney(row.offeringAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OwnershipGroupsTables({ groups }: { groups: ResearchSnapshotOwnershipGroup[] }) {
  if (groups.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="mb-3">
          {group.reportedDate ? <p className="mb-1 text-sm text-zinc-500">Reported: {formatDate(group.reportedDate)}</p> : null}
          <div className="scrollbar-hidden overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-white/10 text-zinc-400">
                  <th className="py-1.5 pr-3 text-left text-sm">Name</th>
                  <th className="py-1.5 pr-3 text-left text-sm">Role</th>
                  <th className="py-1.5 pr-3 text-right text-sm">Common</th>
                  <th className="py-1.5 pr-3 text-right text-sm">Preferred</th>
                  <th className="py-1.5 pr-3 text-right text-sm">Options</th>
                  <th className="py-1.5 text-right text-sm">Warrants</th>
                </tr>
              </thead>
              <tbody>
                {group.owners.map((owner, ownerIndex) => (
                  <tr key={ownerIndex} className="border-b border-white/5">
                    <td className="py-1.5 pr-3 text-sm text-zinc-200">{owner.name}</td>
                    <td className="py-1.5 pr-3 text-sm text-zinc-400">{owner.role}</td>
                    <td className="py-1.5 pr-3 text-right text-sm text-zinc-300">{formatNumber(owner.common)}</td>
                    <td className="py-1.5 pr-3 text-right text-sm text-zinc-300">{formatNumber(owner.preferred)}</td>
                    <td className="py-1.5 pr-3 text-right text-sm text-zinc-300">{formatNumber(owner.options)}</td>
                    <td className="py-1.5 text-right text-sm text-zinc-300">{formatNumber(owner.warrants)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

function GapStatRow({ row, onSelectDate }: { row: ResearchSnapshotGapStat; onSelectDate?: (date: string) => void }) {
  // Date upstream is YYYY-MM-DD (verified in __tests__/askedgar-client.test.ts).
  // Pass it straight through; ResearchChart will hand it to buildTradeChartOptions.
  const canSelect = Boolean(row.date && onSelectDate);
  return (
    <tr className="border-b border-white/5">
      <td className="py-2 pr-3 text-zinc-300">
        {canSelect ? (
          <button
            type="button"
            onClick={() => row.date && onSelectDate?.(row.date)}
            className="text-zinc-300 underline-offset-2 transition-colors hover:text-emerald-400 hover:underline"
            title="View 5m chart for this date"
          >
            {formatDate(row.date)}
          </button>
        ) : (
          formatDate(row.date)
        )}
      </td>
      <td className="py-2 pr-3 text-right font-medium text-emerald-400">
        {row.gapPercentage !== null ? `+${row.gapPercentage.toFixed(0)}%` : 'N/A'}
      </td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.marketOpen)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.marketClose)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.intradayHigh)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.intradayLow)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatNumber(row.volume)}</td>
      <td className="py-2 text-zinc-400">
        {row.tags.length === 0 ? '--' : (
          <div className="flex flex-wrap gap-1">
            {row.tags.map((tag, index) => (
              <span key={`${tag}-${index}`} className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-xs text-zinc-400">
                {tag}
              </span>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function ResearchReportSections({ ticker, data, activeTab, onSelectGapDate }: Props) {
  const [reportExpanded, setReportExpanded] = useState(false);
  const atmRegistrations = data.registrations.filter((row) => row.isAtm === true);
  const regularWarrants = data.warrants.filter((row) => !row.isPrefunded);
  const prefundedWarrants = data.warrants.filter((row) => row.isPrefunded);

  const hasCashPosition = [
    data.dilutionDetails.cashRemainingMonths,
    data.dilutionDetails.cashBurn,
    data.dilutionDetails.estimatedCash,
  ].some((value) => value !== null);

  return (
    <section className="flex flex-col">
      <div className="text-base">
        {activeTab === 'overview' ? (
          <div className="space-y-5 p-3">
            <div className="flex gap-4">
              <div className="min-w-0 flex-1">
                <ResearchTldr key={ticker} ticker={ticker} />
              </div>
              <div className="w-64 shrink-0">
                <DilutionRatingTile
                  offeringAbilityRating={data.offeringAbilityRating}
                  offeringFrequencyRating={data.offeringFrequencyRating}
                  dilutionRating={data.dilutionRating}
                  cashNeedRating={data.cashNeedRating}
                  overallRisk={data.overallRisk}
                  warrantExerciseRating={data.warrantExerciseRating}
                  nasdaqCompliance={data.nasdaqCompliance}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-lg font-semibold text-zinc-200">Research Report</h4>
                <button
                  type="button"
                  onClick={() => setReportExpanded(true)}
                  aria-label="Expand research report"
                  title="Expand"
                  className="rounded p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
              <ResearchReportPanel ticker={ticker} />
            </div>

            {/* Same panel rendered inside a Dialog when expanded. ResearchReportPanel's
                module-level cache means the dialog instance gets the same report data
                immediately — no refetch. */}
            <Dialog open={reportExpanded} onOpenChange={setReportExpanded}>
              <DialogContent className="scrollbar-hidden max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Research Report — {ticker}</DialogTitle>
                </DialogHeader>
                <ResearchReportPanel ticker={ticker} />
              </DialogContent>
            </Dialog>
          </div>
        ) : null}

        {activeTab === 'dilution' ? (
          <div className="space-y-6 p-3">
            <DilutionRatingPanel data={data} />

            <div>
              <h4 className="mb-2 text-base font-bold text-zinc-200">Offering Risks</h4>
              {[
                data.dilutionDetails.warrantInfo,
                data.dilutionDetails.convertibles,
                data.dilutionDetails.authorizedShares,
                data.dilutionDetails.sharesAvailable,
              ].some((value) => value !== null) ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Warrants</p><p className="text-zinc-200">{toStringValue(data.dilutionDetails.warrantInfo)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Convertibles</p><p className="text-zinc-200">{toStringValue(data.dilutionDetails.convertibles)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Auth Shares</p><p className="text-zinc-200">{formatNumber(data.dilutionDetails.authorizedShares)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Available</p><p className="text-zinc-200">{formatNumber(data.dilutionDetails.sharesAvailable)}</p></div>
                </div>
              ) : (
                <NoDataBadge />
              )}
            </div>

            <div>
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Cash Position</h4>
              {hasCashPosition ? (
                <p className="text-sm text-zinc-300">
                  The company has ~<span className="font-bold text-zinc-100">{toStringValue(data.dilutionDetails.cashRemainingMonths)}</span> months of cash left
                  based on the quarterly cash burn of <span className="font-bold text-zinc-100">{formatMoney(data.dilutionDetails.cashBurn)}</span>
                  {' '}and estimated current cash of <span className="font-bold text-zinc-100">{formatMoney(data.dilutionDetails.estimatedCash)}</span>
                </p>
              ) : (
                <NoDataBadge />
              )}
            </div>

            <div>
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Financial Commentary</h4>
              <p className="text-sm text-zinc-200">{toStringValue(data.dilutionDetails.managementCommentary)}</p>
            </div>

            <div className="space-y-4">
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Split History</h4>
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-zinc-300">Reverse Splits</h5>
                <ReverseSplitsTable rows={data.reverseSplits} />
              </div>
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-zinc-300">Split Status</h5>
                <SplitStatusesTable rows={data.splitStatuses} />
              </div>
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-zinc-300">Agreements</h5>
                <AgreementsTable rows={data.agreements} />
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-base font-semibold text-zinc-200">S-1&apos;s</h4>
              {/* Source from registrations rather than filings so we catch S-1s
                  filed more than 90 days ago — getRecentFilings has a 90-day
                  window, but S-1s often stay effective for years. Same source
                  the scanner's hasS1 column uses. */}
              <FilingsTable
                filings={data.registrations
                  .filter((row) => row.formType?.startsWith('S-1') ?? false)
                  .map((row) => ({
                    formType: row.formType ?? 'S-1',
                    bucket: 'registrations' as const,
                    title: row.headline,
                    filedAt: row.filedAt,
                    url: null,
                    accessionNumber: null,
                  }))}
              />
            </div>

            <div>
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Shelfs</h4>
              <ShelfRegistrationsTable rows={data.registrations} />
            </div>

            <ProgramSection title="ATM Programs" rows={atmRegistrations} emptyLabel="No active ATM programs found" remainingLabel="ATM Remaining" />

            <ProgramSection title="Equity Lines" rows={data.equityLines} emptyLabel="No equity lines found" remainingLabel="Remaining" />

            <div className="space-y-3">
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Warrants</h4>
              <WarrantSection title="Outstanding Warrants" warrants={regularWarrants} currentPrice={data.header.price} priceLabel="Strike" emptyLabel="No outstanding warrants found" />
              <WarrantSection title="Pre-funded Warrants" warrants={prefundedWarrants} currentPrice={data.header.price} priceLabel="Pre-funded Cost" emptyLabel="No pre-funded warrants found" />
            </div>

            <div>
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Past Offerings</h4>
              <PastOfferingsTable rows={data.offerings} />
            </div>

            <div>
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Historical Float</h4>
              <HistoricalFloatTable rows={data.historicalFloat} />
            </div>

            <div>
              <h4 className="mb-2 text-base font-semibold text-zinc-200">Owners</h4>
              <OwnershipGroupsTables groups={data.ownershipGroups} />
            </div>
          </div>
        ) : null}

        {activeTab === 'news' ? (
          <div className="divide-y divide-white/5 p-3">
            {data.news.map((item, index) => (
              <NewsArticle key={`news-filing-${index}`} item={item} />
            ))}
            {data.news.length === 0 ? <NoDataBadge /> : null}
          </div>
        ) : null}

        {activeTab === 'filings' ? (
          <div className="p-3">
            <FilingsView filings={data.filings} />
          </div>
        ) : null}

        {activeTab === 'gap-stats' ? (
          <div className="space-y-3 p-3">
            {data.gapStats.length > 0 ? (
              <>
                <p className="text-sm text-zinc-500">
                  Historical day-1 gap-ups only (excludes multi-day runs). Most recent first.
                </p>
                <div className="scrollbar-hidden overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-white/10 text-zinc-400">
                        <th className="py-2 pr-3 text-left">Date</th>
                        <th className="py-2 pr-3 text-right">Gap %</th>
                        <th className="py-2 pr-3 text-right">Open</th>
                        <th className="py-2 pr-3 text-right">Close</th>
                        <th className="py-2 pr-3 text-right">High</th>
                        <th className="py-2 pr-3 text-right">Low</th>
                        <th className="py-2 pr-3 text-right">Volume</th>
                        <th className="py-2 text-left">Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.gapStats.map((row, index) => (
                        <GapStatRow key={index} row={row} onSelectDate={onSelectGapDate} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <NoDataBadge />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
