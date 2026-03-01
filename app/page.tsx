'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import Image from 'next/image';
import { signIn, signOut, useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  Activity,
  Bell,
  LayoutGrid,
  Upload,
  Calendar as CalendarIcon,
  BarChart3,
  List,
  Plus,
  Trash2,
  Filter,
  Search,
  User,
  X,
  Tag as TagIcon,
} from 'lucide-react';
import { format, isAfter, isWithinInterval, parseISO, subDays } from 'date-fns';

import type { Trade } from '@/lib/types';
import { formatCurrency } from '@/lib/trading-utils';
import { parseDateFromFilename, processCsvData } from '@/lib/csv-parser';
import { isDatabaseAvailable } from '@/lib/storage';
import TradeTable from '@/components/trading/TradeTable';
import PerformanceCharts from '@/components/trading/PerformanceCharts';
import TradingCalendar from '@/components/trading/TradingCalendar';
import NewTradeDialog from '@/components/trading/NewTradeDialog';
import TradeDetailSheet from '@/components/trading/TradeDetailSheet';
import SettingsMenu from '@/components/trading/SettingsMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type TabKey = 'dashboard' | 'journal' | 'performance' | 'filter' | 'backtesting';
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

export default function NexusTerminal() {
  const { data: session, status } = useSession();
  const user = session?.user as ({ id?: string; name?: string | null; email?: string | null; image?: string | null } | undefined);

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useLocalStorage, setUseLocalStorage] = useState(true);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [riskInput, setRiskInput] = useState('');
  const [performanceMetric, setPerformanceMetric] = useState<'$' | 'R'>('$');
  const [filterPreset, setFilterPreset] = useState<'all' | '30' | '60' | '90'>('all');
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isManualTradeOpen, setIsManualTradeOpen] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const sortTrades = (list: Trade[]) => [...list].sort((a, b) => b.date.getTime() - a.date.getTime());

  const selectedTrade = useMemo(
    () => trades.find((trade) => trade.id === selectedTradeId) ?? null,
    [selectedTradeId, trades],
  );

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

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SCHWAB_AUTH_SUCCESS') {
        toast.success('Charles Schwab connected');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setError(null);

    const allNewTrades: Trade[] = [];
    const processedDates = new Set<string>();

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
                const tradesFromFile = processCsvData(results.data as Record<string, unknown>[], dateInfo);
                allNewTrades.push(...tradesFromFile);
                resolve();
              } catch (parseError) {
                reject(parseError);
              }
            },
            error: (parseError) => reject(parseError),
          });
        });
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

  const handleConnectSchwab = async () => {
    try {
      const res = await fetch('/api/auth/schwab/url');
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start Schwab auth');
      }
      window.open(data.url, 'schwab_login', 'width=600,height=700');
    } catch (connectError) {
      const msg = connectError instanceof Error ? connectError.message : 'Could not connect Schwab';
      toast.error(msg);
    }
  };

  const handleSignIn = () => {
    signIn('google').catch(() => {
      toast.error('Could not start Google sign in');
    });
  };

  const handleSignOut = () => {
    signOut().catch(() => {
      toast.error('Could not sign out');
    });
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E4E4E7] font-sans selection:bg-emerald-500/30">
      <nav className="fixed left-0 top-0 h-full w-16 border-r border-white/5 bg-[#0A0A0B] flex flex-col items-center py-6 gap-8 z-50">
        <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 cursor-pointer">
          <Activity className="text-black w-6 h-6" />
        </div>

        <div className="flex flex-col gap-6 text-zinc-500">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`p-2 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`}
            title="Dashboard"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={`p-2 rounded-lg transition-colors ${activeTab === 'performance' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`}
            title="Performance"
          >
            <BarChart3 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTab('journal')}
            className={`p-2 rounded-lg transition-colors ${activeTab === 'journal' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`}
            title="Journal"
          >
            <List className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTab('filter')}
            className={`p-2 rounded-lg transition-colors ${activeTab === 'filter' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`}
            title="Filter"
          >
            <Filter className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTab('backtesting')}
            className={`p-2 rounded-lg transition-colors ${activeTab === 'backtesting' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`}
            title="Backtesting"
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            onClick={() => toast('No new notifications')}
            className="p-2 rounded-lg transition-colors hover:text-white"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-auto flex flex-col gap-6 text-zinc-500">
          <SettingsMenu trades={trades} onClearAllData={handleClearAllData} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 rounded-lg transition-colors hover:text-white" title={user ? 'User Menu' : 'Sign In'}>
                <User className="w-5 h-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 bg-[#121214] border-white/10 text-white">
              {user ? (
                <>
                  <div className="px-3 py-2 border-b border-white/10">
                    <p className="text-xs text-zinc-400">{user.name}</p>
                    <p className="text-[11px] text-zinc-500">{user.email}</p>
                  </div>
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-rose-400">
                    Sign Out
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={handleSignIn} className="cursor-pointer">
                  Sign In
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <main className="pl-16">
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 sticky top-0 bg-[#0A0A0B]/80 backdrop-blur-md z-40">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-medium tracking-tight">Nexus Terminal</h1>
            <div className="h-4 w-[1px] bg-white/10 mx-2" />
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {filteredTrades.length} TRADES LOGGED
            </div>
            {hasActiveFilters ? (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                <span>Filtered ({activeFilterCount})</span>
                <button onClick={clearAllFilters} className="text-emerald-300 hover:text-white transition-colors" title="Clear filters">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : null}

            <span className="text-[10px] uppercase tracking-widest text-zinc-600">{useLocalStorage ? 'Local Storage Mode' : 'Cloud Mode'}</span>
          </div>

          {error ? <div className="flex-1 mx-8 px-4 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-500 text-xs font-medium">{error}</div> : null}

          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs font-medium">{user.name}</div>
                  <div className="text-[10px] text-zinc-500">{user.email}</div>
                </div>
                <button onClick={handleSignOut} className="group relative">
                  {user.image ? (
                    <Image src={user.image} alt={user.name ?? 'User'} width={32} height={32} className="w-8 h-8 rounded-full border border-white/10" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                      <User className="w-4 h-4 text-emerald-500" />
                    </div>
                  )}
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-[#0A0A0B] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleSignIn}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                <Image src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-4 h-4" alt="Google" width={16} height={16} />
                Login with Google
              </button>
            )}

            {selectedIds.size > 0 ? (
              <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-2">
                <span className="text-xs text-zinc-500 font-medium">{selectedIds.size} selected</span>
                <button
                  onClick={handleDeleteSelected}
                  className="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-lg hover:bg-rose-500/20 transition-colors"
                  title="Delete Selected"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : null}

            <button
              onClick={() => importInputRef.current?.click()}
              className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Bulk Import
            </button>
            <input ref={importInputRef} type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />

            <button
              onClick={() => setIsManualTradeOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-medium px-4 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Trade
            </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' ? (
              <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
                {trades.length === 0 ? (
                  <div className="bg-[#121214] border border-white/5 rounded-2xl p-10 text-center space-y-5">
                    <h2 className="text-2xl font-bold">Welcome to Nexus Terminal</h2>
                    <p className="text-sm text-zinc-400 max-w-2xl mx-auto">Import your trading data to get started.</p>
                    <div className="flex flex-col items-center gap-3">
                      <button
                        onClick={() => importInputRef.current?.click()}
                        className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-5 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Import Trades
                      </button>
                      <p className="text-xs text-zinc-500">
                        CSV files should be named like <span className="font-mono">01-15-25.csv</span> (MM-DD-YY)
                      </p>
                      <button
                        onClick={() => setIsManualTradeOpen(true)}
                        className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-2 rounded-lg text-sm"
                      >
                        Or add a trade manually
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                        <div className="text-zinc-500 text-xs font-mono uppercase mb-2">Total PnL</div>
                        <div className={`text-3xl font-bold tracking-tight ${trades.reduce((acc, trade) => acc + trade.pnl, 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          ${trades.reduce((acc, trade) => acc + trade.pnl, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                        <div className="text-zinc-500 text-xs font-mono uppercase mb-2">Win Rate</div>
                        <div className="text-3xl font-bold tracking-tight">
                          {trades.length > 0 ? ((trades.filter((trade) => trade.pnl > 0).length / trades.length) * 100).toFixed(1) : '0.0'}%
                        </div>
                      </div>
                      <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                        <div className="text-zinc-500 text-xs font-mono uppercase mb-2">Profit Factor</div>
                        <div className="text-3xl font-bold tracking-tight">
                          {(() => {
                            const wins = trades.filter((trade) => trade.pnl > 0).reduce((acc, trade) => acc + trade.pnl, 0);
                            const losses = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((acc, trade) => acc + trade.pnl, 0));
                            return losses === 0 ? (wins > 0 ? '∞' : '0.00') : (wins / losses).toFixed(2);
                          })()}
                        </div>
                      </div>
                    </div>

                    <PerformanceCharts trades={filteredTrades} metric={performanceMetric} />

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold">Recent Trades</h2>
                        <button onClick={() => setActiveTab('journal')} className="text-sm text-emerald-500 hover:text-emerald-400">
                          View Journal
                        </button>
                      </div>
                      <TradeTable
                        trades={filteredTrades.slice(0, 10)}
                        selectedIds={selectedIds}
                        onToggleSelect={handleToggleSelect}
                        onSelectAll={handleSelectAll}
                        onAddTag={handleAddTag}
                        onRemoveTag={handleRemoveTag}
                        onDeleteGlobalTag={handleDeleteGlobalTag}
                        onTradeClick={(trade) => setSelectedTradeId(trade.id)}
                        globalTags={globalTags}
                        readOnly
                      />
                    </div>
                  </>
                )}
              </motion.div>
            ) : null}

            {activeTab === 'journal' ? (
              <motion.div key="journal" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
                <div className="flex flex-col gap-6 bg-[#121214] border border-white/5 rounded-2xl p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <h2 className="text-2xl font-bold">Trading Journal</h2>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="text"
                          placeholder="Search symbol..."
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors w-64"
                        />
                      </div>
                    </div>

                    {selectedIds.size > 0 ? (
                      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold">Set Risk:</span>
                          <input
                            type="number"
                            placeholder="$500"
                            value={riskInput}
                            onChange={(event) => setRiskInput(event.target.value)}
                            className="w-16 bg-transparent text-xs focus:outline-none border-b border-white/10"
                          />
                          <button onClick={handleApplyRisk} className="text-emerald-500 hover:text-emerald-400 text-[10px] font-bold uppercase">
                            Apply
                          </button>
                        </div>

                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                          <TagIcon className="w-3 h-3 text-zinc-500" />
                          <input
                            type="text"
                            placeholder="Add Tag..."
                            value={bulkTagInput}
                            onChange={(event) => setBulkTagInput(event.target.value)}
                            className="w-20 bg-transparent text-xs focus:outline-none border-b border-white/10"
                          />
                          <button onClick={handleBulkAddTag} className="text-emerald-500 hover:text-emerald-400 text-[10px] font-bold uppercase">
                            Add
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <TradeTable
                  trades={filteredTrades}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                  onSelectAll={handleSelectAll}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                  onDeleteGlobalTag={handleDeleteGlobalTag}
                  onTradeClick={(trade) => setSelectedTradeId(trade.id)}
                  globalTags={globalTags}
                />
              </motion.div>
            ) : null}

            {activeTab === 'performance' ? (
              <motion.div key="performance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">Performance Analytics</h2>
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-1">
                    <button
                      onClick={() => setPerformanceMetric('$')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${performanceMetric === '$' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
                    >
                      $ Metrics
                    </button>
                    <button
                      onClick={() => setPerformanceMetric('R')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${performanceMetric === 'R' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
                    >
                      R Metrics
                    </button>
                  </div>
                </div>

                <PerformanceCharts trades={filteredTrades} metric={performanceMetric} />
                <TradingCalendar trades={filteredTrades} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-sm font-semibold mb-4 text-zinc-400 uppercase tracking-wider">Symbol Distribution</h3>
                    <div className="space-y-3">
                      {Object.entries(
                        filteredTrades.reduce<Record<string, number>>((acc, trade) => {
                          acc[trade.symbol] = (acc[trade.symbol] || 0) + 1;
                          return acc;
                        }, {}),
                      )
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([symbol, count]) => (
                          <div key={symbol} className="flex items-center justify-between">
                            <span className="text-sm font-mono">{symbol}</span>
                            <div className="flex-1 mx-4 h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500" style={{ width: `${(count / Math.max(filteredTrades.length, 1)) * 100}%` }} />
                            </div>
                            <span className="text-xs text-zinc-500">{count} trades</span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-sm font-semibold mb-4 text-zinc-400 uppercase tracking-wider">Risk Summary</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-zinc-500">Avg Risk per Trade</span>
                        <span className="text-sm font-mono">
                          {formatCurrency(
                            filteredTrades.filter((trade) => trade.initialRisk).reduce((acc, trade) => acc + (trade.initialRisk || 0), 0) /
                              (filteredTrades.filter((trade) => trade.initialRisk).length || 1),
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-zinc-500">Total R-Multiple</span>
                        <span className="text-sm font-mono text-emerald-500">
                          {filteredTrades
                            .filter((trade) => trade.initialRisk)
                            .reduce((acc, trade) => acc + trade.pnl / (trade.initialRisk || 1), 0)
                            .toFixed(2)}
                          R
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}

            {activeTab === 'filter' ? (
              <motion.div key="filter" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
                <div className="flex flex-col gap-6 bg-[#121214] border border-white/5 rounded-2xl p-6">
                  <h2 className="text-2xl font-bold">Advanced Filters</h2>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-xs font-mono uppercase text-zinc-500 tracking-wider">Date Range</h3>
                      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                        <CalendarIcon className="w-4 h-4 text-zinc-500" />
                        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="bg-transparent text-xs focus:outline-none" />
                        <span className="text-zinc-600">to</span>
                        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="bg-transparent text-xs focus:outline-none" />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-xs font-mono uppercase text-zinc-500 tracking-wider">Time Presets</h3>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'all', label: 'All Time' },
                          { id: '30', label: 'Last 30 Days' },
                          { id: '60', label: 'Last 60 Days' },
                          { id: '90', label: 'Last 90 Days' },
                        ].map((preset) => (
                          <button
                            key={preset.id}
                            onClick={() => setFilterPreset(preset.id as 'all' | '30' | '60' | '90')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              filterPreset === preset.id ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-xs font-mono uppercase text-zinc-500 tracking-wider">Tag Filters</h3>
                      <div className="flex flex-wrap gap-2">
                        {globalTags.map((tag) => (
                          <div
                            key={tag}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                              selectedFilterTags.has(tag)
                                ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                                : 'bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10'
                            }`}
                            onClick={() => {
                              setSelectedFilterTags((prev) => {
                                const next = new Set(prev);
                                if (next.has(tag)) next.delete(tag);
                                else next.add(tag);
                                return next;
                              });
                            }}
                          >
                            <span>{tag}</span>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteGlobalTag(tag);
                              }}
                              className="p-0.5 hover:bg-rose-500/20 rounded transition-colors text-zinc-600 hover:text-rose-500"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        {globalTags.length === 0 ? <span className="text-sm text-zinc-600 italic">No tags created yet.</span> : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Filtered Results ({filteredTrades.length})</h3>
                    {hasActiveFilters ? (
                      <button onClick={clearAllFilters} className="text-xs text-rose-500 hover:text-rose-400 font-medium">
                        Clear All Filters
                      </button>
                    ) : null}
                  </div>
                  <TradeTable
                    trades={filteredTrades}
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onSelectAll={handleSelectAll}
                    onAddTag={handleAddTag}
                    onRemoveTag={handleRemoveTag}
                    onDeleteGlobalTag={handleDeleteGlobalTag}
                    onTradeClick={(trade) => setSelectedTradeId(trade.id)}
                    globalTags={globalTags}
                    readOnly
                  />
                </div>
              </motion.div>
            ) : null}

            {activeTab === 'backtesting' ? (
              <motion.div key="backtesting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
                <div className="bg-[#121214] border border-white/5 rounded-2xl p-12 flex flex-col items-center text-center space-y-8">
                  <div className="max-w-2xl w-full space-y-4">
                    <h2 className="text-3xl font-bold tracking-tight">Backtesting Engine</h2>
                    <p className="text-zinc-500 text-sm">
                      Retrieve historical data from Charles Schwab and test your strategies with custom context files.
                    </p>
                  </div>

                  <div className="max-w-3xl w-full relative">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search symbol for historical data (e.g. NVDA, TSLA)..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-6 pl-16 pr-6 text-lg focus:outline-none focus:border-emerald-500/50 transition-all shadow-2xl"
                    />
                  </div>

                  <div className="flex flex-col items-center gap-4">
                    <label className="flex flex-col items-center gap-2 p-8 border-2 border-dashed border-white/5 rounded-2xl hover:border-emerald-500/20 hover:bg-emerald-500/5 transition-all cursor-pointer group">
                      <Upload className="w-8 h-8 text-zinc-500 group-hover:text-emerald-500 transition-colors" />
                      <span className="text-sm font-medium text-zinc-400 group-hover:text-zinc-200">Add context files (.csv, .json, .txt)</span>
                      <input
                        type="file"
                        className="hidden"
                        multiple
                        onChange={(event) => {
                          if (event.target.files) {
                            setContextFiles((prev) => [...prev, ...Array.from(event.target.files || [])]);
                          }
                        }}
                      />
                    </label>
                    {contextFiles.length > 0 ? (
                      <div className="flex flex-wrap gap-2 justify-center max-w-xl">
                        {contextFiles.map((file, index) => (
                          <div key={`${file.name}-${index}`} className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1 rounded-full text-[10px] font-mono">
                            <X className="w-3 h-3 cursor-pointer hover:text-rose-500" onClick={() => setContextFiles((prev) => prev.filter((_, idx) => idx !== index))} />
                            {file.name}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">
                      Context files help the engine understand your strategy parameters
                    </p>
                  </div>

                  <div className="pt-8 border-t border-white/5 w-full flex justify-center">
                    <button
                      onClick={handleConnectSchwab}
                      className="flex items-center gap-3 bg-[#00338d] hover:bg-[#002a75] text-white px-8 py-4 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20"
                    >
                      <Activity className="w-5 h-5" />
                      Connect Charles Schwab API
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </main>

      <NewTradeDialog open={isManualTradeOpen} onOpenChange={setIsManualTradeOpen} onCreateTrade={handleCreateManualTrade} />
      <TradeDetailSheet
        key={selectedTrade?.id ?? 'no-trade'}
        trade={selectedTrade}
        open={!!selectedTrade}
        onOpenChange={(open) => {
          if (!open) setSelectedTradeId(null);
        }}
        onSaveNotes={handleSaveNotes}
      />

      {isImporting ? (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-[#121214] border border-white/10 p-8 rounded-2xl flex flex-col items-center gap-4 shadow-2xl">
            <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-sm font-medium">Processing Trade Data...</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
