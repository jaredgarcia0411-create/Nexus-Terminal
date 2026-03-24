'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import {
  Camera,
  ChartCandlestick,
  Grid3X3,
  Magnet,
  Search,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { Trade } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCandleData } from '@/hooks/use-candle-data';
import { atr, bollingerBands, ema, rsi, sma, vwap } from '@/lib/indicators';
import { epochToNySortKey, nyDateTimeToEpoch } from '@/lib/time-utils';
import ChartDrawings from './ChartDrawings';
import DrawingToolbar from './DrawingToolbar';
import type { DrawingTool } from '@/hooks/use-chart-drawings';

type SeriesType = 'candles' | 'bars' | 'line' | 'area' | 'baseline';
type TimeframeKey = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
type TimeRangeKey = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'ALL';

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
  '4h': { label: '4h', periodType: 'month', period: '6', frequencyType: 'minute', frequency: '240', intraday: true },
  '1d': { label: '1D', periodType: 'year', period: '2', frequencyType: 'daily', frequency: '1', intraday: false },
  '1w': { label: '1W', periodType: 'year', period: '5', frequencyType: 'weekly', frequency: '1', intraday: false },
  '1M': { label: '1M', periodType: 'year', period: '10', frequencyType: 'monthly', frequency: '1', intraday: false },
};

type TimeRangeConfig = { label: string; periodType: string; period: string; defaultTimeframe: TimeframeKey };

const TIME_RANGE_CONFIG: Record<TimeRangeKey, TimeRangeConfig> = {
  '1D': { label: '1D', periodType: 'day', period: '1', defaultTimeframe: '5m' },
  '5D': { label: '5D', periodType: 'day', period: '5', defaultTimeframe: '15m' },
  '1M': { label: '1M', periodType: 'month', period: '1', defaultTimeframe: '1h' },
  '3M': { label: '3M', periodType: 'month', period: '3', defaultTimeframe: '4h' },
  '6M': { label: '6M', periodType: 'month', period: '6', defaultTimeframe: '4h' },
  'YTD': { label: 'YTD', periodType: 'year', period: '1', defaultTimeframe: '1d' },
  '1Y': { label: '1Y', periodType: 'year', period: '1', defaultTimeframe: '1d' },
  '5Y': { label: '5Y', periodType: 'year', period: '5', defaultTimeframe: '1w' },
  'ALL': { label: 'All', periodType: 'year', period: '10', defaultTimeframe: '1M' },
};

const UP_COLOR = '#ffffff';
const DOWN_COLOR = '#3b82f6';
const UP_VOLUME_COLOR = '#ffffff33';
const DOWN_VOLUME_COLOR = '#3b82f633';
const SESSION_SHADE = 'rgba(148, 163, 184, 0.12)';
const CHART_SYMBOL_STORAGE_KEY = 'nexus-chart-symbol';

function toTime(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
}

function toEpochMs(time: Time | null | undefined): number | null {
  if (time == null) return null;
  if (typeof time === 'number') return Number.isFinite(time) ? time * 1000 : null;
  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof time === 'object') {
    const businessDay = time as { year?: number; month?: number; day?: number };
    if (
      Number.isFinite(businessDay.year)
      && Number.isFinite(businessDay.month)
      && Number.isFinite(businessDay.day)
    ) {
      return Date.UTC(Number(businessDay.year), Number(businessDay.month) - 1, Number(businessDay.day));
    }
  }
  return null;
}

function BarsIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="10" width="2.2" height="7" rx="1" fill="currentColor" />
      <rect x="5.2" y="7" width="2.2" height="10" rx="1" fill="currentColor" />
      <rect x="8.9" y="4" width="2.2" height="13" rx="1" fill="currentColor" />
      <rect x="12.6" y="8.5" width="2.2" height="8.5" rx="1" fill="currentColor" />
      <rect x="16.3" y="5.5" width="2.2" height="11.5" rx="1" fill="currentColor" />
    </svg>
  );
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

function formatSignedPercent(value: number) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

interface ChartsTabProps {
  trades: Trade[];
}

export default function ChartsTab({ trades }: ChartsTabProps) {
  const recentSymbols = useMemo(() => {
    const seen = new Set<string>();
    const symbols: string[] = [];
    for (const trade of trades) {
      const symbol = trade.symbol?.toUpperCase().trim();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      symbols.push(symbol);
      if (symbols.length >= 8) break;
    }
    return symbols;
  }, [trades]);

  const [symbolInput, setSymbolInput] = useState('');
  const [symbol, setSymbol] = useState(() => {
    const fallback = recentSymbols[0] ?? 'SPY';
    if (typeof window === 'undefined') return fallback;
    try {
      const stored = localStorage.getItem(CHART_SYMBOL_STORAGE_KEY)?.trim().toUpperCase();
      if (stored) return stored;
    } catch {
      return fallback;
    }
    return fallback;
  });
  const [timeframe, setTimeframe] = useState<TimeframeKey>('5m');
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('1D');
  const [seriesType, setSeriesType] = useState<SeriesType>('candles');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareInput, setCompareInput] = useState('QQQ');
  const [compareSymbol, setCompareSymbol] = useState('QQQ');
  const [showVolume, setShowVolume] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [crosshairMagnet, setCrosshairMagnet] = useState(false);
  const [showSma20, setShowSma20] = useState(false);
  const [showEma21, setShowEma21] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [showAtr, setShowAtr] = useState(false);
  const [sessionRects, setSessionRects] = useState<Array<{ key: string; left: number; width: number }>>([]);
  const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
  const [seriesInstance, setSeriesInstance] = useState<ISeriesApi<'Candlestick' | 'Bar'> | null>(null);

  // Drawing tools state
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>(null);
  const [drawingColor] = useState('#ffffff');
  const [drawingLineWidth, setDrawingLineWidth] = useState(2);
  const [drawingsCount, setDrawingsCount] = useState(0);
  const clearAllDrawingsRef = useRef<(() => void) | null>(null);

  const frame = FRAME_CONFIG[timeframe];
  const rangeConfig = TIME_RANGE_CONFIG[timeRange];
  const marketOptions = useMemo(() => ({
    periodType: rangeConfig.periodType,
    period: rangeConfig.period,
    frequencyType: frame.frequencyType,
    frequency: frame.frequency,
    includePrePost: frame.intraday,
  }), [rangeConfig.periodType, rangeConfig.period, frame.frequencyType, frame.frequency, frame.intraday]);

  const { candles, isLoading, error } = useCandleData(symbol, { ...marketOptions, refreshIntervalMs: 60_000 });
  const compareState = useCandleData(compareEnabled ? compareSymbol : null, { ...marketOptions, refreshIntervalMs: 60_000 });

  useEffect(() => {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return;
    try {
      localStorage.setItem(CHART_SYMBOL_STORAGE_KEY, cleanSymbol);
    } catch {
      // Ignore persistence failures.
    }
  }, [symbol]);

  const applySymbolInput = () => {
    const next = symbolInput.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
  };

  const headline = useMemo(() => {
    if (candles.length < 2) return { price: null, changePct: null };
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    if (!prev || prev.close === 0) return { price: last.close, changePct: null };
    return {
      price: last.close,
      changePct: ((last.close - prev.close) / prev.close) * 100,
    };
  }, [candles]);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick' | 'Bar'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const initialWidth = containerRef.current.clientWidth;
    const initialHeight = containerRef.current.clientHeight;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#121214' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: showGrid ? '#ffffff08' : 'transparent' },
        horzLines: { color: showGrid ? '#ffffff08' : 'transparent' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#ffffff10',
      },
      leftPriceScale: {
        borderColor: '#ffffff10',
        visible: compareEnabled,
      },
      timeScale: {
        borderColor: '#ffffff10',
        timeVisible: frame.intraday,
        secondsVisible: false,
      },
      width: initialWidth,
      height: Math.max(initialHeight, 420),
    });

    chartRef.current = chart;

    let baseSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area' | 'Baseline'>;
    if (seriesType === 'bars') {
      baseSeries = chart.addSeries(BarSeries, { upColor: UP_COLOR, downColor: DOWN_COLOR });
    } else if (seriesType === 'line') {
      baseSeries = chart.addSeries(LineSeries, { color: '#22d3ee', lineWidth: 2 });
    } else if (seriesType === 'area') {
      baseSeries = chart.addSeries(AreaSeries, {
        lineColor: '#22d3ee',
        topColor: 'rgba(34, 211, 238, 0.28)',
        bottomColor: 'rgba(34, 211, 238, 0.02)',
      });
    } else if (seriesType === 'baseline') {
      baseSeries = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: candles[0]?.close ?? 0 },
        topLineColor: '#22c55e',
        topFillColor1: 'rgba(34, 197, 94, 0.25)',
        topFillColor2: 'rgba(34, 197, 94, 0.02)',
        bottomLineColor: '#ef4444',
        bottomFillColor1: 'rgba(239, 68, 68, 0.04)',
        bottomFillColor2: 'rgba(239, 68, 68, 0.2)',
      });
    } else {
      baseSeries = chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
      });
    }

    // Store series reference for drawing tools
    if (seriesType === 'candles' || seriesType === 'bars') {
      seriesRef.current = baseSeries as ISeriesApi<'Candlestick'>;
    } else {
      seriesRef.current = null;
    }
    // Use queueMicrotask to avoid synchronous setState in effect
    queueMicrotask(() => {
      if (seriesType === 'candles' || seriesType === 'bars') {
        setSeriesInstance(baseSeries as ISeriesApi<'Candlestick' | 'Bar'>);
      } else {
        setSeriesInstance(null);
      }
      setChartInstance(chart);
    });

    const sortedCandles = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closePrices = sortedCandles.map((c) => c.close);

    if (seriesType === 'candles' || seriesType === 'bars') {
      const data: CandlestickData[] = sortedCandles.map((c) => ({
        time: toTime(c.datetime),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      baseSeries.setData(data);
    } else {
      const data: LineData[] = sortedCandles.map((c) => ({
        time: toTime(c.datetime),
        value: c.close,
      }));
      baseSeries.setData(data);
    }

    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      const volumeData: HistogramData[] = sortedCandles.map((c) => ({
        time: toTime(c.datetime),
        value: c.volume,
        color: c.close >= c.open ? UP_VOLUME_COLOR : DOWN_VOLUME_COLOR,
      }));
      volumeSeries.setData(volumeData);
    }

    if (compareEnabled && compareState.candles.length > 0) {
      const compareSeries = chart.addSeries(LineSeries, {
        color: '#eab308',
        lineWidth: 2,
        priceScaleId: 'left',
      });
      compareSeries.setData(compareState.candles.map((c) => ({
        time: toTime(c.datetime),
        value: c.close,
      })));
    }

    if (showSma20) {
      const values = sma(closePrices, 20);
      const series = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1 });
      series.setData(sortedCandles.flatMap((candle, index) => {
        const value = values[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
    }

    if (showEma21) {
      const values = ema(closePrices, 21);
      const series = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1 });
      series.setData(sortedCandles.flatMap((candle, index) => {
        const value = values[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
    }

    if (showVwap) {
      const values = vwap(sortedCandles.map((candle) => ({
        time: candle.datetime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })));
      const series = chart.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 1 });
      series.setData(sortedCandles.flatMap((candle, index) => {
        const value = values[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
    }

    if (showBollinger) {
      const values = bollingerBands(closePrices, 20, 2);
      const upper = chart.addSeries(LineSeries, { color: '#94a3b8', lineWidth: 1 });
      const lower = chart.addSeries(LineSeries, { color: '#94a3b8', lineWidth: 1 });
      upper.setData(sortedCandles.flatMap((candle, index) => {
        const value = values.upper[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
      lower.setData(sortedCandles.flatMap((candle, index) => {
        const value = values.lower[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
    }

    // RSI on separate pane
    if (showRsi && sortedCandles.length > 0) {
      const rsiValues = rsi(closePrices, 14);
      const rsiPane = chart.addPane();
      rsiPane.setHeight(80);
      rsiPane.setStretchFactor(0.25);
      const rsiSeries = rsiPane.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 1,
        priceLineVisible: false,
      });
      rsiSeries.setData(sortedCandles.flatMap((candle, index) => {
        const value = rsiValues[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
      // Add overbought/oversold lines
      rsiSeries.createPriceLine({
        price: 70,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 2,
        title: 'OB',
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        title: 'OS',
      });
    }

    // ATR on separate pane
    if (showAtr && sortedCandles.length > 0) {
      const atrValues = atr(sortedCandles.map((candle) => ({
        time: candle.datetime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })), 14);
      const atrPane = chart.addPane();
      atrPane.setHeight(60);
      atrPane.setStretchFactor(0.2);
      const atrSeries = atrPane.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        priceLineVisible: false,
      });
      atrSeries.setData(sortedCandles.flatMap((candle, index) => {
        const value = atrValues[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
    }

    chart.timeScale().fitContent();

      const recalcSessionRects = () => {
      if (!frame.intraday || sortedCandles.length === 0 || !chartWrapRef.current) {
        setSessionRects([]);
        return;
      }

      const chartWidth = chartWrapRef.current.clientWidth;
      if (!Number.isFinite(chartWidth) || chartWidth <= 0) {
        setSessionRects([]);
        return;
      }

      const visibleRange = chart.timeScale().getVisibleRange();
      const visibleStart = toEpochMs(visibleRange?.from);
      const visibleEnd = toEpochMs(visibleRange?.to);

      const byDay = new Set<string>();
      for (const candle of sortedCandles) {
        byDay.add(epochToNySortKey(candle.datetime));
      }

      const rects: Array<{ key: string; left: number; width: number }> = [];
      for (const day of byDay) {
        const preStart = nyDateTimeToEpoch(day, '04:00:00');
        const preEnd = nyDateTimeToEpoch(day, '09:30:00');
        const postStart = nyDateTimeToEpoch(day, '16:00:00');
        const postEnd = nyDateTimeToEpoch(day, '20:00:00');
        const spans = [
          { key: `${day}:pre`, start: preStart, end: preEnd },
          { key: `${day}:post`, start: postStart, end: postEnd },
        ];

        for (const span of spans) {
          if (span.start == null || span.end == null || !Number.isFinite(span.start) || !Number.isFinite(span.end)) continue;

          let clippedStart = span.start;
          let clippedEnd = span.end;
          if (visibleStart != null && visibleEnd != null) {
            clippedStart = Math.max(clippedStart, visibleStart);
            clippedEnd = Math.min(clippedEnd, visibleEnd);
          }
          if (clippedEnd <= clippedStart) continue;

          const x1 = chart.timeScale().timeToCoordinate(toTime(clippedStart));
          const x2 = chart.timeScale().timeToCoordinate(toTime(clippedEnd));
          if (x1 == null || x2 == null) continue;

          const leftRaw = Math.min(x1, x2);
          const rightRaw = Math.max(x1, x2);
          const left = Math.max(0, Math.min(leftRaw, chartWidth));
          const right = Math.max(0, Math.min(rightRaw, chartWidth));
          const width = right - left;
          if (width <= 0) continue;
          rects.push({ key: span.key, left, width });
        }
      }
      setSessionRects(rects);
    };

    recalcSessionRects();

    const onVisibleRange = () => {
      recalcSessionRects();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRange);
    chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleRange);

    const resizeObserver = new ResizeObserver(() => {
      const width = containerRef.current?.clientWidth ?? 0;
      const height = containerRef.current?.clientHeight ?? 0;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
        recalcSessionRects();
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRange);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onVisibleRange);
      resizeObserver.disconnect();
      setSessionRects([]);
      chart.remove();
      chartRef.current = null;
    };
  }, [
    candles,
    compareEnabled,
    compareState.candles,
    crosshairMagnet,
    frame.intraday,
    seriesType,
    showAtr,
    showBollinger,
    showEma21,
    showGrid,
    showRsi,
    showSma20,
    showVolume,
    showVwap,
  ]);

  return (
    <motion.div
      key="charts"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-[calc(100dvh-6.5rem)] min-h-[420px] flex-col"
    >
<div className="flex min-h-0 flex-1 flex-col bg-[#090b10]">
{/* Header - 32px height */}
<div className="flex h-8 items-center gap-2 border-b border-white/10 bg-[#090b10] px-2">
<div className="flex items-center gap-1.5">
<Search className="h-3.5 w-3.5 text-zinc-500" />
<Input
value={symbolInput}
onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
onKeyDown={(event) => {
if (event.key === 'Enter') {
applySymbolInput();
}
}}
placeholder={symbol}
className="h-6 w-16 border-0 bg-transparent px-1 text-[11px]"
/>
</div>

          <div className="mr-2 flex items-center gap-1.5 xl:gap-2 xl:border-r xl:border-white/10 xl:pr-3">
            <span className="text-xs font-semibold text-white xl:text-sm">{symbol}</span>
            {headline.price != null ? <span className="text-xs text-zinc-300 xl:text-sm">${headline.price.toFixed(2)}</span> : null}
            {headline.changePct != null ? (
              <span className={`text-[11px] font-semibold xl:text-xs ${headline.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatSignedPercent(headline.changePct)}
              </span>
            ) : null}
          </div>

        <div className="ml-auto flex w-full items-center justify-end gap-1.5 xl:w-auto xl:gap-2">
          {/* Timeframe buttons */}
          <div className="flex items-center gap-0.5 rounded-lg bg-[#0d1016] p-0.5">
            {(Object.entries(FRAME_CONFIG) as Array<[TimeframeKey, FrameConfig]>).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTimeframe(key)}
                className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  timeframe === key
                    ? 'bg-zinc-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {cfg.label}
              </button>
            ))}
          </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10 xl:p-2" title="Candle type" aria-label="Candle type">
                  <ChartCandlestick className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-white/10 bg-[#111319] text-white">
                <DropdownMenuRadioGroup value={seriesType} onValueChange={(value) => setSeriesType(value as SeriesType)}>
                  <DropdownMenuRadioItem value="candles" className="cursor-pointer text-xs">Candles</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="bars" className="cursor-pointer text-xs">Bars</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="line" className="cursor-pointer text-xs">Line</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="area" className="cursor-pointer text-xs">Area</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="baseline" className="cursor-pointer text-xs">Baseline</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10 xl:p-2" title="Indicators" aria-label="Indicators">
                  <BarsIcon />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-white/10 bg-[#111319] text-white">
                <DropdownMenuCheckboxItem checked={showVolume} onCheckedChange={(checked) => setShowVolume(Boolean(checked))} className="cursor-pointer text-xs">
                  Volume
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={showSma20} onCheckedChange={(checked) => setShowSma20(Boolean(checked))} className="cursor-pointer text-xs">
                  SMA 20
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={showEma21} onCheckedChange={(checked) => setShowEma21(Boolean(checked))} className="cursor-pointer text-xs">
                  EMA 21
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={showVwap} onCheckedChange={(checked) => setShowVwap(Boolean(checked))} className="cursor-pointer text-xs">
                  VWAP
                </DropdownMenuCheckboxItem>
<DropdownMenuCheckboxItem checked={showBollinger} onCheckedChange={(checked) => setShowBollinger(Boolean(checked))} className="cursor-pointer text-xs">
                      Bollinger
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={showRsi} onCheckedChange={(checked) => setShowRsi(Boolean(checked))} className="cursor-pointer text-xs">
                      RSI 14
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={showAtr} onCheckedChange={(checked) => setShowAtr(Boolean(checked))} className="cursor-pointer text-xs">
                      ATR 14
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={() => {
                const chart = chartRef.current;
                if (!chart) return;
                const canvas = chart.takeScreenshot();
                downloadCanvas(canvas, `${symbol}-${timeframe}.png`);
              }}
              className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10 xl:p-2"
              title="Capture chart screenshot"
              aria-label="Capture chart screenshot"
            >
              <Camera className="h-4 w-4" />
            </button>
          </div>
        </div>

{/* Main content area with sidebar */}
<div className="grid min-h-0 flex-1 lg:grid-cols-[32px_minmax(0,1fr)]">
{/* Sidebar - 32px width */}
<div className="flex flex-col items-center justify-between border-r border-white/10 bg-[#090b10] py-2">
<div className="flex flex-col items-center gap-1">
<DrawingToolbar
activeTool={activeDrawingTool}
onToolSelect={setActiveDrawingTool}
lineWidth={drawingLineWidth}
onLineWidthChange={setDrawingLineWidth}
/>
<div className="h-px w-5 bg-white/10" />
<button onClick={() => setCrosshairMagnet((prev) => !prev)} className={`rounded p-1 ${crosshairMagnet ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:bg-white/5'}`} title="Crosshair Magnet">
<Magnet className="h-4 w-4" />
</button>
<button onClick={() => setShowGrid((prev) => !prev)} className={`rounded p-1 ${showGrid ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:bg-white/5'}`} title="Grid">
<Grid3X3 className="h-4 w-4" />
</button>
<button
onClick={() => setCompareEnabled((prev) => !prev)}
className={`rounded p-1 ${compareEnabled ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:bg-white/5'}`}
title="Compare Symbol"
>
<TrendingUp className="h-4 w-4" />
</button>
</div>
{/* Trash icon at bottom */}
{drawingsCount > 0 && (
<button
onClick={() => clearAllDrawingsRef.current?.()}
className="rounded p-1 text-zinc-400 hover:bg-red-500/20 hover:text-red-400"
title="Clear all drawings"
>
<Trash2 className="h-4 w-4" />
</button>
)}
</div>

          <div className="flex min-h-0 flex-col gap-2">
            {compareEnabled ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border border-white/10 bg-[#111319] px-2 py-2 text-xs text-zinc-300">
                <Input
                  value={compareInput}
                  onChange={(event) => setCompareInput(event.target.value.toUpperCase())}
                  className="h-7 w-24 border-white/10 bg-white/5 px-2 text-xs"
                  placeholder="Compare"
                />
                <Button
                  onClick={() => {
                    const next = compareInput.trim().toUpperCase();
                    if (next) setCompareSymbol(next);
                  }}
                  className="h-7 bg-amber-500 px-2 text-black hover:bg-amber-400"
                >
                  Apply
                </Button>
              </div>
            ) : null}

            {isLoading ? <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-xl border border-white/10 bg-[#121214] text-sm text-zinc-400">Loading chart...</div> : null}
            {error ? <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-xl border border-white/10 bg-[#121214] text-sm text-zinc-400">{error}</div> : null}
{!isLoading && !error ? (
          <div ref={chartWrapRef} className="relative min-h-[420px] flex-1 border border-white/10 bg-[#121214]">
            <div ref={containerRef} className="h-full w-full" />
            {frame.intraday && sessionRects.length > 0 ? (
              <div className="pointer-events-none absolute inset-0">
                {sessionRects.map((rect) => (
                  <div
                    key={rect.key}
                    className="absolute bottom-0 top-0"
                    style={{ left: `${rect.left}px`, width: `${rect.width}px`, backgroundColor: SESSION_SHADE }}
                  />
                ))}
              </div>
            ) : null}
{/* Drawing Tools Overlay */}
<ChartDrawings
symbol={symbol}
chart={chartInstance}
series={seriesInstance}
activeTool={activeDrawingTool}
onToolChange={setActiveDrawingTool}
selectedColor={drawingColor}
lineWidth={drawingLineWidth}
onDrawingsChange={(count, clearFn) => {
setDrawingsCount(count);
clearAllDrawingsRef.current = clearFn;
}}
/>
          </div>
        ) : null}

{/* Bottom bar - 32px height with time range shortcuts */}
<div className="flex h-8 items-center justify-center gap-0.5 border-t border-white/10 bg-[#090b10] px-2">
{(Object.entries(TIME_RANGE_CONFIG) as Array<[TimeRangeKey, TimeRangeConfig]>).map(([key, cfg]) => (
<button
key={key}
type="button"
onClick={() => {
setTimeRange(key);
setTimeframe(cfg.defaultTimeframe);
}}
className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
timeRange === key
? 'bg-zinc-600 text-white'
: 'text-zinc-400 hover:text-zinc-200'
}`}
>
{cfg.label}
</button>
))}
</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
