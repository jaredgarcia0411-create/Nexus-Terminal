'use client';

import { useEffect, useState } from 'react';
import type { SplitEvent } from '@/lib/splits';
import { apiRequest } from '@/lib/trade-utils';

// Split history only changes when a company splits, so it's fetched once per
// ticker and cached at module scope for the session (timeframe toggles and
// reopening the same trade don't refetch). Failed requests are NOT cached, so
// the next chart open retries; until then markers stay at raw prices.
const splitsCache = new Map<string, SplitEvent[]>();
const inFlight = new Map<string, Promise<SplitEvent[]>>();
const NO_SPLITS: SplitEvent[] = [];

function loadSplits(symbol: string): Promise<SplitEvent[]> {
  const cached = splitsCache.get(symbol);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(symbol);
  if (existing) return existing;

  const promise = apiRequest<{ splits?: SplitEvent[] }>(`/api/splits?symbol=${encodeURIComponent(symbol)}`)
    .then((res) => {
      const splits = res.splits ?? [];
      splitsCache.set(symbol, splits);
      return splits;
    })
    .catch(() => NO_SPLITS)
    .finally(() => {
      inFlight.delete(symbol);
    });

  inFlight.set(symbol, promise);
  return promise;
}

export function useSplitHistory(symbol: string | null): SplitEvent[] {
  const key = symbol?.trim().toUpperCase() ?? '';
  const [loaded, setLoaded] = useState<{ symbol: string; splits: SplitEvent[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void loadSplits(key).then((splits) => {
      if (!cancelled) setLoaded({ symbol: key, splits });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return NO_SPLITS;
  if (loaded?.symbol === key) return loaded.splits;
  return splitsCache.get(key) ?? NO_SPLITS;
}
