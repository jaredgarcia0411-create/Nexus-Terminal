'use client';

import { useEffect, useState } from 'react';
import type { ApiTrade, Execution } from '@/lib/types';
import { apiRequest, fromApiTrade } from '@/lib/trade-utils';

// Executions are dropped from the bulk GET /api/trades payload (Sprint 7), so
// replay charts fetch a single trade's executions on demand here. Results are
// cached at module scope (keyed by trade id) so timeframe toggles / re-renders
// don't refetch; in-flight requests are stored as promises so the chart hook
// and prefetchTradeExecutions() share one request per trade.
const executionsCache = new Map<string, Execution[]>();
const inFlight = new Map<string, Promise<Execution[]>>();

function loadExecutions(tradeId: string): Promise<Execution[]> {
  const cached = executionsCache.get(tradeId);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(tradeId);
  if (existing) return existing;

  const promise = apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`)
    .then((res) => {
      const executions = fromApiTrade(res.trade).rawExecutions;
      executionsCache.set(tradeId, executions);
      return executions;
    })
    .catch(() => [] as Execution[])
    .finally(() => {
      inFlight.delete(tradeId);
    });

  inFlight.set(tradeId, promise);
  return promise;
}

export function useTradeExecutions(tradeId: string, seeded: Execution[]): Execution[] {
  const hasSeed = seeded.length > 0;
  const [fetched, setFetched] = useState<Execution[] | null>(
    () => executionsCache.get(tradeId) ?? null,
  );

  useEffect(() => {
    if (hasSeed) return;
    let cancelled = false;
    void loadExecutions(tradeId).then((executions) => {
      if (!cancelled) setFetched(executions);
    });
    return () => {
      cancelled = true;
    };
  }, [tradeId, hasSeed]);

  if (hasSeed) return seeded;
  return fetched ?? [];
}

export async function prefetchTradeExecutions(tradeIds: string[]): Promise<void> {
  await Promise.all(tradeIds.map((tradeId) => loadExecutions(tradeId)));
}
