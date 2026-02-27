'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { 
  TrendingUp, 
  Activity, 
  Layers, 
  Settings, 
  Search, 
  Bell, 
  User,
  LayoutGrid,
  Upload,
  Calendar as CalendarIcon,
  BarChart3,
  List,
  Plus,
  Trash2,
  ChevronDown,
  Filter
} from 'lucide-react';

import { Trade, Direction } from '@/lib/types';
import { parsePrice, calculatePnL, formatCurrency } from '@/lib/trading-utils';
import { parseDateFromFilename, processCsvData } from '@/lib/csv-parser';
import TradeTable from '@/components/trading/TradeTable';
import PerformanceCharts from '@/components/trading/PerformanceCharts';
import TradingCalendar from '@/components/trading/TradingCalendar';
import { format, isWithinInterval, parseISO, subDays, isAfter } from 'date-fns';
import { X, Tag as TagIcon } from 'lucide-react';

export default function NexusTerminal() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'journal' | 'performance' | 'filter' | 'backtesting'>('dashboard');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [user, setUser] = useState<{ name: string; email: string; picture?: string } | null>(null);
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Selection & Filtering
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [riskInput, setRiskInput] = useState('');
  const [performanceMetric, setPerformanceMetric] = useState<'$' | 'R'>('$');
  
  // Filter Page State
  const [filterPreset, setFilterPreset] = useState<'all' | '30' | '60' | '90'>('all');
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Load data from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('nexus-trades');
    const savedTags = localStorage.getItem('nexus-tags');
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const loadedTrades = parsed.map((t: any) => ({ ...t, date: new Date(t.date) }));
        setTrades(loadedTrades.sort((a: Trade, b: Trade) => b.date.getTime() - a.date.getTime()));
      } catch (e) {
        console.error('Failed to load trades', e);
      }
    }
    
    if (savedTags) {
      try {
        setGlobalTags(JSON.parse(savedTags));
      } catch (e) {
        console.error('Failed to load tags', e);
      }
    }
    
    setMounted(true);
  }, []);

  // Save data to localStorage when trades or tags change
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('nexus-trades', JSON.stringify(trades));
      localStorage.setItem('nexus-tags', JSON.stringify(globalTags));
    }
  }, [trades, globalTags, mounted]);

  const sortTrades = (list: Trade[]) => [...list].sort((a, b) => b.date.getTime() - a.date.getTime());

  const filteredTrades = sortTrades(trades.filter(trade => {
    // Search Filter (Always active if query exists)
    if (searchQuery) {
      if (!trade.symbol.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    }

    // Date Range Filter (Filter Page)
    if (activeTab === 'filter') {
      if (startDate || endDate) {
        const tradeDate = new Date(trade.date);
        const start = startDate ? parseISO(startDate) : new Date(0);
        const end = endDate ? parseISO(endDate) : new Date(8640000000000000);
        if (!isWithinInterval(tradeDate, { start, end })) return false;
      }

      // Presets
      if (filterPreset !== 'all') {
        const days = parseInt(filterPreset);
        const cutoff = subDays(new Date(), days);
        if (!isAfter(new Date(trade.date), cutoff)) return false;
      }
      
      // Tags
      if (selectedFilterTags.size > 0) {
        if (!trade.tags || !trade.tags.some(tag => selectedFilterTags.has(tag))) return false;
      }
    }
    
    return true;
  }));

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (ids: string[]) => {
    const allSelected = ids.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    
    setTrades(currentTrades => {
      const nextTrades = currentTrades.filter(t => !selectedIds.has(t.id));
      localStorage.setItem('nexus-trades', JSON.stringify(nextTrades));
      return nextTrades;
    });
    
    setSelectedIds(new Set());
  };

  const handleApplyRisk = () => {
    const risk = parseFloat(riskInput);
    if (isNaN(risk)) return;
    
    setTrades(prev => prev.map(t => {
      if (selectedIds.has(t.id)) {
        return { ...t, initialRisk: risk };
      }
      return t;
    }));
    setRiskInput('');
    setSelectedIds(new Set());
  };

  // Tagging Logic
  const handleAddTag = (tradeId: string, tagName: string) => {
    const cleanTag = tagName.trim();
    if (!cleanTag) return;

    setTrades(prev => prev.map(t => {
      if (t.id === tradeId) {
        const tags = t.tags || [];
        if (!tags.includes(cleanTag)) {
          return { ...t, tags: [...tags, cleanTag] };
        }
      }
      return t;
    }));

    setGlobalTags(prev => {
      if (!prev.includes(cleanTag)) {
        return [...prev, cleanTag];
      }
      return prev;
    });
  };

  const handleRemoveTag = (tradeId: string, tagName: string) => {
    setTrades(prev => prev.map(t => {
      if (t.id === tradeId) {
        return { ...t, tags: (t.tags || []).filter(tag => tag !== tagName) };
      }
      return t;
    }));
  };

  const handleDeleteGlobalTag = (tagName: string) => {
    setGlobalTags(prev => prev.filter(t => t !== tagName));
    setTrades(prev => prev.map(t => ({
      ...t,
      tags: (t.tags || []).filter(tag => tag !== tagName)
    })));
    setSelectedFilterTags(prev => {
      const next = new Set(prev);
      next.delete(tagName);
      return next;
    });
  };

  const handleBulkAddTag = () => {
    const cleanTag = bulkTagInput.trim();
    if (!cleanTag || selectedIds.size === 0) return;

    setTrades(prev => prev.map(t => {
      if (selectedIds.has(t.id)) {
        const tags = t.tags || [];
        if (!tags.includes(cleanTag)) {
          return { ...t, tags: [...tags, cleanTag] };
        }
      }
      return t;
    }));

    setGlobalTags(prev => {
      if (!prev.includes(cleanTag)) {
        return [...prev, cleanTag];
      }
      return prev;
    });

    setBulkTagInput('');
    setSelectedIds(new Set());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setError(null);

    const allNewTrades: Trade[] = [];
    const processedDates = new Set<string>();

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dateInfo = parseDateFromFilename(file.name);
        
        if (!dateInfo) {
          console.warn(`Skipping invalid filename: ${file.name}`);
          continue;
        }

        processedDates.add(dateInfo.sortKey);

        await new Promise<void>((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              try {
                const tradesFromFile = processCsvData(results.data, dateInfo);
                allNewTrades.push(...tradesFromFile);
                resolve();
              } catch (err) {
                reject(err);
              }
            },
            error: (error) => reject(error)
          });
        });
      }

      setTrades((prev) => {
        const filtered = prev.filter(t => !processedDates.has(t.sortKey));
        return sortTrades([...allNewTrades, ...filtered]);
      });
    } catch (err: any) {
      setError(`Processing error: ${err.message}`);
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    setSearchQuery('');
  };

  const handleGoogleLogin = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      const { url } = await res.json();
      const popup = window.open(url, 'google_login', 'width=500,height=600');
      
      if (!popup) {
        alert('Please allow popups for this site');
        return;
      }
    } catch (err) {
      console.error('Login failed', err);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        // Refresh user session
        fetch('/api/auth/me')
          .then(res => res.json())
          .then(data => {
            if (data.user) setUser(data.user);
          });
      }
      if (event.data?.type === 'SCHWAB_AUTH_SUCCESS') {
        alert('Charles Schwab connected successfully!');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    // Initial session check
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.user) setUser(data.user);
      });
  }, []);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E4E4E7] font-sans selection:bg-emerald-500/30">
      {/* Sidebar */}
      <nav className="fixed left-0 top-0 h-full w-16 border-r border-white/5 bg-[#0A0A0B] flex flex-col items-center py-6 gap-8 z-50">
        <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 cursor-pointer">
          <Activity className="text-black w-6 h-6" />
        </div>
        <div className="flex flex-col gap-6 text-zinc-500">
          <button onClick={() => handleTabChange('dashboard')} className={`p-2 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`} title="Dashboard">
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button onClick={() => handleTabChange('performance')} className={`p-2 rounded-lg transition-colors ${activeTab === 'performance' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`} title="Performance">
            <BarChart3 className="w-5 h-5" />
          </button>
          <button onClick={() => handleTabChange('journal')} className={`p-2 rounded-lg transition-colors ${activeTab === 'journal' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`} title="Journal">
            <List className="w-5 h-5" />
          </button>
          <button onClick={() => handleTabChange('filter')} className={`p-2 rounded-lg transition-colors ${activeTab === 'filter' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`} title="Filter">
            <Filter className="w-5 h-5" />
          </button>
          <button onClick={() => handleTabChange('backtesting')} className={`p-2 rounded-lg transition-colors ${activeTab === 'backtesting' ? 'text-emerald-500 bg-emerald-500/10' : 'hover:text-white'}`} title="Backtesting">
            <Search className="w-5 h-5" />
          </button>
          <Bell className="w-5 h-5 cursor-pointer hover:text-white transition-colors" />
        </div>
        <div className="mt-auto flex flex-col gap-6 text-zinc-500">
          <Settings className="w-5 h-5 cursor-pointer hover:text-white transition-colors" />
          <User className="w-5 h-5 cursor-pointer hover:text-white transition-colors" />
        </div>
      </nav>

      {/* Main Content */}
      <main className="pl-16">
        {/* Header */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 sticky top-0 bg-[#0A0A0B]/80 backdrop-blur-md z-40">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-medium tracking-tight">Nexus Terminal</h1>
            <div className="h-4 w-[1px] bg-white/10 mx-2" />
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {trades.length} TRADES LOGGED
            </div>
          </div>
          
          {error && (
            <div className="flex-1 mx-8 px-4 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-500 text-xs font-medium animate-in fade-in slide-in-from-top-1">
              {error}
            </div>
          )}
          
            <div className="flex items-center gap-3">
              {user ? (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs font-medium">{user.name}</div>
                  <div className="text-[10px] text-zinc-500">{user.email}</div>
                </div>
                <button onClick={handleLogout} className="group relative">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full border border-white/10" />
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
                  onClick={handleGoogleLogin}
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-4 h-4" alt="Google" />
                  Login with Google
                </button>
              )}

              {selectedIds.size > 0 && (
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
              )}
              
              <label className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Bulk Import
                <input type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />
              </label>

              <button className="bg-emerald-500 hover:bg-emerald-400 text-black font-medium px-4 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2">
                <Plus className="w-4 h-4" />
                New Trade
              </button>
            </div>
        </header>

        {/* Dynamic Content */}
        <div className="p-8 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                    <div className="text-zinc-500 text-xs font-mono uppercase mb-2">Total PnL</div>
                    <div className={`text-3xl font-bold tracking-tight ${trades.reduce((acc, t) => acc + t.pnl, 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      ${trades.reduce((acc, t) => acc + t.pnl, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                    <div className="text-zinc-500 text-xs font-mono uppercase mb-2">Win Rate</div>
                    <div className="text-3xl font-bold tracking-tight">
                      {trades.length > 0 ? ((trades.filter(t => t.pnl > 0).length / trades.length) * 100).toFixed(1) : '0.0'}%
                    </div>
                  </div>
                  <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                    <div className="text-zinc-500 text-xs font-mono uppercase mb-2">Profit Factor</div>
                    <div className="text-3xl font-bold tracking-tight">
                      {(() => {
                        const wins = trades.filter(t => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
                        const losses = Math.abs(trades.filter(t => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0));
                        return losses === 0 ? (wins > 0 ? '∞' : '0.00') : (wins / losses).toFixed(2);
                      })()}
                    </div>
                  </div>
                </div>

                <PerformanceCharts trades={trades} metric={performanceMetric} />
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Recent Trades</h2>
                    <button onClick={() => setActiveTab('journal')} className="text-sm text-emerald-500 hover:text-emerald-400">View Journal</button>
                  </div>
                  <TradeTable 
                    trades={trades.slice(0, 10)} 
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onSelectAll={handleSelectAll}
                    onAddTag={handleAddTag}
                    onRemoveTag={handleRemoveTag}
                    onDeleteGlobalTag={handleDeleteGlobalTag}
                    globalTags={globalTags}
                    readOnly
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'journal' && (
              <motion.div 
                key="journal"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
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
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors w-64"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {selectedIds.size > 0 && (
                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">Set Risk:</span>
                            <input 
                              type="number" 
                              placeholder="$500"
                              value={riskInput}
                              onChange={(e) => setRiskInput(e.target.value)}
                              className="w-16 bg-transparent text-xs focus:outline-none border-b border-white/10"
                            />
                            <button 
                              onClick={handleApplyRisk}
                              className="text-emerald-500 hover:text-emerald-400 text-[10px] font-bold uppercase"
                            >
                              Apply
                            </button>
                          </div>
                          
                          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                            <TagIcon className="w-3 h-3 text-zinc-500" />
                            <input 
                              type="text" 
                              placeholder="Add Tag..."
                              value={bulkTagInput}
                              onChange={(e) => setBulkTagInput(e.target.value)}
                              className="w-20 bg-transparent text-xs focus:outline-none border-b border-white/10"
                            />
                            <button 
                              onClick={handleBulkAddTag}
                              className="text-emerald-500 hover:text-emerald-400 text-[10px] font-bold uppercase"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
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
                  globalTags={globalTags}
                />
              </motion.div>
            )}

            {activeTab === 'performance' && (
              <motion.div 
                key="performance"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
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

                <PerformanceCharts trades={trades} metric={performanceMetric} />
                
                <TradingCalendar trades={trades} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-[#121214] border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-sm font-semibold mb-4 text-zinc-400 uppercase tracking-wider">Symbol Distribution</h3>
                    <div className="space-y-3">
                      {Object.entries(trades.reduce((acc: any, t) => {
                        acc[t.symbol] = (acc[t.symbol] || 0) + 1;
                        return acc;
                      }, {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5).map(([symbol, count]: any) => (
                        <div key={symbol} className="flex items-center justify-between">
                          <span className="text-sm font-mono">{symbol}</span>
                          <div className="flex-1 mx-4 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${(count / trades.length) * 100}%` }} />
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
                          {formatCurrency(trades.filter(t => t.initialRisk).reduce((acc, t) => acc + (t.initialRisk || 0), 0) / (trades.filter(t => t.initialRisk).length || 1))}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-zinc-500">Total R-Multiple</span>
                        <span className="text-sm font-mono text-emerald-500">
                          {trades.filter(t => t.initialRisk).reduce((acc, t) => acc + (t.pnl / (t.initialRisk || 1)), 0).toFixed(2)}R
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'filter' && (
              <motion.div 
                key="filter"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex flex-col gap-6 bg-[#121214] border border-white/5 rounded-2xl p-6">
                  <div className="flex flex-col gap-6">
                    <h2 className="text-2xl font-bold">Advanced Filters</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      {/* Date Range Filter */}
                      <div className="space-y-4">
                        <h3 className="text-xs font-mono uppercase text-zinc-500 tracking-wider">Date Range</h3>
                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                          <CalendarIcon className="w-4 h-4 text-zinc-500" />
                          <input 
                            type="date" 
                            value={startDate} 
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-transparent text-xs focus:outline-none"
                          />
                          <span className="text-zinc-600">to</span>
                          <input 
                            type="date" 
                            value={endDate} 
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-transparent text-xs focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Presets */}
                      <div className="space-y-4">
                        <h3 className="text-xs font-mono uppercase text-zinc-500 tracking-wider">Time Presets</h3>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { id: 'all', label: 'All Time' },
                            { id: '30', label: 'Last 30 Days' },
                            { id: '60', label: 'Last 60 Days' },
                            { id: '90', label: 'Last 90 Days' }
                          ].map(preset => (
                            <button
                              key={preset.id}
                              onClick={() => setFilterPreset(preset.id as any)}
                              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                filterPreset === preset.id 
                                ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' 
                                : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Tags Management */}
                      <div className="space-y-4">
                        <h3 className="text-xs font-mono uppercase text-zinc-500 tracking-wider">Tag Filters</h3>
                        <div className="flex flex-wrap gap-2">
                          {globalTags.map(tag => (
                            <div 
                              key={tag}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                                selectedFilterTags.has(tag)
                                ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                                : 'bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10'
                              }`}
                              onClick={() => {
                                setSelectedFilterTags(prev => {
                                  const next = new Set(prev);
                                  if (next.has(tag)) next.delete(tag);
                                  else next.add(tag);
                                  return next;
                                });
                              }}
                            >
                              <span>{tag}</span>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteGlobalTag(tag);
                                }}
                                className="p-0.5 hover:bg-rose-500/20 rounded transition-colors text-zinc-600 hover:text-rose-500"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          {globalTags.length === 0 && (
                            <span className="text-sm text-zinc-600 italic">No tags created yet. Add tags to trades in the journal.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Filtered Results ({filteredTrades.length})</h3>
                    {selectedFilterTags.size > 0 || filterPreset !== 'all' ? (
                      <button 
                        onClick={() => {
                          setFilterPreset('all');
                          setSelectedFilterTags(new Set());
                        }}
                        className="text-xs text-rose-500 hover:text-rose-400 font-medium"
                      >
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
                    globalTags={globalTags}
                    readOnly
                  />
                </div>
              </motion.div>
            )}
            {activeTab === 'backtesting' && (
              <motion.div 
                key="backtesting"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
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
                        onChange={(e) => {
                          if (e.target.files) {
                            setContextFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                          }
                        }}
                      />
                    </label>
                    {contextFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-center max-w-xl">
                        {contextFiles.map((file, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1 rounded-full text-[10px] font-mono">
                            <X 
                              className="w-3 h-3 cursor-pointer hover:text-rose-500" 
                              onClick={() => setContextFiles(prev => prev.filter((_, i) => i !== idx))}
                            />
                            {file.name}
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">Context files help the engine understand your strategy parameters</p>
                  </div>

                  <div className="pt-8 border-t border-white/5 w-full flex justify-center">
                    <button 
                      onClick={() => {
                        // Schwab OAuth flow
                        fetch('/api/auth/schwab/url')
                          .then(res => res.json())
                          .then(({ url }) => {
                            window.open(url, 'schwab_login', 'width=600,height=700');
                          });
                      }}
                      className="flex items-center gap-3 bg-[#00338d] hover:bg-[#002a75] text-white px-8 py-4 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20"
                    >
                      <Activity className="w-5 h-5" />
                      Connect Charles Schwab API
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Loading Overlay */}
      {isImporting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-[#121214] border border-white/10 p-8 rounded-2xl flex flex-col items-center gap-4 shadow-2xl">
            <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-sm font-medium">Processing Trade Data...</p>
          </div>
        </div>
      )}
    </div>
  );
}
