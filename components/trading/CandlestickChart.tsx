'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  PriceScaleMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineWidth,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { TriangleMarkersPrimitive, type TriangleMarker } from '@/components/trading/plugins/TriangleMarkersPrimitive';
import { useSessionShading } from '@/hooks/use-session-shading';
import type { TradeMarker } from '@/lib/types';
import { formatNyCrosshair, formatNyTime, toEpochMs, toTime } from '@/lib/chart-time';
import { sessionVwap, vwap } from '@/lib/indicators';
import { epochToNySortKey } from '@/lib/time-utils';

export interface CandleData {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const UP_COLOR = '#22c55e';
const DOWN_COLOR = '#ef4444';
const UP_VOLUME_COLOR = '#22c55e33';
const DOWN_VOLUME_COLOR = '#ef444433';

interface CandlestickChartProps extends CandlestickChartOptions {
  candles: CandleData[];
  tradeMarkers?: TradeMarker[];
  focusLastSession?: boolean;
  height?: number;
  exactPriceMarkers?: boolean;
  showTimeAxis?: boolean;
  showSessionShading?: boolean;
  showVwap?: boolean;
  scaleMode?: PriceScaleMode;
  onInstances?: (chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null) => void;
}

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
  focusLastSession = false,
  height = 400,
  exactPriceMarkers = false,
  showTimeAxis = false,
  showSessionShading = false,
  showVwap = false,
  scaleMode,
  priceLines,
  showCrosshairLegend = false,
  onInstances,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const trianglePrimitiveRef = useRef<TriangleMarkersPrimitive | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const onInstancesRef = useRef(onInstances);
  const heightRef = useRef(height);
  const [, setContainerWidth] = useState(0);
  const [crosshairPoint, setCrosshairPoint] = useState<NativeCrosshairPoint | null>(null);

  const sortedCandles = useMemo(() => [...candles].sort((a, b) => a.datetime - b.datetime), [candles]);
  const isIntraday = useMemo(() => {
    if (sortedCandles.length < 2) return false;
    const spacingMs = sortedCandles[1].datetime - sortedCandles[0].datetime;
    return Number.isFinite(spacingMs) && spacingMs > 0 && spacingMs < 24 * 60 * 60 * 1000;
  }, [sortedCandles]);
  const sortedCandlesRef = useRef<typeof sortedCandles>([]);
  useEffect(() => {
    sortedCandlesRef.current = sortedCandles;
  }, [sortedCandles]);

  useEffect(() => {
    onInstancesRef.current = onInstances;
  }, [onInstances]);

  useEffect(() => {
    heightRef.current = height;
    chartRef.current?.applyOptions({ height });
  }, [height]);

  const candleByEpoch = useMemo(() => {
    const map = new Map<number, CandleData>();
    for (const candle of sortedCandles) {
      map.set(candle.datetime, candle);
    }
    return map;
  }, [sortedCandles]);

  const { rects: sessionShadeRects, schedule: scheduleSessionShadeRecalculation } = useSessionShading({
    enabled: showSessionShading && isIntraday,
    chartRef,
    containerRef,
    candlesRef: sortedCandlesRef,
  });

  const clearCrosshairPoint = useCallback(() => {
    setCrosshairPoint(null);
  }, []);

  const detachTrianglePrimitive = useCallback(() => {
    const series = candleSeriesRef.current;
    const primitive = trianglePrimitiveRef.current;
    if (series && primitive) {
      try {
        series.detachPrimitive(primitive);
      } catch {
        // series may already be disposed during teardown
      }
    }
    trianglePrimitiveRef.current = null;
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

  const buildMarkers = useCallback((): TriangleMarker[] => {
    if (tradeMarkers.length === 0 || sortedCandles.length === 0) {
      return [];
    }

    const candleTimestamps = sortedCandles.map((candle) => candle.datetime);
    const markers: TriangleMarker[] = [];
    [...tradeMarkers]
      .sort((a, b) => a.time - b.time)
      .forEach((marker) => {
        const nearestTimestamp = findNearestTimestamp(marker.time, candleTimestamps);
        if (nearestTimestamp == null) return;
        markers.push({
          time: toTime(nearestTimestamp),
          price: marker.price,
          direction: marker.direction,
        });
      });

    return markers;
  }, [sortedCandles, tradeMarkers]);

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
      height: heightRef.current,
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
    onInstancesRef.current?.(lifecycle.chart, lifecycle.candleSeries);

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
      detachTrianglePrimitive();
      removePriceLines();
      clearCrosshairPoint();
      onInstancesRef.current?.(null, null);
      lifecycle.cleanup();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [
    clearCrosshairPoint,
    detachTrianglePrimitive,
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
      detachTrianglePrimitive();
      if (showSessionShading) {
        scheduleSessionShadeRecalculation();
      }
      return;
    }

    const candleData: CandlestickData[] = sortedCandles.map((candle) => ({
      time: toTime(candle.datetime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const volumeData: HistogramData[] = sortedCandles.map((candle) => ({
      time: toTime(candle.datetime),
      value: candle.volume,
      color: candle.close >= candle.open ? UP_VOLUME_COLOR : DOWN_VOLUME_COLOR,
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    const markers = buildMarkers();
    if (trianglePrimitiveRef.current == null) {
      trianglePrimitiveRef.current = new TriangleMarkersPrimitive(exactPriceMarkers ? 4 : 8);
      candleSeries.attachPrimitive(trianglePrimitiveRef.current);
    }
    trianglePrimitiveRef.current.setMarkers(markers);

    if (focusLastSession) {
      const lastCandle = sortedCandles[sortedCandles.length - 1];
      const lastDayKey = epochToNySortKey(lastCandle.datetime);
      let fromDayKey = lastDayKey;
      if (tradeMarkers.length > 0) {
        const earliestMarkerDay = epochToNySortKey(Math.min(...tradeMarkers.map((m) => m.time)));
        if (earliestMarkerDay < fromDayKey) fromDayKey = earliestMarkerDay;
      }
      const firstVisible = sortedCandles.find((c) => epochToNySortKey(c.datetime) >= fromDayKey) ?? lastCandle;
      chart.timeScale().setVisibleRange({
        from: toTime(firstVisible.datetime),
        to: toTime(lastCandle.datetime),
      });
    } else {
      chart.timeScale().fitContent();
    }

    if (showSessionShading) {
      scheduleSessionShadeRecalculation();
    }
  }, [
    buildMarkers,
    clearCrosshairPoint,
    detachTrianglePrimitive,
    exactPriceMarkers,
    focusLastSession,
    scheduleSessionShadeRecalculation,
    showSessionShading,
    sortedCandles,
    tradeMarkers,
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

  // VWAP overlay. Session-anchored intraday (resets each NY session's PM open),
  // continuous for daily — matches the charts section (BacktestChart).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (vwapSeriesRef.current) {
      try {
        chart.removeSeries(vwapSeriesRef.current);
      } catch {
        // chart may be disposed
      }
      vwapSeriesRef.current = null;
    }

    if (!showVwap || sortedCandles.length === 0) return;

    const ohlc = sortedCandles.map((candle) => ({
      time: candle.datetime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));
    const values = isIntraday
      ? sessionVwap(ohlc, (candle) => (Number.isFinite(candle.time) ? epochToNySortKey(candle.time) : null))
      : vwap(ohlc);

    const series = chart.addSeries(LineSeries, {
      color: '#15803d',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(sortedCandles.flatMap((candle, index) => {
      const value = values[index];
      return value == null ? [] : [{ time: toTime(candle.datetime), value }];
    }));
    vwapSeriesRef.current = series;

    return () => {
      const activeChart = chartRef.current;
      if (activeChart && vwapSeriesRef.current) {
        try {
          activeChart.removeSeries(vwapSeriesRef.current);
        } catch {
          // chart may be disposed
        }
      }
      vwapSeriesRef.current = null;
    };
  }, [showVwap, sortedCandles, isIntraday]);

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
