'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { detectParser, getParserById, type BrokerParserConfig } from '@/lib/parsers';
import { parseTraderVueCsv } from '@/lib/parsers/tradervue';
import type { ApiTrade, Trade } from '@/lib/types';
import { useTradeFilters } from './use-trade-filters';
import { useTradeSync } from './use-trade-sync';
import { apiRequest, collectImportedTrades, fromApiTrade, sortTradesByDate, toApiTrade } from '@/lib/trade-utils';

const IMPORT_CHUNK_SIZE = 200;
const DEFAULT_RISK_STORAGE_KEY = 'nexus-default-risk';

type ImportOptions = {
  warningLabel: 'file' | 'folder';
  emptyMessage: string;
  includeFile?: (file: File) => boolean;
  resolveParser: (file: File, rows: Record<string, string>[]) => BrokerParserConfig | null;
};

export function useTrades() {
  const { status, user, trades, setTrades, globalTags, setGlobalTags, mounted, error, setError, refreshTrades } =
    useTradeSync();
  const [isImporting, setIsImporting] = useState(false);
  const [riskInput, setRiskInput] = useState('');
  const [defaultRiskInput, setDefaultRiskInput] = useState('');
  const [defaultRisk, setDefaultRisk] = useState<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const traderVueInputRef = useRef<HTMLInputElement | null>(null);
  const tradesRef = useRef<Trade[]>([]);
  const defaultRiskHydratedRef = useRef(false);
  const sortTrades = sortTradesByDate;
  const withErrorToast = useCallback((message: string, fn: () => Promise<void>) => {
    fn().catch((opError: unknown) => toast.error(opError instanceof Error ? opError.message : message));
  }, []);

  const {
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
  } = useTradeFilters(trades, {
    setTrades,
    setGlobalTags,
    runWithErrorToast: withErrorToast,
    requestBulkAddTag: async (ids, tag) => {
      await apiRequest('/api/trades/bulk', { method: 'POST', body: JSON.stringify({ action: 'addTag', ids, value: tag }) });
    },
  });

  const clearAllFilters = () => {
    setFilterPreset('all');
    setSelectedFilterTags(new Set());
    setStartDate('');
    setEndDate('');
  };

  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  useEffect(() => {
    const savedDefaultRisk = localStorage.getItem(DEFAULT_RISK_STORAGE_KEY);
    if (savedDefaultRisk) {
      const parsed = parseFloat(savedDefaultRisk);
      if (Number.isFinite(parsed) && parsed > 0) {
        setDefaultRisk(parsed);
        setDefaultRiskInput(parsed.toString());
      }
    }
    defaultRiskHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!defaultRiskHydratedRef.current) return;
    if (defaultRisk == null) {
      localStorage.removeItem(DEFAULT_RISK_STORAGE_KEY);
      return;
    }
    localStorage.setItem(DEFAULT_RISK_STORAGE_KEY, defaultRisk.toString());
  }, [defaultRisk]);

  const withDefaultRisk = useCallback(
    (trade: Trade): Trade => {
      if (defaultRisk == null) return trade;
      if (typeof trade.initialRisk === 'number' && Number.isFinite(trade.initialRisk) && trade.initialRisk > 0) return trade;
      return { ...trade, initialRisk: defaultRisk };
    },
    [defaultRisk],
  );

  const fetchTradeDetail = useCallback(
    async (tradeId: string) => {
      const current = tradesRef.current.find((trade) => trade.id === tradeId);
      if (!current) return null;
      if (current.rawExecutions.length > 0) return current;
      const result = await apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`);
      const detailed = fromApiTrade(result.trade);
      setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? detailed : trade)));
      return detailed;
    },
    [setTrades],
  );

  const handleCreateManualTrade = async (trade: Trade) => {
    const nextTrade = withDefaultRisk(trade);
    const result = await apiRequest<{ trade: ApiTrade }>('/api/trades', {
      method: 'POST',
      body: JSON.stringify(toApiTrade(nextTrade)),
    });
    setTrades((prev) => sortTrades([fromApiTrade(result.trade), ...prev.filter((item) => item.id !== result.trade.id)]));
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    withErrorToast('Failed to delete selected trades', async () => {
      await apiRequest('/api/trades/bulk', { method: 'POST', body: JSON.stringify({ action: 'delete', ids }) });
      setTrades((prev) => prev.filter((trade) => !selectedIds.has(trade.id)));
      setSelectedIds(new Set());
    });
  };

  const handleApplyRisk = () => {
    const risk = parseFloat(riskInput);
    if (!Number.isFinite(risk) || risk <= 0 || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    withErrorToast('Failed to apply risk', async () => {
      await apiRequest('/api/trades/bulk', { method: 'POST', body: JSON.stringify({ action: 'applyRisk', ids, value: risk }) });
      setTrades((prev) => prev.map((trade) => (selectedIds.has(trade.id) ? { ...trade, initialRisk: risk } : trade)));
      setRiskInput('');
      setSelectedIds(new Set());
    });
  };

  const handleSaveNotes = async (tradeId: string, notes: string) => {
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
    withErrorToast('Failed to remove tag', async () => {
      await apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: nextTags }),
      });
      setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? { ...trade, tags: nextTags } : trade)));
    });
  };

  const handleDeleteGlobalTag = (tagName: string) => {
    const removeFromSelected = (prev: Set<string>) => {
      const next = new Set(prev);
      next.delete(tagName);
      return next;
    };

    withErrorToast('Failed to delete tag', async () => {
      await apiRequest('/api/tags', { method: 'DELETE', body: JSON.stringify({ name: tagName }) });
      setGlobalTags((prev) => prev.filter((tag) => tag !== tagName));
      setTrades((prev) => prev.map((trade) => ({ ...trade, tags: (trade.tags ?? []).filter((tag) => tag !== tagName) })));
      setSelectedFilterTags(removeFromSelected);
    });
  };

  const handleClearAllData = () => {
    const resetFiltersAndSelection = () => {
      setSelectedIds(new Set());
      setSelectedFilterTags(new Set());
      setFilterPreset('all');
      setStartDate('');
      setEndDate('');
    };

    withErrorToast('Failed to clear cloud data', async () => {
      if (trades.length > 0) {
        await apiRequest('/api/trades/bulk', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', ids: trades.map((trade) => trade.id) }),
        });
      }
      await Promise.all(
        globalTags.map((tag) => apiRequest('/api/tags', { method: 'DELETE', body: JSON.stringify({ name: tag }) })),
      );
      setTrades([]);
      setGlobalTags([]);
      resetFiltersAndSelection();
    });
  };

  const handleSetDefaultRisk = () => {
    const parsedRisk = parseFloat(defaultRiskInput);
    if (!Number.isFinite(parsedRisk) || parsedRisk <= 0) return;
    setDefaultRisk(parsedRisk);
    setDefaultRiskInput(parsedRisk.toString());
    toast.success(`Auto risk set to $${parsedRisk.toLocaleString()}`);
  };

  const processImportFiles = async (files: FileList, options: ImportOptions): Promise<void> => {
    setIsImporting(true);
    setError(null);

    try {
      const { trades: allNewTrades, warnings } = await collectImportedTrades(files, {
        includeFile: options.includeFile,
        resolveParser: options.resolveParser,
      });

      if (warnings.length > 0) {
        console.warn(`[trade import] ${warnings.length} warning(s):`, warnings);
        toast.warning(`${warnings.length} warning(s) during ${options.warningLabel} import (see DevTools console)`);
      }
      if (allNewTrades.length === 0) {
        if (warnings.length === 0) toast.warning(options.emptyMessage);
        return;
      }

      const importedTrades = allNewTrades.map((trade) => withDefaultRisk(trade));
      const apiTrades = importedTrades.map(toApiTrade);
      for (let offset = 0; offset < apiTrades.length; offset += IMPORT_CHUNK_SIZE) {
        const chunk = apiTrades.slice(offset, offset + IMPORT_CHUNK_SIZE);
        await apiRequest<{ trades: ApiTrade[] }>('/api/trades/import', {
          method: 'POST',
          body: JSON.stringify({ trades: chunk }),
        });
      }
      await refreshTrades();
    } catch (uploadError) {
      const msg = uploadError instanceof Error ? uploadError.message : 'Processing error';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    try {
      await processImportFiles(files, {
        warningLabel: 'file',
        emptyMessage: 'No valid trade rows found to import',
        resolveParser: (_file, rows) => detectParser(rows.length > 0 ? Object.keys(rows[0]) : [], rows),
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleFolderUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    try {
      await processImportFiles(files, {
        warningLabel: 'folder',
        emptyMessage: 'No valid trade rows found in folder import',
        includeFile: (file) => file.name.endsWith('.csv'),
        resolveParser: (file, rows) => {
          const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          const parts = relativePath?.split('/') ?? [];
          const subdirName = parts.length >= 3 ? parts[parts.length - 2].toLowerCase() : 'default';
          return getParserById(subdirName) ?? detectParser(rows.length > 0 ? Object.keys(rows[0]) : [], rows);
        },
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleTraderVueImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setIsImporting(true);
    setError(null);
    try {
      const allTrades: Trade[] = [];
      const warnings: string[] = [];

      // Each TraderVue CSV is already-aggregated trades, so we parse files
      // in parallel and merge — much faster than the per-day pipeline.
      const results = await Promise.all(Array.from(files).map((file) => parseTraderVueCsv(file)));
      for (const result of results) {
        allTrades.push(...result.trades);
        warnings.push(...result.warnings);
      }

      if (warnings.length > 0) {
        console.warn(`[TraderVue import] ${warnings.length} warning(s):`, warnings);
        toast.warning(`${warnings.length} warning(s) during TraderVue import (see DevTools console)`);
      }

      if (allTrades.length === 0) {
        if (warnings.length === 0) toast.warning('No valid TraderVue trades found to import');
        return;
      }

      const importedTrades = allTrades.map((trade) => withDefaultRisk(trade));
      const apiTrades = importedTrades.map(toApiTrade);
      for (let offset = 0; offset < apiTrades.length; offset += IMPORT_CHUNK_SIZE) {
        const chunk = apiTrades.slice(offset, offset + IMPORT_CHUNK_SIZE);
        await apiRequest<{ trades: ApiTrade[] }>('/api/trades/import', {
          method: 'POST',
          body: JSON.stringify({ trades: chunk }),
        });
      }
      await refreshTrades();
      toast.success(`Imported ${importedTrades.length} trade${importedTrades.length === 1 ? '' : 's'} from TraderVue`);
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
    status, user, trades, globalTags, filteredTrades, isImporting, mounted, error, importInputRef, folderInputRef, traderVueInputRef,
    selectedIds, startDate, endDate, riskInput, defaultRiskInput, defaultRisk, filterPreset, selectedFilterTags, bulkTagInput,
    searchQuery, hasActiveFilters, activeFilterCount, clearAllFilters, setStartDate, setEndDate, setRiskInput, setDefaultRiskInput,
    setFilterPreset, setSelectedFilterTags, setBulkTagInput, setSearchQuery, handleToggleSelect, handleSelectAll,
    handleCreateManualTrade, handleDeleteSelected, handleApplyRisk, handleSetDefaultRisk, handleSaveNotes, handleAddTag,
    handleRemoveTag, handleDeleteGlobalTag, handleBulkAddTag, handleClearAllData, handleFileUpload, handleFolderUpload, handleTraderVueImport,
    fetchTradeDetail,
  };
}
