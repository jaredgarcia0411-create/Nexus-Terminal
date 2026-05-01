'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

import {
  computeAggregateStats,
  computeReviewStats,
  type AggregateStats,
  type ReviewWithStats,
  type SystemTickerForStats,
} from '@/lib/backtest-stats';
import {
  applyFilters,
  buildGradeFilters,
  buildSetupFilters,
  type FilterDef,
} from '@/lib/backtest-filters';
import { apiRequest } from '@/lib/trade-utils';
import type { BacktestAction, BacktestSession } from '@/lib/types';

type BacktestDetail = {
  id: string;
  name: string;
  description: string | null;
  sampleSetId: string | null;
  sampleSetName?: string | null;
  ownerId?: string;
  ownerName?: string | null;
  userId?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ReviewPayload = {
  session: BacktestSession;
  actions: BacktestAction[];
  systemTicker: SystemTickerForStats | null;
};

type BacktestDetailResponse = {
  backtest?: BacktestDetail;
  reviews?: ReviewPayload[];
};

function normalizeSessionUser(
  session: ReturnType<typeof useSession>['data'],
): { id?: string | null } | undefined {
  return session?.user as { id?: string | null } | undefined;
}

export function useBacktestStats(backtestId: string) {
  const { data: session } = useSession();
  const currentUserId = normalizeSessionUser(session)?.id ?? null;

  const [backtest, setBacktest] = useState<BacktestDetail | null>(null);
  const [reviewsWithStats, setReviewsWithStats] = useState<ReviewWithStats[]>([]);
  const [activeFilterIds, setActiveFilterIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBacktest = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await apiRequest<BacktestDetailResponse>(`/api/backtests/${backtestId}`);
      if (!payload.backtest) throw new Error('Backtest not found');

      const nextReviews = (payload.reviews ?? []).map((review) => ({
        session: review.session,
        actions: review.actions,
        systemTicker: review.systemTicker,
        stats: computeReviewStats(review.session, review.actions, review.systemTicker),
      }));

      setBacktest(payload.backtest);
      setReviewsWithStats(nextReviews);
    } catch (loadError) {
      setBacktest(null);
      setReviewsWithStats([]);
      setError(loadError instanceof Error ? loadError.message : 'Could not load backtest stats');
    } finally {
      setIsLoading(false);
    }
  }, [backtestId]);

  useEffect(() => {
    setActiveFilterIds(new Set());
    void fetchBacktest();
  }, [fetchBacktest]);

  const refetch = useCallback(() => {
    void fetchBacktest();
  }, [fetchBacktest]);

  const dynamicFilters = useMemo<FilterDef[]>(() => [
    ...buildGradeFilters(reviewsWithStats),
    ...buildSetupFilters(reviewsWithStats),
  ], [reviewsWithStats]);

  const filteredReviews = useMemo(
    () => applyFilters(reviewsWithStats, activeFilterIds, dynamicFilters),
    [activeFilterIds, dynamicFilters, reviewsWithStats],
  );

  const aggregateStats = useMemo<AggregateStats | null>(() => {
    if (!backtest) return null;
    return computeAggregateStats(filteredReviews);
  }, [backtest, filteredReviews]);

  const toggleFilter = useCallback((id: string) => {
    setActiveFilterIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    backtest,
    reviewsWithStats,
    filteredReviews,
    aggregateStats,
    activeFilterIds,
    toggleFilter,
    dynamicFilters,
    isLoading,
    error,
    refetch,
    currentUserId,
  };
}
