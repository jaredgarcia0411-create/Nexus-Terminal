'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

import { apiRequest } from '@/lib/trade-utils';
import type { SampleSetRow } from '@/lib/sample-set-csv';

export type BacktestListItem = {
  id: string;
  name: string;
  description: string | null;
  sampleSetId: string | null;
  sampleSetName: string | null;
  sampleSetExists: boolean;
  ownerId: string;
  ownerName: string | null;
  reviewCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  // Server-computed: the backtest *owner's* most recent saved review for this
  // backtest. Drives auto-load when the per-card Launch Chart is clicked, so
  // viewers see the author's latest work without having to pick from a list.
  recentOwnerReview: { id: string; ticker: string; date: string } | null;
};

export type SampleSetListItem = {
  id: string;
  name: string;
  rowCount: number;
  ownerId: string;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BacktestSortKey = 'updatedAt' | 'name';

type BacktestsResponse = {
  backtests: BacktestListItem[];
  currentUserId?: string | null;
  recentUncategorizedReview?: { id: string; ticker: string; date: string } | null;
};

type SampleSetsResponse = {
  sampleSets: SampleSetListItem[];
  currentUserId?: string | null;
};

type BacktestMutationPayload = {
  backtest: BacktestListItem;
};

type SampleSetMutationPayload = {
  sampleSet: SampleSetListItem;
};

function normalizeSessionUser(
  session: ReturnType<typeof useSession>['data'],
): { id?: string | null } | undefined {
  return session?.user as { id?: string | null } | undefined;
}

function compareNullableDates(a: string | null, b: string | null) {
  if (a && b) return Date.parse(b) - Date.parse(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

export function useBacktestManager() {
  const { data: session } = useSession();
  const sessionUserId = normalizeSessionUser(session)?.id ?? null;
  const [serverUserId, setServerUserId] = useState<string | null>(null);
  // Server-derived currentUserId is authoritative — `ensureUser` may remap the
  // session's JWT id to a canonical DB id when an email-collided record exists,
  // which would cause owner checks against `session.user.id` to silently fail.
  const currentUserId = serverUserId ?? sessionUserId;

  const [backtests, setBacktests] = useState<BacktestListItem[]>([]);
  const [sampleSets, setSampleSets] = useState<SampleSetListItem[]>([]);
  const [recentUncategorizedReview, setRecentUncategorizedReview] = useState<
    { id: string; ticker: string; date: string } | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backtestSearch, setBacktestSearch] = useState('');
  const [sampleSetSearch, setSampleSetSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [sortKey, setSortKey] = useState<BacktestSortKey>('updatedAt');

  const fetchLists = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [backtestsData, sampleSetsData] = await Promise.all([
        apiRequest<BacktestsResponse>('/api/backtests'),
        apiRequest<SampleSetsResponse>('/api/sample-sets'),
      ]);

      setBacktests(backtestsData.backtests ?? []);
      setSampleSets(sampleSetsData.sampleSets ?? []);
      setRecentUncategorizedReview(backtestsData.recentUncategorizedReview ?? null);
      const serverId = backtestsData.currentUserId ?? sampleSetsData.currentUserId ?? null;
      if (serverId) setServerUserId(serverId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load backtest manager');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLists();
  }, [fetchLists]);

  const refetch = useCallback(() => {
    void fetchLists();
  }, [fetchLists]);

  const filteredBacktests = useMemo(() => {
    const query = backtestSearch.trim().toLowerCase();

    const filtered = backtests.filter((item) => {
      if (mineOnly && currentUserId && item.ownerId !== currentUserId) return false;
      if (!query) return true;

      return [
        item.name,
        item.description ?? '',
        item.sampleSetName ?? '',
        item.ownerName ?? '',
      ].some((value) => value.toLowerCase().includes(query));
    });

    const regular = filtered.filter((item) => !item.id.startsWith('uncat-'));
    const uncategorized = filtered.filter((item) => item.id.startsWith('uncat-'));

    regular.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      return compareNullableDates(a.updatedAt, b.updatedAt);
    });

    return [...regular, ...uncategorized];
  }, [backtestSearch, backtests, currentUserId, mineOnly, sortKey]);

  const filteredSampleSets = useMemo(() => {
    const query = sampleSetSearch.trim().toLowerCase();
    if (!query) return sampleSets;

    return sampleSets.filter((item) =>
      [item.name, item.ownerName ?? ''].some((value) => value.toLowerCase().includes(query)),
    );
  }, [sampleSetSearch, sampleSets]);

  const createBacktest = useCallback(async (body: {
    name: string;
    description?: string;
    sampleSetId?: string;
  }) => {
    const payload = await apiRequest<BacktestMutationPayload>('/api/backtests', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await fetchLists();
    return payload.backtest;
  }, [fetchLists]);

  const updateBacktest = useCallback(async (id: string, body: {
    name?: string;
    description?: string | null;
    sampleSetId?: string | null;
  }) => {
    const payload = await apiRequest<BacktestMutationPayload>(`/api/backtests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    await fetchLists();
    return payload.backtest;
  }, [fetchLists]);

  const deleteBacktest = useCallback(async (id: string) => {
    await apiRequest<{ deleted: boolean; id: string }>(`/api/backtests/${id}`, {
      method: 'DELETE',
    });
    await fetchLists();
  }, [fetchLists]);

  const createSampleSet = useCallback(async (body: { name: string; rows: SampleSetRow[] }) => {
    const payload = await apiRequest<SampleSetMutationPayload>('/api/sample-sets', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await fetchLists();
    return payload.sampleSet;
  }, [fetchLists]);

  const deleteSampleSet = useCallback(async (id: string) => {
    await apiRequest<{ deleted: boolean; id: string }>(`/api/sample-sets/${id}`, {
      method: 'DELETE',
    });
    await fetchLists();
  }, [fetchLists]);

  const duplicateSampleSet = useCallback(async (id: string, name: string) => {
    const payload = await apiRequest<SampleSetMutationPayload>(`/api/sample-sets/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await fetchLists();
    return payload.sampleSet;
  }, [fetchLists]);

  return {
    backtests,
    sampleSets,
    recentUncategorizedReview,
    isLoading,
    error,
    refetch,
    backtestSearch,
    setBacktestSearch,
    sampleSetSearch,
    setSampleSetSearch,
    mineOnly,
    setMineOnly,
    sortKey,
    setSortKey,
    filteredBacktests,
    filteredSampleSets,
    currentUserId,
    createBacktest,
    updateBacktest,
    deleteBacktest,
    createSampleSet,
    deleteSampleSet,
    duplicateSampleSet,
  };
}
