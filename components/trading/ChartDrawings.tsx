'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import type { IChartApi, ISeriesApi, Time, IPriceLine } from 'lightweight-charts';
import { useChartDrawings, type Drawing, type DrawingTool } from '@/hooks/use-chart-drawings';
import FibonacciSettings from './FibonacciSettings';
import { createTrendLineRenderer } from './plugins/TrendLinePrimitive';
import { createRectangleRenderer } from './plugins/RectanglePrimitive';
import { createFibonacciRenderer, DEFAULT_FIBONACCI_LEVELS } from './plugins/FibonacciPrimitive';

// Hit detection helper - check if point is near a drawing
const HIT_TOLERANCE = 10; // pixels

function isPointNearDrawing(
  x: number,
  y: number,
  drawing: Drawing,
  priceToCoordinate: (price: number) => number | null,
  timeToCoordinate: (time: number) => number | null
): boolean {
  switch (drawing.type) {
    case 'trendline': {
      const x1 = timeToCoordinate(drawing.start.time);
      const y1 = priceToCoordinate(drawing.start.price);
      const x2 = timeToCoordinate(drawing.end.time);
      const y2 = priceToCoordinate(drawing.end.price);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return false;
      return distanceToLineSegment(x, y, x1, y1, x2, y2) < HIT_TOLERANCE;
    }
    case 'horizontal': {
      const yPos = priceToCoordinate(drawing.price);
      if (yPos === null) return false;
      return Math.abs(y - yPos) < HIT_TOLERANCE;
    }
    case 'rectangle': {
      const x1 = timeToCoordinate(drawing.start.time);
      const y1 = priceToCoordinate(drawing.start.price);
      const x2 = timeToCoordinate(drawing.end.time);
      const y2 = priceToCoordinate(drawing.end.price);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return false;
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);
      // Check if point is inside or near rectangle
      return (
        x >= left - HIT_TOLERANCE &&
        x <= right + HIT_TOLERANCE &&
        y >= top - HIT_TOLERANCE &&
        y <= bottom + HIT_TOLERANCE
      );
    }
    case 'fibonacci': {
      const x1 = timeToCoordinate(drawing.start.time);
      const y1 = priceToCoordinate(drawing.start.price);
      const x2 = timeToCoordinate(drawing.end.time);
      const y2 = priceToCoordinate(drawing.end.price);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return false;
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      // Check if near the base line or any level line
      if (distanceToLineSegment(x, y, x1, y1, x2, y2) < HIT_TOLERANCE) return true;
      // Check level lines
      const topPrice = Math.max(drawing.start.price, drawing.end.price);
      const bottomPrice = Math.min(drawing.start.price, drawing.end.price);
      const priceRange = topPrice - bottomPrice;
      for (const level of drawing.levels) {
        const levelPrice = topPrice - priceRange * level;
        const yPos = priceToCoordinate(levelPrice);
        if (yPos !== null && Math.abs(y - yPos) < HIT_TOLERANCE && x >= left - HIT_TOLERANCE && x <= right + HIT_TOLERANCE) {
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

function distanceToLineSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;
  let xx: number, yy: number;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

interface ChartDrawingsProps {
  symbol: string;
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick' | 'Bar'> | null;
  activeTool: DrawingTool;
  onToolChange?: (tool: DrawingTool) => void;
  selectedColor: string;
  lineWidth: number;
  onDrawingsChange?: (count: number, clearAll: () => void) => void;
}

export default function ChartDrawings({
  symbol,
  chart,
  series,
  activeTool,
  onToolChange,
  selectedColor,
  lineWidth,
  onDrawingsChange,
}: ChartDrawingsProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [showFibSettings, setShowFibSettings] = useState(false);
  const [editingFibId, setEditingFibId] = useState<string | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());

  const {
    isDrawing,
    tempDrawing,
    drawings,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    clearAllDrawings,
    updateDrawingLevels,
  } = useChartDrawings(symbol, activeTool, selectedColor, lineWidth);

  // Get coordinate converters
  const priceToCoordinate = useCallback(
    (price: number): number | null => {
      if (!series) return null;
      return series.priceToCoordinate(price);
    },
    [series]
  );

  const timeToCoordinate = useCallback(
    (time: number): number | null => {
      if (!chart) return null;
      // Convert milliseconds to seconds for lightweight-charts Time type
      return chart.timeScale().timeToCoordinate(Math.floor(time / 1000) as Time);
    },
    [chart]
  );

  const coordinateToPrice = useCallback(
    (y: number): number | null => {
      if (!series) return null;
      return series.coordinateToPrice(y);
    },
    [series]
  );

  const coordinateToTime = useCallback(
    (x: number): number | null => {
      if (!chart) return null;
      const time = chart.timeScale().coordinateToTime(x);
      if (time === null) return null;
      // Convert seconds to milliseconds for internal storage
      if (typeof time === 'number') return time * 1000;
      if (typeof time === 'string') return Date.parse(time);
      return null;
    },
    [chart]
  );

  // Handle mouse events for drawing
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!chart) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = coordinateToTime(x);
      const price = coordinateToPrice(y);

      if (time === null || price === null) return;

      // If no tool is active, check for click on existing drawings
      if (!activeTool) {
        // Check if clicking on a drawing (reverse order to get top-most first)
        for (let i = drawings.length - 1; i >= 0; i--) {
          const drawing = drawings[i];
          if (isPointNearDrawing(x, y, drawing, priceToCoordinate, timeToCoordinate)) {
            setSelectedDrawingId(drawing.id);
            return;
          }
        }
        // Clicked on empty space, deselect
        setSelectedDrawingId(null);
        return;
      }

      startDrawing({ time, price });
    },
    [activeTool, chart, coordinateToTime, coordinateToPrice, startDrawing, drawings, priceToCoordinate, timeToCoordinate]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !chart) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = coordinateToTime(x);
      const price = coordinateToPrice(y);

      if (time === null || price === null) return;

      updateDrawing({ time, price });
    },
    [isDrawing, chart, coordinateToTime, coordinateToPrice, updateDrawing]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;
    finishDrawing();
    // Auto-deselect tool after drawing is placed
    if (onToolChange) {
      onToolChange(null);
    }
  }, [isDrawing, finishDrawing, onToolChange]);

  const handleMouseLeave = useCallback(() => {
    if (isDrawing) {
      cancelDrawing();
    }
  }, [isDrawing, cancelDrawing]);

  // Render a single drawing
  const renderDrawing = useCallback(
    (ctx: CanvasRenderingContext2D, drawing: Drawing, isSelected: boolean) => {
      // Draw selection highlight if selected
      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = '#22d3ee'; // cyan highlight
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        // Draw bounding box or highlight based on drawing type
        switch (drawing.type) {
          case 'trendline':
          case 'fibonacci': {
            const x1 = timeToCoordinate(drawing.start.time);
            const y1 = priceToCoordinate(drawing.start.price);
            const x2 = timeToCoordinate(drawing.end.time);
            const y2 = priceToCoordinate(drawing.end.price);
            if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }
            break;
          }
          case 'rectangle': {
            const x1 = timeToCoordinate(drawing.start.time);
            const y1 = priceToCoordinate(drawing.start.price);
            const x2 = timeToCoordinate(drawing.end.time);
            const y2 = priceToCoordinate(drawing.end.price);
            if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
              ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
            }
            break;
          }
        }
        ctx.restore();
      }

      switch (drawing.type) {
        case 'trendline': {
          const renderer = createTrendLineRenderer({
            startTime: drawing.start.time,
            startPrice: drawing.start.price,
            endTime: drawing.end.time,
            endPrice: drawing.end.price,
            color: drawing.color,
            lineWidth: drawing.lineWidth,
          });
          renderer.draw(ctx, priceToCoordinate, timeToCoordinate);
          break;
        }
        case 'horizontal': {
          // Horizontal lines are rendered via createPriceLine
          break;
        }
        case 'rectangle': {
          const renderer = createRectangleRenderer({
            startTime: drawing.start.time,
            startPrice: drawing.start.price,
            endTime: drawing.end.time,
            endPrice: drawing.end.price,
            color: drawing.color,
            lineWidth: drawing.lineWidth,
          });
          renderer.draw(ctx, priceToCoordinate, timeToCoordinate);
          break;
        }
        case 'fibonacci': {
          const renderer = createFibonacciRenderer({
            startTime: drawing.start.time,
            startPrice: drawing.start.price,
            endTime: drawing.end.time,
            endPrice: drawing.end.price,
            levels: drawing.levels,
            color: drawing.color,
            lineWidth: drawing.lineWidth,
          });
          renderer.draw(ctx, priceToCoordinate, timeToCoordinate);
          break;
        }
      }
    },
    [priceToCoordinate, timeToCoordinate]
  );

  // Render all drawings on canvas
  const renderDrawings = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas || !chart) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render completed drawings
    drawings.forEach((drawing) => {
      renderDrawing(ctx, drawing, drawing.id === selectedDrawingId);
    });

    // Render temp drawing
    if (tempDrawing) {
      renderDrawing(ctx, tempDrawing, false);
    }
  }, [drawings, tempDrawing, chart, renderDrawing, selectedDrawingId]);

  // Update price lines for horizontal drawings
  useEffect(() => {
    if (!series) return;

    // Store ref values in local variables for cleanup
    const currentSeries = series;
    const priceLinesMap = priceLinesRef.current;

    // Remove old price lines
    priceLinesMap.forEach((line) => {
      currentSeries.removePriceLine(line);
    });
    priceLinesMap.clear();

    // Add new price lines for horizontal drawings
    drawings.forEach((drawing) => {
      if (drawing.type === 'horizontal') {
        const line = currentSeries.createPriceLine({
          price: drawing.price,
          color: drawing.color,
          lineWidth: drawing.lineWidth as 1 | 2 | 3 | 4,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
        });
        priceLinesMap.set(drawing.id, line);
      }
    });

    return () => {
      const linesToRemove = Array.from(priceLinesMap.values());
      linesToRemove.forEach((line) => {
        currentSeries.removePriceLine(line);
      });
      priceLinesMap.clear();
    };
  }, [drawings, series]);

  // Redraw on changes
  useEffect(() => {
    renderDrawings();
  }, [renderDrawings]);

  // Notify parent of drawings count and provide clearAllDrawings function
  useEffect(() => {
    if (onDrawingsChange) {
      onDrawingsChange(drawings.length, clearAllDrawings);
    }
  }, [drawings.length, clearAllDrawings, onDrawingsChange]);

  // Handle chart resize and initial sizing
  useEffect(() => {
    if (!chart || !overlayRef.current) return;

    const canvas = overlayRef.current;
    const container = canvas.parentElement;
    if (!container) return;

    // Set initial size immediately
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    renderDrawings();

    const resizeObserver = new ResizeObserver(() => {
      if (!container || !canvas) return;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      renderDrawings();
    });

    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [chart, renderDrawings]);

  // Subscribe to chart updates for redraw
  useEffect(() => {
    if (!chart) return;

    const handleVisibleRangeChange = () => {
      requestAnimationFrame(renderDrawings);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
    };
  }, [chart, renderDrawings]);

  // Handle fibonacci settings
  const handleFibSettingsOpen = useCallback((id: string) => {
    setEditingFibId(id);
    setShowFibSettings(true);
  }, []);

  const handleFibSettingsSave = useCallback(
    (levels: number[]) => {
      if (editingFibId) {
        updateDrawingLevels(editingFibId, levels);
      }
      setShowFibSettings(false);
      setEditingFibId(null);
    },
    [editingFibId, updateDrawingLevels]
  );

  // Get current fib levels for editing
  const currentFibLevels = editingFibId
    ? (drawings.find((d) => d.id === editingFibId)?.type === 'fibonacci'
      ? (drawings.find((d) => d.id === editingFibId) as { levels: number[] }).levels
      : DEFAULT_FIBONACCI_LEVELS)
    : DEFAULT_FIBONACCI_LEVELS;

  // Get selected drawing for showing settings button
  const selectedDrawing = selectedDrawingId ? drawings.find((d) => d.id === selectedDrawingId) : null;
  const isSelectedFibonacci = selectedDrawing?.type === 'fibonacci';

  // Calculate position for settings button (near the end point of the drawing)
  const settingsButtonPosition = useMemo(() => {
    if (!selectedDrawing || !isSelectedFibonacci) return null;
    const x2 = timeToCoordinate(selectedDrawing.end.time);
    const y2 = priceToCoordinate(selectedDrawing.end.price);
    if (x2 === null || y2 === null) return null;
    return { x: x2 + 10, y: y2 - 12 };
  }, [selectedDrawing, isSelectedFibonacci, timeToCoordinate, priceToCoordinate]);

  return (
    <>
      {/* Drawing Overlay Canvas */}
      <canvas
        ref={overlayRef}
        className={`absolute inset-0 z-20 ${activeTool ? 'cursor-crosshair' : 'pointer-events-none'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Settings button for selected fibonacci */}
      {isSelectedFibonacci && settingsButtonPosition && (
        <button
          onClick={() => {
            if (selectedDrawingId) {
              handleFibSettingsOpen(selectedDrawingId);
            }
          }}
          className="absolute z-30 rounded bg-zinc-700 p-1 text-white hover:bg-zinc-600"
          style={{ left: settingsButtonPosition.x, top: settingsButtonPosition.y }}
          title="Edit Fibonacci levels"
        >
          <Settings className="h-4 w-4" />
        </button>
      )}

      {/* Fibonacci Settings Dialog */}
      <FibonacciSettings
        isOpen={showFibSettings}
        onClose={() => {
          setShowFibSettings(false);
          setEditingFibId(null);
        }}
        currentLevels={currentFibLevels}
        onSave={handleFibSettingsSave}
      />
    </>
  );
}
