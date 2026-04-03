'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CrosshairMode, type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';

import { useCandleData } from '@/hooks/use-candle-data';
import {
  RESEARCH_CHART_FRAME_CONFIG,
  type ResearchChartTimeframeKey,
} from '@/lib/chart-timeframes';

function toTime(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
}

interface Props {
  ticker: string;
}

export default function ResearchChart({ ticker }: Props) {
  const [timeframe, setTimeframe] = useState<ResearchChartTimeframeKey>('1D');
  const frame = RESEARCH_CHART_FRAME_CONFIG[timeframe];

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
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;

    const setupChart = async () => {
      if (!containerRef.current) return;
      const { createChart, CandlestickSeries, HistogramSeries } = await import('lightweight-charts');
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
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: { borderColor: '#ffffff10' },
        timeScale: {
          borderColor: '#ffffff10',
          timeVisible: frame.intraday,
          secondsVisible: false,
        },
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#ffffff',
        downColor: '#3b82f6',
        borderUpColor: '#ffffff',
        borderDownColor: '#3b82f6',
        wickUpColor: '#ffffff',
        wickDownColor: '#3b82f6',
      });

      // Volume histogram — rendered behind candles, scaled to bottom 20% of chart
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      chartRef.current = chart;
      seriesRef.current = series;
      volumeRef.current = volume;

      resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current || !chartRef.current) return;
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
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
      volumeRef.current = null;
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

    // Volume bars — white-ish for up candles, blue-ish for down
    if (volumeRef.current) {
      const volumeData: HistogramData[] = sorted.map((candle) => ({
        time: toTime(candle.datetime),
        value: candle.volume,
        color: candle.close >= candle.open ? '#ffffff33' : '#3b82f633',
      }));
      volumeRef.current.setData(volumeData);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2">
        {(Object.keys(RESEARCH_CHART_FRAME_CONFIG) as ResearchChartTimeframeKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTimeframe(key)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              timeframe === key ? 'bg-emerald-500 text-black' : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
            }`}
          >
            {RESEARCH_CHART_FRAME_CONFIG[key].label}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
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
