'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { isAfter, isWithinInterval, parseISO, subDays } from 'date-fns';
import Papa from 'papaparse';
import { toast } from 'sonner';
import type { Trade } from '@/lib/types';
import { parseDateFromFilename, processCsvData } from '@/lib/csv-parser';
import { detectParser, getParserById } from '@/lib/parsers';
import { isDatabaseAvailable } from '@/lib/storage';
import {
  acquireMigrationLock,
  createMigrationBatchKey,
  isDatabaseUnavailableError,
  releaseMigrationLock,
} from '@/lib/trade-migration';
import { useSession } from 'next-auth/react';

type ApiTrade = Omit<Trade, 'date'> & { date: string };
type CsvParseIssue = { row?: number; message?: string; code?: string };

type TradeLike = Partial<Omit<Trade, 'date'>> & {
  id: string;
  date: string | Date;
  sortKey: string;
  symbol: string;
  direction: Trade['direction'];
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
};

const normalizeTrade = (trade: TradeLike): Trade => {
  const commission = trade.commission ?? 0;
  const fees = trade.fees ?? 0;
  const netPnl = trade.netPnl ?? trade.pnl ?? 0;
  const grossPnl = trade.grossPnl ?? netPnl + commission + fees;
  const legacyExecutionCount = (trade as unknown as Record<string, unknown>)['executions'];
  const executionCount = trade.executionCount ?? (typeof legacyExecutionCount === 'number' ? legacyExecutionCount : 1);

  return {
    ...trade,
    date: new Date(trade.date),
    grossPnl,
    netPnl,
    entryTime: trade.entryTime ?? '',
    exitTime: trade.exitTime ?? '',
    executionCount,
    rawExecutions: trade.rawExecutions ?? [],
    pnl: netPnl,
    executions: executionCount,
    tags: trade.tags ?? [],
  };
};

const toApiTrade = (trade: Trade): ApiTrade => ({
  ...trade,
  pnl: trade.netPnl,
  executions: trade.executionCount,
  date: new Date(trade.date).toISOString(),
});

const fromApiTrade = (trade: ApiTrade): Trade => normalizeTrade(trade);

const LOCAL_MIGRATION_LOCK_TTL_MS = 2 * 60 * 1000;
const IMPORT_CHUNK_SIZE = 200;

type ApiRequestError = Error & { status?: number };

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string; details?: string; code?: string };
  if (!res.ok) {
    const base = data.error || 'Something went wrong';
    const code = typeof data.code === 'string' && data.code ? ` [${data.code}]` : '';
    const details = typeof data.details === 'string' && data.details ? `: ${data.details}` : '';
    const error = new Error(`${base}${code}${details}`) as ApiRequestError;
    error.status = res.status;
    throw error;
  }

  return data;
}

function appendCsvParseWarnings(fileName: string, issues: CsvParseIssue[], warnings: string[]) {
  for (const issue of issues) {
    const row = typeof issue.row === 'number' ? ` row ${issue.row + 1}` : '';
    const code = issue.code ? ` (${issue.code})` : '';
    const message = issue.message?.trim() || 'Unknown CSV parse error';
    warnings.push(`${fileName}${row}: ${message}${code}`);
  }
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
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const tradesRef = useRef<Trade[]>([]);

  const sortTrades = useCallback((list: Trade[]) => [...list].sort((a, b) => b.date.getTime() - a.date.getTime()), []);

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
    [trades, searchQuery, startDate, endDate, filterPreset, selectedFilterTags, sortTrades],
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
    tradesRef.current = trades;
  }, [trades]);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      setUseLocalStorage(false);
      setError('Authentication required');
      setMounted(true);
      return;
    }

    const loadLocal = () => {
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
    };

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

        const [tradesRes, tagsRes] = await Promise.all([
          apiRequest<{ trades: ApiTrade[] }>('/api/trades'),
          apiRequest<{ tags: string[] }>('/api/tags'),
        ]);

        setTrades(sortTrades(tradesRes.trades.map(fromApiTrade)));
        setGlobalTags(tagsRes.tags);

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
  }, [status, user?.id, sortTrades]);

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

  const fetchTradeDetail = useCallback(async (tradeId: string) => {
    const current = tradesRef.current.find((trade) => trade.id === tradeId);
    if (!current) return null;

    if (useLocalStorage || current.rawExecutions.length > 0) {
      return current;
    }

    const result = await apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`);
    const detailed = fromApiTrade(result.trade);

    setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? detailed : trade)));
    return detailed;
  }, [useLocalStorage]);

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
          warnings.push(`Skipped ${file.name}: could not parse date from filename`);
          continue;
        }

        await new Promise<void>((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              try {
                const parseIssues = (results.errors ?? []) as CsvParseIssue[];
                if (parseIssues.length > 0) {
                  appendCsvParseWarnings(file.name, parseIssues, warnings);
                }

                const parsed = processCsvData(results.data as Record<string, unknown>[], dateInfo);
                if (parsed.trades.length > 0) {
                  processedDates.add(dateInfo.sortKey);
                }
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
        toast.warning(`${warnings.length} warning(s) during file import`);
      }

      if (allNewTrades.length === 0) {
        if (warnings.length === 0) {
          toast.warning('No valid trade rows found to import');
        }
        return;
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
        const apiTrades = allNewTrades.map(toApiTrade);
        for (let offset = 0; offset < apiTrades.length; offset += IMPORT_CHUNK_SIZE) {
          const chunk = apiTrades.slice(offset, offset + IMPORT_CHUNK_SIZE);
          await apiRequest<{ trades: ApiTrade[] }>('/api/trades/import', {
            method: 'POST',
            body: JSON.stringify({ trades: chunk }),
          });
        }

        const [tradesRes, tagsRes] = await Promise.all([
          apiRequest<{ trades: ApiTrade[] }>('/api/trades'),
          apiRequest<{ tags: string[] }>('/api/tags'),
        ]);

        setTrades(sortTrades(tradesRes.trades.map(fromApiTrade)));
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

  const handleFolderUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setError(null);

    const allNewTrades: Trade[] = [];
    const processedDates = new Set<string>();
    const warnings: string[] = [];

    try {
      // Group files by subdirectory name (broker hint)
      const groups = new Map<string, File[]>();
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (!file.name.endsWith('.csv')) continue;
        const relativePath = (file as any).webkitRelativePath as string | undefined;
        const parts = relativePath?.split('/') ?? [];
        // e.g. "my-trades/schwab/01-15-25.csv" → subdirName = "schwab"
        const subdirName = parts.length >= 3 ? parts[parts.length - 2].toLowerCase() : 'default';
        if (!groups.has(subdirName)) groups.set(subdirName, []);
        groups.get(subdirName)!.push(file);
      }

      for (const [subdirName, groupFiles] of groups) {
        // Try to resolve parser by subdirectory name
        const parserById = getParserById(subdirName);

        for (const file of groupFiles) {
          const dateInfo = parseDateFromFilename(file.name);
          if (!dateInfo) {
            warnings.push(`Skipped ${file.name}: could not parse date from filename`);
            continue;
          }

          await new Promise<void>((resolve, reject) => {
            Papa.parse(file, {
              header: true,
              skipEmptyLines: true,
              complete: (results) => {
                try {
                  const rows = results.data as Record<string, unknown>[];
                  const parseIssues = (results.errors ?? []) as CsvParseIssue[];
                  if (parseIssues.length > 0) {
                    appendCsvParseWarnings(file.name, parseIssues, warnings);
                  }
                  // Resolve parser: by dir name → auto-detect from headers → built-in
                  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
                  const parser = parserById ?? detectParser(headers, rows);
                  const parsed = processCsvData(rows, dateInfo, parser.id !== 'default' ? parser : undefined);
                  if (parsed.trades.length > 0) {
                    processedDates.add(dateInfo.sortKey);
                  }
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
      }

      if (warnings.length > 0) {
        toast.warning(`${warnings.length} warning(s) during folder import`);
      }

      if (allNewTrades.length === 0) {
        if (warnings.length === 0) {
          toast.warning('No valid trade rows found in folder import');
        }
        return;
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
        const apiTrades = allNewTrades.map(toApiTrade);
        for (let offset = 0; offset < apiTrades.length; offset += IMPORT_CHUNK_SIZE) {
          const chunk = apiTrades.slice(offset, offset + IMPORT_CHUNK_SIZE);
          await apiRequest<{ trades: ApiTrade[] }>('/api/trades/import', {
            method: 'POST',
            body: JSON.stringify({ trades: chunk }),
          });
        }

        const [tradesRes, tagsRes] = await Promise.all([
          apiRequest<{ trades: ApiTrade[] }>('/api/trades'),
          apiRequest<{ tags: string[] }>('/api/tags'),
        ]);

        setTrades(sortTrades(tradesRes.trades.map(fromApiTrade)));
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
    folderInputRef,
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
    handleFolderUpload,
    fetchTradeDetail,
  };
}
