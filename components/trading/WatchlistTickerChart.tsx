'use client';

import { useMemo } from 'react';

import CandlestickChart from '@/components/trading/CandlestickChart';
import { useCandleData } from '@/hooks/use-candle-data';
import { buildTradeChartOptions } from '@/lib/chart-timeframes';

interface WatchlistTickerChartProps {
  ticker: string;
  // YYYY-MM-DD date of the daily review the watchlist row belongs to.
  date: string;
}

// Renders a 5m intraday candlestick chart for a watchlist ticker on a given day.
// Mirrors JournalTradeChart but takes a (ticker, date) pair instead of a Trade,
// so it works for rows where we never opened a position. No markers — those are
// trade-specific and there's no trade here.
export default function WatchlistTickerChart({ ticker, date }: WatchlistTickerChartProps) {
  const chartOptions = useMemo(() => buildTradeChartOptions(date, '5m'), [date]);
  const { candles, isLoading, error } = useCandleData(ticker, chartOptions);

  if (!ticker) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        Add a ticker to load a chart.
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">Loading chart…</div>;
  }

  if (error) {
    return <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">{error}</div>;
  }

  if (candles.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        No intraday candles for this day.
      </div>
    );
  }

  return (
    <CandlestickChart
      candles={candles}
      height={360}
      exactPriceMarkers
      showTimeAxis
      showSessionShading
    />
  );
}
