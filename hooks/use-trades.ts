'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { isAfter, isWithinInterval, parseISO, subDays } from 'date-fns';
import Papa from 'papaparse';
import { toast } from 'sonner';
import type { Trade } from '@/lib/types';
import { parseDateFromFilename, processCsvData } from '@/lib/csv-parser';
import { isDatabaseAvailable } from '@/lib/storage';
import { useSession } from 'next-auth/react';

type ApiTrade = Omit<Trade, 'date'> & { date: string };

const toApiTrade = (trade: Trade): ApiTrade => ({
  ...trade,
  date: new Date(trade.date).toISOString(),
});

const fromApiTrade = (trade: ApiTrade): Trade => ({
  ...trade,
  date: new Date(trade.date),
  tags: trade.tags ?? [],
});

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
}

export function useTrades() {
  const { data: session, status } = useSession();
  const user = session?.user as
    | { id?: string; name?: string | null; email?: string | null; image?: string | null }
    | undefined;

  const [trades, setTrades] = useState<Trade[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useLocalStorage, setUseLocalStorage] = useState(true);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [riskInput, setRiskInput] = useState('');
  const [filterPreset, setFilterPreset] = useState<'all' | '30' | '60' | '90'>('all');
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const sortTrades = (list: Trade[]) => [...list].sort((a, b) => b.date.getTime() - a.date.getTime());

  const filteredTrades = useMemo(
    () =>
      sortTrades(
        trades.filter((trade) => {
          if (searchQuery && !trade.symbol.toLowerCase().includes(searchQuery.toLowerCase())) return false;

          if (startDate || endDate) {
            const tradeDate = new Date(trade.date);
            const start = startDate ? parseISO(startDate) : new Date(0);
            const end = endDate ? parseISO(endDate) : new Date(8640000000000000);
            if (!isWithinInterval(tradeDate, { start, end })) return false;
          }

          if (filterPreset !== 'all') {
            const days = Number(filterPreset);
            const cutoff = subDays(new Date(), days);
            if (!isAfter(new Date(trade.date), cutoff)) return false;
          }

          if (selectedFilterTags.size > 0 && !(trade.tags ?? []).some((tag) => selectedFilterTags.has(tag))) return false;

          return true;
        }),
      ),
    [trades, searchQuery, startDate, endDate, filterPreset, selectedFilterTags],
  );

  const hasActiveFilters = !!startDate || !!endDate || filterPreset !== 'all' || selectedFilterTags.size > 0;
  const activeFilterCount =
    (startDate ? 1 : 0) + (endDate ? 1 : 0) + (filterPreset !== 'all' ? 1 : 0) + selectedFilterTags.size;

  const clearAllFilters = () => {
    setFilterPreset('all');
    setSelectedFilterTags(new Set());
    setStartDate('');
    setEndDate('');
  };

  useEffect(() => {
    if (status === 'loading') return;

    const loadLocal = () => {
      const savedTrades = localStorage.getItem('nexus-trades');
      const savedTags = localStorage.getItem('nexus-tags');

      if (savedTrades) {
        try {
          const parsed = JSON.parse(savedTrades) as Array<Omit<Trade, 'date'> & { date: string }>;
          setTrades(sortTrades(parsed.map((trade) => ({ ...trade, date: new Date(trade.date) }))));
        } catch (loadError) {
          console.error('Failed to load local trades', loadError);
        }
      }

      if (savedTags) {
        try {
          setGlobalTags(JSON.parse(savedTags) as string[]);
        } catch (loadError) {
          console.error('Failed to load local tags', loadError);
        }
      }
    };

    const loadRemote = async () => {
      try {
        const dbAvailable = await isDatabaseAvailable();

        if (!dbAvailable || !user?.id) {
          setUseLocalStorage(true);
          loadLocal();
          setMounted(true);
          return;
        }

        setUseLocalStorage(false);

        const localTradesRaw = localStorage.getItem('nexus-trades');
        const localTagsRaw = localStorage.getItem('nexus-tags');
        const localTrades: ApiTrade[] = localTradesRaw
          ? (JSON.parse(localTradesRaw) as Array<Omit<Trade, 'date'> & { date: string }>).map((trade) => ({
              ...trade,
              date: new Date(trade.date).toISOString(),
            }))
          : [];
        const localTags: string[] = localTagsRaw ? (JSON.parse(localTagsRaw) as string[]) : [];

        if (localTrades.length > 0) {
          await apiRequest<{ trades: ApiTrade[] }>('/api/trades/import', {
            method: 'POST',
            body: JSON.stringify({ trades: localTrades }),
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

        if (localTrades.length > 0 || localTags.length > 0) {
          localStorage.removeItem('nexus-trades');
          localStorage.removeItem('nexus-tags');
          toast.success('Trades migrated to cloud');
        }

        const [tradesRes, tagsRes] = await Promise.all([
          apiRequest<{ trades: ApiTrade[] }>('/api/trades'),
          apiRequest<{ tags: string[] }>('/api/tags'),
        ]);

        setTrades(sortTrades(tradesRes.trades.map(fromApiTrade)));
        setGlobalTags(tagsRes.tags);
      } catch (loadError) {
        console.error(loadError);
        setUseLocalStorage(true);
        loadLocal();
      } finally {
        setMounted(true);
      }
    };

    loadRemote();
  }, [status, user?.id]);

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

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (ids: string[]) => {
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const withErrorToast = (message: string, fn: () => Promise<void>) =>
    fn().catch((opError: unknown) => {
      const text = opError instanceof Error ? opError.message : message;
      toast.error(text);
    });

  const handleCreateManualTrade = async (trade: Trade) => {
    if (useLocalStorage) {
      setTrades((prev) => sortTrades([trade, ...prev]));
      return;
    }

    const result = await apiRequest<{ trade: ApiTrade }>('/api/trades', {
      method: 'POST',
      body: JSON.stringify(toApiTrade(trade)),
    });

    setTrades((prev) => sortTrades([fromApiTrade(result.trade), ...prev.filter((item) => item.id !== result.trade.id)]));
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);

    if (useLocalStorage) {
      setTrades((prev) => prev.filter((trade) => !selectedIds.has(trade.id)));
      setSelectedIds(new Set());
      return;
    }

    withErrorToast('Failed to delete selected trades', async () => {
      await apiRequest('/api/trades/bulk', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', ids }),
      });
      setTrades((prev) => prev.filter((trade) => !selectedIds.has(trade.id)));
      setSelectedIds(new Set());
    });
  };

  const handleApplyRisk = () => {
    const risk = parseFloat(riskInput);
    if (!Number.isFinite(risk) || risk <= 0) return;

    if (selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);

    if (useLocalStorage) {
      setTrades((prev) => prev.map((trade) => (selectedIds.has(trade.id) ? { ...trade, initialRisk: risk } : trade)));
      setRiskInput('');
      setSelectedIds(new Set());
      return;
    }

    withErrorToast('Failed to apply risk', async () => {
      await apiRequest('/api/trades/bulk', {
        method: 'POST',
        body: JSON.stringify({ action: 'applyRisk', ids, value: risk }),
      });
      setTrades((prev) => prev.map((trade) => (selectedIds.has(trade.id) ? { ...trade, initialRisk: risk } : trade)));
      setRiskInput('');
      setSelectedIds(new Set());
    });
  };

  const handleSaveNotes = async (tradeId: string, notes: string) => {
    if (useLocalStorage) {
      setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? { ...trade, notes } : trade)));
      return;
    }

    const result = await apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });

    setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? fromApiTrade(result.trade) : trade)));
  };

  const handleAddTag = (tradeId: string, tagName: string) => {
    const cleanTag = tagName.trim();
    if (!cleanTag) return;

    const target = trades.find((trade) => trade.id === tradeId);
    if (!target) return;

    const nextTags = Array.from(new Set([...(target.tags ?? []), cleanTag]));

    if (useLocalStorage) {
      setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? { ...trade, tags: nextTags } : trade)));
      setGlobalTags((prev) => (prev.includes(cleanTag) ? prev : [...prev, cleanTag]));
      return;
    }

    withErrorToast('Failed to add tag', async () => {
      await apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: nextTags }),
      });
      setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? { ...trade, tags: nextTags } : trade)));
      setGlobalTags((prev) => (prev.includes(cleanTag) ? prev : [...prev, cleanTag]));
    });
  };

  const handleRemoveTag = (tradeId: string, tagName: string) => {
    const target = trades.find((trade) => trade.id === tradeId);
    if (!target) return;

    const nextTags = (target.tags ?? []).filter((tag) => tag !== tagName);

    if (useLocalStorage) {
      setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? { ...trade, tags: nextTags } : trade)));
      return;
    }

    withErrorToast('Failed to remove tag', async () => {
      await apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: nextTags }),
      });
      setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? { ...trade, tags: nextTags } : trade)));
    });
  };

  const handleDeleteGlobalTag = (tagName: string) => {
    if (useLocalStorage) {
      setGlobalTags((prev) => prev.filter((tag) => tag !== tagName));
      setTrades((prev) => prev.map((trade) => ({ ...trade, tags: (trade.tags ?? []).filter((tag) => tag !== tagName) })));
      setSelectedFilterTags((prev) => {
        const next = new Set(prev);
        next.delete(tagName);
        return next;
      });
      return;
    }

    withErrorToast('Failed to delete tag', async () => {
      await apiRequest('/api/tags', {
        method: 'DELETE',
        body: JSON.stringify({ name: tagName }),
      });
      setGlobalTags((prev) => prev.filter((tag) => tag !== tagName));
      setTrades((prev) => prev.map((trade) => ({ ...trade, tags: (trade.tags ?? []).filter((tag) => tag !== tagName) })));
      setSelectedFilterTags((prev) => {
        const next = new Set(prev);
        next.delete(tagName);
        return next;
      });
    });
  };

  const handleBulkAddTag = () => {
    const cleanTag = bulkTagInput.trim();
    if (!cleanTag || selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);

    if (useLocalStorage) {
      setTrades((prev) =>
        prev.map((trade) =>
          selectedIds.has(trade.id)
            ? {
                ...trade,
                tags: Array.from(new Set([...(trade.tags ?? []), cleanTag])),
              }
            : trade,
        ),
      );
      setGlobalTags((prev) => (prev.includes(cleanTag) ? prev : [...prev, cleanTag]));
      setBulkTagInput('');
      setSelectedIds(new Set());
      return;
    }

    withErrorToast('Failed to add bulk tag', async () => {
      await apiRequest('/api/trades/bulk', {
        method: 'POST',
        body: JSON.stringify({ action: 'addTag', ids, value: cleanTag }),
      });
      setTrades((prev) =>
        prev.map((trade) =>
          selectedIds.has(trade.id)
            ? {
                ...trade,
                tags: Array.from(new Set([...(trade.tags ?? []), cleanTag])),
              }
            : trade,
        ),
      );
      setGlobalTags((prev) => (prev.includes(cleanTag) ? prev : [...prev, cleanTag]));
      setBulkTagInput('');
      setSelectedIds(new Set());
    });
  };

  const handleClearAllData = () => {
    if (useLocalStorage) {
      setTrades([]);
      setGlobalTags([]);
      setSelectedIds(new Set());
      setSelectedFilterTags(new Set());
      setFilterPreset('all');
      setStartDate('');
      setEndDate('');
      localStorage.removeItem('nexus-trades');
      localStorage.removeItem('nexus-tags');
      return;
    }

    withErrorToast('Failed to clear cloud data', async () => {
      if (trades.length > 0) {
        await apiRequest('/api/trades/bulk', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', ids: trades.map((trade) => trade.id) }),
        });
      }

      await Promise.all(
        globalTags.map((tag) =>
          apiRequest('/api/tags', {
            method: 'DELETE',
            body: JSON.stringify({ name: tag }),
          }),
        ),
      );

      setTrades([]);
      setGlobalTags([]);
      setSelectedIds(new Set());
      setSelectedFilterTags(new Set());
      setFilterPreset('all');
      setStartDate('');
      setEndDate('');
    });
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setError(null);

    const allNewTrades: Trade[] = [];
    const processedDates = new Set<string>();
    const warnings: string[] = [];

    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const dateInfo = parseDateFromFilename(file.name);

        if (!dateInfo) {
          continue;
        }

        processedDates.add(dateInfo.sortKey);

        await new Promise<void>((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              try {
                const parsed = processCsvData(results.data as Record<string, unknown>[], dateInfo);
                allNewTrades.push(...parsed.trades);
                warnings.push(...parsed.warnings);
                resolve();
              } catch (parseError) {
                reject(parseError);
              }
            },
            error: (parseError) => reject(parseError),
          });
        });
      }

      if (warnings.length > 0) {
        toast.warning(`${warnings.length} executions skipped (unmatched)`);
      }

      if (useLocalStorage) {
        setTrades((prev) => {
          const existingMeta = new Map(
            prev
              .filter((trade) => processedDates.has(trade.sortKey))
              .map((trade) => [trade.id, { tags: trade.tags, notes: trade.notes, initialRisk: trade.initialRisk }] as const),
          );

          const mergedNewTrades = allNewTrades.map((trade) => {
            const preserved = existingMeta.get(trade.id);
            if (!preserved) return trade;
            return {
              ...trade,
              tags: preserved.tags ?? [],
              notes: preserved.notes,
              initialRisk: preserved.initialRisk,
            };
          });

          const filtered = prev.filter((trade) => !processedDates.has(trade.sortKey));
          return sortTrades([...mergedNewTrades, ...filtered]);
        });
      } else {
        const importRes = await apiRequest<{ trades: ApiTrade[] }>('/api/trades/import', {
          method: 'POST',
          body: JSON.stringify({ trades: allNewTrades.map(toApiTrade) }),
        });

        setTrades(sortTrades(importRes.trades.map(fromApiTrade)));
        const tagsRes = await apiRequest<{ tags: string[] }>('/api/tags');
        setGlobalTags(tagsRes.tags);
      }
    } catch (uploadError) {
      const msg = uploadError instanceof Error ? uploadError.message : 'Processing error';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  return {
    status,
    user,
    trades,
    globalTags,
    filteredTrades,
    isImporting,
    mounted,
    error,
    useLocalStorage,
    importInputRef,
    selectedIds,
    startDate,
    endDate,
    riskInput,
    filterPreset,
    selectedFilterTags,
    bulkTagInput,
    searchQuery,
    hasActiveFilters,
    activeFilterCount,
    clearAllFilters,
    setStartDate,
    setEndDate,
    setRiskInput,
    setFilterPreset,
    setSelectedFilterTags,
    setBulkTagInput,
    setSearchQuery,
    handleToggleSelect,
    handleSelectAll,
    handleCreateManualTrade,
    handleDeleteSelected,
    handleApplyRisk,
    handleSaveNotes,
    handleAddTag,
    handleRemoveTag,
    handleDeleteGlobalTag,
    handleBulkAddTag,
    handleClearAllData,
    handleFileUpload,
  };
}
