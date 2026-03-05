'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CandleData } from '@/components/trading/CandlestickChart';

type CandleDataOptions = {
  periodType?: string;
  period?: string;
  frequencyType?: string;
  frequency?: string;
  startDate?: string;
  endDate?: string;
};

type MarketDataResponse = {
  candles?: CandleData[];
  error?: string;
};

type CandleDataState = {
  candles: CandleData[];
  isLoading: boolean;
  error: string | null;
};

const candleDataCache = new Map<string, CandleData[]>();

function buildCacheKey(symbol: string, options: CandleDataOptions) {
  return [
    symbol.toUpperCase(),
    options.periodType ?? '',
    options.period ?? '',
    options.frequencyType ?? '',
    options.frequency ?? '',
    options.startDate ?? '',
    options.endDate ?? '',
  ].join('|');
}

function statusToMessage(status: number, fallback: string) {
  if (status === 401) return 'Authentication required';
  if (status === 404) return 'Unknown symbol';
  if (status === 429) return 'Rate limited by market data provider';
  return fallback;
}

export function useCandleData(symbol: string | null, options: CandleDataOptions = {}): CandleDataState {
  const periodType = options.periodType ?? 'day';
  const period = options.period ?? '1';
  const frequencyType = options.frequencyType ?? 'minute';
  const frequency = options.frequency ?? '5';
  const startDate = options.startDate;
  const endDate = options.endDate;

  const [state, setState] = useState<CandleDataState>({
    candles: [],
    isLoading: false,
    error: null,
  });
  const scheduleState = useCallback((next: CandleDataState) => {
    queueMicrotask(() => setState(next));
  }, []);

  useEffect(() => {
    if (!symbol) {
      scheduleState({ candles: [], isLoading: false, error: null });
      return;
    }

    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) {
      scheduleState({ candles: [], isLoading: false, error: null });
      return;
    }

    const cacheKey = buildCacheKey(cleanSymbol, {
      periodType,
      period,
      frequencyType,
      frequency,
      startDate,
      endDate,
    });
    const cached = candleDataCache.get(cacheKey);
    if (cached) {
      scheduleState({ candles: cached, isLoading: false, error: null });
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      symbol: cleanSymbol,
      periodType,
      period,
      frequencyType,
      frequency,
    });

    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    scheduleState({ candles: [], isLoading: true, error: null });

    void fetch(`/api/market-data?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as MarketDataResponse;
        if (!res.ok) {
          throw new Error(statusToMessage(res.status, payload.error ?? 'Could not fetch market data'));
        }

        const candles = payload.candles ?? [];
        candleDataCache.set(cacheKey, candles);
        setState({ candles, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Could not fetch market data';
        setState({ candles: [], isLoading: false, error: message });
      });

    return () => controller.abort();
  }, [
    symbol,
    periodType,
    period,
    frequencyType,
    frequency,
    startDate,
    endDate,
    scheduleState,
  ]);

  return state;
}
