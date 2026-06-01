'use client';

import { useState } from 'react';

import { LayoutGrid, TableProperties } from 'lucide-react';

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
  ResearchSnapshotHistoricalTicker,
  ResearchSnapshotOffering,
  ResearchSnapshotRegistration,
  ResearchSnapshotReverseSplit,
  ResearchSnapshotWarrant,
} from '@/lib/types';

import { FilingsTable, NoDataBadge } from './_shared';

interface Props {
  ticker: string;
  data: ResearchSnapshot;
}

function programStatusClass(statusLabel: string): string {
  if (/inactive|expired|terminated|unavailable/i.test(statusLabel)) return 'text-rose-300';
  if (/restricted|limited|baby shelf/i.test(statusLabel)) return 'text-amber-300';
  if (/active|effective|available/i.test(statusLabel)) return 'text-emerald-300';
  return 'text-muted-foreground';
}

const LAYOUT_STORAGE_KEY = 'nexus-research-dilution-layout';

function readLayoutMode(): 'table' | 'card' {
  if (typeof window === 'undefined') return 'table';
  try {
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return stored === 'card' ? 'card' : 'table';
  } catch {
    return 'table';
  }
}

function writeLayoutMode(mode: 'table' | 'card'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function shelfCardBorderClass(row: ResearchSnapshotRegistration): string {
  if (!row.isEffective) return 'border-l-zinc-500';
  if (row.overBabyShelf) return 'border-l-rose-500';
  return 'border-l-emerald-500';
}

function programCardBorderClass(statusLabel: string): string {
  if (/inactive|expired|terminated|unavailable/i.test(statusLabel)) return 'border-l-rose-500';
  if (/restricted|limited|baby shelf/i.test(statusLabel)) return 'border-l-amber-500';
  if (/active|effective|available/i.test(statusLabel)) return 'border-l-emerald-500';
  return 'border-l-zinc-500';
}

function warrantCardBorderClass(warrant: ResearchSnapshotWarrant, currentPrice: number | null): string {
  const status = getWarrantStatus(warrant, currentPrice);
  if (/in play$/i.test(status.label) && !/not/i.test(status.label)) return 'border-l-emerald-500';
  if (/potentially/i.test(status.label)) return 'border-l-amber-500';
  return 'border-l-rose-500';
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
      <h4 className="mb-2 text-base font-semibold text-foreground">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-2 text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((row, index) => {
            const badge = babyShelfBadge(row);
            // Show AskEdgar's registration status verbatim. When it's absent we
            // render no badge rather than inferring Active/Inactive — ATMs ride
            // on a parent shelf and don't carry their own effective_status, so
            // inferring it here was unreliable.
            const statusLabel = row.status;
            // ATM Remaining color tracks baby-shelf status: green when there's
            // still room to raise, red when over the limit. Matches scanner.
            const remainingColorClass = row.overBabyShelf ? 'text-rose-500' : 'text-emerald-400';
            return (
              <div key={`${title}-${index}`} className="py-2">
                <div className="flex items-center gap-2">
                  {statusLabel ? (
                    <span className={`text-xs font-medium whitespace-nowrap ${programStatusClass(statusLabel)}`}>
                      {statusLabel}
                    </span>
                  ) : null}
                  {row.documentUrl ? (
                    <a
                      href={row.documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
                    >
                      {row.headline}
                    </a>
                  ) : (
                    <span className="text-foreground">{row.headline}</span>
                  )}
                  {badge ? <span className={`ml-auto text-sm font-semibold whitespace-nowrap ${badge.colorClass}`}>{badge.label}</span> : null}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div><span className="text-muted-foreground">Total Registered:</span> <span className="text-foreground">{formatMoney(row.offeringAmount)}</span></div>
                  <div><span className="text-muted-foreground">Raised So Far:</span> <span className="text-foreground">{formatMoney(row.totalRaised)}</span></div>
                  <div><span className="text-muted-foreground">{remainingLabel}:</span> <span className={`font-semibold ${remainingColorClass}`}>{formatMoney(row.amountRemainingAtm)}</span></div>
                  {row.bank ? <div><span className="text-muted-foreground">Bank:</span> <span className="text-foreground">{row.bank}</span></div> : null}
                </div>
                <div className="mt-1 text-muted-foreground">Filed: {formatDate(row.filedAt)} | Expires: {formatDate(row.expirationDate)}</div>
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
      <h4 className="text-base font-medium text-foreground">Convertible Notes</h4>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No convertible notes found</p>
      ) : (
        <div className="scrollbar-hidden overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
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
                <tr key={`convertible-${index}`} className="border-b border-border">
                  <td className="py-2 pr-3 text-muted-foreground">
                    {note.documentUrl ? (
                      <a
                        href={note.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 transition-colors hover:text-primary hover:underline"
                      >
                        {note.details}
                      </a>
                    ) : (
                      note.details
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums text-foreground">{formatMoney(note.principalAmount)}</td>
                  <td className="py-2 pr-3 font-bold text-foreground">{formatMoney(note.conversionPrice)}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDate(note.maturityDate)}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDate(note.filedAt)}</td>
                  <td className="py-2 text-muted-foreground">{toStringValue(note.status)}</td>
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
      <h4 className="text-base font-medium text-foreground">{title}</h4>
      {warrants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="scrollbar-hidden overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
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
                  <tr key={`${title}-${index}`} className="border-b border-border">
                    <td className="py-2 pr-3 text-muted-foreground">
                      {warrant.documentUrl ? (
                        <a
                          href={warrant.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 transition-colors hover:text-primary hover:underline"
                        >
                          {warrant.details}
                        </a>
                      ) : (
                        warrant.details
                      )}
                    </td>
                    <td className="py-2 pr-3 text-foreground">{formatNumber(warrant.remaining)}</td>
                    {/* Strike price color-tracks the warrant status (in play /
                        potentially / not) so the most actionable column reads
                        at a glance. */}
                    <td className={`py-2 pr-3 font-bold ${status.colorClass}`}>{formatMoney(priceValue)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{toStringValue(warrant.registered)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatDate(warrant.exercisableDate)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatDate(warrant.expirationDate)}</td>
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
          <tr className="border-b border-border text-muted-foreground">
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
            <tr key={`registration-${index}`} className="border-b border-border text-muted-foreground">
              <td className="py-2 pr-3">
                {row.documentUrl ? (
                  <a
                    href={row.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
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
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 pr-3 text-left">Date</th>
            <th className="py-2 pr-3 text-left">Outstanding</th>
            <th className="py-2 pr-3 text-left">Float</th>
            <th className="py-2 text-left">Tradable Float</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`historical-${index}`} className="border-b border-border text-muted-foreground">
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
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 pr-3 text-left">Date</th>
            <th className="py-2 text-left">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`split-${index}`} className="border-b border-border text-muted-foreground">
              <td className="py-2 pr-3">{formatDate(row.date)}</td>
              <td className="py-2">{toStringValue(row.ratio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoricalTickersTable({ rows }: { rows: ResearchSnapshotHistoricalTicker[] }) {
  if (rows.length === 0) {
    return <NoDataBadge />;
  }

  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 pr-3 text-left">Former Ticker</th>
            <th className="py-2 text-left">Date Changed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.ticker}-${index}`} className="border-b border-border text-muted-foreground">
              <td className="py-2 pr-3 font-medium text-foreground">{row.ticker}</td>
              <td className="py-2">{formatDate(row.dateChanged)}</td>
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
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 pr-3 text-left">Date</th>
            <th className="py-2 pr-3 text-left">Type</th>
            <th className="py-2 pr-3 text-left">Shares</th>
            <th className="py-2 pr-3 text-left">Price</th>
            <th className="py-2 text-left">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`offering-${index}`} className="border-b border-border text-muted-foreground">
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

/* ── Card view variants ─────────────────────────────────────────── */

function S1CardView({ filings }: { filings: { formType: string; title: string; filedAt: string | null; url: string | null }[] }) {
  if (filings.length === 0) return <NoDataBadge />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {filings.map((filing, index) => (
        <div key={`s1-card-${index}`} className="rounded-lg border-l-4 border-l-zinc-500 bg-accent p-4">
          <h5 className="mb-3 font-semibold text-foreground">{filing.title}</h5>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Form Type</span>
              <span className="text-foreground">{filing.formType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Filed</span>
              <span className="text-foreground">{formatDate(filing.filedAt)}</span>
            </div>
          </div>
          {filing.url && (
            <div className="mt-3 text-right">
              <a href={filing.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View</a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ShelfCardView({ rows }: { rows: ResearchSnapshotRegistration[] }) {
  if (rows.length === 0) return <NoDataBadge />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row, index) => (
        <div key={`shelf-card-${index}`} className={`rounded-lg border-l-4 ${shelfCardBorderClass(row)} bg-accent p-4`}>
          <h5 className="mb-3 font-semibold text-foreground">{row.headline}</h5>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ATM</span>
              <span className={row.isAtm ? 'font-semibold text-emerald-400' : 'text-foreground'}>{row.isAtm ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="text-foreground">{formatMoney(row.offeringAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Remaining</span>
              <span className="text-foreground">{formatMoney(row.amountRemainingAtm)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Baby Shelf</span>
              <span className={row.overBabyShelf ? 'font-semibold text-rose-500' : 'text-foreground'}>{row.overBabyShelf ? 'Over Limit' : 'OK'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Filed</span>
              <span className="text-foreground">{formatDate(row.filedAt)}</span>
            </div>
          </div>
          {row.documentUrl && (
            <div className="mt-3 text-right">
              <a href={row.documentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View</a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProgramCardView({
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
      <h4 className="mb-2 text-base font-semibold text-foreground">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-2 text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, index) => {
            const badge = babyShelfBadge(row);
            // Display AskEdgar's status verbatim; no badge when it's absent.
            const statusLabel = row.status;
            const borderClass = programCardBorderClass(statusLabel ?? '');
            const remainingColorClass = row.overBabyShelf ? 'text-rose-500' : 'text-emerald-400';
            return (
              <div key={`${title}-card-${index}`} className={`rounded-lg border-l-4 ${borderClass} bg-accent p-4`}>
                <div className="mb-3 flex items-center gap-2">
                  {statusLabel ? (
                    <span className={`text-xs font-medium whitespace-nowrap ${programStatusClass(statusLabel)}`}>{statusLabel}</span>
                  ) : null}
                  {badge ? <span className={`text-sm font-semibold whitespace-nowrap ${badge.colorClass}`}>{badge.label}</span> : null}
                </div>
                <h5 className="mb-3 text-sm font-semibold text-foreground">{row.headline}</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Registered</span>
                    <span className="text-foreground">{formatMoney(row.offeringAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Raised So Far</span>
                    <span className="text-foreground">{formatMoney(row.totalRaised)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{remainingLabel}</span>
                    <span className={`font-semibold ${remainingColorClass}`}>{formatMoney(row.amountRemainingAtm)}</span>
                  </div>
                  {row.bank ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bank</span>
                      <span className="text-foreground">{row.bank}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Filed</span>
                    <span className="text-foreground">{formatDate(row.filedAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span className="text-foreground">{formatDate(row.expirationDate)}</span>
                  </div>
                </div>
                {row.documentUrl && (
                  <div className="mt-3 text-right">
                    <a href={row.documentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View</a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WarrantCardView({
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
      <h4 className="text-base font-medium text-foreground">{title}</h4>
      {warrants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {warrants.map((warrant, index) => {
            const status = getWarrantStatus(warrant, currentPrice);
            const priceValue = warrant.isPrefunded ? warrant.prefundedCost : warrant.exercisePrice;
            const borderClass = warrantCardBorderClass(warrant, currentPrice);
            return (
              <div key={`${title}-card-${index}`} className={`rounded-lg border-l-4 ${borderClass} bg-accent p-4`}>
                <h5 className="mb-3 text-sm font-semibold text-foreground">{warrant.details}</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Remaining</span>
                    <span className="text-foreground">{formatNumber(warrant.remaining)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{priceLabel}</span>
                    <span className={`font-bold ${status.colorClass}`}>{formatMoney(priceValue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Registered</span>
                    <span className="text-foreground">{toStringValue(warrant.registered)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exercisable</span>
                    <span className="text-foreground">{formatDate(warrant.exercisableDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span className="text-foreground">{formatDate(warrant.expirationDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`font-bold ${status.colorClass}`}>{status.label}</span>
                  </div>
                </div>
                {warrant.documentUrl && (
                  <div className="mt-3 text-right">
                    <a href={warrant.documentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View</a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConvertibleNotesCardView({ notes }: { notes: ResearchSnapshotConvertibleNote[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-base font-medium text-foreground">Convertible Notes</h4>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No convertible notes found</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note, index) => (
            <div key={`convertible-card-${index}`} className="rounded-lg border-l-4 border-l-zinc-500 bg-accent p-4">
              <h5 className="mb-3 text-sm font-semibold text-foreground">{note.details}</h5>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Principal</span>
                  <span className="font-mono tabular-nums text-foreground">{formatMoney(note.principalAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Conversion</span>
                  <span className="font-bold text-foreground">{formatMoney(note.conversionPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Maturity</span>
                  <span className="text-foreground">{formatDate(note.maturityDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Filed</span>
                  <span className="text-foreground">{formatDate(note.filedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-foreground">{toStringValue(note.status)}</span>
                </div>
              </div>
              {note.documentUrl && (
                <div className="mt-3 text-right">
                  <a href={note.documentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View</a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DilutionSection({ data }: Props) {
  const atmRegistrations = data.registrations.filter((row) => row.isAtm === true);
  const regularWarrants = data.warrants.filter((row) => !row.isPrefunded);
  const prefundedWarrants = data.warrants.filter((row) => row.isPrefunded);
  const convertibleNotes = data.convertibleNotes ?? [];
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

  const [layoutMode, setLayoutMode] = useState<'table' | 'card'>(readLayoutMode);

  function handleLayoutChange(mode: 'table' | 'card') {
    setLayoutMode(mode);
    writeLayoutMode(mode);
  }

  const s1Filings = primaryRegistrations.map((row) => ({
    formType: row.formType ?? 'S-1',
    bucket: 'registrations' as const,
    title: row.headline,
    filedAt: row.filedAt,
    url: row.documentUrl,
    accessionNumber: null,
  }));

  return (
    <div className="space-y-6 p-3 text-sm">
      <DilutionRatingPanel data={data} />

      <div>
        <h4 className="mb-2 text-base font-semibold text-foreground">Cash Position</h4>
        {hasCashPosition ? (
          <p className="text-sm text-muted-foreground">
            The company has <span className="font-bold text-foreground">{toStringValue(data.dilutionDetails.cashRemainingMonths)}</span> months of cash left
            based on the quarterly cash burn of <span className="font-bold text-foreground">{formatMoney(data.dilutionDetails.cashBurn)}</span>
            {' '}and estimated current cash of <span className="font-bold text-foreground">{formatMoney(data.dilutionDetails.estimatedCash)}</span>
          </p>
        ) : (
          <NoDataBadge />
        )}
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-foreground">Financial Commentary</h4>
        <p className="text-sm text-foreground">{toStringValue(data.dilutionDetails.managementCommentary)}</p>
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-foreground">Former Symbols</h4>
        <HistoricalTickersTable rows={data.historicalTickers} />
      </div>

      <div className="space-y-4">
        <h4 className="mb-2 text-base font-semibold text-foreground">Split History</h4>
        <ReverseSplitsTable rows={data.reverseSplits} />
      </div>

      {/* Table / Card toggle */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-accent p-1 w-fit">
        <button
          type="button"
          onClick={() => handleLayoutChange('table')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            layoutMode === 'table' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <TableProperties className="h-3.5 w-3.5" />
          Table
        </button>
        <button
          type="button"
          onClick={() => handleLayoutChange('card')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            layoutMode === 'card' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Card
        </button>
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-foreground">S-1 / F-1</h4>
        {layoutMode === 'card' ? (
          <S1CardView filings={s1Filings} />
        ) : (
          <FilingsTable filings={s1Filings} />
        )}
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-foreground">Shelfs</h4>
        {layoutMode === 'card' ? (
          <ShelfCardView rows={shelfRegistrations} />
        ) : (
          <ShelfRegistrationsTable rows={shelfRegistrations} />
        )}
      </div>

      {layoutMode === 'card' ? (
        <ProgramCardView title="ATM Programs" rows={atmRegistrations} emptyLabel="No active ATM programs found" remainingLabel="ATM Remaining" />
      ) : (
        <ProgramSection title="ATM Programs" rows={atmRegistrations} emptyLabel="No active ATM programs found" remainingLabel="ATM Remaining" />
      )}

      {layoutMode === 'card' ? (
        <ProgramCardView title="Equity Lines" rows={data.equityLines} emptyLabel="No equity lines found" remainingLabel="Remaining" />
      ) : (
        <ProgramSection title="Equity Lines" rows={data.equityLines} emptyLabel="No equity lines found" remainingLabel="Remaining" />
      )}

      <div className="space-y-3">
        <h4 className="mb-2 text-base font-semibold text-foreground">Warrants</h4>
        {layoutMode === 'card' ? (
          <>
            <WarrantCardView title="Outstanding Warrants" warrants={regularWarrants} currentPrice={data.header.price} priceLabel="Strike" emptyLabel="No outstanding warrants found" />
            <WarrantCardView title="Pre-funded Warrants" warrants={prefundedWarrants} currentPrice={data.header.price} priceLabel="Pre-funded Cost" emptyLabel="No pre-funded warrants found" />
          </>
        ) : (
          <>
            <WarrantSection title="Outstanding Warrants" warrants={regularWarrants} currentPrice={data.header.price} priceLabel="Strike" emptyLabel="No outstanding warrants found" />
            <WarrantSection title="Pre-funded Warrants" warrants={prefundedWarrants} currentPrice={data.header.price} priceLabel="Pre-funded Cost" emptyLabel="No pre-funded warrants found" />
          </>
        )}
      </div>

      {layoutMode === 'card' ? (
        <ConvertibleNotesCardView notes={convertibleNotes} />
      ) : (
        <ConvertibleNotesSection notes={convertibleNotes} />
      )}

      <div>
        <h4 className="mb-2 text-base font-semibold text-foreground">Past Offerings</h4>
        <PastOfferingsTable rows={data.offerings} />
      </div>

      <div>
        <h4 className="mb-2 text-base font-semibold text-foreground">Historical Outstanding Shares</h4>
        <HistoricalFloatTable rows={data.historicalFloat} />
      </div>

    </div>
  );
}
