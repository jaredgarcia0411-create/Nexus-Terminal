'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, type CandlestickData, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';

import { useCandleData } from '@/hooks/use-candle-data';

type TimeframeKey = '1m' | '5m' | '15m' | '30m' | '1h' | '1D';

type FrameConfig = {
  label: string;
  periodType: string;
  period: string;
  frequencyType: string;
  frequency: string;
  intraday: boolean;
};

const FRAME_CONFIG: Record<TimeframeKey, FrameConfig> = {
  '1m': { label: '1m', periodType: 'day', period: '5', frequencyType: 'minute', frequency: '1', intraday: true },
  '5m': { label: '5m', periodType: 'day', period: '10', frequencyType: 'minute', frequency: '5', intraday: true },
  '15m': { label: '15m', periodType: 'month', period: '1', frequencyType: 'minute', frequency: '15', intraday: true },
  '30m': { label: '30m', periodType: 'month', period: '2', frequencyType: 'minute', frequency: '30', intraday: true },
  '1h': { label: '1h', periodType: 'month', period: '3', frequencyType: 'minute', frequency: '60', intraday: true },
  '1D': { label: '1D', periodType: 'year', period: '2', frequencyType: 'daily', frequency: '1', intraday: false },
};

function toTime(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
}

interface Props {
  ticker: string;
}

export default function ResearchChart({ ticker }: Props) {
  const [timeframe, setTimeframe] = useState<TimeframeKey>('30m');
  const frame = FRAME_CONFIG[timeframe];

  const marketOptions = useMemo(
    () => ({
      periodType: frame.periodType,
      period: frame.period,
      frequencyType: frame.frequencyType,
      frequency: frame.frequency,
      includePrePost: frame.intraday,
      refreshIntervalMs: 60_000,
    }),
    [frame.frequency, frame.frequencyType, frame.intraday, frame.period, frame.periodType],
  );

  const { candles, isLoading, error } = useCandleData(ticker, marketOptions);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;

    const setupChart = async () => {
      if (!containerRef.current) return;
      const { createChart, CandlestickSeries } = await import('lightweight-charts');
      if (!mounted || !containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#0A0A0B' },
          textColor: '#71717A',
        },
        grid: {
          vertLines: { color: '#ffffff08' },
          horzLines: { color: '#ffffff08' },
        },
        rightPriceScale: { borderColor: '#ffffff10' },
        timeScale: {
          borderColor: '#ffffff10',
          timeVisible: frame.intraday,
          secondsVisible: false,
        },
        width: containerRef.current.clientWidth,
        height: 300,
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#ffffff',
        downColor: '#3b82f6',
        borderUpColor: '#ffffff',
        borderDownColor: '#3b82f6',
        wickUpColor: '#ffffff',
        wickDownColor: '#3b82f6',
      });

      chartRef.current = chart;
      seriesRef.current = series;

      resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current || !chartRef.current) return;
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: 300,
        });
      });
      resizeObserver.observe(containerRef.current);
    };

    void setupChart();

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [frame.intraday]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const data: CandlestickData[] = sorted.map((candle) => ({
      time: toTime(candle.datetime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2">
        {(Object.keys(FRAME_CONFIG) as TimeframeKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTimeframe(key)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              timeframe === key ? 'bg-emerald-500 text-black' : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
            }`}
          >
            {FRAME_CONFIG[key].label}
          </button>
        ))}
      </div>

      <div className="relative flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">Loading chart...</div>
        ) : null}
        {!isLoading && error ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-400">{error}</div>
        ) : null}
      </div>
    </div>
  );
}
