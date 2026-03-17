'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { isDatabaseAvailable } from '@/lib/storage';
import {
  acquireMigrationLock,
  createMigrationBatchKey,
  isDatabaseUnavailableError,
  releaseMigrationLock,
} from '@/lib/trade-migration';
import type { ApiTrade, Trade } from '@/lib/types';
import { apiRequest, fromApiTrade, normalizeTrade, toApiTrade, type TradeLike } from './trade-utils';

const LOCAL_MIGRATION_LOCK_TTL_MS = 2 * 60 * 1000;

export function useTradeSync() {
  const { data: session, status } = useSession();
  const user = session?.user as
    | { id?: string; name?: string | null; email?: string | null; image?: string | null }
    | undefined;

  const [trades, setTrades] = useState<Trade[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useLocalStorage, setUseLocalStorage] = useState(true);

  const sortTrades = useCallback((list: Trade[]) => [...list].sort((a, b) => b.date.getTime() - a.date.getTime()), []);

  const loadLocal = useCallback(() => {
    const savedTrades = localStorage.getItem('nexus-trades');
    const savedTags = localStorage.getItem('nexus-tags');

    let nextTrades: Trade[] = [];
    let nextTags: string[] = [];

    if (savedTrades) {
      try {
        const parsed = JSON.parse(savedTrades) as TradeLike[];
        nextTrades = sortTrades(parsed.map((trade) => normalizeTrade(trade)));
      } catch (loadError) {
        console.error('Failed to load local trades', loadError);
      }
    }

    if (savedTags) {
      try {
        nextTags = JSON.parse(savedTags) as string[];
      } catch (loadError) {
        console.error('Failed to load local tags', loadError);
      }
    }

    setTrades(nextTrades);
    setGlobalTags(nextTags);
  }, [sortTrades]);

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
        const dbAvailable = await isDatabaseAvailable();

        if (!dbAvailable) {
          setUseLocalStorage(true);
          setError('Database not configured');
          loadLocal();
          return;
        }

        if (!user?.id) {
          setUseLocalStorage(false);
          setError('Authentication required');
          return;
        }

        setUseLocalStorage(false);
        setError(null);

        const localTradesRaw = localStorage.getItem('nexus-trades');
        const localTagsRaw = localStorage.getItem('nexus-tags');
        let localTrades: ApiTrade[] = [];
        let localTags: string[] = [];

        if (localTradesRaw) {
          try {
            localTrades = (JSON.parse(localTradesRaw) as TradeLike[]).map((trade) => toApiTrade(normalizeTrade(trade)));
          } catch (parseError) {
            console.error('Failed to parse local trades for migration', parseError);
          }
        }

        if (localTagsRaw) {
          try {
            localTags = JSON.parse(localTagsRaw) as string[];
          } catch (parseError) {
            console.error('Failed to parse local tags for migration', parseError);
          }
        }

        let migratedLocalData = false;
        if (localTrades.length > 0 || localTags.length > 0) {
          const migrationLockKey = `nexus-cloud-migration-lock:${user.id}`;
          const lockAcquired = acquireMigrationLock(localStorage, migrationLockKey, Date.now(), LOCAL_MIGRATION_LOCK_TTL_MS);

          if (lockAcquired) {
            try {
              if (localTrades.length > 0) {
                const batchKey = createMigrationBatchKey(user.id, localTrades, localTags);
                await apiRequest<{ trades: ApiTrade[]; importSkipped?: boolean }>('/api/trades/import', {
                  method: 'POST',
                  body: JSON.stringify({ trades: localTrades, batchKey }),
                });
              }

              if (localTags.length > 0) {
                await Promise.all(
                  localTags.map((tag) =>
                    apiRequest<{ tag: string }>('/api/tags', {
                      method: 'POST',
                      body: JSON.stringify({ name: tag }),
                    }),
                  ),
                );
              }

              localStorage.removeItem('nexus-trades');
              localStorage.removeItem('nexus-tags');
              migratedLocalData = true;
            } finally {
              releaseMigrationLock(localStorage, migrationLockKey);
            }
          }
        }

        await refreshTrades();

        if (migratedLocalData) {
          toast.success('Trades migrated to cloud');
        }
      } catch (loadError) {
        if (isDatabaseUnavailableError(loadError)) {
          setUseLocalStorage(true);
          setError('Database not configured');
          loadLocal();
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
  }, [status, user?.id, loadLocal, refreshTrades]);

  useEffect(() => {
    if (!mounted || !useLocalStorage) return;
    localStorage.setItem(
      'nexus-trades',
      JSON.stringify(
        trades.map((trade) => ({
          ...trade,
          date: new Date(trade.date).toISOString(),
        })),
      ),
    );
    localStorage.setItem('nexus-tags', JSON.stringify(globalTags));
  }, [mounted, useLocalStorage, trades, globalTags]);

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
