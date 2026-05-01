'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { IChartApi, ISeriesApi, Time, IPriceLine } from 'lightweight-charts';
import { useChartDrawings, type Drawing, type DrawingTool, type TrendLineDrawing, type RectangleDrawing, type FibonacciDrawing } from '@/hooks/use-chart-drawings';
import { createTrendLineRenderer } from './plugins/TrendLinePrimitive';
import { createRectangleRenderer } from './plugins/RectanglePrimitive';
import { createFibonacciRenderer } from './plugins/FibonacciPrimitive';

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
      // Hit on the diagonal anchor line counts.
      if (distanceToLineSegment(x, y, x1, y1, x2, y2) < HIT_TOLERANCE) return true;
      // Or hit on any horizontal level line within the diagonal's x-span.
      const topPrice = Math.max(drawing.start.price, drawing.end.price);
      const bottomPrice = Math.min(drawing.start.price, drawing.end.price);
      const priceRange = topPrice - bottomPrice;
      for (const level of drawing.levels) {
        const levelPrice = topPrice - priceRange * level;
        const yPos = priceToCoordinate(levelPrice);
        if (yPos === null) continue;
        if (
          Math.abs(y - yPos) < HIT_TOLERANCE &&
          x >= left - HIT_TOLERANCE &&
          x <= right + HIT_TOLERANCE
        ) {
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

// Check if point is near a specific endpoint of a drawing
function isPointNearEndpoint(
  x: number,
  y: number,
  drawing: Drawing,
  priceToCoordinate: (price: number) => number | null,
  timeToCoordinate: (time: number) => number | null
): { isNear: boolean; which: 'start' | 'end' | null } {
  if (drawing.type === 'horizontal') {
    return { isNear: false, which: null };
  }

  const d = drawing as TrendLineDrawing | RectangleDrawing | FibonacciDrawing;
  const x1 = timeToCoordinate(d.start.time);
  const y1 = priceToCoordinate(d.start.price);
  const x2 = timeToCoordinate(d.end.time);
  const y2 = priceToCoordinate(d.end.price);

  if (x1 === null || y1 === null || x2 === null || y2 === null) {
    return { isNear: false, which: null };
  }

  const distToStart = Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  const distToEnd = Math.sqrt((x - x2) ** 2 + (y - y2) ** 2);

  if (distToStart < HIT_TOLERANCE) {
    return { isNear: true, which: 'start' };
  }
  if (distToEnd < HIT_TOLERANCE) {
    return { isNear: true, which: 'end' };
  }

  return { isNear: false, which: null };
}

interface ChartDrawingsProps {
	symbol: string;
	chart: IChartApi | null;
	series: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area' | 'Baseline'> | null;
	activeTool: DrawingTool;
	onToolChange?: (tool: DrawingTool) => void;
	selectedColor: string;
	lineWidth: number;
	onDrawingsChange?: (count: number, clearAll: () => void) => void;
	onDeleteDrawing?: (id: string) => void;
	onInteractionChange?: (isInteracting: boolean) => void;
	persistDrawings?: boolean;
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
	onDeleteDrawing,
	onInteractionChange,
	persistDrawings = true,
}: ChartDrawingsProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ drawingId: string; point: 'start' | 'end' } | null>(null);
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
    updateDrawingEndpoint,
    removeDrawing,
  } = useChartDrawings(symbol, activeTool, selectedColor, lineWidth, { persist: persistDrawings });
  const isInteracting = isDrawing || dragState !== null;

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

  useEffect(() => {
    if (onInteractionChange) {
      onInteractionChange(isInteracting);
    }
  }, [isInteracting, onInteractionChange]);

  // Use chart click subscription instead of canvas mouse events to keep native crosshair visible
  useEffect(() => {
    if (!chart) return;

    const handleClick = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!param.time || !param.point) return;

      // Convert chart time to milliseconds
      let timeMs: number;
      if (typeof param.time === 'number') {
        timeMs = param.time * 1000;
      } else if (typeof param.time === 'string') {
        timeMs = Date.parse(param.time);
      } else {
        return;
      }

      // Get price from the series at this point
      const price = coordinateToPrice(param.point.y);
      if (price === null) return;

      const x = param.point.x;
      const y = param.point.y;

      if (dragState) {
        return;
      }

      if (activeTool) {
        if (isDrawing) {
          updateDrawing({ time: timeMs, price });
          finishDrawing();
          onToolChange?.(null);
          return;
        }

        startDrawing({ time: timeMs, price });
        return;
      }

      if (!activeTool) {
        // Check if clicking on an existing drawing
        for (let i = drawings.length - 1; i >= 0; i--) {
          const drawing = drawings[i];
          if (isPointNearDrawing(x, y, drawing, priceToCoordinate, timeToCoordinate)) {
            setSelectedDrawingId(drawing.id);
            
            // Check if clicking near an endpoint to start dragging
            const endpointCheck = isPointNearEndpoint(x, y, drawing, priceToCoordinate, timeToCoordinate);
            if (endpointCheck.isNear && endpointCheck.which) {
              setDragState({ drawingId: drawing.id, point: endpointCheck.which });
            }
            return;
          }
        }
        setSelectedDrawingId(null);
        return;
      }
    };

    chart.subscribeClick(handleClick);
    return () => chart.unsubscribeClick(handleClick);
  }, [
    chart,
    activeTool,
    drawings,
    priceToCoordinate,
    timeToCoordinate,
    coordinateToPrice,
    dragState,
    finishDrawing,
    isDrawing,
    onToolChange,
    startDrawing,
    updateDrawing,
  ]);

  // Track mouse movement for drawing updates and dragging
  useEffect(() => {
    if (!chart) return;

    const handleCrosshairMove = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!param.time || !param.point) return;

      let timeMs: number;
      if (typeof param.time === 'number') {
        timeMs = param.time * 1000;
      } else if (typeof param.time === 'string') {
        timeMs = Date.parse(param.time);
      } else {
        return;
      }

      const price = coordinateToPrice(param.point.y);
      if (price === null) return;

      // Handle active drawing (placing a new drawing)
      if (isDrawing) {
        updateDrawing({ time: timeMs, price });
        return;
      }

      // Handle dragging an endpoint
      if (dragState) {
        updateDrawingEndpoint(dragState.drawingId, { time: timeMs, price }, dragState.point);
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove);
  }, [chart, isDrawing, dragState, coordinateToPrice, updateDrawing, updateDrawingEndpoint]);

  // End endpoint drag on mouseup
  useEffect(() => {
    if (!dragState) return;

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragState]);

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

	// Get selected drawing for showing settings button
	const selectedDrawing = selectedDrawingId ? drawings.find((d) => d.id === selectedDrawingId) : null;

	// Calculate position for action buttons (near the end point of the drawing)
	const actionButtonPosition = useMemo(() => {
		if (!selectedDrawing) return null;
		// Get position based on drawing type
		let x: number | null = null;
		let y: number | null = null;
		
		if (selectedDrawing.type === 'horizontal') {
			// For horizontal lines, position at the right edge
			x = chart ? chart.timeScale().getVisibleRange()?.to ? chart.timeScale().timeToCoordinate(chart.timeScale().getVisibleRange()!.to as Time) : null : null;
			y = priceToCoordinate(selectedDrawing.price);
		} else {
			// For trendline and rectangle, use end point.
			const drawing = selectedDrawing as { end: { time: number; price: number } };
			x = timeToCoordinate(drawing.end.time);
			y = priceToCoordinate(drawing.end.price);
		}
		
		if (x === null || y === null) return null;
		return { x: x + 10, y: y - 12 };
	}, [selectedDrawing, timeToCoordinate, priceToCoordinate, chart]);

	// Handle deleting selected drawing
	const handleDeleteSelected = useCallback(() => {
		if (selectedDrawingId) {
			if (onDeleteDrawing) {
				onDeleteDrawing(selectedDrawingId);
			} else {
				removeDrawing(selectedDrawingId);
			}
			setSelectedDrawingId(null);
		}
	}, [selectedDrawingId, onDeleteDrawing, removeDrawing]);

	// Keyboard shortcuts for selected drawing
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't handle if user is typing in an input
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			
			if (e.key === 'Delete' || e.key === 'Backspace') {
				if (selectedDrawingId) {
					e.preventDefault();
					handleDeleteSelected();
				}
			} else if (e.key === 'Escape') {
				if (tempDrawing) {
					e.preventDefault();
					cancelDrawing();
					setDragState(null);
					onToolChange?.(null);
					return;
				}

				if (dragState) {
					e.preventDefault();
					setDragState(null);
					return;
				}

				if (selectedDrawingId) {
					e.preventDefault();
					setSelectedDrawingId(null);
					return;
				}

				if (activeTool) {
					e.preventDefault();
					onToolChange?.(null);
				}
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [activeTool, cancelDrawing, dragState, handleDeleteSelected, onToolChange, selectedDrawingId, tempDrawing]);

	// Handle double-click for drawing selection (when canvas has pointer-events-none)
	useEffect(() => {
		if (activeTool) return; // Only needed when no tool is active

		const handleDoubleClick = (e: MouseEvent) => {
			// Don't handle if clicking on a button or input
			if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			const canvas = overlayRef.current;
			if (!canvas) return;

			const rect = canvas.getBoundingClientRect();

			// Check if click is within the canvas area
			if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;

			// Check if clicking on a drawing (reverse order to get top-most first)
			for (let i = drawings.length - 1; i >= 0; i--) {
				const drawing = drawings[i];
				if (isPointNearDrawing(x, y, drawing, priceToCoordinate, timeToCoordinate)) {
					e.preventDefault();
					setSelectedDrawingId(drawing.id);
					return;
				}
			}
			// Clicked on empty space, deselect
			setSelectedDrawingId(null);
		};

		window.addEventListener('dblclick', handleDoubleClick, true); // Use capture phase
		return () => window.removeEventListener('dblclick', handleDoubleClick, true);
	}, [activeTool, drawings, priceToCoordinate, timeToCoordinate]);

  return (
    <>
      {/* Drawing Overlay Canvas — always pointer-events-none so clicks reach
          the chart's own canvas where chart.subscribeClick is registered. The
          parent chartWrapRef in BacktestChart applies the crosshair cursor. */}
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 z-20"
      />

		{/* Action buttons for selected drawing */}
		{selectedDrawing && actionButtonPosition && (
			<>
				{/* Delete button - shown for all drawing types */}
				<button
					onClick={handleDeleteSelected}
					className="absolute z-30 rounded bg-red-600/80 p-1 text-white hover:bg-red-500"
					style={{ left: actionButtonPosition.x, top: actionButtonPosition.y }}
					title="Delete drawing (Delete key)"
				>
					<Trash2 className="h-4 w-4" />
				</button>
			</>
		)}
    </>
  );
}
