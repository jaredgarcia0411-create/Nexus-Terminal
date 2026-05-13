'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CrosshairMode, type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';

import { useCandleData } from '@/hooks/use-candle-data';
import { buildExtendedHoursShadeSegments, buildSessionShadeRects, type SessionShadeRect } from '@/lib/chart-session-shading';
import { formatNyCrosshair, formatNyTime, toEpochMs } from '@/lib/chart-time';
import {
  RESEARCH_CHART_FRAME_CONFIG,
  buildTradeChartOptions,
  type ResearchChartTimeframeKey,
} from '@/lib/chart-timeframes';

function toTime(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
}

// Used to bucket candle timestamps by NY trading day so we can zoom intraday
// charts to just the most recent session's price action.
const NY_DAY_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function nyDateKey(epochMs: number): string {
  return NY_DAY_KEY_FORMATTER.format(new Date(epochMs));
}

interface Props {
  ticker: string;
  historicalDate?: string | null;
  onClearHistorical?: () => void;
}

export default function ResearchChart({ ticker, historicalDate, onClearHistorical }: Props) {
  const [timeframe, setTimeframe] = useState<ResearchChartTimeframeKey>('5m');
  const frame = RESEARCH_CHART_FRAME_CONFIG[timeframe];

  // When historicalDate is set, pin the fetch to that day's session window using the
  // same helper journal trade charts use. Otherwise drive from the timeframe selector.
  const marketOptions = useMemo(() => {
    if (historicalDate) {
      const opts = buildTradeChartOptions(historicalDate, '5m');
      return {
        periodType: opts.periodType,
        period: opts.period,
        frequencyType: opts.frequencyType,
        frequency: opts.frequency,
        startDate: opts.startDate,
        endDate: opts.endDate,
        includePrePost: opts.includePrePost ?? true,
      };
    }
    return {
      periodType: frame.periodType,
      period: frame.period,
      frequencyType: frame.frequencyType,
      frequency: frame.frequency,
      includePrePost: frame.intraday,
      refreshIntervalMs: 60_000,
    };
  }, [historicalDate, frame.frequency, frame.frequencyType, frame.intraday, frame.period, frame.periodType]);

  // Historical mode is always 5m intraday. Live mode follows the selected timeframe.
  const isIntraday = historicalDate ? true : frame.intraday;

  const { candles, isLoading, error } = useCandleData(ticker, marketOptions);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const sessionAnimationFrameRef = useRef<number | null>(null);
  const sortedCandlesRef = useRef<typeof candles>([]);
  const isIntradayRef = useRef(isIntraday);
  const [sessionShadeRects, setSessionShadeRects] = useState<SessionShadeRect[]>([]);
  const sortedCandles = useMemo(() => [...candles].sort((a, b) => a.datetime - b.datetime), [candles]);

  useEffect(() => {
    sortedCandlesRef.current = sortedCandles;
  }, [sortedCandles]);

  useEffect(() => {
    isIntradayRef.current = isIntraday;
  }, [isIntraday]);

  const clearSessionShadeRects = useCallback(() => {
    queueMicrotask(() => setSessionShadeRects([]));
  }, []);

  const recalculateSessionShading = useCallback(() => {
    const currentCandles = sortedCandlesRef.current;
    if (!isIntradayRef.current) {
      clearSessionShadeRects();
      return;
    }

    const chart = chartRef.current;
    const viewportWidth = containerRef.current?.clientWidth ?? 0;
    if (!chart || currentCandles.length === 0 || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
      clearSessionShadeRects();
      return;
    }

    const visibleRange = chart.timeScale().getVisibleRange();
    const visibleStart = toEpochMs(visibleRange?.from);
    const visibleEnd = toEpochMs(visibleRange?.to);
    const daySet = new Set(currentCandles.map((candle) => nyDateKey(candle.datetime)));

    const rects = buildSessionShadeRects({
      candles: currentCandles,
      segments: buildExtendedHoursShadeSegments(daySet),
      visibleStart,
      visibleEnd,
      viewportWidth,
      timeToCoordinate: (epochMs) => chart.timeScale().timeToCoordinate(toTime(epochMs)),
    });

    queueMicrotask(() => setSessionShadeRects(rects));
  }, [clearSessionShadeRects]);

  const scheduleSessionShadeRecalculation = useCallback(() => {
    if (sessionAnimationFrameRef.current != null) {
      cancelAnimationFrame(sessionAnimationFrameRef.current);
    }

    sessionAnimationFrameRef.current = requestAnimationFrame(() => {
      sessionAnimationFrameRef.current = null;
      recalculateSessionShading();
    });
  }, [recalculateSessionShading]);

  useEffect(() => {
    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;
    let unsubscribeSessionRange: (() => void) | null = null;

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
          timeVisible: isIntraday,
          secondsVisible: false,
          tickMarkFormatter: (time: Time) => formatNyTime(time, isIntraday),
        },
        localization: {
          timeFormatter: (time: Time) => formatNyCrosshair(time),
        },
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
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

      const onRangeChange = () => {
        scheduleSessionShadeRecalculation();
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
      chart.timeScale().subscribeVisibleTimeRangeChange(onRangeChange);
      unsubscribeSessionRange = () => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
        chart.timeScale().unsubscribeVisibleTimeRangeChange(onRangeChange);
      };

      resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current || !chartRef.current) return;
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        scheduleSessionShadeRecalculation();
      });
      resizeObserver.observe(containerRef.current);
    };

    void setupChart();

    return () => {
      mounted = false;
      unsubscribeSessionRange?.();
      resizeObserver?.disconnect();
      if (sessionAnimationFrameRef.current != null) {
        cancelAnimationFrame(sessionAnimationFrameRef.current);
        sessionAnimationFrameRef.current = null;
      }
      clearSessionShadeRects();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, [clearSessionShadeRects, isIntraday, scheduleSessionShadeRecalculation]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const data: CandlestickData[] = sortedCandles.map((candle) => ({
      time: toTime(candle.datetime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    seriesRef.current.setData(data);

    // Volume bars — white-ish for up candles, blue-ish for down
    if (volumeRef.current) {
      const volumeData: HistogramData[] = sortedCandles.map((candle) => ({
        time: toTime(candle.datetime),
        value: candle.volume,
        color: candle.close >= candle.open ? '#22c55e33' : '#ef444433',
      }));
      volumeRef.current.setData(volumeData);
    }

    // For intraday views, zoom to just the latest NY trading day so the chart
    // opens on today's price action instead of the full 5–10 day fetch window.
    // Daily/weekly frames keep fitContent so the user sees the longer context.
    const timeScale = chartRef.current?.timeScale();
    if (!timeScale) return;
    if (isIntraday && sortedCandles.length > 0) {
      const lastDayKey = nyDateKey(sortedCandles[sortedCandles.length - 1].datetime);
      const firstSameDay = sortedCandles.find((candle) => nyDateKey(candle.datetime) === lastDayKey);
      if (firstSameDay) {
        timeScale.setVisibleRange({
          from: toTime(firstSameDay.datetime),
          to: toTime(sortedCandles[sortedCandles.length - 1].datetime),
        });
        scheduleSessionShadeRecalculation();
        return;
      }
    }
    timeScale.fitContent();
    scheduleSessionShadeRecalculation();
  }, [isIntraday, scheduleSessionShadeRecalculation, sortedCandles]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        {historicalDate ? (
          <>
            <span className="px-2 py-1 text-xs text-zinc-300">
              Viewing {historicalDate} · 5m
            </span>
            <button
              type="button"
              onClick={() => onClearHistorical?.()}
              className="rounded-sm px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
            >
              Back to live
            </button>
          </>
        ) : (
          (Object.keys(RESEARCH_CHART_FRAME_CONFIG) as ResearchChartTimeframeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTimeframe(key)}
              className={`rounded-sm px-2 py-1 text-xs transition-colors ${
                timeframe === key ? 'bg-zinc-700/60 text-zinc-100' : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
              }`}
            >
              {RESEARCH_CHART_FRAME_CONFIG[key].label}
            </button>
          ))
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {isIntraday && sessionShadeRects.length > 0 ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            {sessionShadeRects.map((rect) => (
              <div
                key={rect.key}
                className="absolute bottom-0 top-0"
                style={{
                  left: `${rect.left}px`,
                  width: `${rect.width}px`,
                  backgroundColor: 'rgba(148, 163, 184, 0.12)',
                }}
              />
            ))}
          </div>
        ) : null}
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
