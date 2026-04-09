'use client';

import { useState } from 'react';

import {
  babyShelfBadge,
  detectFormType,
  formatDate,
  formatMoney,
  formatNumber,
  getWarrantStatus,
  riskClass,
  riskDotClass,
  toStringValue,
} from '@/lib/askedgar-utils';
import type {
  ResearchSnapshot,
  ResearchSnapshotGapStat,
  ResearchSnapshotRegistration,
  ResearchSnapshotWarrant,
} from '@/lib/types';

interface Props {
  ticker: string;
  data: ResearchSnapshot;
}

type TabKey = 'overview' | 'offering-ability' | 'dilution' | 'news-filings' | 'offerings' | 'history' | 'gap-stats';

function NoDataBadge({ label = 'No data' }: { label?: string }) {
  return (
    <span className="inline-flex rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-sm text-zinc-400">
      {label}
    </span>
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
  if (rows.length === 0) {
    return <p className="py-2 text-zinc-400">{emptyLabel}</p>;
  }

  return (
    <div className="divide-y divide-white/5">
      <h4 className="pb-2 font-medium text-white">{title}</h4>
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
        <div className="overflow-x-auto">
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

const TABS: Array<{ key: TabKey; label: string }> = [{ key: 'overview', label: 'Overview' }, { key: 'offering-ability', label: 'Offering Ability' }, { key: 'dilution', label: 'Dilution' }, { key: 'news-filings', label: 'News & Filings' }, { key: 'offerings', label: 'Offerings' }, { key: 'history', label: 'History' }, { key: 'gap-stats', label: 'Gap Stats' }];

function GapStatRow({ row }: { row: ResearchSnapshotGapStat }) {
  return (
    <tr className="border-b border-white/5">
      <td className="py-2 pr-3 text-zinc-300">{formatDate(row.date)}</td>
      <td className="py-2 pr-3 text-right font-medium text-emerald-400">
        {row.gapPercentage !== null ? `+${row.gapPercentage.toFixed(0)}%` : 'N/A'}
      </td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.marketOpen)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.marketClose)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.intradayHigh)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.intradayLow)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.vwap)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.premarketHigh)}</td>
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

export default function ResearchReportSections({ data }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const atmRegistrations = data.registrations.filter((row) => row.isAtm);
  const regularWarrants = data.warrants.filter((row) => !row.isPrefunded);
  const prefundedWarrants = data.warrants.filter((row) => row.isPrefunded);

  const ratings = [
    { label: 'Offering Ability', value: data.offeringAbilityRating },
    { label: 'Dilution', value: data.dilutionRating },
    { label: 'Offering Frequency', value: data.offeringFrequencyRating },
    { label: 'Cash Need', value: data.cashNeedRating },
    { label: 'Warrant Exercise', value: data.warrantExerciseRating },
    { label: 'Nasdaq Compliance', value: data.nasdaqCompliance },
  ];
  const hasRatings = ratings.some((item) => item.value);
  const hasCashPosition = [
    data.dilutionDetails.cashRemainingMonths,
    data.dilutionDetails.cashBurn,
    data.dilutionDetails.estimatedCash,
  ].some((value) => value !== null);
  const hasMarketStats = [
    data.header.price,
    data.header.marketCap,
    data.header.float,
    data.header.outstandingShares,
    data.header.shortInterest,
    data.header.volume,
  ].some((value) => value !== null);

  return (
    <section className="flex flex-col">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded px-2.5 py-1 text-sm transition-colors ${
                activeTab === tab.key ? 'bg-emerald-500 text-black' : 'text-white hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 text-base">
        {activeTab === 'overview' ? (
          <div className="space-y-5 divide-y divide-white/5">
            {hasRatings ? (
              <div>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ratings.map((item) => {
                    const colorClass = riskClass(item.value);
                    return (
                      <div key={item.label} className="flex items-center gap-2 py-1">
                        <span className="text-white">{item.label}</span>
                        <span className={`h-2 w-2 rounded-full ${riskDotClass(colorClass)}`} />
                        <span className={`rounded border px-2 py-0.5 text-sm font-medium ${colorClass}`}>
                          {toStringValue(item.value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <NoDataBadge />
            )}

            {hasCashPosition ? (
              <div className="pt-5">
                <h4 className="mb-2 text-lg font-semibold text-zinc-200">Cash Position</h4>
                <p className="text-zinc-300">
                  The company has ~<span className="font-bold text-zinc-100">{toStringValue(data.dilutionDetails.cashRemainingMonths)}</span> months of cash left
                  based on the quarterly cash burn of <span className="font-bold text-zinc-100">{formatMoney(data.dilutionDetails.cashBurn)}</span>
                  {' '}and estimated current cash of <span className="font-bold text-zinc-100">{formatMoney(data.dilutionDetails.estimatedCash)}</span>
                </p>
              </div>
            ) : null}

            {data.dilutionDetails.managementCommentary || data.dilutionDetails.cashNeedDescription ? (
              <div className="pt-5">
                <h4 className="mb-2 text-lg font-semibold text-zinc-200">Commentary on Financial Condition</h4>
                <div className="space-y-2">
                  {data.dilutionDetails.cashNeedDescription ? <p className="text-zinc-300">{data.dilutionDetails.cashNeedDescription}</p> : null}
                  {data.dilutionDetails.managementCommentary ? <p className="text-zinc-300">{data.dilutionDetails.managementCommentary}</p> : null}
                  {data.dilutionDetails.filedAt ? <p className="text-sm text-zinc-500">Filed At: {formatDate(data.dilutionDetails.filedAt)}</p> : null}
                </div>
              </div>
            ) : null}

            {data.ownershipGroups.length > 0 ? (
              <div className="pt-5">
                <h4 className="mb-2 text-lg font-semibold text-zinc-200">Ownership</h4>
                {data.ownershipGroups.map((group, groupIndex) => (
                  <div key={groupIndex} className="mb-3">
                    {group.reportedDate ? <p className="mb-1 text-sm text-zinc-500">Reported: {formatDate(group.reportedDate)}</p> : null}
                    <div className="overflow-x-auto">
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
              </div>
            ) : null}

            {hasMarketStats ? (
              <div className="pt-5">
                <h4 className="mb-2 text-sm font-medium uppercase tracking-wider text-zinc-500">Market Stats</h4>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Price</p><p className="text-sm text-zinc-200">{formatMoney(data.header.price)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Market Cap</p><p className="text-sm text-zinc-200">{formatMoney(data.header.marketCap)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Float</p><p className="text-sm text-zinc-200">{formatNumber(data.header.float)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">OS</p><p className="text-sm text-zinc-200">{formatNumber(data.header.outstandingShares)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Short Interest</p><p className="text-sm text-zinc-200">{formatNumber(data.header.shortInterest)}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Volume</p><p className="text-sm text-zinc-200">{formatNumber(data.header.volume)}</p></div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'offering-ability' ? (
          <div className="space-y-4">
            <ProgramSection title="ATM Programs" rows={atmRegistrations} emptyLabel="No active ATM programs found" remainingLabel="ATM Remaining" />

            <ProgramSection title="Equity Lines" rows={data.equityLines} emptyLabel="No equity lines found" remainingLabel="Remaining" />

            {data.registrations.length > 0 ? (
              <div className="space-y-2">
                <h4 className="font-medium text-zinc-300">Shelf Registrations</h4>
                <div className="overflow-x-auto">
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
                      {data.registrations.map((row, index) => (
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
              </div>
            ) : (
              <NoDataBadge />
            )}

            <div className="space-y-1">
              <h4 className="font-medium text-white">Management Commentary</h4>
              <p className="text-sm text-zinc-200">{toStringValue(data.dilutionDetails.managementCommentary)}</p>
            </div>
          </div>
        ) : null}

        {activeTab === 'dilution' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-1 text-sm ${riskClass(data.dilutionRating)}`}>
                {toStringValue(data.dilutionRating)}
              </span>
              <span className="text-zinc-400">Dilution Rating</span>
            </div>

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

            <WarrantSection title="Outstanding Warrants" warrants={regularWarrants} currentPrice={data.header.price} priceLabel="Strike" emptyLabel="No outstanding warrants found" />

            <WarrantSection title="Pre-funded Warrants" warrants={prefundedWarrants} currentPrice={data.header.price} priceLabel="Pre-funded Cost" emptyLabel="No pre-funded warrants found" />
          </div>
        ) : null}

        {activeTab === 'news-filings' ? (
          <div className="space-y-2">
            {data.news.map((item, index) => {
              const formType = item.formType ?? (item.isNews ? 'News' : 'Filing');
              const sourceClass = item.isNews
                ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                : formType.toLowerCase().includes('grok')
                  ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                  : 'border-orange-500/30 bg-orange-500/10 text-orange-300';

              return (
                <details key={`news-filing-${index}`} className="rounded border border-white/10 bg-white/5 p-2">
                  <summary className="cursor-pointer text-zinc-200">{item.title}</summary>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-sm ${sourceClass}`}>{formType}</span>
                      <span className="text-zinc-500">{formatDate(item.filedAt)}</span>
                    </div>
                    <p className="text-zinc-300">{item.summary || 'N/A'}</p>
                  </div>
                </details>
              );
            })}
            {data.news.length === 0 ? <NoDataBadge /> : null}
          </div>
        ) : null}

        {activeTab === 'offerings' ? (
          <div className="space-y-4">
            {data.offerings.length > 0 ? (
              <div className="space-y-2">
                <h4 className="font-medium text-zinc-300">Offerings</h4>
                <div className="overflow-x-auto">
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
                      {data.offerings.map((row, index) => (
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
              </div>
            ) : (
              <NoDataBadge />
            )}
          </div>
        ) : null}

        {activeTab === 'history' ? (
          <div className="space-y-3">
            {data.historicalFloat.length > 0 ? (
              <div className="overflow-x-auto">
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
                    {data.historicalFloat.map((row, index) => (
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
            ) : (
              <NoDataBadge />
            )}

            {data.reverseSplits.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400">
                      <th className="py-2 pr-3 text-left">Date</th>
                      <th className="py-2 text-left">Ratio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reverseSplits.map((row, index) => (
                      <tr key={`split-${index}`} className="border-b border-white/5 text-zinc-300">
                        <td className="py-2 pr-3">{formatDate(row.date)}</td>
                        <td className="py-2">{toStringValue(row.ratio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <NoDataBadge />
            )}

            {data.splitStatuses.length > 0 ? (
              <div className="space-y-2">
                <h4 className="font-medium text-zinc-300">Split Status</h4>
                <div className="overflow-x-auto">
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
                      {data.splitStatuses.map((row, index) => (
                        <tr key={`split-status-${index}`} className="border-b border-white/5 text-zinc-300">
                          <td className="py-2 pr-3">{toStringValue(row.actionType)}</td>
                          <td className="py-2 pr-3">
                            {row.splitFrom != null && row.splitTo != null
                              ? `${row.splitFrom}:${row.splitTo}`
                              : '—'}
                          </td>
                          <td className="py-2 pr-3">{formatDate(row.voteDate)}</td>
                          <td className="py-2 pr-3">{formatDate(row.effectiveDate)}</td>
                          <td className="py-2">{toStringValue(row.details)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {data.agreements.length > 0 ? (
              <div className="overflow-x-auto">
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
                    {data.agreements.map((row, index) => (
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
            ) : (
              <NoDataBadge />
            )}
          </div>
        ) : null}

        {activeTab === 'gap-stats' ? (
          <div className="space-y-3">
            {data.gapStats.length > 0 ? (
              <>
                <p className="text-sm text-zinc-500">
                  Historical day-1 gap-ups only (excludes multi-day runs). Most recent first.
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-white/10 text-zinc-400">
                        <th className="py-2 pr-3 text-left">Date</th>
                        <th className="py-2 pr-3 text-right">Gap %</th>
                        <th className="py-2 pr-3 text-right">Open</th>
                        <th className="py-2 pr-3 text-right">Close</th>
                        <th className="py-2 pr-3 text-right">High</th>
                        <th className="py-2 pr-3 text-right">Low</th>
                        <th className="py-2 pr-3 text-right">VWAP</th>
                        <th className="py-2 pr-3 text-right">PM High</th>
                        <th className="py-2 pr-3 text-right">Volume</th>
                        <th className="py-2 text-left">Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.gapStats.map((row, index) => (
                        <GapStatRow key={index} row={row} />
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
