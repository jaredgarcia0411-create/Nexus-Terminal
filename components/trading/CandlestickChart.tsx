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

interface CandlestickChartProps {
  candles: CandleData[];
  tradeMarkers?: TradeMarker[];
  height?: number;
  exactPriceMarkers?: boolean;
  showTimeAxis?: boolean;
}

type ExactMarkerPoint = {
  key: string;
  x: number;
  y: number;
  color: string;
  points: string;
  label: string;
  showLabel: boolean;
};

function toUTCSeconds(ms: number): Time {
  return Math.floor(ms / 1000) as unknown as Time;
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
    },
    width: container.clientWidth,
    height,
  });

  const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
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
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [exactMarkerPoints, setExactMarkerPoints] = useState<ExactMarkerPoint[]>([]);
  const sortedCandles = useMemo(() => [...candles].sort((a, b) => a.datetime - b.datetime), [candles]);

  const clearExactMarkerPoints = useCallback(() => {
    queueMicrotask(() => setExactMarkerPoints([]));
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
    const markerSize = 10;
    const points = [...tradeMarkers]
      .sort((a, b) => a.time - b.time)
      .flatMap((marker, index) => {
        let x = chart.timeScale().timeToCoordinate(toUTCSeconds(marker.time));
        if (x == null) {
          const nearestTimestamp = findNearestTimestamp(marker.time, candleTimestamps);
          if (nearestTimestamp != null) {
            x = chart.timeScale().timeToCoordinate(toUTCSeconds(nearestTimestamp));
          }
        }
        const y = candleSeries.priceToCoordinate(marker.price);
        if (x == null || y == null) return [];

        const isEntry = marker.label.toUpperCase().startsWith('ENTRY');
        const color = isEntry ? '#10b981' : '#ef4444';
        const triangle = isEntry
          ? `${x},${y - markerSize} ${x - markerSize},${y + markerSize} ${x + markerSize},${y + markerSize}`
          : `${x},${y + markerSize} ${x - markerSize},${y - markerSize} ${x + markerSize},${y - markerSize}`;

        return [{
          key: `${marker.time}:${marker.price}:${index}`,
          x,
          y,
          color,
          points: triangle,
          label: isEntry ? 'E' : 'X',
          showLabel: true,
        }];
      });

    let lastLabeledX = Number.NEGATIVE_INFINITY;
    let lastLabeledY = Number.NEGATIVE_INFINITY;
    const collisionX = markerSize * 2.2 + 4;
    const collisionY = markerSize * 2.2;

    const withCollisionHandling = points.map((point) => {
      if (Math.abs(point.x - lastLabeledX) <= collisionX && Math.abs(point.y - lastLabeledY) <= collisionY) {
        return { ...point, showLabel: false };
      }

      lastLabeledX = point.x;
      lastLabeledY = point.y;
      return point;
    });

    queueMicrotask(() => setExactMarkerPoints(withCollisionHandling));
  }, [clearExactMarkerPoints, exactPriceMarkers, sortedCandles, tradeMarkers]);

  useEffect(() => {
    if (!containerRef.current) return;

    const lifecycle = createChartLifecycle({
      container: containerRef.current,
      height,
      showTimeAxis,
      onResize: (width) => {
        setContainerWidth(width);
        if (exactPriceMarkers) {
          requestAnimationFrame(() => {
            recalculateExactMarkers();
          });
        }
      },
    });
    setContainerWidth(containerRef.current.clientWidth);
    chartRef.current = lifecycle.chart;
    candleSeriesRef.current = lifecycle.candleSeries;
    volumeSeriesRef.current = lifecycle.volumeSeries;

    return () => {
      lifecycle.cleanup();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      clearExactMarkerPoints();
    };
  }, [clearExactMarkerPoints, exactPriceMarkers, height, recalculateExactMarkers, showTimeAxis]);

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
      color: c.close >= c.open ? '#10b98133' : '#ef444433',
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // Trade markers
    if (!exactPriceMarkers && tradeMarkers.length > 0) {
      const markers = [...tradeMarkers]
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          time: toUTCSeconds(m.time),
          position: m.direction === 'LONG' ? ('belowBar' as const) : ('aboveBar' as const),
          color: m.direction === 'LONG' ? '#10b981' : '#ef4444',
          shape: m.direction === 'LONG' ? ('arrowUp' as const) : ('arrowDown' as const),
          text: m.label,
        }));
      createSeriesMarkers(candleSeries, markers);
    } else {
      createSeriesMarkers(candleSeries, []);
    }

    chart.timeScale().fitContent();

    if (exactPriceMarkers) {
      const animationFrame = requestAnimationFrame(() => {
        recalculateExactMarkers();
      });
      return () => cancelAnimationFrame(animationFrame);
    }

    clearExactMarkerPoints();
  }, [sortedCandles, clearExactMarkerPoints, tradeMarkers, exactPriceMarkers, recalculateExactMarkers]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      {exactPriceMarkers && exactMarkerPoints.length > 0 ? (
        <svg className="pointer-events-none absolute inset-0 z-20" width="100%" height="100%" viewBox={`0 0 ${Math.max(containerWidth, 1)} ${height}`} preserveAspectRatio="none">
          {exactMarkerPoints.map((marker) => (
            <g key={marker.key}>
              <polygon points={marker.points} fill={marker.color} stroke="rgba(20, 20, 23, 0.9)" strokeWidth="2" />
              {marker.showLabel ? (
                <text x={marker.x + 12} y={marker.y - 14} fill="#ffffff" fontSize="12" fontWeight="700" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
                  {marker.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}
