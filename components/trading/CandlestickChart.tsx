'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type LineWidth,
  type Time,
} from 'lightweight-charts';
import { sma, ema, bollingerBands } from '@/lib/indicators';

export interface CandleData {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeMarker {
  time: number;
  direction: 'LONG' | 'SHORT';
  price: number;
  label: string;
}

export type IndicatorType = 'sma20' | 'sma50' | 'ema12' | 'ema26' | 'bollinger';

interface CandlestickChartProps {
  candles: CandleData[];
  indicators?: IndicatorType[];
  tradeMarkers?: TradeMarker[];
  height?: number;
}

function toUTCSeconds(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
}

export default function CandlestickChart({
  candles,
  indicators = [],
  tradeMarkers = [],
  height = 400,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#121214' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: '#ffffff08' },
        horzLines: { color: '#ffffff08' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#ffffff10',
      },
      timeScale: {
        borderColor: '#ffffff10',
        timeVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lineSeriesRefs.current = [];
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || candles.length === 0) return;

    // Remove old line series
    for (const ls of lineSeriesRefs.current) {
      chart.removeSeries(ls);
    }
    lineSeriesRefs.current = [];

    // Sort candles by time
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);

    const candleData: CandlestickData[] = sorted.map((c) => ({
      time: toUTCSeconds(c.datetime),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData: HistogramData[] = sorted.map((c) => ({
      time: toUTCSeconds(c.datetime),
      value: c.volume,
      color: c.close >= c.open ? '#10b98133' : '#ef444433',
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // Indicators
    const closes = sorted.map((c) => c.close);
    const times = sorted.map((c) => toUTCSeconds(c.datetime));

    const addLine = (values: (number | null)[], color: string, lineWidth: LineWidth = 1 as LineWidth) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: lineWidth as LineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const lineData: LineData[] = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] !== null) {
          lineData.push({ time: times[i], value: values[i]! });
        }
      }
      series.setData(lineData);
      lineSeriesRefs.current.push(series);
    };

    for (const ind of indicators) {
      if (ind === 'sma20') addLine(sma(closes, 20), '#f59e0b');
      else if (ind === 'sma50') addLine(sma(closes, 50), '#3b82f6');
      else if (ind === 'ema12') addLine(ema(closes, 12), '#8b5cf6');
      else if (ind === 'ema26') addLine(ema(closes, 26), '#ec4899');
      else if (ind === 'bollinger') {
        const bb = bollingerBands(closes, 20, 2);
        addLine(bb.upper, '#6366f1', 1);
        addLine(bb.middle, '#6366f180', 1);
        addLine(bb.lower, '#6366f1', 1);
      }
    }

    // Trade markers
    if (tradeMarkers.length > 0) {
      const markers = tradeMarkers
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          time: toUTCSeconds(m.time),
          position: m.direction === 'LONG' ? ('belowBar' as const) : ('aboveBar' as const),
          color: m.direction === 'LONG' ? '#10b981' : '#ef4444',
          shape: m.direction === 'LONG' ? ('arrowUp' as const) : ('arrowDown' as const),
          text: m.label,
        }));
      createSeriesMarkers(candleSeries, markers);
    }

    chart.timeScale().fitContent();
  }, [candles, indicators, tradeMarkers]);

  return <div ref={containerRef} />;
}
