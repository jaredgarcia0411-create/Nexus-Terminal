'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  exactPriceMarkers?: boolean;
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

type ResizeObserverLike = {
  observe: (target: Element) => void;
  disconnect: () => void;
};

type ResizeObserverCtorLike = new (callback: ResizeObserverCallback) => ResizeObserverLike;

type CreateChartFn = typeof createChart;

export function createChartLifecycle({
  container,
  height,
  createChartFn = createChart,
  resizeObserverCtor = typeof ResizeObserver !== 'undefined' ? (ResizeObserver as ResizeObserverCtorLike) : undefined,
  onResize,
}: {
  container: HTMLDivElement;
  height: number;
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
      timeVisible: false,
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
  indicators = [],
  tradeMarkers = [],
  height = 400,
  exactPriceMarkers = false,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [exactMarkerPoints, setExactMarkerPoints] = useState<ExactMarkerPoint[]>([]);

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

    const markerSize = 6;
    const points = [...tradeMarkers]
      .sort((a, b) => a.time - b.time)
      .flatMap((marker, index) => {
        const x = chart.timeScale().timeToCoordinate(toUTCSeconds(marker.time));
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
    const collisionX = markerSize * 2 + 2;
    const collisionY = markerSize * 2;

    const withCollisionHandling = points.map((point) => {
      if (Math.abs(point.x - lastLabeledX) <= collisionX && Math.abs(point.y - lastLabeledY) <= collisionY) {
        return { ...point, showLabel: false };
      }

      lastLabeledX = point.x;
      lastLabeledY = point.y;
      return point;
    });

    queueMicrotask(() => setExactMarkerPoints(withCollisionHandling));
  }, [clearExactMarkerPoints, exactPriceMarkers, tradeMarkers]);

  useEffect(() => {
    if (!containerRef.current) return;

    const lifecycle = createChartLifecycle({
      container: containerRef.current,
      height,
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
      lineSeriesRefs.current = [];
      clearExactMarkerPoints();
    };
  }, [clearExactMarkerPoints, exactPriceMarkers, height, recalculateExactMarkers]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    // Remove old line series
    for (const ls of lineSeriesRefs.current) {
      chart.removeSeries(ls);
    }
    lineSeriesRefs.current = [];

    if (candles.length === 0) {
      candleSeries.setData([]);
      volumeSeries.setData([]);
      createSeriesMarkers(candleSeries, []);
      clearExactMarkerPoints();
      return;
    }

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
  }, [candles, clearExactMarkerPoints, indicators, tradeMarkers, exactPriceMarkers, recalculateExactMarkers]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      {exactPriceMarkers && exactMarkerPoints.length > 0 ? (
        <svg className="pointer-events-none absolute inset-0" width="100%" height="100%" viewBox={`0 0 ${Math.max(containerWidth, 1)} ${height}`} preserveAspectRatio="none">
          {exactMarkerPoints.map((marker) => (
            <g key={marker.key}>
              <polygon points={marker.points} fill={marker.color} stroke="rgba(10, 10, 11, 0.45)" strokeWidth="1" />
              {marker.showLabel ? (
                <text x={marker.x + 10} y={marker.y - 10} fill="rgba(228, 228, 231, 0.9)" fontSize="10" fontWeight="700">
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
