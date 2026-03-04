'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Play, Search, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import dynamic from 'next/dynamic';
import type { IndicatorType, CandleData, TradeMarker } from '@/components/trading/CandlestickChart';
import { ALL_STRATEGIES, type StrategyDefinition } from '@/lib/backtesting/strategies';
import { runBacktest, type BacktestResult } from '@/lib/backtesting/engine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { OHLCData } from '@/lib/indicators';
import BacktestResultsPanel from '@/components/trading/BacktestResultsPanel';

const CandlestickChart = dynamic(() => import('@/components/trading/CandlestickChart'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
    </div>
  ),
});

type SchwabStatusResponse = {
  connected: boolean;
  expiresAt?: string;
};

type MarketDataResponse = {
  symbol: string;
  candles: CandleData[];
};

type TimeframeOption = {
  label: string;
  periodType: string;
  period: string;
  frequencyType: string;
  frequency: string;
};

const TIMEFRAMES: TimeframeOption[] = [
  { label: '1D', periodType: 'day', period: '1', frequencyType: 'minute', frequency: '5' },
  { label: '1W', periodType: 'day', period: '5', frequencyType: 'minute', frequency: '30' },
  { label: '1M', periodType: 'month', period: '1', frequencyType: 'daily', frequency: '1' },
  { label: '3M', periodType: 'month', period: '3', frequencyType: 'daily', frequency: '1' },
  { label: '1Y', periodType: 'year', period: '1', frequencyType: 'daily', frequency: '1' },
];

const INDICATOR_OPTIONS: { id: IndicatorType; label: string }[] = [
  { id: 'sma20', label: 'SMA 20' },
  { id: 'sma50', label: 'SMA 50' },
  { id: 'ema12', label: 'EMA 12' },
  { id: 'ema26', label: 'EMA 26' },
  { id: 'bollinger', label: 'Bollinger' },
];

export default function BacktestingTab() {
  const [symbolQuery, setSymbolQuery] = useState('NVDA');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [status, setStatus] = useState<SchwabStatusResponse>({ connected: false });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframeOption>(TIMEFRAMES[4]); // 1Y default
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorType>>(new Set());

  // Backtesting state
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyDefinition>(ALL_STRATEGIES[0]);
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    ALL_STRATEGIES[0].params.forEach((p) => { defaults[p.key] = p.defaultValue; });
    return defaults;
  });
  const [initialCapital, setInitialCapital] = useState(10000);
  const [positionSizePct, setPositionSizePct] = useState(0.1);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [runningBacktest, setRunningBacktest] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const res = await fetch('/api/schwab/status');
      const data = (await res.json()) as SchwabStatusResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not load Schwab status');
      }
      setStatus(data);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Could not load Schwab status';
      toast.error(text);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SCHWAB_AUTH_SUCCESS') {
        toast.success('Charles Schwab connected');
        refreshStatus();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshStatus]);

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

  const loadSymbolData = useCallback(async (symbol: string, tf: TimeframeOption = selectedTimeframe) => {
    try {
      setLoadingData(true);
      const cleanSymbol = symbol.trim().toUpperCase();
      if (!cleanSymbol) return;

      const params = new URLSearchParams({
        symbol: cleanSymbol,
        periodType: tf.periodType,
        period: tf.period,
        frequencyType: tf.frequencyType,
        frequency: tf.frequency,
      });

      const res = await fetch(`/api/schwab/market-data?${params}`);
      const data = (await res.json()) as MarketDataResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not fetch market data');
      }

      setActiveSymbol(cleanSymbol);
      setMarketData(data);
      if (!data.candles?.length) {
        toast.warning(`No historical candles returned for ${cleanSymbol}`);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Could not fetch market data';
      toast.error(text);
      setMarketData(null);
    } finally {
      setLoadingData(false);
    }
  }, [selectedTimeframe]);

  const handleTimeframeChange = (tf: TimeframeOption) => {
    setSelectedTimeframe(tf);
    if (activeSymbol) {
      loadSymbolData(activeSymbol, tf);
    }
  };

  const toggleIndicator = (id: IndicatorType) => {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const candles = useMemo(() => marketData?.candles ?? [], [marketData]);

  const handleStrategyChange = (stratId: string) => {
    const strat = ALL_STRATEGIES.find((s) => s.id === stratId);
    if (!strat) return;
    setSelectedStrategy(strat);
    const defaults: Record<string, number> = {};
    strat.params.forEach((p) => { defaults[p.key] = p.defaultValue; });
    setStrategyParams(defaults);
    setBacktestResult(null);
  };

  const handleRunBacktest = () => {
    if (candles.length === 0) {
      toast.error('Load market data first');
      return;
    }

    setRunningBacktest(true);
    setBacktestResult(null);

    // Run in a setTimeout to avoid blocking the UI
    setTimeout(() => {
      try {
        const ohlcData: OHLCData[] = candles.map((c) => ({
          time: c.datetime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        const stratConfig = selectedStrategy.createConfig(strategyParams);
        const result = runBacktest(ohlcData, {
          initialCapital,
          positionSizePct,
          ...stratConfig,
        });

        setBacktestResult(result);
        toast.success(`Backtest complete: ${result.trades.length} trades`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Backtest failed');
      } finally {
        setRunningBacktest(false);
      }
    }, 10);
  };

  const tradeMarkers: TradeMarker[] = useMemo(() => {
    if (!backtestResult) return [];
    return backtestResult.trades.flatMap((trade) => [
      { time: trade.entryTime, direction: trade.direction, price: trade.entryPrice, label: `${trade.direction} Entry` },
      { time: trade.exitTime, direction: trade.direction, price: trade.exitPrice, label: 'Exit' },
    ]);
  }, [backtestResult]);

  return (
    <motion.div key="backtesting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
      <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#121214] p-5">
        <div>
          <h2 className="text-xl font-bold">Backtesting Engine</h2>
          <p className="mt-1 text-xs text-zinc-500">Historical market data via Charles Schwab API</p>
        </div>
        {loadingStatus ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">Checking...</span>
        ) : status.connected ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
            Connected{status.expiresAt ? ` • expires ${format(new Date(status.expiresAt), 'PP p')}` : ''}
          </span>
        ) : (
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-400">Not connected</span>
        )}
      </div>

      <div className="space-y-6 rounded-2xl border border-white/5 bg-[#121214] p-8">
        <div className="relative max-w-3xl">
          <Search className="absolute left-6 top-1/2 h-6 w-6 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search symbol for historical data (e.g. NVDA, TSLA)..."
            value={symbolQuery}
            onChange={(event) => setSymbolQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                loadSymbolData(symbolQuery);
              }
            }}
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-6 pl-16 pr-28 text-lg shadow-2xl transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
          />
          <button
            onClick={() => loadSymbolData(symbolQuery)}
            disabled={loadingData || !status.connected}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingData ? 'Loading...' : 'Fetch'}
          </button>
        </div>

        <label className="group flex max-w-xl cursor-not-allowed flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/5 p-8">
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            Coming Soon
          </span>
          <Upload className="h-8 w-8 text-zinc-500 transition-colors group-hover:text-emerald-500" />
          <span className="text-sm font-medium text-zinc-400">Add context files (.csv, .json, .txt)</span>
          <span className="text-center text-xs text-zinc-500">Upload CSV, JSON, or TXT files for AI-assisted analysis (not yet functional).</span>
          <input
            type="file"
            className="hidden"
            multiple
            disabled
            onChange={(event) => {
              if (event.target.files) {
                setContextFiles((prev) => [...prev, ...Array.from(event.target.files || [])]);
              }
            }}
          />
        </label>

        {contextFiles.length > 0 ? (
          <div className="flex max-w-xl flex-wrap gap-2">
            {contextFiles.map((file, index) => (
              <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px]">
                <X className="h-3 w-3 cursor-pointer hover:text-rose-500" onClick={() => setContextFiles((prev) => prev.filter((_, idx) => idx !== index))} />
                {file.name}
              </div>
            ))}
          </div>
        ) : null}

        {!status.connected ? (
          <button
            onClick={handleConnectSchwab}
            className="flex w-fit items-center gap-3 rounded-xl bg-[#00338d] px-8 py-4 font-bold text-white shadow-lg shadow-blue-900/20 transition-all hover:bg-[#002a75]"
          >
            <Activity className="h-5 w-5" />
            Connect Charles Schwab API
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            {activeSymbol ? `${activeSymbol} Historical Price` : 'Historical Price'}
          </h3>

          <div className="flex items-center gap-4">
            {/* Timeframe selector */}
            <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.label}
                  onClick={() => handleTimeframeChange(tf)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    selectedTimeframe.label === tf.label
                      ? 'bg-emerald-500 text-black'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {/* Indicator toggles */}
            <div className="flex gap-1">
              {INDICATOR_OPTIONS.map((ind) => (
                <button
                  key={ind.id}
                  onClick={() => toggleIndicator(ind.id)}
                  className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors ${
                    activeIndicators.has(ind.id)
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {ind.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadingData ? (
          <div className="flex h-[400px] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
          </div>
        ) : candles.length === 0 ? (
          <div className="flex h-[400px] items-center justify-center text-sm text-zinc-500">
            {status.connected ? 'Search a symbol to load historical data.' : 'Connect Schwab to fetch historical data.'}
          </div>
        ) : (
          <CandlestickChart
            candles={candles}
            indicators={Array.from(activeIndicators)}
            tradeMarkers={tradeMarkers}
            height={400}
          />
        )}
      </div>
      {/* Backtesting Strategy Panel */}
      <div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">Backtesting</h3>

        <div className="mb-4 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Strategy</label>
            <Select value={selectedStrategy.id} onValueChange={handleStrategyChange}>
              <SelectTrigger className="w-full border-white/10 bg-white/5 text-sm focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-[#121214] text-white">
                {ALL_STRATEGIES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-zinc-500">{selectedStrategy.description}</p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Initial Capital</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value) || 10000)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Position Size %</label>
            <input
              type="number"
              value={(positionSizePct * 100).toFixed(0)}
              onChange={(e) => setPositionSizePct((Number(e.target.value) || 10) / 100)}
              min={1}
              max={100}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 block text-xs text-zinc-400">Parameters</label>
            {selectedStrategy.params.map((p) => (
              <div key={p.key} className="mb-1 flex items-center gap-2">
                <span className="text-[10px] text-zinc-500">{p.label}</span>
                <input
                  type="number"
                  value={strategyParams[p.key] ?? p.defaultValue}
                  onChange={(e) => setStrategyParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) || p.defaultValue }))}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  className="w-20 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleRunBacktest}
          disabled={runningBacktest || candles.length === 0}
          className="flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-2 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {runningBacktest ? 'Running...' : 'Run Backtest'}
        </button>

        {backtestResult ? (
          <div className="mt-6">
            <BacktestResultsPanel result={backtestResult} />
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
