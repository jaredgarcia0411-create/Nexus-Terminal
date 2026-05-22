'use client';

import { DilutionRatingPanel } from '@/components/trading/DilutionRatingTile';
import {
  babyShelfBadge,
  formatDate,
  formatMoney,
  formatNumber,
  getWarrantStatus,
  toStringValue,
} from '@/lib/askedgar-utils';
import type {
  ResearchSnapshot,
  ResearchSnapshotConvertibleNote,
  ResearchSnapshotHistoricalFloatRow,
  ResearchSnapshotIdentityEvent,
  ResearchSnapshotOffering,
  ResearchSnapshotOwnershipGroup,
  ResearchSnapshotRegistration,
  ResearchSnapshotReverseSplit,
  ResearchSnapshotSplitStatus,
  ResearchSnapshotWarrant,
} from '@/lib/types';

import { FilingsTable, NoDataBadge } from './_shared';

interface Props {
  ticker: string;
  data: ResearchSnapshot;
}

function programStatusClass(statusLabel: string): string {
  if (/inactive|expired|terminated|unavailable/i.test(statusLabel)) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  if (/restricted|limited|baby shelf/i.test(statusLabel)) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  if (/active|effective|available/i.test(statusLabel)) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400';
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
            const statusLabel = row.status ?? (row.isEffective ? 'Active' : 'Inactive');
            const statusClass = programStatusClass(statusLabel);
            // ATM Remaining color tracks baby-shelf status: green when there's
            // still room to raise, red when over the limit. Matches scanner.
            const remainingColorClass = row.overBabyShelf ? 'text-rose-500' : 'text-emerald-400';
            return (
              <div key={`${title}-${index}`} className="py-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusClass}`}>
                    {statusLabel}
                  </span>
                  {row.documentUrl ? (
                    <a
                      href={row.documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-200 underline-offset-2 transition-colors hover:text-emerald-400 hover:underline"
                    >
                      {row.headline}
                    </a>
                  ) : (
                    <span className="text-zinc-200">{row.headline}</span>
                  )}
                  {badge ? <span className={`ml-auto text-sm font-semibold whitespace-nowrap ${badge.colorClass}`}>{badge.label}</span> : null}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div><span className="text-zinc-500">Total Registered:</span> <span className="text-zinc-200">{formatMoney(row.offeringAmount)}</span></div>
                  <div><span className="text-zinc-500">Raised So Far:</span> <span className="text-zinc-200">{formatMoney(row.totalRaised)}</span></div>
                  <div><span className="text-zinc-500">{remainingLabel}:</span> <span className={`font-semibold ${remainingColorClass}`}>{formatMoney(row.amountRemainingAtm)}</span></div>
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

function ConvertibleNotesSection({ notes }: { notes: ResearchSnapshotConvertibleNote[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-base font-medium text-zinc-300">Convertible Notes</h4>
      {notes.length === 0 ? (
        <p className="text-sm text-zinc-500">No convertible notes found</p>
      ) : (
        <div className="scrollbar-hidden overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="py-2 pr-3 text-left">Details</th>
                <th className="py-2 pr-3 text-left">Principal</th>
                <th className="py-2 pr-3 text-left">Conversion</th>
                <th className="py-2 pr-3 text-left">Maturity</th>
                <th className="py-2 pr-3 text-left">Filed</th>
                <th className="py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note, index) => (
                <tr key={`convertible-${index}`} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-zinc-300">
                    {note.documentUrl ? (
                      <a
                        href={note.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 transition-colors hover:text-emerald-400 hover:underline"
                      >
                        {note.details}
                      </a>
                    ) : (
                      note.details
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums text-zinc-200">{formatMoney(note.principalAmount)}</td>
                  <td className="py-2 pr-3 font-bold text-zinc-200">{formatMoney(note.conversionPrice)}</td>
                  <td className="py-2 pr-3 text-zinc-300">{formatDate(note.maturityDate)}</td>
                  <td className="py-2 pr-3 text-zinc-300">{formatDate(note.filedAt)}</td>
                  <td className="py-2 text-zinc-300">{toStringValue(note.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <h4 className="text-base font-medium text-zinc-300">{title}</h4>
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
                    <td className="py-2 pr-3 text-zinc-300">
                      {warrant.documentUrl ? (
                        <a
                          href={warrant.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 transition-colors hover:text-emerald-400 hover:underline"
                        >
                          {warrant.details}
                        </a>
                      ) : (
                        warrant.details
                      )}
                    </td>
                    <td className="py-2 pr-3 text-zinc-200">{formatNumber(warrant.remaining)}</td>
                    {/* Strike price color-tracks the warrant status (in play /
                        potentially / not) so the most actionable column reads
                        at a glance. */}
                    <td className={`py-2 pr-3 font-bold ${status.colorClass}`}>{formatMoney(priceValue)}</td>
                    <td className="py-2 pr-3 text-zinc-300">{toStringValue(warrant.registered)}</td>
                    <td className="py-2 pr-3 text-zinc-300">{formatDate(warrant.exercisableDate)}</td>
                    <td className="py-2 pr-3 text-zinc-300">{formatDate(warrant.expirationDate)}</td>
                    <td className={`py-2 font-bold whitespace-nowrap ${status.colorClass}`}>{status.label}</td>
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
            <th className="py-2 pr-3 text-left whitespace-nowrap">Baby Shelf</th>
            <th className="py-2 text-left">Filed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`registration-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">
                {row.documentUrl ? (
                  <a
                    href={row.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-200 underline-offset-2 transition-colors hover:text-emerald-400 hover:underline"
                  >
                    {row.headline}
                  </a>
                ) : (
                  row.headline
                )}
              </td>
              <td className="py-2 pr-3">{row.isAtm ? <span className="font-semibold text-emerald-400">Yes</span> : 'No'}</td>
              <td className="py-2 pr-3">{formatMoney(row.offeringAmount)}</td>
              <td className="py-2 pr-3">{formatMoney(row.amountRemainingAtm)}</td>
              <td className="py-2 pr-3">{row.overBabyShelf ? <span className="font-semibold text-rose-500">Over Limit</span> : 'OK'}</td>
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

function FormerSymbolsTable({ rows }: { rows: ResearchSnapshotIdentityEvent[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Former</th>
            <th className="py-2 pr-3 text-left">Current</th>
            <th className="py-2 pr-3 text-left">Effective</th>
            <th className="py-2 text-left">Filing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const formType = toStringValue(row.formType);
            return (
              <tr key={`${row.accessionNumber ?? row.previousTicker ?? 'symbol'}-${index}`} className="border-b border-white/5 text-zinc-300">
                <td className="py-2 pr-3 font-medium text-zinc-100">{toStringValue(row.previousTicker)}</td>
                <td className="py-2 pr-3">{toStringValue(row.currentTicker)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatDate(row.effectiveDate ?? row.filedAt)}</td>
                <td className="py-2">
                  {row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-200 underline-offset-2 transition-colors hover:text-emerald-400 hover:underline"
                    >
                      {formType}
                    </a>
                  ) : (
                    formType
                  )}
                </td>
              </tr>
            );
          })}
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

export default function DilutionSection({ data }: Props) {
  const atmRegistrations = data.registrations.filter((row) => row.isAtm === true);
  const regularWarrants = data.warrants.filter((row) => !row.isPrefunded);
  const prefundedWarrants = data.warrants.filter((row) => row.isPrefunded);
  const convertibleNotes = data.convertibleNotes ?? [];
  const formerSymbolEvents = data.identityEvents.filter((row) => row.previousTicker !== null);
  const equityLineKey = (row: ResearchSnapshotRegistration) => `${row.headline}::${row.filedAt ?? ''}`;
  const equityLineKeys = new Set(data.equityLines.map(equityLineKey));
  const primaryRegistrations = data.registrations.filter((row) => {
    if (equityLineKeys.has(equityLineKey(row))) return false;
    return row.formType?.startsWith('S-1') || row.formType?.startsWith('F-1');
  });
  const shelfRegistrations = data.registrations.filter((row) => {
    if (equityLineKeys.has(equityLineKey(row))) return false;
    return row.formType?.startsWith('S-3') || row.formType?.startsWith('F-3');
  });

  const hasCashPosition = [
    data.dilutionDetails.cashRemainingMonths,
    data.dilutionDetails.cashBurn,
    data.dilutionDetails.estimatedCash,
  ].some((value) => value !== null);

  return (
    <div className="space-y-6 p-3 text-sm">
      <DilutionRatingPanel data={data} />

      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">Cash Position</h4>
        {hasCashPosition ? (
          <p className="text-sm text-zinc-300">
            The company has <span className="font-bold text-zinc-100">{toStringValue(data.dilutionDetails.cashRemainingMonths)}</span> months of cash left
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

      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">Former Symbols</h4>
        <FormerSymbolsTable rows={formerSymbolEvents} />
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
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">S-1 / F-1</h4>
        {/* Source from registrations rather than filings so we catch
            primary registrations filed more than 90 days ago —
            getRecentFilings has a 90-day window, but S-1s/F-1s often
            stay effective for years. F-1 is the foreign-issuer
            equivalent of S-1; both create the same dilution risk so
            they share a bucket. */}
        <FilingsTable
          filings={primaryRegistrations.map((row) => ({
            formType: row.formType ?? 'S-1',
            bucket: 'registrations' as const,
            title: row.headline,
            filedAt: row.filedAt,
            url: row.documentUrl,
            accessionNumber: null,
          }))}
        />
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">Shelfs</h4>
        <ShelfRegistrationsTable rows={shelfRegistrations} />
      </div>

      <ProgramSection title="ATM Programs" rows={atmRegistrations} emptyLabel="No active ATM programs found" remainingLabel="ATM Remaining" />

      <ProgramSection title="Equity Lines" rows={data.equityLines} emptyLabel="No equity lines found" remainingLabel="Remaining" />

      <div className="space-y-3">
        <h4 className="mb-2 text-base font-semibold text-zinc-200">Warrants</h4>
        <WarrantSection title="Outstanding Warrants" warrants={regularWarrants} currentPrice={data.header.price} priceLabel="Strike" emptyLabel="No outstanding warrants found" />
        <WarrantSection title="Pre-funded Warrants" warrants={prefundedWarrants} currentPrice={data.header.price} priceLabel="Pre-funded Cost" emptyLabel="No pre-funded warrants found" />
      </div>

      <ConvertibleNotesSection notes={convertibleNotes} />

      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">Past Offerings</h4>
        <PastOfferingsTable rows={data.offerings} />
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">Historical Outstanding Shares</h4>
        <HistoricalFloatTable rows={data.historicalFloat} />
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-zinc-200">Owners</h4>
        <OwnershipGroupsTables groups={data.ownershipGroups} />
      </div>
    </div>
  );
}
