'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { ChartCandlestick, Layers, Trash2 } from 'lucide-react';

import ChartDrawings from '@/components/trading/ChartDrawings';
import DrawingToolbar from '@/components/trading/DrawingToolbar';
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
import type { DrawingTool } from '@/hooks/use-chart-drawings';
import { buildExtendedHoursShadeSegments, buildSessionShadeRects, type SessionShadeRect } from '@/lib/chart-session-shading';
import { BACKTEST_FRAME_CONFIG, type BacktestTimeframeKey } from '@/lib/chart-timeframes';
import {
  anchoredVwap,
  atr,
  bollingerBands,
  ema9,
  ema20,
  ema21,
  ema50,
  rsi,
  sma20,
  sma50,
  sma200,
  vwap,
  type OHLCData,
} from '@/lib/indicators';
import { epochToNySortKey, getPreviousTradingSession, nyDateTimeToEpoch, parseSortKey } from '@/lib/time-utils';
import { formatNyCrosshair, formatNyTime } from '@/lib/chart-time';
import type { BacktestAction, BacktestActionType } from '@/lib/types';

export type IndicatorKey =
  | 'SMA20'
  | 'SMA50'
  | 'SMA200'
  | 'EMA9'
  | 'EMA20'
  | 'EMA21'
  | 'EMA50'
  | 'VWAP'
  | 'BB'
  | 'RSI'
  | 'ATR';

type SeriesType = 'candles' | 'bars' | 'line' | 'area' | 'baseline';

type MainSeriesApi = ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area' | 'Baseline'>;

type DailyAnchorRect = {
  left: number;
  width: number;
};

type MarketDataResponse = {
  candles?: Array<{
    datetime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  error?: string;
};

interface BacktestChartProps {
  ticker: string;
  anchorDate: string;
  defaultTimeframe: BacktestTimeframeKey;
  defaultIndicators?: readonly IndicatorKey[];
  onAnchorChange?: (newDate: string) => void;
  armedAction?: BacktestActionType | null;
  onArmedClick?: (payload: { price: number; barTime: string }) => void;
  actions?: BacktestAction[];
  currentStop?: number | null;
}

const UP_COLOR = '#ffffff';
const DOWN_COLOR = '#3b82f6';
const ANCHOR_BAND_COLOR = 'rgba(56, 139, 253, 0.18)';

const TIMEFRAME_OPTIONS = Object.entries(BACKTEST_FRAME_CONFIG) as Array<[BacktestTimeframeKey, (typeof BACKTEST_FRAME_CONFIG)[BacktestTimeframeKey]]>;

const INDICATOR_OPTIONS: Array<{ key: IndicatorKey; label: string }> = [
  { key: 'SMA20', label: 'SMA 20' },
  { key: 'SMA50', label: 'SMA 50' },
  { key: 'SMA200', label: 'SMA 200' },
  { key: 'EMA9', label: 'EMA 9' },
  { key: 'EMA20', label: 'EMA 20' },
  { key: 'EMA21', label: 'EMA 21' },
  { key: 'EMA50', label: 'EMA 50' },
  { key: 'VWAP', label: 'VWAP' },
  { key: 'BB', label: 'Bollinger' },
  { key: 'RSI', label: 'RSI 14' },
  { key: 'ATR', label: 'ATR 14' },
];

const LOOKBACK_WINDOWS: Record<BacktestTimeframeKey, { tradingSessionsBack?: number; calendarYearsBack?: number }> = {
  '1m': { tradingSessionsBack: 2 },
  '2m': { tradingSessionsBack: 2 },
  '3m': { tradingSessionsBack: 2 },
  '5m': { tradingSessionsBack: 2 },
  '10m': { tradingSessionsBack: 5 },
  '15m': { tradingSessionsBack: 5 },
  '30m': { tradingSessionsBack: 5 },
  '1h': { tradingSessionsBack: 20 },
  '4h': { tradingSessionsBack: 20 },
  '1D': { calendarYearsBack: 1 },
  '1W': { calendarYearsBack: 2 },
  '1M': { calendarYearsBack: 5 },
};

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
  const businessDay = time as { year?: number; month?: number; day?: number };
  if (
    Number.isFinite(businessDay.year)
    && Number.isFinite(businessDay.month)
    && Number.isFinite(businessDay.day)
  ) {
    return Date.UTC(Number(businessDay.year), Number(businessDay.month) - 1, Number(businessDay.day));
  }
  return null;
}

function shiftCalendarDays(dateKey: string, days: number) {
  const parsed = parseSortKey(dateKey);
  if (!parsed) return dateKey;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftCalendarYears(dateKey: string, years: number) {
  const parsed = parseSortKey(dateKey);
  if (!parsed) return dateKey;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

function shiftTradingSessions(dateKey: string, sessionsBack: number) {
  let cursor = dateKey;
  for (let index = 0; index < sessionsBack; index += 1) {
    const previous = getPreviousTradingSession(cursor);
    if (!previous) return cursor;
    cursor = previous;
  }
  return cursor;
}

function buildMarketOptions(anchorDate: string, timeframe: BacktestTimeframeKey) {
  const frame = BACKTEST_FRAME_CONFIG[timeframe];
  const lookback = LOOKBACK_WINDOWS[timeframe];

  if (frame.intraday) {
    const startKey = shiftTradingSessions(anchorDate, lookback.tradingSessionsBack ?? 2);
    const startDate = nyDateTimeToEpoch(startKey, '04:00:00');
    const endDate = nyDateTimeToEpoch(anchorDate, '20:00:00');

    return {
      periodType: frame.periodType,
      period: frame.period,
      frequencyType: frame.frequencyType,
      frequency: frame.frequency,
      includePrePost: true,
      startDate: startDate == null ? undefined : String(startDate),
      endDate: endDate == null ? undefined : String(endDate),
    };
  }

  const startKey = shiftCalendarYears(anchorDate, -(lookback.calendarYearsBack ?? 1));
  const startDate = nyDateTimeToEpoch(startKey, '00:00:00');
  const endDate = nyDateTimeToEpoch(anchorDate, '20:00:00');

  return {
    periodType: frame.periodType,
    period: frame.period,
    frequencyType: frame.frequencyType,
    frequency: frame.frequency,
    includePrePost: false,
    startDate: startDate == null ? undefined : String(startDate),
    endDate: endDate == null ? undefined : String(endDate),
  };
}

function dailyDateKey(epochMs: number, anchorDate?: string) {
  const utcDate = new Date(epochMs).toISOString().slice(0, 10);
  if (utcDate === anchorDate) return utcDate;

  const nyDate = epochToNySortKey(epochMs);
  if (nyDate === anchorDate) return nyDate;

  return utcDate;
}

function usePriorDailyClose(ticker: string, anchorDate: string, enabled: boolean) {
  const [priorClose, setPriorClose] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPriorClose(null);
      return;
    }

    const controller = new AbortController();
    const startKey = shiftCalendarDays(anchorDate, -14);
    const startDate = nyDateTimeToEpoch(startKey, '00:00:00');
    const endDate = nyDateTimeToEpoch(anchorDate, '00:00:00');

    const fetchPriorClose = async () => {
      try {
        const params = new URLSearchParams({
          symbol: ticker,
          periodType: 'day',
          period: '10',
          frequencyType: 'daily',
          frequency: '1',
        });
        if (startDate != null) params.set('startDate', String(startDate));
        if (endDate != null) params.set('endDate', String(endDate));

        const response = await fetch(`/api/market-data?${params.toString()}`, { signal: controller.signal });
        const payload = (await response.json().catch(() => ({}))) as MarketDataResponse;
        if (!response.ok) throw new Error(payload.error ?? 'Could not fetch prior close');

        const prior = [...(payload.candles ?? [])]
          .filter((candle) => dailyDateKey(candle.datetime, anchorDate) < anchorDate)
          .sort((a, b) => a.datetime - b.datetime)
          .at(-1);

        setPriorClose(prior?.close ?? null);
      } catch {
        if (!controller.signal.aborted) setPriorClose(null);
      }
    };

    void fetchPriorClose();

    return () => controller.abort();
  }, [anchorDate, enabled, ticker]);

  return priorClose;
}

function formatIndicatorSummary(indicators: Set<IndicatorKey>) {
  if (indicators.size === 0) return 'Indicators';
  const labels = INDICATOR_OPTIONS.filter((option) => indicators.has(option.key)).map((option) => option.label);
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.length} indicators`;
}

function toOhlc(candles: MarketDataResponse['candles'] = []): OHLCData[] {
  return candles.map((candle) => ({
    time: candle.datetime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function addLineOverlay(
  chart: IChartApi,
  sortedCandles: NonNullable<MarketDataResponse['candles']>,
  values: Array<number | null>,
  color: string,
) {
  const series = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false });
  series.setData(sortedCandles.flatMap((candle, index) => {
    const value = values[index];
    if (value == null) return [];
    return [{ time: toTime(candle.datetime), value }];
  }));
}

export default function BacktestChart({
  ticker,
  anchorDate,
  defaultTimeframe,
  defaultIndicators = [],
  onAnchorChange,
  armedAction = null,
  onArmedClick,
  actions,
  currentStop = null,
}: BacktestChartProps) {
  const [timeframe, setTimeframe] = useState<BacktestTimeframeKey>(defaultTimeframe);
  const [indicators, setIndicators] = useState<Set<IndicatorKey>>(() => new Set(defaultIndicators));
  const [seriesType, setSeriesType] = useState<SeriesType>('candles');
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>(null);
  const [drawingsCount, setDrawingsCount] = useState(0);
  const [isDrawingInteractionActive, setIsDrawingInteractionActive] = useState(false);
  const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
  const [seriesInstance, setSeriesInstance] = useState<MainSeriesApi | null>(null);
  const [dailyAnchorRect, setDailyAnchorRect] = useState<DailyAnchorRect | null>(null);
  const [sessionShadeRects, setSessionShadeRects] = useState<SessionShadeRect[]>([]);
  const [hoverOhlc, setHoverOhlc] = useState<{ o: number; h: number; l: number; c: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const clearAllDrawingsRef = useRef<(() => void) | null>(null);
  const activeDrawingToolRef = useRef<DrawingTool>(activeDrawingTool);
  // Volatile callbacks/state captured in refs so the main chart effect doesn't
  // tear down and rebuild the chart whenever the parent re-renders. Without
  // this, drawings vanish because the underlying chart (and ChartDrawings'
  // synced canvas) gets replaced mid-interaction.
  const armedActionRef = useRef<BacktestActionType | null>(armedAction);
  const onArmedClickRef = useRef(onArmedClick);
  const onAnchorChangeRef = useRef(onAnchorChange);

  const frame = BACKTEST_FRAME_CONFIG[timeframe];
  const isDailyAnchorCell = timeframe === '1D' && onAnchorChange != null;
  const marketOptions = useMemo(() => buildMarketOptions(anchorDate, timeframe), [anchorDate, timeframe]);
  const { candles, isLoading, error } = useCandleData(ticker, marketOptions);
  const priorClose = usePriorDailyClose(ticker, anchorDate, frame.intraday);
  const indicatorSummary = useMemo(() => formatIndicatorSummary(indicators), [indicators]);
  const drawingScope = `${ticker}:${anchorDate}:${timeframe}`;

  useEffect(() => {
    activeDrawingToolRef.current = activeDrawingTool;
  }, [activeDrawingTool]);

  useEffect(() => {
    armedActionRef.current = armedAction;
  }, [armedAction]);

  useEffect(() => {
    onArmedClickRef.current = onArmedClick;
  }, [onArmedClick]);

  useEffect(() => {
    onAnchorChangeRef.current = onAnchorChange;
  }, [onAnchorChange]);

  const toggleIndicator = useCallback((key: IndicatorKey, checked: boolean) => {
    setIndicators((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    chart.applyOptions({
      handleScroll: !isDrawingInteractionActive,
      handleScale: !isDrawingInteractionActive,
    });
  }, [isDrawingInteractionActive]);

  useEffect(() => {
    if (!containerRef.current) return;

    const sortedCandles = [...candles].sort((a, b) => a.datetime - b.datetime);
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
        timeVisible: frame.intraday,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => formatNyTime(time, frame.intraday),
      },
      localization: {
        timeFormatter: (time: Time) => formatNyCrosshair(time),
      },
      handleScroll: true,
      handleScale: true,
      width: containerRef.current.clientWidth,
      height: Math.max(containerRef.current.clientHeight, 300),
    });

    chartRef.current = chart;

    let baseSeries: MainSeriesApi;
    if (seriesType === 'bars') {
      baseSeries = chart.addSeries(BarSeries, { upColor: UP_COLOR, downColor: DOWN_COLOR });
    } else if (seriesType === 'line') {
      baseSeries = chart.addSeries(LineSeries, { color: '#e4e4e7', lineWidth: 2 });
    } else if (seriesType === 'area') {
      baseSeries = chart.addSeries(AreaSeries, {
        lineColor: '#22c55e',
        topColor: 'rgba(34, 197, 94, 0.22)',
        bottomColor: 'rgba(34, 197, 94, 0.02)',
      });
    } else if (seriesType === 'baseline') {
      baseSeries = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: sortedCandles[0]?.close ?? 0 },
        topLineColor: '#22c55e',
        topFillColor1: 'rgba(34, 197, 94, 0.2)',
        topFillColor2: 'rgba(34, 197, 94, 0.02)',
        bottomLineColor: '#ef4444',
        bottomFillColor1: 'rgba(239, 68, 68, 0.02)',
        bottomFillColor2: 'rgba(239, 68, 68, 0.18)',
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

    let disposed = false;
    let sessionShadeAnimationFrame: number | null = null;
    queueMicrotask(() => {
      if (disposed) return;
      setChartInstance(chart);
      setSeriesInstance(baseSeries);
    });

    if (seriesType === 'candles' || seriesType === 'bars') {
      const data: CandlestickData[] = sortedCandles.map((candle) => ({
        time: toTime(candle.datetime),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));
      baseSeries.setData(data);
    } else {
      const data: LineData[] = sortedCandles.map((candle) => ({
        time: toTime(candle.datetime),
        value: candle.close,
      }));
      baseSeries.setData(data);
    }

    const closes = sortedCandles.map((candle) => candle.close);
    const ohlc = toOhlc(sortedCandles);

    if (indicators.has('SMA20')) addLineOverlay(chart, sortedCandles, sma20(closes), '#a1a1aa');
    if (indicators.has('SMA50')) addLineOverlay(chart, sortedCandles, sma50(closes), '#f59e0b');
    if (indicators.has('SMA200')) addLineOverlay(chart, sortedCandles, sma200(closes), '#ef4444');
    if (indicators.has('EMA9')) addLineOverlay(chart, sortedCandles, ema9(closes), '#22c55e');
    if (indicators.has('EMA20')) addLineOverlay(chart, sortedCandles, ema20(closes), '#eab308');
    if (indicators.has('EMA21')) addLineOverlay(chart, sortedCandles, ema21(closes), '#f97316');
    if (indicators.has('EMA50')) addLineOverlay(chart, sortedCandles, ema50(closes), '#38bdf8');
    if (indicators.has('VWAP')) {
      // For intraday charts, anchor VWAP at 04:00 NY of the trade's date so the
      // line starts at the PM open and includes pre-market bars. For daily
      // charts (no PM concept), fall back to the simple cumulative VWAP.
      const anchorEpochMs = frame.intraday ? nyDateTimeToEpoch(anchorDate, '04:00:00') : null;
      const values = anchorEpochMs != null ? anchoredVwap(ohlc, anchorEpochMs) : vwap(ohlc);
      addLineOverlay(chart, sortedCandles, values, '#f472b6');
    }

    if (indicators.has('BB')) {
      const bands = bollingerBands(closes, 20, 2);
      addLineOverlay(chart, sortedCandles, bands.upper, '#94a3b8');
      addLineOverlay(chart, sortedCandles, bands.lower, '#94a3b8');
    }

    if (indicators.has('RSI') && sortedCandles.length > 0) {
      const rsiPane = chart.addPane();
      rsiPane.setHeight(64);
      rsiPane.setStretchFactor(0.24);
      const rsiSeries = rsiPane.addSeries(LineSeries, {
        color: '#e4e4e7',
        lineWidth: 1,
        priceLineVisible: false,
      });
      const values = rsi(closes, 14);
      rsiSeries.setData(sortedCandles.flatMap((candle, index) => {
        const value = values[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
    }

    if (indicators.has('ATR') && sortedCandles.length > 0) {
      const atrPane = chart.addPane();
      atrPane.setHeight(54);
      atrPane.setStretchFactor(0.2);
      const atrSeries = atrPane.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        priceLineVisible: false,
      });
      const values = atr(ohlc, 14);
      atrSeries.setData(sortedCandles.flatMap((candle, index) => {
        const value = values[index];
        if (value == null) return [];
        return [{ time: toTime(candle.datetime), value }];
      }));
    }

    if (frame.intraday && priorClose != null) {
      baseSeries.createPriceLine({
        price: priorClose,
        color: '#888888',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'PDC',
      });
    }

    chart.timeScale().fitContent();

    const clearSessionShadeRects = () => {
      queueMicrotask(() => {
        if (disposed) return;
        setSessionShadeRects([]);
      });
    };

    const recalcSessionShadeRects = () => {
      if (!frame.intraday || sortedCandles.length === 0 || !chartWrapRef.current) {
        clearSessionShadeRects();
        return;
      }

      const viewportWidth = chartWrapRef.current.clientWidth;
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

      const rects = buildSessionShadeRects({
        candles: sortedCandles,
        segments: buildExtendedHoursShadeSegments(daySet),
        visibleStart,
        visibleEnd,
        viewportWidth,
        timeToCoordinate: (epochMs) => chart.timeScale().timeToCoordinate(toTime(epochMs)),
      });

      queueMicrotask(() => {
        if (disposed) return;
        setSessionShadeRects(rects);
      });
    };

    const scheduleSessionShadeRecalc = () => {
      if (sessionShadeAnimationFrame != null) {
        cancelAnimationFrame(sessionShadeAnimationFrame);
      }

      sessionShadeAnimationFrame = requestAnimationFrame(() => {
        sessionShadeAnimationFrame = null;
        recalcSessionShadeRects();
      });
    };

    const recalcDailyAnchorRect = () => {
      if (!isDailyAnchorCell || sortedCandles.length === 0 || !chartWrapRef.current) {
        setDailyAnchorRect(null);
        return;
      }

      const matchIndex = sortedCandles.findIndex((candle) => dailyDateKey(candle.datetime, anchorDate) === anchorDate);
      if (matchIndex < 0) {
        setDailyAnchorRect(null);
        return;
      }

      const center = chart.timeScale().timeToCoordinate(toTime(sortedCandles[matchIndex].datetime));
      if (center == null) {
        setDailyAnchorRect(null);
        return;
      }

      const previous = sortedCandles[matchIndex - 1]
        ? chart.timeScale().timeToCoordinate(toTime(sortedCandles[matchIndex - 1].datetime))
        : null;
      const next = sortedCandles[matchIndex + 1]
        ? chart.timeScale().timeToCoordinate(toTime(sortedCandles[matchIndex + 1].datetime))
        : null;

      const neighborDistance = Math.min(
        previous == null ? Number.POSITIVE_INFINITY : Math.abs(center - previous),
        next == null ? Number.POSITIVE_INFINITY : Math.abs(next - center),
      );
      const width = Number.isFinite(neighborDistance) ? Math.max(8, neighborDistance * 0.82) : 12;
      const chartWidth = chartWrapRef.current.clientWidth;
      const left = Math.max(0, Math.min(center - width / 2, chartWidth));
      const right = Math.max(0, Math.min(center + width / 2, chartWidth));
      setDailyAnchorRect({ left, width: Math.max(0, right - left) });
    };

    const handleRangeChange = () => {
      recalcDailyAnchorRect();
      scheduleSessionShadeRecalc();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
    chart.timeScale().subscribeVisibleTimeRangeChange(handleRangeChange);

    const handleClick = (param: MouseEventParams<Time>) => {
      if (activeDrawingToolRef.current || !param.time) return;

      const currentArmedAction = armedActionRef.current;
      const armedClick = onArmedClickRef.current;
      if (currentArmedAction && armedClick && param.point) {
        const price = baseSeries.coordinateToPrice(param.point.y);
        const epochMs = toEpochMs(param.time);
        if (price != null && epochMs != null) {
          armedClick({
            price: Number(price.toFixed(4)),
            barTime: new Date(epochMs).toISOString(),
          });
          return;
        }
      }

      if (!isDailyAnchorCell || currentArmedAction) return;
      const epochMs = toEpochMs(param.time);
      if (epochMs == null) return;
      const nextDate = dailyDateKey(epochMs, anchorDate);
      if (nextDate !== anchorDate) onAnchorChangeRef.current?.(nextDate);
    };
    chart.subscribeClick(handleClick);

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const data = param.seriesData.get(baseSeries) as
        | { open?: number; high?: number; low?: number; close?: number; value?: number }
        | undefined;
      if (!data) {
        setHoverOhlc(null);
        return;
      }
      // Candle/bar series provide o/h/l/c; line/area/baseline only have `value` (= close).
      if (data.open != null && data.high != null && data.low != null && data.close != null) {
        setHoverOhlc({ o: data.open, h: data.high, l: data.low, c: data.close });
      } else if (data.value != null) {
        setHoverOhlc({ o: data.value, h: data.value, l: data.value, c: data.value });
      } else {
        setHoverOhlc(null);
      }
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const resizeObserver = new ResizeObserver(() => {
      const width = containerRef.current?.clientWidth ?? 0;
      const height = containerRef.current?.clientHeight ?? 0;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
        chart.timeScale().fitContent();
        recalcDailyAnchorRect();
        scheduleSessionShadeRecalc();
      }
    });
    resizeObserver.observe(containerRef.current);
    recalcDailyAnchorRect();
    scheduleSessionShadeRecalc();

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleRangeChange);
      chart.unsubscribeClick(handleClick);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      resizeObserver.disconnect();
      if (sessionShadeAnimationFrame != null) {
        cancelAnimationFrame(sessionShadeAnimationFrame);
        sessionShadeAnimationFrame = null;
      }
      disposed = true;
      setChartInstance(null);
      setSeriesInstance(null);
      setDailyAnchorRect(null);
      setSessionShadeRects([]);
      setHoverOhlc(null);
      setIsDrawingInteractionActive(false);
      chart.remove();
      chartRef.current = null;
    };
  }, [
    anchorDate,
    candles,
    frame.intraday,
    indicators,
    isDailyAnchorCell,
    priorClose,
    seriesType,
  ]);

  // Sim execution arrows + open-position stop line. Runs separately from the
  // chart-creation effect so placing a trade doesn't tear down the chart (and
  // wipe in-progress drawings).
  useEffect(() => {
    if (!seriesInstance) return;

    const series = seriesInstance;
    let markersPlugin: ISeriesMarkersPluginApi<Time> | null = null;
    let stopLine: IPriceLine | null = null;

    if (frame.intraday && actions && actions.length > 0) {
      const markers: SeriesMarker<Time>[] = actions.map((action) => {
        const epochMs = Date.parse(action.barTime);
        const time = (Number.isFinite(epochMs) ? Math.floor(epochMs / 1000) : 0) as unknown as Time;
        const isUpArrow = action.actionType === 'LONG'
          || action.actionType === 'LONG_ADD'
          || action.actionType === 'COVER';
        return {
          id: action.id,
          time,
          position: isUpArrow ? 'atPriceBottom' : 'atPriceTop',
          color: isUpArrow ? '#22c55e' : '#ef4444',
          shape: isUpArrow ? 'arrowUp' : 'arrowDown',
          price: action.price,
          size: 1,
        };
      });
      markersPlugin = createSeriesMarkers(series, markers);
    }

    if (currentStop != null && Number.isFinite(currentStop)) {
      stopLine = series.createPriceLine({
        price: currentStop,
        color: '#fbbf24',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `S:${currentStop.toFixed(2)}`,
      });
    }

    return () => {
      markersPlugin?.detach();
      if (stopLine) {
        try {
          series.removePriceLine(stopLine);
        } catch {
          // series may already be disposed when chart was torn down.
        }
      }
    };
  }, [seriesInstance, actions, currentStop, frame.intraday]);

  return (
    <section className="flex h-[440px] shrink-0 flex-col overflow-hidden border border-white/10 bg-[#121214]">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/10 bg-[#0A0A0B] px-2">
        <div className="mr-1 flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-xs font-semibold text-zinc-100">{ticker}</span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-500">{BACKTEST_FRAME_CONFIG[timeframe].label}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="h-7 px-2 text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white">
              {BACKTEST_FRAME_CONFIG[timeframe].label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-white/10 bg-[#111319] text-white">
            <DropdownMenuRadioGroup value={timeframe} onValueChange={(value) => setTimeframe(value as BacktestTimeframeKey)}>
              {TIMEFRAME_OPTIONS.map(([key, config]) => (
                <DropdownMenuRadioItem key={key} value={key} className="cursor-pointer text-xs">
                  {config.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="h-7 max-w-[130px] px-2 text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white">
              <Layers className="h-3 w-3" />
              <span className="truncate">{indicatorSummary}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 border-white/10 bg-[#111319] text-white">
            {INDICATOR_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.key}
                checked={indicators.has(option.key)}
                onCheckedChange={(checked) => toggleIndicator(option.key, Boolean(checked))}
                className="cursor-pointer text-xs"
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" className="text-zinc-300 hover:bg-white/10 hover:text-white" title="Series type" aria-label="Series type">
              <ChartCandlestick className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-white/10 bg-[#111319] text-white">
            <DropdownMenuRadioGroup value={seriesType} onValueChange={(value) => setSeriesType(value as SeriesType)}>
              <DropdownMenuRadioItem value="candles" className="cursor-pointer text-xs">Candles</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="bars" className="cursor-pointer text-xs">Bars</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="line" className="cursor-pointer text-xs">Line</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="area" className="cursor-pointer text-xs">Area</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="baseline" className="cursor-pointer text-xs">Baseline</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {hoverOhlc ? (
          <div className="ml-2 flex items-center gap-2 font-mono text-xs tabular-nums text-zinc-300">
            <span><span className="text-zinc-500">O</span> {hoverOhlc.o.toFixed(2)}</span>
            <span><span className="text-zinc-500">H</span> {hoverOhlc.h.toFixed(2)}</span>
            <span><span className="text-zinc-500">L</span> {hoverOhlc.l.toFixed(2)}</span>
            <span><span className="text-zinc-500">C</span> {hoverOhlc.c.toFixed(2)}</span>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-0.5">
          <DrawingToolbar
            activeTool={activeDrawingTool}
            onToolSelect={setActiveDrawingTool}
          />
          {drawingsCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => clearAllDrawingsRef.current?.()}
              className="text-zinc-400 hover:bg-rose-500/20 hover:text-rose-400"
              title="Clear drawings"
              aria-label="Clear drawings"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <div ref={chartWrapRef} className={`relative min-h-0 flex-1 ${activeDrawingTool ? 'cursor-crosshair' : ''}`}>
        <div ref={containerRef} className="absolute inset-0" />
        {frame.intraday && sessionShadeRects.length > 0 ? (
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
        {dailyAnchorRect && dailyAnchorRect.width > 0 ? (
          <div className="pointer-events-none absolute inset-0 z-20">
            <div
              className="absolute bottom-0 top-0"
              style={{
                left: `${dailyAnchorRect.left}px`,
                width: `${dailyAnchorRect.width}px`,
                backgroundColor: ANCHOR_BAND_COLOR,
              }}
            />
          </div>
        ) : null}
        {isLoading ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#121214]/70 text-xs text-zinc-500">Loading chart...</div>
        ) : null}
        {!isLoading && error ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#121214]/80 px-4 text-center text-xs text-rose-400">{error}</div>
        ) : null}
        {!isLoading && !error && candles.length === 0 ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#121214]/70 text-xs text-zinc-500">No candles found</div>
        ) : null}
        <ChartDrawings
          symbol={drawingScope}
          chart={chartInstance}
          series={seriesInstance}
          activeTool={activeDrawingTool}
          onToolChange={setActiveDrawingTool}
          selectedColor="#ffffff"
          lineWidth={1}
          persistDrawings={false}
          onInteractionChange={setIsDrawingInteractionActive}
          onDrawingsChange={(count, clearFn) => {
            setDrawingsCount(count);
            clearAllDrawingsRef.current = clearFn;
          }}
        />
      </div>
    </section>
  );
}
