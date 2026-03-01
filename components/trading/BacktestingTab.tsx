'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Search, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';

type SchwabStatusResponse = {
  connected: boolean;
  expiresAt?: string;
};

type Candle = {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type MarketDataResponse = {
  symbol: string;
  candles: Candle[];
};

export default function BacktestingTab() {
  const [symbolQuery, setSymbolQuery] = useState('NVDA');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [status, setStatus] = useState<SchwabStatusResponse>({ connected: false });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [contextFiles, setContextFiles] = useState<File[]>([]);

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

  const loadSymbolData = useCallback(async (symbol: string) => {
    try {
      setLoadingData(true);
      const cleanSymbol = symbol.trim().toUpperCase();
      if (!cleanSymbol) return;

      const res = await fetch(`/api/schwab/market-data?symbol=${encodeURIComponent(cleanSymbol)}`);
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
  }, []);

  const chartData = useMemo(
    () =>
      (marketData?.candles ?? []).map((candle) => ({
        date: format(new Date(candle.datetime), 'MM/dd'),
        close: candle.close,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        volume: candle.volume,
      })),
    [marketData],
  );

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
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-6 pl-16 pr-28 text-lg shadow-2xl transition-all focus:border-emerald-500/50 focus:outline-none"
          />
          <button
            onClick={() => loadSymbolData(symbolQuery)}
            disabled={loadingData || !status.connected}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingData ? 'Loading...' : 'Fetch'}
          </button>
        </div>

        <label className="group flex max-w-xl cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/5 p-8 transition-all hover:border-emerald-500/20 hover:bg-emerald-500/5">
          <Upload className="h-8 w-8 text-zinc-500 transition-colors group-hover:text-emerald-500" />
          <span className="text-sm font-medium text-zinc-400 transition-colors group-hover:text-zinc-200">Add context files (.csv, .json, .txt)</span>
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
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          {activeSymbol ? `${activeSymbol} Historical Price` : 'Historical Price'}
        </h3>
        {loadingData ? (
          <div className="flex h-[360px] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-zinc-500">
            {status.connected ? 'Search a symbol to load historical data.' : 'Connect Schwab to fetch historical data.'}
          </div>
        ) : (
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  formatter={(value: number | string | undefined, key: string | undefined) => [
                    Number(value ?? 0).toFixed(2),
                    key ?? 'close',
                  ]}
                />
                <Line type="monotone" dataKey="close" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </motion.div>
  );
}
