'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScannerFilters, ScannerRow, ScannerSortDir, ScannerSortKey } from '@/hooks/use-scanner';

export function useMarketStream(options: {
  enabled: boolean;
  scannerFilters: ScannerFilters;
  scannerSortBy: ScannerSortKey;
  scannerSortDir: ScannerSortDir;
  onSnapshot: (data: unknown) => void;
  onScanner: (data: { results: ScannerRow[] }) => void;
  onError?: (error: string) => void;
}): { connected: boolean; fallbackToPolling: boolean } {
  const [connected, setConnected] = useState(false);
  const [fallbackToPolling, setFallbackToPolling] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const onSnapshotRef = useRef(options.onSnapshot);
  const onScannerRef = useRef(options.onScanner);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onSnapshotRef.current = options.onSnapshot;
    onScannerRef.current = options.onScanner;
    onErrorRef.current = options.onError;
  }, [options.onError, options.onScanner, options.onSnapshot]);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    const filters = options.scannerFilters;

    if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
    if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
    if (filters.minChangePercent !== undefined) params.set('minChangePercent', String(filters.minChangePercent));
    if (filters.maxChangePercent !== undefined) params.set('maxChangePercent', String(filters.maxChangePercent));
    if (filters.minVolume !== undefined) params.set('minVolume', String(filters.minVolume));
    if (filters.assetType) params.set('assetType', filters.assetType);

    params.set('sortBy', options.scannerSortBy);
    params.set('sortDir', options.scannerSortDir);

    return `/api/market-data/stream?${params.toString()}`;
  }, [options.scannerFilters, options.scannerSortBy, options.scannerSortDir]);

  useEffect(() => {
    if (!options.enabled) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    esRef.current?.close();

    const es = new EventSource(buildUrl());
    esRef.current = es;

    es.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        onSnapshotRef.current(payload);
        setConnected(true);
        setFallbackToPolling(false);
      } catch {
        // Ignore malformed events.
      }
    });

    es.addEventListener('scanner', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { results: ScannerRow[] };
        onScannerRef.current(payload);
      } catch {
        // Ignore malformed events.
      }
    });

    es.addEventListener('error', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
        if (payload.message) {
          onErrorRef.current?.(payload.message);
        }
      } catch {
        // Not every error event has JSON payload.
      }
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnected(false);
        setFallbackToPolling(true);
        onErrorRef.current?.('Realtime stream disconnected; falling back to polling.');
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
      setFallbackToPolling(false);
    };
  }, [buildUrl, options.enabled]);

  return { connected, fallbackToPolling };
}
