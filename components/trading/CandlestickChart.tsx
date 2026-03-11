'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
} from 'lightweight-charts';
import { epochToNySortKey, nyDateTimeToEpoch } from '@/lib/time-utils';

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

const UP_COLOR = '#ffffff';
const DOWN_COLOR = '#3b82f6';
const UP_VOLUME_COLOR = '#ffffff33';
const DOWN_VOLUME_COLOR = '#3b82f633';

interface CandlestickChartProps {
  candles: CandleData[];
  tradeMarkers?: TradeMarker[];
  height?: number;
  exactPriceMarkers?: boolean;
  showTimeAxis?: boolean;
  showSessionShading?: boolean;
}

type ExactMarkerPoint = {
  key: string;
  x: number;
  y: number;
  color: string;
  points: string;
};

type SessionShadeRect = {
  key: string;
  left: number;
  width: number;
};

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

function toEpochMs(time: Time): number | null {
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
  createChartFn = createChart,
  resizeObserverCtor = typeof ResizeObserver !== 'undefined' ? (ResizeObserver as ResizeObserverCtorLike) : undefined,
  onResize,
}: {
  container: HTMLDivElement;
  height: number;
  showTimeAxis?: boolean;
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

export default function CandlestickChart({
  candles,
  tradeMarkers = [],
  height = 400,
  exactPriceMarkers = false,
  showTimeAxis = false,
  showSessionShading = false,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerAnimationFrameRef = useRef<number | null>(null);
  const sessionAnimationFrameRef = useRef<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [exactMarkerPoints, setExactMarkerPoints] = useState<ExactMarkerPoint[]>([]);
  const [sessionShadeRects, setSessionShadeRects] = useState<SessionShadeRect[]>([]);
  const sortedCandles = useMemo(() => [...candles].sort((a, b) => a.datetime - b.datetime), [candles]);
  const isIntraday = useMemo(() => {
    if (sortedCandles.length < 2) return false;
    const spacingMs = sortedCandles[1].datetime - sortedCandles[0].datetime;
    return Number.isFinite(spacingMs) && spacingMs > 0 && spacingMs < 24 * 60 * 60 * 1000;
  }, [sortedCandles]);

  const clearExactMarkerPoints = useCallback(() => {
    queueMicrotask(() => setExactMarkerPoints([]));
  }, []);

  const clearSessionShadeRects = useCallback(() => {
    queueMicrotask(() => setSessionShadeRects([]));
  }, []);

  const recalculateExactMarkers = useCallback(() => {
    if (!exactPriceMarkers) {
      clearExactMarkerPoints();
      return;
    }

    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || tradeMarkers.length === 0) {
      clearExactMarkerPoints();
      return;
    }

    const candleTimestamps = sortedCandles.map((candle) => candle.datetime);
    const markerSize = 6;
    const points = [...tradeMarkers]
      .sort((a, b) => a.time - b.time)
      .flatMap((marker, index) => {
        const nearestTimestamp = findNearestTimestamp(marker.time, candleTimestamps);
        if (nearestTimestamp == null) return [];

        const x = chart.timeScale().timeToCoordinate(toUTCSeconds(nearestTimestamp));
        const y = candleSeries.priceToCoordinate(marker.price);
        if (x == null || y == null) return [];

        const isBuy = marker.direction === 'LONG';
        const color = isBuy ? UP_COLOR : DOWN_COLOR;
        const triangle = isBuy
          ? `${x},${y - markerSize} ${x - markerSize},${y + markerSize} ${x + markerSize},${y + markerSize}`
          : `${x},${y + markerSize} ${x - markerSize},${y - markerSize} ${x + markerSize},${y - markerSize}`;

        return [{
          key: `${marker.time}:${marker.price}:${index}`,
          x,
          y,
          color,
          points: triangle,
        }];
      });

    queueMicrotask(() => setExactMarkerPoints(points));
  }, [clearExactMarkerPoints, exactPriceMarkers, sortedCandles, tradeMarkers]);

  const scheduleExactMarkerRecalculation = useCallback(() => {
    if (markerAnimationFrameRef.current != null) {
      cancelAnimationFrame(markerAnimationFrameRef.current);
    }
    markerAnimationFrameRef.current = requestAnimationFrame(() => {
      markerAnimationFrameRef.current = null;
      recalculateExactMarkers();
    });
  }, [recalculateExactMarkers]);

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

        const x1 = chart.timeScale().timeToCoordinate(toUTCSeconds(segment.start));
        const x2 = chart.timeScale().timeToCoordinate(toUTCSeconds(segment.end));
        if (x1 == null || x2 == null) continue;

        const left = Math.min(x1, x2);
        const width = Math.abs(x2 - x1);
        if (width <= 0) continue;

        rects.push({
          key: segment.key,
          left,
          width,
        });
      }
    }

    queueMicrotask(() => setSessionShadeRects(rects));
  }, [clearSessionShadeRects, isIntraday, showSessionShading, sortedCandles]);

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
    if (!containerRef.current) return;

    const lifecycle = createChartLifecycle({
      container: containerRef.current,
      height,
      showTimeAxis,
      onResize: (width) => {
        setContainerWidth(width);
        if (exactPriceMarkers) {
          scheduleExactMarkerRecalculation();
        }
        if (showSessionShading) {
          scheduleSessionShadeRecalculation();
        }
      },
    });
    setContainerWidth(containerRef.current.clientWidth);
    chartRef.current = lifecycle.chart;
    candleSeriesRef.current = lifecycle.candleSeries;
    volumeSeriesRef.current = lifecycle.volumeSeries;

    let unsubscribeRange: (() => void) | null = null;
    let unsubscribeSessionRange: (() => void) | null = null;
    if (exactPriceMarkers) {
      const handleRangeChange = () => {
        scheduleExactMarkerRecalculation();
      };
      lifecycle.chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
      lifecycle.chart.timeScale().subscribeVisibleTimeRangeChange(handleRangeChange);
      unsubscribeRange = () => {
        lifecycle.chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
        lifecycle.chart.timeScale().unsubscribeVisibleTimeRangeChange(handleRangeChange);
      };
    }

    if (showSessionShading) {
      const handleSessionRangeChange = (_range: unknown) => {
        void _range;
        scheduleSessionShadeRecalculation();
      };
      lifecycle.chart.timeScale().subscribeVisibleLogicalRangeChange(handleSessionRangeChange);
      lifecycle.chart.timeScale().subscribeVisibleTimeRangeChange(handleSessionRangeChange);
      unsubscribeSessionRange = () => {
        lifecycle.chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleSessionRangeChange);
        lifecycle.chart.timeScale().unsubscribeVisibleTimeRangeChange(handleSessionRangeChange);
      };
    }

    return () => {
      unsubscribeRange?.();
      unsubscribeSessionRange?.();
      lifecycle.cleanup();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      if (markerAnimationFrameRef.current != null) {
        cancelAnimationFrame(markerAnimationFrameRef.current);
        markerAnimationFrameRef.current = null;
      }
      if (sessionAnimationFrameRef.current != null) {
        cancelAnimationFrame(sessionAnimationFrameRef.current);
        sessionAnimationFrameRef.current = null;
      }
      clearExactMarkerPoints();
      clearSessionShadeRects();
    };
  }, [
    clearExactMarkerPoints,
    clearSessionShadeRects,
    exactPriceMarkers,
    height,
    scheduleExactMarkerRecalculation,
    scheduleSessionShadeRecalculation,
    showSessionShading,
    showTimeAxis,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    if (sortedCandles.length === 0) {
      candleSeries.setData([]);
      volumeSeries.setData([]);
      createSeriesMarkers(candleSeries, []);
      clearExactMarkerPoints();
      clearSessionShadeRects();
      return;
    }

    const candleData: CandlestickData[] = sortedCandles.map((c) => ({
      time: toUTCSeconds(c.datetime),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData: HistogramData[] = sortedCandles.map((c) => ({
      time: toUTCSeconds(c.datetime),
      value: c.volume,
      color: c.close >= c.open ? UP_VOLUME_COLOR : DOWN_VOLUME_COLOR,
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // Trade markers
    if (!exactPriceMarkers && tradeMarkers.length > 0) {
      const markers = [...tradeMarkers]
        .sort((a, b) => a.time - b.time)
        .flatMap((m) => {
          const nearestTimestamp = findNearestTimestamp(m.time, sortedCandles.map((candle) => candle.datetime));
          if (nearestTimestamp == null) return [];
          return [{
            time: toUTCSeconds(nearestTimestamp),
          position: m.direction === 'LONG' ? ('belowBar' as const) : ('aboveBar' as const),
          color: m.direction === 'LONG' ? UP_COLOR : DOWN_COLOR,
          shape: m.direction === 'LONG' ? ('arrowUp' as const) : ('arrowDown' as const),
          text: m.label,
          }];
        });
      createSeriesMarkers(candleSeries, markers);
    } else {
      createSeriesMarkers(candleSeries, []);
    }

    chart.timeScale().fitContent();

    if (exactPriceMarkers) {
      scheduleExactMarkerRecalculation();
    }

    if (showSessionShading) {
      scheduleSessionShadeRecalculation();
    }

    clearExactMarkerPoints();
  }, [
    clearExactMarkerPoints,
    clearSessionShadeRects,
    exactPriceMarkers,
    scheduleExactMarkerRecalculation,
    scheduleSessionShadeRecalculation,
    showSessionShading,
    sortedCandles,
    tradeMarkers,
  ]);

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
      {exactPriceMarkers && exactMarkerPoints.length > 0 ? (
        <svg className="pointer-events-none absolute inset-0 z-20" width="100%" height="100%" viewBox={`0 0 ${Math.max(containerWidth, 1)} ${height}`} preserveAspectRatio="none">
          {exactMarkerPoints.map((marker) => (
            <g key={marker.key}>
              <polygon points={marker.points} fill={marker.color} stroke="rgba(20, 20, 23, 0.9)" strokeWidth="2" />
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}
