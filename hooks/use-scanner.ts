'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ScannerFilters = {
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minVolume?: number;
  assetType?: string;
};

export type ScannerSortKey = 'symbol' | 'lastPrice' | 'netChange' | 'netChangePercent' | 'totalVolume';
export type ScannerSortDir = 'asc' | 'desc';

export type ScannerRow = {
  symbol: string;
  assetType: string;
  lastPrice: number | null;
  netChange: number | null;
  netChangePercent: number | null;
  totalVolume: number | null;
  updatedAt: string;
};

export type ScannerPreset = {
  id: string;
  name: string;
  filtersJson: ScannerFilters;
  createdAt: string;
  updatedAt: string;
};

function buildQueryString(
  filters: ScannerFilters,
  sortBy: ScannerSortKey,
  sortDir: ScannerSortDir,
  limit: number,
): string {
  const params = new URLSearchParams();

  if (filters.minPrice !== undefined) {
    params.set('minPrice', String(filters.minPrice));
  }
  if (filters.maxPrice !== undefined) {
    params.set('maxPrice', String(filters.maxPrice));
  }
  if (filters.minChangePercent !== undefined) {
    params.set('minChangePercent', String(filters.minChangePercent));
  }
  if (filters.maxChangePercent !== undefined) {
    params.set('maxChangePercent', String(filters.maxChangePercent));
  }
  if (filters.minVolume !== undefined) {
    params.set('minVolume', String(filters.minVolume));
  }
  if (filters.assetType) {
    params.set('assetType', filters.assetType);
  }

  params.set('sortBy', sortBy);
  params.set('sortDir', sortDir);
  params.set('limit', String(limit));

  return params.toString();
}

export function useScanner(refreshIntervalMs: number) {
  const [filters, setFilters] = useState<ScannerFilters>({});
  const [sortBy, setSortBy] = useState<ScannerSortKey>('netChangePercent');
  const [sortDir, setSortDir] = useState<ScannerSortDir>('desc');
  const [results, setResults] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<ScannerPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const filtersRef = useRef(filters);
  const sortByRef = useRef(sortBy);
  const sortDirRef = useRef(sortDir);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    sortByRef.current = sortBy;
  }, [sortBy]);

  useEffect(() => {
    sortDirRef.current = sortDir;
  }, [sortDir]);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const queryString = buildQueryString(filtersRef.current, sortByRef.current, sortDirRef.current, 100);
      const response = await fetch(`/api/scanner?${queryString}`);
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { results: ScannerRow[] };
      setResults(data.results);
    } catch {
      // Silently fail and keep stale results visible.
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const response = await fetch('/api/scanner/presets');
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { presets: ScannerPreset[] };
      setPresets(data.presets);
    } catch {
      // Silently fail.
    } finally {
      setPresetsLoading(false);
    }
  }, []);

  const savePreset = useCallback(
    async (name: string) => {
      try {
        await fetch('/api/scanner/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, filters: filtersRef.current }),
        });
        await fetchPresets();
      } catch {
        // Silently fail.
      }
    },
    [fetchPresets],
  );

  const deletePreset = useCallback(async (id: string) => {
    try {
      await fetch(`/api/scanner/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setPresets((previous) => previous.filter((preset) => preset.id !== id));
    } catch {
      // Silently fail.
    }
  }, []);

  const loadPreset = useCallback((preset: ScannerPreset) => {
    setFilters(preset.filtersJson);
  }, []);

  const toggleSort = useCallback((column: ScannerSortKey) => {
    setSortBy((previous) => {
      if (previous === column) {
        setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'));
        return previous;
      }
      setSortDir('desc');
      return column;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  useEffect(() => {
    void fetchResults();
    void fetchPresets();
  }, [fetchResults, fetchPresets]);

  useEffect(() => {
    void fetchResults();
  }, [filters, sortBy, sortDir, fetchResults]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchResults();
    }, refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [refreshIntervalMs, fetchResults]);

  return {
    filters,
    setFilters,
    sortBy,
    sortDir,
    toggleSort,
    results,
    loading,
    presets,
    presetsLoading,
    savePreset,
    deletePreset,
    loadPreset,
    clearFilters,
    fetchResults,
  };
}
