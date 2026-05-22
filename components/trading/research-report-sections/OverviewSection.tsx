'use client';

import { useState } from 'react';

import DilutionRatingTile from '@/components/trading/DilutionRatingTile';
import ResearchTldr from '@/components/trading/ResearchTldr';
import { formatDate, formatMoney, formatNumber } from '@/lib/askedgar-utils';
import type { ResearchSnapshot, ResearchSnapshotGapStat } from '@/lib/types';

import { NoDataBadge } from './_shared';

interface Props {
  ticker: string;
  data: ResearchSnapshot;
  onSelectGapDate?: (date: string) => void;
}

// Tags can stack to several pills per row, which made the table feel noisy.
// A click-to-reveal toggle keeps the column compact while still letting the
// user inspect the per-day catalysts on demand.
function GapStatTags({ tags }: { tags: string[] }) {
  const [open, setOpen] = useState(false);
  if (tags.length === 0) {
    return <span className="text-zinc-500">--</span>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="text-xs text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
      >
        {open ? 'Hide Tags' : `Show Tags (${tags.length})`}
      </button>
      {open ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-400">
          {tags.map((tag, index) => (
            <li key={`${tag}-${index}`}>{tag}</li>
          ))}
        </ul>
      ) : null}
    </div>
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
        {row.gapPercentage !== null ? `+${row.gapPercentage.toFixed(0)}%` : '--'}
      </td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.marketOpen)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.marketClose)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.intradayHigh)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.intradayLow)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatNumber(row.volume)}</td>
      <td className="py-2 text-zinc-400">
        <GapStatTags tags={row.tags} />
      </td>
    </tr>
  );
}

function computeCloseBelowOpenStats(rows: ResearchSnapshotGapStat[]) {
  const evaluableRows = rows.filter((row) => (
    row.marketOpen !== null
    && row.marketClose !== null
    && Number.isFinite(row.marketOpen)
    && Number.isFinite(row.marketClose)
  ));
  const closedBelowOpen = evaluableRows.filter((row) => (
    row.marketClose !== null
    && row.marketOpen !== null
    && row.marketClose < row.marketOpen
  )).length;

  return {
    closedBelowOpen,
    total: evaluableRows.length,
    percentage: evaluableRows.length > 0 ? (closedBelowOpen / evaluableRows.length) * 100 : null,
  };
}

function formatCompactPercent(value: number) {
  return Number.isInteger(value) ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
}

export default function OverviewSection({ ticker, data, onSelectGapDate }: Props) {
  const closeBelowOpenStats = computeCloseBelowOpenStats(data.gapStats);

  return (
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

      {/* No top border — section heading + parent space-y-5 carries the separation.
          Inner border-b under the title row still separates header from the table since
          gap-stat rows already have their own row dividers. */}
      <div className="pt-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/5 pb-2">
          <h4 className="text-lg font-semibold text-zinc-200">Gap Up Days</h4>
          <p className="text-sm text-zinc-500">
            Historical day-1 gap-ups only (excludes multi-day runs).
          </p>
          {closeBelowOpenStats.total > 0 && closeBelowOpenStats.percentage !== null ? (
            <p className="ml-auto font-bold text-zinc-400">
              Closed below open:{' '}
              <span className="text-zinc-200">
                {closeBelowOpenStats.closedBelowOpen}/{closeBelowOpenStats.total}
              </span>{' '}
              ({formatCompactPercent(closeBelowOpenStats.percentage)})
            </p>
          ) : null}
        </div>
        {data.gapStats.length > 0 ? (
          <div className="space-y-3 text-sm">
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
          </div>
        ) : (
          <NoDataBadge />
        )}
      </div>

    </div>
  );
}
