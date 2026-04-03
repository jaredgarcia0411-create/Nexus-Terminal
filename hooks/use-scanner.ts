'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScannerFilters, ScannerRow, ScannerSortDir, ScannerSortKey } from '@/lib/types';

export type { ScannerFilters, ScannerRow, ScannerSortDir, ScannerSortKey };

export type ScannerPreset = {
  id: string;
  name: string;
  filtersJson: ScannerFilters;
  createdAt: string;
  updatedAt: string;
};

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

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
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<ScannerPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  const sortByRef = useRef(sortBy);
  const sortDirRef = useRef(sortDir);
  const hasInitialFetchRef = useRef(false);

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
        setError(await getErrorMessage(response, `Scanner fetch failed (HTTP ${response.status})`));
        return;
      }
      const data = (await response.json()) as { results: ScannerRow[] };
      setResults(data.results);
      setError(null);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const response = await fetch('/api/scanner/presets');
      if (!response.ok) {
        setPresetsError(await getErrorMessage(response, `Scanner presets fetch failed (HTTP ${response.status})`));
        return;
      }
      const data = (await response.json()) as { presets: ScannerPreset[] };
      setPresets(data.presets);
      setPresetsError(null);
    } catch {
      setPresetsError('Network error');
    } finally {
      setPresetsLoading(false);
    }
  }, []);

  const savePreset = useCallback(
    async (name: string) => {
      try {
        const response = await fetch('/api/scanner/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, filters: filtersRef.current }),
        });
        if (!response.ok) {
          setPresetsError('Failed to save preset');
          return;
        }
        await fetchPresets();
      } catch {
        setPresetsError('Network error');
      }
    },
    [fetchPresets],
  );

  const deletePreset = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/scanner/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        setPresetsError('Failed to delete preset');
        return;
      }
      setPresets((previous) => previous.filter((preset) => preset.id !== id));
    } catch {
      setPresetsError('Network error');
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
    if (!hasInitialFetchRef.current) {
      hasInitialFetchRef.current = true;
      return;
    }
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
    error,
    presets,
    presetsLoading,
    presetsError,
    savePreset,
    deletePreset,
    loadPreset,
    clearFilters,
    fetchResults,
  };
}
