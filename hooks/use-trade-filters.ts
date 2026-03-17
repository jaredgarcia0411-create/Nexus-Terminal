import { isAfter, isWithinInterval, parseISO, subDays } from 'date-fns';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Trade } from '@/lib/types';

type FilterPreset = 'all' | '30' | '60' | '90';

type UseTradeFiltersOptions = {
  useLocalStorage: boolean;
  setTrades: Dispatch<SetStateAction<Trade[]>>;
  setGlobalTags: Dispatch<SetStateAction<string[]>>;
  runWithErrorToast: (message: string, fn: () => Promise<void>) => void;
  requestBulkAddTag: (ids: string[], tag: string) => Promise<void>;
};

export function useTradeFilters(trades: Trade[], _globalTags: string[], options?: UseTradeFiltersOptions) {

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPreset, setFilterPreset] = useState<FilterPreset>('all');
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState('');

  const filteredTrades = useMemo(
    () =>
      [...trades]
        .filter((trade) => {
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
        })
        .sort((a, b) => b.date.getTime() - a.date.getTime()),
    [trades, searchQuery, startDate, endDate, filterPreset, selectedFilterTags],
  );

  const hasActiveFilters = !!startDate || !!endDate || filterPreset !== 'all' || selectedFilterTags.size > 0;
  const activeFilterCount =
    (startDate ? 1 : 0) + (endDate ? 1 : 0) + (filterPreset !== 'all' ? 1 : 0) + selectedFilterTags.size;

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

  const handleBulkAddTag = () => {
    if (!options) return;

    const cleanTag = bulkTagInput.trim();
    if (!cleanTag || selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);

    if (options.useLocalStorage) {
      options.setTrades((prev) =>
        prev.map((trade) =>
          selectedIds.has(trade.id)
            ? {
                ...trade,
                tags: Array.from(new Set([...(trade.tags ?? []), cleanTag])),
              }
            : trade,
        ),
      );
      options.setGlobalTags((prev) => (prev.includes(cleanTag) ? prev : [...prev, cleanTag]));
      setBulkTagInput('');
      setSelectedIds(new Set());
      return;
    }

    options.runWithErrorToast('Failed to add bulk tag', async () => {
      await options.requestBulkAddTag(ids, cleanTag);
      options.setTrades((prev) =>
        prev.map((trade) =>
          selectedIds.has(trade.id)
            ? {
                ...trade,
                tags: Array.from(new Set([...(trade.tags ?? []), cleanTag])),
              }
            : trade,
        ),
      );
      options.setGlobalTags((prev) => (prev.includes(cleanTag) ? prev : [...prev, cleanTag]));
      setBulkTagInput('');
      setSelectedIds(new Set());
    });
  };

  return {
    selectedIds,
    setSelectedIds,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    searchQuery,
    setSearchQuery,
    filterPreset,
    setFilterPreset,
    selectedFilterTags,
    setSelectedFilterTags,
    bulkTagInput,
    setBulkTagInput,
    filteredTrades,
    hasActiveFilters,
    activeFilterCount,
    handleToggleSelect,
    handleSelectAll,
    handleBulkAddTag,
  };
}
