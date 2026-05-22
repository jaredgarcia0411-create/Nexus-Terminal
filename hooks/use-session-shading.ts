import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';

import {
  buildExtendedHoursShadeSegments,
  buildSessionShadeRects,
  type SessionShadeRect,
} from '@/lib/chart-session-shading';
import { toEpochMs, toTime } from '@/lib/chart-time';
import { epochToNySortKey } from '@/lib/time-utils';

type TimedCandle = { datetime: number };

interface UseSessionShadingOptions {
  enabled: boolean;
  chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLElement | null>;
  candlesRef: RefObject<readonly TimedCandle[]>;
}

export function useSessionShading({
  enabled,
  chartRef,
  containerRef,
  candlesRef,
}: UseSessionShadingOptions): {
  rects: SessionShadeRect[];
  schedule: () => void;
} {
  const [rects, setRects] = useState<SessionShadeRect[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const clearRects = useCallback(() => {
    queueMicrotask(() => setRects([]));
  }, []);

  const recalculate = useCallback(() => {
    if (!enabledRef.current) {
      clearRects();
      return;
    }

    const chart = chartRef.current;
    const container = containerRef.current;
    const candles = candlesRef.current ?? [];
    if (!chart || !container || candles.length === 0) {
      clearRects();
      return;
    }

    const viewportWidth = container.clientWidth;
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
      clearRects();
      return;
    }

    const visibleRange = chart.timeScale().getVisibleRange();
    const visibleStart = toEpochMs(visibleRange?.from);
    const visibleEnd = toEpochMs(visibleRange?.to);

    const daySet = new Set<string>();
    for (const candle of candles) {
      daySet.add(epochToNySortKey(candle.datetime));
    }

    const next = buildSessionShadeRects({
      candles,
      segments: buildExtendedHoursShadeSegments(daySet),
      visibleStart,
      visibleEnd,
      viewportWidth,
      timeToCoordinate: (epochMs) => chart.timeScale().timeToCoordinate(toTime(epochMs)),
    });

    queueMicrotask(() => setRects(next));
  }, [chartRef, containerRef, candlesRef, clearRects]);

  const schedule = useCallback(() => {
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      recalculate();
    });
  }, [recalculate]);

  useEffect(() => {
    if (!enabled) clearRects();
  }, [enabled, clearRects]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  return { rects, schedule };
}
