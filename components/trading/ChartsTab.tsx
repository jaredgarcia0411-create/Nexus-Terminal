'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Landmark,
  Magnet,
  Search,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { Trade } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useCandleData } from '@/hooks/use-candle-data';
import { bollingerBands, ema, sma, vwap } from '@/lib/indicators';
import { epochToNySortKey, nyDateTimeToEpoch } from '@/lib/time-utils';

type SeriesType = 'candles' | 'bars' | 'line' | 'area' | 'baseline';
type TimeframeKey = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

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

const UP_COLOR = '#14b8a6';
const DOWN_COLOR = '#ef4444';
const SESSION_SHADE = 'rgba(148, 163, 184, 0.10)';

function toTime(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
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
  const [symbol, setSymbol] = useState(recentSymbols[0] ?? 'SPY');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('30m');
  const [seriesType, setSeriesType] = useState<SeriesType>('candles');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareInput, setCompareInput] = useState('QQQ');
  const [compareSymbol, setCompareSymbol] = useState('QQQ');
  const [showVolume, setShowVolume] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [crosshairMagnet, setCrosshairMagnet] = useState(true);
  const [showSma20, setShowSma20] = useState(false);
  const [showEma21, setShowEma21] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showSessionShading, setShowSessionShading] = useState(true);
  const [sessionRects, setSessionRects] = useState<Array<{ key: string; left: number; width: number }>>([]);

  const frame = FRAME_CONFIG[timeframe];
  const marketOptions = useMemo(() => ({
    periodType: frame.periodType,
    period: frame.period,
    frequencyType: frame.frequencyType,
    frequency: frame.frequency,
    includePrePost: frame.intraday,
  }), [frame.frequency, frame.frequencyType, frame.intraday, frame.period, frame.periodType]);

  const { candles, isLoading, error } = useCandleData(symbol, marketOptions);
  const compareState = useCandleData(compareEnabled ? compareSymbol : null, marketOptions);

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

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0d10' },
        textColor: '#6b7280',
      },
      grid: {
        vertLines: { color: showGrid ? '#1f2937' : 'transparent' },
        horzLines: { color: showGrid ? '#1f2937' : 'transparent' },
      },
      crosshair: {
        mode: crosshairMagnet ? CrosshairMode.Magnet : CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#1f2937',
      },
      leftPriceScale: {
        borderColor: '#1f2937',
        visible: compareEnabled,
      },
      timeScale: {
        borderColor: '#1f2937',
        timeVisible: frame.intraday,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: 700,
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
        color: c.close >= c.open ? '#14b8a644' : '#ef444444',
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

    chart.timeScale().fitContent();

    const recalcSessionRects = () => {
      if (!showSessionShading || !frame.intraday || sortedCandles.length === 0 || !chartWrapRef.current) {
        setSessionRects([]);
        return;
      }

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
          const x1 = chart.timeScale().timeToCoordinate(toTime(span.start));
          const x2 = chart.timeScale().timeToCoordinate(toTime(span.end));
          if (x1 == null || x2 == null) continue;
          const left = Math.min(x1, x2);
          const width = Math.abs(x2 - x1);
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
      if (width > 0) {
        chart.applyOptions({ width });
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
    showBollinger,
    showEma21,
    showGrid,
    showSessionShading,
    showSma20,
    showVolume,
    showVwap,
  ]);

  return (
    <motion.div key="charts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[#0b0d10] p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[#0f1219] px-3 py-2">
          <div className="mr-2 flex items-center gap-2 border-r border-white/10 pr-3">
            <span className="text-sm font-semibold text-white">{symbol}</span>
            {headline.price != null ? <span className="text-sm text-zinc-300">${headline.price.toFixed(2)}</span> : null}
            {headline.changePct != null ? (
              <span className={`text-xs font-semibold ${headline.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatSignedPercent(headline.changePct)}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#111319] px-2 py-1">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <Input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              placeholder={symbol}
              className="h-7 w-24 border-0 bg-transparent px-1 text-xs"
            />
            <Button
              onClick={() => {
                const next = symbolInput.trim().toUpperCase();
                if (next) setSymbol(next);
              }}
              size="sm"
              className="h-7 bg-emerald-500 px-2 text-black hover:bg-emerald-400"
            >
              Go
            </Button>
          </div>

          {recentSymbols.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`rounded px-2 py-1 text-xs ${symbol === s ? 'bg-emerald-500 text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'}`}
            >
              {s}
            </button>
          ))}

          <div className="mx-2 h-4 w-px bg-white/10" />

          {Object.entries(FRAME_CONFIG).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setTimeframe(key as TimeframeKey)}
              className={`rounded px-2 py-1 text-xs ${timeframe === key ? 'bg-[#2563eb] text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'}`}
            >
              {cfg.label}
            </button>
          ))}

          <div className="mx-2 h-4 w-px bg-white/10" />

          <Select value={seriesType} onValueChange={(value) => setSeriesType(value as SeriesType)}>
            <SelectTrigger className="h-8 w-32 border-white/10 bg-white/5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#111319] text-white">
              <SelectItem value="candles">Candles</SelectItem>
              <SelectItem value="bars">Bars</SelectItem>
              <SelectItem value="line">Line</SelectItem>
              <SelectItem value="area">Area</SelectItem>
              <SelectItem value="baseline">Baseline</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="secondary"
            onClick={() => {
              const chart = chartRef.current;
              if (!chart) return;
              const canvas = chart.takeScreenshot();
              downloadCanvas(canvas, `${symbol}-${timeframe}.png`);
            }}
            className="h-8 border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 hover:bg-white/10"
          >
            <Camera className="mr-1 h-3.5 w-3.5" />
            Screenshot
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[56px_1fr]">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-[#0d1016] py-2">
            <button onClick={() => setCrosshairMagnet((prev) => !prev)} className={`rounded p-2 ${crosshairMagnet ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-400 hover:bg-white/5'}`} title="Crosshair Magnet">
              <Magnet className="h-4 w-4" />
            </button>
            <button onClick={() => setShowGrid((prev) => !prev)} className={`rounded p-2 ${showGrid ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-400 hover:bg-white/5'}`} title="Grid">
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button onClick={() => setShowSessionShading((prev) => !prev)} className={`rounded p-2 ${showSessionShading ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-400 hover:bg-white/5'}`} title="Session Shading">
              <Landmark className="h-4 w-4" />
            </button>
            <button onClick={() => chartRef.current?.timeScale().fitContent()} className="rounded p-2 text-zinc-400 hover:bg-white/5" title="Fit Content">
              <ChartCandlestick className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCompareEnabled((prev) => !prev)}
              className={`rounded p-2 ${compareEnabled ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-400 hover:bg-white/5'}`}
              title="Compare Symbol"
            >
              <TrendingUp className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[#111319] px-2 py-2 text-xs text-zinc-300">
              <button onClick={() => setShowVolume((prev) => !prev)} className={`rounded px-2 py-1 ${showVolume ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-zinc-400'}`}>Volume</button>
              <button onClick={() => setShowSma20((prev) => !prev)} className={`rounded px-2 py-1 ${showSma20 ? 'bg-violet-500/20 text-violet-300' : 'bg-white/5 text-zinc-400'}`}>SMA 20</button>
              <button onClick={() => setShowEma21((prev) => !prev)} className={`rounded px-2 py-1 ${showEma21 ? 'bg-orange-500/20 text-orange-300' : 'bg-white/5 text-zinc-400'}`}>EMA 21</button>
              <button onClick={() => setShowVwap((prev) => !prev)} className={`rounded px-2 py-1 ${showVwap ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/5 text-zinc-400'}`}>VWAP</button>
              <button onClick={() => setShowBollinger((prev) => !prev)} className={`rounded px-2 py-1 ${showBollinger ? 'bg-slate-500/20 text-slate-300' : 'bg-white/5 text-zinc-400'}`}>Bollinger</button>

              {compareEnabled ? (
                <div className="ml-auto flex items-center gap-2">
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
            </div>

            {isLoading ? <div className="flex h-[700px] items-center justify-center rounded-xl border border-white/10 bg-[#101219] text-sm text-zinc-400">Loading chart...</div> : null}
            {error ? <div className="flex h-[700px] items-center justify-center rounded-xl border border-white/10 bg-[#101219] text-sm text-zinc-400">{error}</div> : null}
            {!isLoading && !error ? (
              <div ref={chartWrapRef} className="relative h-[700px] w-full rounded-xl border border-white/10 bg-[#101219]">
                <div ref={containerRef} className="h-full w-full" />
                {showSessionShading && frame.intraday && sessionRects.length > 0 ? (
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
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0f1219] px-3 py-1 text-[11px] text-zinc-500">
              <span>{symbol} • {FRAME_CONFIG[timeframe].label}</span>
              <span>{compareEnabled ? `Comparing ${compareSymbol}` : 'No comparison symbol'}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
