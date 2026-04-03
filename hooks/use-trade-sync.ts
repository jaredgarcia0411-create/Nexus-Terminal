'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { ApiTrade, Trade } from '@/lib/types';
import { apiRequest, fromApiTrade, sortTradesByDate } from '@/lib/trade-utils';

export function useTradeSync() {
  const { data: session, status } = useSession();
  const user = session?.user as
    | { id?: string; name?: string | null; email?: string | null; image?: string | null }
    | undefined;

  const [trades, setTrades] = useState<Trade[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useLocalStorage, setUseLocalStorage] = useState(false);

  const sortTrades = sortTradesByDate;

  const refreshTrades = useCallback(async () => {
    if (useLocalStorage) return;
    const [tradesRes, tagsRes] = await Promise.all([
      apiRequest<{ trades: ApiTrade[] }>('/api/trades'),
      apiRequest<{ tags: string[] }>('/api/tags'),
    ]);

    setTrades(sortTrades(tradesRes.trades.map(fromApiTrade)));
    setGlobalTags(tagsRes.tags);
  }, [sortTrades, useLocalStorage]);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      setUseLocalStorage(false);
      setError('Authentication required');
      setMounted(true);
      return;
    }

    const loadRemote = async () => {
      try {
        if (!user?.id) {
          setUseLocalStorage(false);
          setError('Authentication required');
          return;
        }

        setUseLocalStorage(false);
        setError(null);

        await refreshTrades();
      } catch (loadError) {
        const isDbError =
          (loadError instanceof Error && loadError.message === 'Database not configured') ||
          (typeof loadError === 'object' && loadError !== null && (loadError as { status?: number }).status === 503);

        if (isDbError) {
          setError('Database not configured');
          return;
        }

        console.error(loadError);
        setUseLocalStorage(false);
        setError(loadError instanceof Error ? loadError.message : 'Could not load cloud data');
      } finally {
        setMounted(true);
      }
    };

    void loadRemote();
  }, [status, user?.id, refreshTrades]);

  return {
    status,
    user,
    trades,
    setTrades,
    globalTags,
    setGlobalTags,
    mounted,
    error,
    setError,
    useLocalStorage,
    setUseLocalStorage,
    refreshTrades,
  };
}
