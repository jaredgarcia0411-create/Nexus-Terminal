'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { ApiTrade, Trade } from '@/lib/types';
import { apiRequest, fromApiTrade, sortTradesByDate } from '@/lib/trade-utils';

export function useTradeSync() {
  const { data: session, status } = useSession();
  const rawUser = session?.user;
  const user = (
    rawUser &&
    typeof rawUser === 'object' &&
    'id' in rawUser &&
    typeof (rawUser as Record<string, unknown>).id === 'string'
  ) ? (rawUser as { id: string; name?: string | null; email?: string | null; image?: string | null })
    : undefined;

  const [trades, setTrades] = useState<Trade[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const sortTrades = sortTradesByDate;

  const refreshTrades = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const [tradesRes, tagsRes] = await Promise.all([
        apiRequest<{ trades: ApiTrade[] }>('/api/trades'),
        apiRequest<{ tags: string[] }>('/api/tags'),
      ]);

      setTrades(sortTrades(tradesRes.trades.map(fromApiTrade)));
      setGlobalTags(tagsRes.tags);
    } finally {
      refreshInFlight.current = false;
    }
  }, [sortTrades]);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      setError('Authentication required');
      setMounted(true);
      return;
    }

    const loadRemote = async () => {
      try {
        if (!user?.id) {
          setError('Authentication required');
          return;
        }

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
    refreshTrades,
  };
}
