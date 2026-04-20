'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import DailyReportSheet from '@/components/trading/DailyReportSheet';
import WeeklyReviewSheet from '@/components/trading/WeeklyReviewSheet';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';

interface ArchiveTabProps {
  trades: Trade[];
}

type ReviewType = 'daily' | 'weekly';

interface AnyReview {
  id: string;
  type: ReviewType;
  dateLabel: string;
  date: string;
  weekEnd?: string;
  reportData: Record<string, unknown>;
  templateSnapshot: unknown[];
}

interface DailyReviewResponse {
  reviews?: Array<{
    id: string;
    date: string;
    reportData: Record<string, unknown>;
    templateSnapshot: unknown[];
  }>;
}

interface WeeklyReviewResponse {
  reviews?: Array<{
    id: string;
    weekStart: string;
    weekEnd: string;
    reportData: Record<string, unknown>;
    templateSnapshot: unknown[];
  }>;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function ninetyDaysAgo() {
  const date = new Date();
  date.setDate(date.getDate() - 90);
  return date.toISOString().slice(0, 10);
}

export default function ArchiveTab({ trades }: ArchiveTabProps) {
  const [reviews, setReviews] = useState<AnyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | ReviewType>('all');
  const [fromDate, setFromDate] = useState(ninetyDaysAgo());
  const [toDate, setToDate] = useState(todayStr());
  const [openReview, setOpenReview] = useState<AnyReview | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);

      try {
        const [dailyResponse, weeklyResponse] = await Promise.all([
          fetch(`/api/daily-reviews?from=${fromDate}&to=${toDate}`),
          fetch(`/api/weekly-reviews?from=${fromDate}&to=${toDate}`),
        ]);

        const [dailyResult, weeklyResult] = (await Promise.all([
          dailyResponse.json(),
          weeklyResponse.json(),
        ])) as [DailyReviewResponse, WeeklyReviewResponse];

        if (!active) return;

        const daily: AnyReview[] = (dailyResult.reviews ?? []).map((review) => ({
          id: review.id,
          type: 'daily',
          dateLabel: review.date,
          date: review.date,
          reportData: review.reportData,
          templateSnapshot: review.templateSnapshot,
        }));

        const weekly: AnyReview[] = (weeklyResult.reviews ?? []).map((review) => ({
          id: review.id,
          type: 'weekly',
          dateLabel: `${review.weekStart} – ${review.weekEnd}`,
          date: review.weekStart,
          weekEnd: review.weekEnd,
          reportData: review.reportData,
          templateSnapshot: review.templateSnapshot,
        }));

        setReviews([...daily, ...weekly].sort((left, right) => right.date.localeCompare(left.date)));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [fromDate, toDate]);

  const filteredReviews = useMemo(
    () => reviews.filter((review) => typeFilter === 'all' || review.type === typeFilter),
    [reviews, typeFilter],
  );

  const exportReview = (review: AnyReview) => {
    const json = JSON.stringify(review, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = review.type === 'daily' ? `drc-${review.date}.json` : `weekly-${review.date}.json`;
    anchor.click();

    URL.revokeObjectURL(url);
  };

  const deleteReview = async (review: AnyReview) => {
    if (!window.confirm(`Delete this ${review.type} review for ${review.dateLabel}? This cannot be undone.`)) {
      return;
    }

    const endpoint = review.type === 'daily' ? 'daily-reviews' : 'weekly-reviews';

    try {
      const response = await fetch(`/api/${endpoint}/${review.id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`Delete failed with status ${response.status}`);
      }
      setReviews((prev) => prev.filter((entry) => entry.id !== review.id));
    } catch (error) {
      console.error('Failed to delete review', error);
      window.alert('Failed to delete review. Please try again.');
    }
  };

  return (
    <motion.div
      key="archive"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-base text-zinc-400">Past daily and weekly reviews.</p>

        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as 'all' | ReviewType)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
        >
          <option value="all">All</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
          />
          <span className="text-zinc-500">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-zinc-500">Loading reviews…</div>
      ) : filteredReviews.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#121214] p-10 text-center text-sm text-zinc-500">
          No reviews in this range.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#121214]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Date / Range</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Grade</th>
                <th className="px-4 py-3">Net Result</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredReviews.map((review) => {
                const grade = typeof review.reportData.grade === 'string' ? review.reportData.grade : null;
                const netRaw = review.reportData.netResult;
                const net =
                  typeof netRaw === 'string'
                    ? netRaw
                    : typeof netRaw === 'number'
                      ? formatCurrency(netRaw)
                      : '—';

                return (
                  <tr
                    key={review.id}
                    className="cursor-pointer border-b border-white/5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
                    onClick={() => setOpenReview(review)}
                  >
                    <td className="px-4 py-3 font-mono text-zinc-200">{review.dateLabel}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          review.type === 'daily'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-blue-500/15 text-blue-400'
                        }`}
                      >
                        {review.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{grade ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-300">{net}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            exportReview(review);
                          }}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/10 hover:text-white"
                        >
                          Export
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteReview(review);
                          }}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openReview?.type === 'daily' ? (
        <DailyReportSheet
          open
          onOpenChange={(open) => {
            if (!open) setOpenReview(null);
          }}
          date={openReview.date}
          trades={trades}
          readOnly
        />
      ) : null}

      {openReview?.type === 'weekly' ? (
        <WeeklyReviewSheet
          open
          onOpenChange={(open) => {
            if (!open) setOpenReview(null);
          }}
          weekStart={openReview.date}
          weekEnd={openReview.weekEnd ?? openReview.date}
          trades={trades}
          readOnly
        />
      ) : null}
    </motion.div>
  );
}
