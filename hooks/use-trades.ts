'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { isAfter, isWithinInterval, parseISO, subDays } from 'date-fns';
import Papa from 'papaparse';
import { toast } from 'sonner';
import type { CandleData } from '@/components/trading/CandlestickChart';
import type { Trade } from '@/lib/types';
import { parseDateFromFilename, processCsvData } from '@/lib/csv-parser';
import { calculateMfeMae } from '@/lib/mfe-mae';
import { detectParser, getParserById } from '@/lib/parsers';
import { isDatabaseAvailable } from '@/lib/storage';
import { useSession } from 'next-auth/react';

type ApiTrade = Omit<Trade, 'date'> & { date: string };

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

type MarketDataResponse = {
  candles?: CandleData[];
};

type MfeMaeBatchResult = {
  trades: Trade[];
  computed: number;
  unavailable: number;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NY_TIME_ZONE = 'America/New_York';
const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parseSortKey(sortKey: string) {
  const match = sortKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

function getNyOffsetMs(atEpochMs: number) {
  const parts = NY_DATE_PARTS.formatToParts(new Date(atEpochMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - atEpochMs;
}

function nyDateTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const offset = getNyOffsetMs(utcGuess);
  return utcGuess - offset;
}

function getMarketWindowEpoch(sortKey: string) {
  const dateParts = parseSortKey(sortKey);
  if (!dateParts) return {};

  const start = nyDateTimeToEpoch(dateParts.year, dateParts.month, dateParts.day, 9, 30, 0);
  const end = nyDateTimeToEpoch(dateParts.year, dateParts.month, dateParts.day, 16, 0, 0);

  return {
    startDate: String(start),
    endDate: String(end),
  };
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
  const candleCacheRef = useRef<Map<string, CandleData[] | null>>(new Map());
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

    const loadLocal = () => {
      const savedTrades = localStorage.getItem('nexus-trades');
      const savedTags = localStorage.getItem('nexus-tags');

      if (savedTrades) {
        try {
          const parsed = JSON.parse(savedTrades) as TradeLike[];
          setTrades(sortTrades(parsed.map((trade) => normalizeTrade(trade))));
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
          ? (JSON.parse(localTradesRaw) as TradeLike[]).map((trade) => toApiTrade(normalizeTrade(trade)))
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

  const persistTradeUpdates = useCallback(async (updatedTrades: Trade[]) => {
    if (updatedTrades.length === 0) return;

    if (useLocalStorage) {
      const updateMap = new Map(updatedTrades.map((trade) => [trade.id, trade]));
      setTrades((prev) => sortTrades(prev.map((trade) => updateMap.get(trade.id) ?? trade)));
      return;
    }

    const importRes = await apiRequest<{ trades: ApiTrade[] }>('/api/trades/import', {
      method: 'POST',
      body: JSON.stringify({ trades: updatedTrades.map(toApiTrade) }),
    });

    setTrades(sortTrades(importRes.trades.map(fromApiTrade)));
    const tagsRes = await apiRequest<{ tags: string[] }>('/api/tags');
    setGlobalTags(tagsRes.tags);
  }, [useLocalStorage, sortTrades]);

  const computeMfeMaeBatch = useCallback(async (
    targetTrades: Trade[],
    options: { showProgress?: boolean } = {},
  ): Promise<MfeMaeBatchResult> => {
    const { showProgress = true } = options;
    if (targetTrades.length === 0) {
      return { trades: targetTrades, computed: 0, unavailable: 0 };
    }

    const eligibleTrades = targetTrades.filter((trade) =>
      !!trade.symbol && !!trade.sortKey && !!trade.entryTime && !!trade.exitTime);

    if (eligibleTrades.length === 0) {
      return {
        trades: targetTrades.map((trade) => ({
          ...trade,
          mfe: undefined,
          mae: undefined,
          bestExitPnl: undefined,
          exitEfficiency: undefined,
        })),
        computed: 0,
        unavailable: targetTrades.length,
      };
    }

    const groups = new Map<string, Trade[]>();
    for (const trade of eligibleTrades) {
      const key = `${trade.sortKey}|${trade.symbol.toUpperCase()}`;
      const list = groups.get(key) ?? [];
      list.push(trade);
      groups.set(key, list);
    }

    const updates = new Map<string, Trade>();
    let done = 0;
    let computed = 0;
    const toastId = showProgress ? toast.loading(`Computing MFE/MAE... 0/${eligibleTrades.length}`) : null;

    let groupIndex = 0;
    for (const [groupKey, groupTrades] of groups) {
      if (groupIndex > 0) {
        await sleep(200);
      }

      let candles = candleCacheRef.current.get(groupKey);
      if (candles === undefined) {
        const [sortKey, symbol] = groupKey.split('|');
        const { startDate, endDate } = getMarketWindowEpoch(sortKey);

        try {
          const params = new URLSearchParams({
            symbol,
            periodType: 'day',
            period: '1',
            frequencyType: 'minute',
            frequency: '1',
          });
          if (startDate) params.set('startDate', startDate);
          if (endDate) params.set('endDate', endDate);
          const res = await apiRequest<MarketDataResponse>(`/api/schwab/market-data?${params.toString()}`);
          candles = res.candles && res.candles.length > 0 ? res.candles : null;
        } catch {
          candles = null;
        }

        candleCacheRef.current.set(groupKey, candles);
      }

      for (const trade of groupTrades) {
        const result = candles
          ? calculateMfeMae(
              trade.direction,
              trade.avgEntryPrice,
              trade.totalQuantity,
              trade.entryTime,
              trade.exitTime,
              trade.commission ?? 0,
              trade.fees ?? 0,
              trade.netPnl,
              candles,
            )
          : null;

        if (result) {
          updates.set(trade.id, { ...trade, ...result });
          computed += 1;
        } else {
          updates.set(trade.id, {
            ...trade,
            mfe: undefined,
            mae: undefined,
            bestExitPnl: undefined,
            exitEfficiency: undefined,
          });
        }

        done += 1;
        if (toastId) {
          toast.loading(`Computing MFE/MAE... ${done}/${eligibleTrades.length}`, { id: toastId });
        }
      }

      groupIndex += 1;
    }

    if (toastId) {
      const unavailable = targetTrades.length - computed;
      if (computed > 0) {
        toast.success(
          unavailable > 0
            ? `Computed MFE/MAE for ${computed} trade(s); ${unavailable} unavailable.`
            : `Computed MFE/MAE for ${computed} trade(s).`,
          { id: toastId },
        );
      } else {
        toast.warning('MFE/MAE unavailable for selected trades.', { id: toastId });
      }
    }

    return {
      trades: targetTrades.map((trade) => updates.get(trade.id) ?? trade),
      computed,
      unavailable: targetTrades.length - computed,
    };
  }, []);

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

  const handleRecalculateMfeMae = (tradeId: string) =>
    withErrorToast('Failed to recalculate MFE/MAE', async () => {
      const target = trades.find((trade) => trade.id === tradeId);
      if (!target) return;

      const { trades: recalculated } = await computeMfeMaeBatch([target], { showProgress: true });
      await persistTradeUpdates(recalculated);
    });

  const handleBulkRecalculateMfeMae = () => {
    if (selectedIds.size === 0) return;
    const ids = new Set(selectedIds);

    withErrorToast('Failed to recalculate MFE/MAE for selected trades', async () => {
      const targets = trades.filter((trade) => ids.has(trade.id));
      if (targets.length === 0) return;

      const { trades: recalculated } = await computeMfeMaeBatch(targets, { showProgress: true });
      await persistTradeUpdates(recalculated);
      setSelectedIds(new Set());
    });
  };

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

      const { trades: tradesWithMfeMae } = await computeMfeMaeBatch(allNewTrades, { showProgress: true });

      if (useLocalStorage) {
        setTrades((prev) => {
          const existingMeta = new Map(
            prev
              .filter((trade) => processedDates.has(trade.sortKey))
              .map((trade) => [trade.id, { tags: trade.tags, notes: trade.notes, initialRisk: trade.initialRisk }] as const),
          );

          const mergedNewTrades = tradesWithMfeMae.map((trade) => {
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
          body: JSON.stringify({ trades: tradesWithMfeMae.map(toApiTrade) }),
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

          processedDates.add(dateInfo.sortKey);

          await new Promise<void>((resolve, reject) => {
            Papa.parse(file, {
              header: true,
              skipEmptyLines: true,
              complete: (results) => {
                try {
                  const rows = results.data as Record<string, unknown>[];
                  // Resolve parser: by dir name → auto-detect from headers → built-in
                  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
                  const parser = parserById ?? detectParser(headers, rows);
                  const parsed = processCsvData(rows, dateInfo, parser.id !== 'default' ? parser : undefined);
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

      const { trades: tradesWithMfeMae } = await computeMfeMaeBatch(allNewTrades, { showProgress: true });

      if (useLocalStorage) {
        setTrades((prev) => {
          const existingMeta = new Map(
            prev
              .filter((trade) => processedDates.has(trade.sortKey))
              .map((trade) => [trade.id, { tags: trade.tags, notes: trade.notes, initialRisk: trade.initialRisk }] as const),
          );

          const mergedNewTrades = tradesWithMfeMae.map((trade) => {
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
          body: JSON.stringify({ trades: tradesWithMfeMae.map(toApiTrade) }),
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
    handleRecalculateMfeMae,
    handleBulkRecalculateMfeMae,
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
