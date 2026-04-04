'use client';

import { useCallback, useEffect, useState } from 'react';

// Shape returned by /api/tradingview/gainers
interface TradingViewGainer {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
}

interface Props {
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
}

function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export default function ResearchGainersList({ selectedTicker, onSelectTicker }: Props) {
  const [gainers, setGainers] = useState<TradingViewGainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRealtime, setIsRealtime] = useState(false);

  const fetchGainers = useCallback(async () => {
    try {
      const response = await fetch('/api/tradingview/gainers');
      if (!response.ok) return;
      const data = (await response.json()) as {
        gainers: TradingViewGainer[];
        isRealtime: boolean;
      };
      setGainers(data.gainers ?? []);
      setIsRealtime(data.isRealtime ?? false);
    } catch {
      // Silently fail; list remains as-is.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGainers();
    // Poll every 60 seconds — TradingView data refreshes in near real-time
    const interval = setInterval(() => {
      void fetchGainers();
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchGainers]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 border-b border-white/10 bg-[#121214] px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">Top Gainers</h3>
          {!loading && (
            <span className={`text-[10px] font-medium ${isRealtime ? 'text-emerald-500' : 'text-yellow-500'}`}>
              {isRealtime ? 'LIVE' : '15-MIN DELAY'}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[10px] text-zinc-600">+30% &bull; &lt;$300M mcap &bull; price &gt;$1.12</p>
      </div>

      {loading ? (
        <p className="px-3 py-4 text-sm text-zinc-500">Loading gainers...</p>
      ) : gainers.length === 0 ? (
        <p className="px-3 py-4 text-sm text-zinc-500">No gainers found</p>
      ) : (
        <div className="flex flex-col">
          {gainers.map((gainer) => (
            <button
              key={gainer.ticker}
              type="button"
              onClick={() => onSelectTicker(gainer.ticker)}
              className={`flex items-center justify-between border-b border-white/5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/5 ${
                selectedTicker === gainer.ticker ? 'border-l-2 border-l-emerald-500 bg-emerald-500/5' : ''
              }`}
            >
              <div>
                <span className="font-medium text-zinc-200">{gainer.ticker}</span>
                <span className="ml-2 text-zinc-500">${gainer.price.toFixed(2)}</span>
              </div>
              <div className="text-right">
                <span className="text-zinc-500">{formatCompact(gainer.volume)}</span>
                <span className="ml-2 text-emerald-400">+{gainer.change.toFixed(0)}%</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
