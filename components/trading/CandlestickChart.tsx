'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  PriceScaleMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type CandlestickData,
  type HistogramData,
  type LineWidth,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesMarkerBar,
  type SeriesMarkerPrice,
  type Time,
} from 'lightweight-charts';
import type { TradeMarker } from '@/lib/types';
import { epochToNySortKey, nyDateTimeToEpoch } from '@/lib/time-utils';

export interface CandleData {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const UP_COLOR = '#ffffff';
const DOWN_COLOR = '#3b82f6';
const UP_VOLUME_COLOR = '#ffffff33';
const DOWN_VOLUME_COLOR = '#3b82f633';
const LONG_MARKER_COLOR = '#22c55e';
const SHORT_MARKER_COLOR = '#ef4444';

interface CandlestickChartProps extends CandlestickChartOptions {
  candles: CandleData[];
  tradeMarkers?: TradeMarker[];
  height?: number;
  exactPriceMarkers?: boolean;
  showTimeAxis?: boolean;
  showSessionShading?: boolean;
  scaleMode?: PriceScaleMode;
}

type SessionShadeRect = {
  key: string;
  left: number;
  width: number;
};

type NativeCrosshairPoint = {
  timeLabel: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

type NativePriceLine = {
  price: number;
  color?: string;
  title?: string;
  lineWidth?: LineWidth;
  lineStyle?: LineStyle;
  axisLabelVisible?: boolean;
};

export interface CandlestickChartOptions {
  priceLines?: NativePriceLine[];
  showCrosshairLegend?: boolean;
}

const NY_TIME_ZONE = 'America/New_York';

const NY_INTRADAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const NY_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
});

const NY_CROSSHAIR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function toUTCSeconds(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
}

function toEpochMs(time: Time | undefined): number | null {
  if (time == null) return null;
  if (typeof time === 'number') return Number.isFinite(time) ? time * 1000 : null;

  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (time && typeof time === 'object') {
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

function formatNyTime(time: Time, showTime: boolean) {
  const epochMs = toEpochMs(time);
  if (epochMs == null) return '';
  const date = new Date(epochMs);
  return showTime ? NY_INTRADAY_FORMATTER.format(date) : NY_DAY_FORMATTER.format(date);
}

function formatNyCrosshair(time: Time) {
  const epochMs = toEpochMs(time);
  if (epochMs == null) return '';
  return NY_CROSSHAIR_FORMATTER.format(new Date(epochMs));
}

function findNearestTimestamp(target: number, sortedTimestamps: number[]): number | null {
  if (sortedTimestamps.length === 0) return null;

  let left = 0;
  let right = sortedTimestamps.length - 1;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const value = sortedTimestamps[middle];
    if (value === target) return value;
    if (value < target) left = middle + 1;
    else right = middle - 1;
  }

  const upper = sortedTimestamps[Math.min(left, sortedTimestamps.length - 1)];
  const lower = sortedTimestamps[Math.max(left - 1, 0)];
  return Math.abs(upper - target) < Math.abs(target - lower) ? upper : lower;
}

type ResizeObserverLike = {
  observe: (target: Element) => void;
  disconnect: () => void;
};

type ResizeObserverCtorLike = new (callback: ResizeObserverCallback) => ResizeObserverLike;

type CreateChartFn = typeof createChart;

export function createChartLifecycle({
  container,
  height,
  showTimeAxis = false,
  scaleMode = PriceScaleMode.Normal,
  createChartFn = createChart,
  resizeObserverCtor = typeof ResizeObserver !== 'undefined' ? (ResizeObserver as ResizeObserverCtorLike) : undefined,
  onResize,
}: {
  container: HTMLDivElement;
  height: number;
  showTimeAxis?: boolean;
  scaleMode?: PriceScaleMode;
  createChartFn?: CreateChartFn;
  resizeObserverCtor?: ResizeObserverCtorLike | undefined;
  onResize?: (width: number) => void;
}) {
  const chart = createChartFn(container, {
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
      mode: scaleMode,
    },
    timeScale: {
      borderColor: '#ffffff10',
      timeVisible: showTimeAxis,
      secondsVisible: false,
      tickMarkFormatter: (time: Time) => formatNyTime(time, showTimeAxis),
    },
    localization: {
      timeFormatter: (time: Time) => formatNyCrosshair(time),
    },
    width: container.clientWidth,
    height,
  });

  const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    borderUpColor: UP_COLOR,
    borderDownColor: DOWN_COLOR,
    wickUpColor: UP_COLOR,
    wickDownColor: DOWN_COLOR,
  });

  const volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });

  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  const handleResize = () => {
    const width = container.clientWidth;
    if (width > 0) {
      chart.applyOptions({ width });
      onResize?.(width);
    }
  };

  let resizeObserver: ResizeObserverLike | null = null;
  if (resizeObserverCtor) {
    resizeObserver = new resizeObserverCtor(() => {
      handleResize();
    });
    resizeObserver.observe(container);
  }

  const cleanup = () => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    chart.remove();
  };

  return {
    chart,
    candleSeries,
    volumeSeries,
    cleanup,
    handleResize,
  };
}

function formatNumber(value: number | null) {
  if (value == null || Number.isNaN(value)) return '-';
  return value.toFixed(4);
}

export default function CandlestickChart({
  candles,
  tradeMarkers = [],
  height = 400,
  exactPriceMarkers = false,
  showTimeAxis = false,
  showSessionShading = false,
  scaleMode,
  priceLines,
  showCrosshairLegend = false,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const sessionAnimationFrameRef = useRef<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [sessionShadeRects, setSessionShadeRects] = useState<SessionShadeRect[]>([]);
  const [crosshairPoint, setCrosshairPoint] = useState<NativeCrosshairPoint | null>(null);

  const sortedCandles = useMemo(() => [...candles].sort((a, b) => a.datetime - b.datetime), [candles]);
  const isIntraday = useMemo(() => {
    if (sortedCandles.length < 2) return false;
    const spacingMs = sortedCandles[1].datetime - sortedCandles[0].datetime;
    return Number.isFinite(spacingMs) && spacingMs > 0 && spacingMs < 24 * 60 * 60 * 1000;
  }, [sortedCandles]);

  const candleByEpoch = useMemo(() => {
    const map = new Map<number, CandleData>();
    for (const candle of sortedCandles) {
      map.set(candle.datetime, candle);
    }
    return map;
  }, [sortedCandles]);

  const clearSessionShadeRects = useCallback(() => {
    queueMicrotask(() => setSessionShadeRects([]));
  }, []);

  const clearCrosshairPoint = useCallback(() => {
    setCrosshairPoint(null);
  }, []);

  const detachSeriesMarkers = useCallback(() => {
    const plugin = markersPluginRef.current;
    if (plugin == null) return;
    plugin.detach();
    markersPluginRef.current = null;
  }, []);

  const removePriceLines = useCallback(() => {
    const candleSeries = candleSeriesRef.current;
    if (candleSeries == null) {
      priceLinesRef.current = [];
      return;
    }

    for (const line of priceLinesRef.current) {
      candleSeries.removePriceLine(line);
    }
    priceLinesRef.current = [];
  }, []);

  const buildMarkers = useCallback((): SeriesMarker<Time>[] => {
    if (tradeMarkers.length === 0 || sortedCandles.length === 0) {
      return [];
    }

    const candleTimestamps = sortedCandles.map((candle) => candle.datetime);
    const markers: Array<SeriesMarkerBar<Time> | SeriesMarkerPrice<Time>> = [];
    [...tradeMarkers]
      .sort((a, b) => a.time - b.time)
      .forEach((marker, index) => {
        const nearestTimestamp = findNearestTimestamp(marker.time, candleTimestamps);
        if (nearestTimestamp == null) return;

        if (exactPriceMarkers) {
          markers.push({
            id: `${marker.time}:${marker.price}:${index}`,
            time: toUTCSeconds(nearestTimestamp),
            position: marker.direction === 'LONG' ? 'atPriceBottom' : 'atPriceTop',
            color: marker.direction === 'LONG' ? LONG_MARKER_COLOR : SHORT_MARKER_COLOR,
            shape: marker.direction === 'LONG' ? 'arrowUp' : 'arrowDown',
            price: marker.price,
            size: 1,
          });
          return;
        }

        markers.push({
          id: `${marker.time}:${marker.price}:${index}`,
          time: toUTCSeconds(nearestTimestamp),
          position: marker.direction === 'LONG' ? 'belowBar' : 'aboveBar',
          color: marker.direction === 'LONG' ? LONG_MARKER_COLOR : SHORT_MARKER_COLOR,
          shape: marker.direction === 'LONG' ? 'arrowUp' : 'arrowDown',
          size: 1,
        });
      });

    return markers;
  }, [exactPriceMarkers, sortedCandles, tradeMarkers]);

  const recalculateSessionShading = useCallback(() => {
    if (!showSessionShading || !isIntraday) {
      clearSessionShadeRects();
      return;
    }

    const chart = chartRef.current;
    if (!chart || sortedCandles.length === 0) {
      clearSessionShadeRects();
      return;
    }

    const first = sortedCandles[0]?.datetime;
    const last = sortedCandles[sortedCandles.length - 1]?.datetime;
    if (!Number.isFinite(first) || !Number.isFinite(last)) {
      clearSessionShadeRects();
      return;
    }

    const viewportWidth = containerRef.current?.clientWidth ?? containerWidth;
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
      clearSessionShadeRects();
      return;
    }

    const visibleRange = chart.timeScale().getVisibleRange();
    const visibleStart = toEpochMs(visibleRange?.from);
    const visibleEnd = toEpochMs(visibleRange?.to);

    const daySet = new Set<string>();
    for (const candle of sortedCandles) {
      daySet.add(epochToNySortKey(candle.datetime));
    }

    const rects: SessionShadeRect[] = [];
    for (const dayKey of daySet) {
      const preStart = nyDateTimeToEpoch(dayKey, '04:00:00');
      const preEnd = nyDateTimeToEpoch(dayKey, '09:30:00');
      const postStart = nyDateTimeToEpoch(dayKey, '16:00:00');
      const postEnd = nyDateTimeToEpoch(dayKey, '20:00:00');

      const segments = [
        { key: `${dayKey}:pre`, start: preStart, end: preEnd },
        { key: `${dayKey}:post`, start: postStart, end: postEnd },
      ];

      for (const segment of segments) {
        if (segment.start == null || segment.end == null || segment.end <= first || segment.start >= last) continue;

        let clippedStart = segment.start;
        let clippedEnd = segment.end;
        if (visibleStart != null && visibleEnd != null) {
          clippedStart = Math.max(clippedStart, visibleStart);
          clippedEnd = Math.min(clippedEnd, visibleEnd);
        }
        if (clippedEnd <= clippedStart) continue;

        const x1 = chart.timeScale().timeToCoordinate(toUTCSeconds(clippedStart));
        const x2 = chart.timeScale().timeToCoordinate(toUTCSeconds(clippedEnd));
        if (x1 == null || x2 == null) continue;

        const leftRaw = Math.min(x1, x2);
        const rightRaw = Math.max(x1, x2);
        const left = Math.max(0, Math.min(leftRaw, viewportWidth));
        const right = Math.max(0, Math.min(rightRaw, viewportWidth));
        const width = right - left;
        if (width <= 0) continue;

        rects.push({
          key: segment.key,
          left,
          width,
        });
      }
    }

    queueMicrotask(() => setSessionShadeRects(rects));
  }, [clearSessionShadeRects, containerWidth, isIntraday, showSessionShading, sortedCandles]);

  const scheduleSessionShadeRecalculation = useCallback(() => {
    if (sessionAnimationFrameRef.current != null) {
      cancelAnimationFrame(sessionAnimationFrameRef.current);
    }

    sessionAnimationFrameRef.current = requestAnimationFrame(() => {
      sessionAnimationFrameRef.current = null;
      recalculateSessionShading();
    });
  }, [recalculateSessionShading]);

  const findCrosshairCandle = useCallback((time: Time): CandleData | null => {
    const epoch = toEpochMs(time);
    if (epoch == null || sortedCandles.length === 0) return null;

    const exact = candleByEpoch.get(epoch);
    if (exact != null) return exact;

    const nearest = findNearestTimestamp(epoch, sortedCandles.map((c) => c.datetime));
    if (nearest == null) return null;

    return candleByEpoch.get(nearest) ?? null;
  }, [candleByEpoch, sortedCandles]);

  const updateCrosshairLegend = useCallback((time: Time | undefined) => {
    if (time == null) {
      clearCrosshairPoint();
      return;
    }

    const candle = findCrosshairCandle(time);
    if (candle == null) {
      clearCrosshairPoint();
      return;
    }

    setCrosshairPoint({
      timeLabel: formatNyCrosshair(time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    });
  }, [clearCrosshairPoint, findCrosshairCandle]);

  useEffect(() => {
    if (!containerRef.current) return;

    const lifecycle = createChartLifecycle({
      container: containerRef.current,
      height,
      showTimeAxis,
      scaleMode,
      onResize: (width) => {
        setContainerWidth(width);
        if (showSessionShading) {
          scheduleSessionShadeRecalculation();
        }
      },
    });

    setContainerWidth(containerRef.current.clientWidth);
    chartRef.current = lifecycle.chart;
    candleSeriesRef.current = lifecycle.candleSeries;
    volumeSeriesRef.current = lifecycle.volumeSeries;

    let unsubscribeSessionRange: (() => void) | null = null;
    if (showSessionShading) {
      const onRangeChange = () => {
        scheduleSessionShadeRecalculation();
      };

      lifecycle.chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
      lifecycle.chart.timeScale().subscribeVisibleTimeRangeChange(onRangeChange);
      unsubscribeSessionRange = () => {
        lifecycle.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
        lifecycle.chart.timeScale().unsubscribeVisibleTimeRangeChange(onRangeChange);
      };
    }

    let unsubscribeCrosshair: ((param: MouseEventParams<Time>) => void) | null = null;
    if (showCrosshairLegend) {
      const crosshairMoveHandler = (param: MouseEventParams<Time>) => {
        if (param == null || param.time == null || sortedCandles.length === 0) {
          clearCrosshairPoint();
          return;
        }

        updateCrosshairLegend(param.time);
      };

      lifecycle.chart.subscribeCrosshairMove(crosshairMoveHandler);
      unsubscribeCrosshair = crosshairMoveHandler;
    }

    return () => {
      unsubscribeSessionRange?.();
      if (unsubscribeCrosshair != null) {
        lifecycle.chart.unsubscribeCrosshairMove(unsubscribeCrosshair);
      }
      detachSeriesMarkers();
      removePriceLines();
      if (sessionAnimationFrameRef.current != null) {
        cancelAnimationFrame(sessionAnimationFrameRef.current);
        sessionAnimationFrameRef.current = null;
      }
      clearSessionShadeRects();
      clearCrosshairPoint();
      lifecycle.cleanup();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [
    clearCrosshairPoint,
    clearSessionShadeRects,
    detachSeriesMarkers,
    height,
    removePriceLines,
    scaleMode,
    scheduleSessionShadeRecalculation,
    showCrosshairLegend,
    showSessionShading,
    showTimeAxis,
    sortedCandles,
    updateCrosshairLegend,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    if (sortedCandles.length === 0) {
      candleSeries.setData([]);
      volumeSeries.setData([]);
      detachSeriesMarkers();
      clearSessionShadeRects();
      return;
    }

    const candleData: CandlestickData[] = sortedCandles.map((candle) => ({
      time: toUTCSeconds(candle.datetime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const volumeData: HistogramData[] = sortedCandles.map((candle) => ({
      time: toUTCSeconds(candle.datetime),
      value: candle.volume,
      color: candle.close >= candle.open ? UP_VOLUME_COLOR : DOWN_VOLUME_COLOR,
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    const markers = buildMarkers();
    if (markers.length > 0) {
      if (markersPluginRef.current == null) {
        markersPluginRef.current = createSeriesMarkers(candleSeries, markers);
      } else {
        markersPluginRef.current.setMarkers(markers);
      }
    } else if (markersPluginRef.current == null) {
      markersPluginRef.current = createSeriesMarkers(candleSeries, []);
    } else {
      markersPluginRef.current.setMarkers([]);
    }

    chart.timeScale().fitContent();

    if (showSessionShading) {
      scheduleSessionShadeRecalculation();
    }
  }, [
    buildMarkers,
    clearSessionShadeRects,
    clearCrosshairPoint,
    detachSeriesMarkers,
    scheduleSessionShadeRecalculation,
    showSessionShading,
    sortedCandles,
  ]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    removePriceLines();
    if (priceLines == null || priceLines.length === 0) return;

    const createdLines = priceLines
      .map((line) => {
        if (!Number.isFinite(line.price)) return null;
        const { price, ...lineOptions } = line;
        const lineWidth = line.lineWidth ?? 1;

        return candleSeries.createPriceLine({
          ...lineOptions,
          price,
          color: line.color ?? '#ffffff',
          lineWidth,
          lineStyle: line.lineStyle ?? LineStyle.Solid,
          axisLabelVisible: line.axisLabelVisible ?? true,
          title: line.title ?? '',
        });
      })
      .filter((line): line is IPriceLine => Boolean(line));

    priceLinesRef.current = createdLines;

    return () => {
      removePriceLines();
    };
  }, [priceLines, removePriceLines]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      {showSessionShading && isIntraday && sessionShadeRects.length > 0 ? (
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
      {showCrosshairLegend && crosshairPoint != null ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded border border-white/15 bg-[#0d1017]/95 px-2 py-1 text-[11px] text-zinc-300 shadow">
          <div className="mb-1 text-zinc-100">{crosshairPoint.timeLabel}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-zinc-500">O</span>
            <span className="font-mono">{formatNumber(crosshairPoint.open)}</span>
            <span className="text-zinc-500">H</span>
            <span className="font-mono">{formatNumber(crosshairPoint.high)}</span>
            <span className="text-zinc-500">L</span>
            <span className="font-mono">{formatNumber(crosshairPoint.low)}</span>
            <span className="text-zinc-500">C</span>
            <span className="font-mono">{formatNumber(crosshairPoint.close)}</span>
            <span className="text-zinc-500">Vol</span>
            <span className="font-mono">{crosshairPoint.volume?.toLocaleString()}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
