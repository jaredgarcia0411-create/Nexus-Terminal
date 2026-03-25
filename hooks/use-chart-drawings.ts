'use client';

import { useCallback, useEffect, useState } from 'react';

export type DrawingTool = 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci' | null;

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface BaseDrawing {
  id: string;
  color: string;
  lineWidth: number;
}

export interface TrendLineDrawing extends BaseDrawing {
  type: 'trendline';
  start: DrawingPoint;
  end: DrawingPoint;
}

export interface HorizontalLineDrawing extends BaseDrawing {
  type: 'horizontal';
  price: number;
  time: number;
}

export interface RectangleDrawing extends BaseDrawing {
  type: 'rectangle';
  start: DrawingPoint;
  end: DrawingPoint;
}

export interface FibonacciDrawing extends BaseDrawing {
  type: 'fibonacci';
  start: DrawingPoint;
  end: DrawingPoint;
  levels: number[];
}

export type Drawing = TrendLineDrawing | HorizontalLineDrawing | RectangleDrawing | FibonacciDrawing;

const DEFAULT_COLORS = ['#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#ffffff'];
const DEFAULT_LINE_WIDTH = 2;
const STORAGE_KEY_PREFIX = 'nexus-chart-drawings';
const FIB_LEVELS_STORAGE_KEY = 'nexus-chart-fib-levels';
const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function useChartDrawings(
  symbol: string,
  externalActiveTool?: DrawingTool,
  externalColor?: string,
  externalLineWidth?: number
) {
  // Use external values if provided, otherwise use internal state
  const [internalActiveTool, setInternalActiveTool] = useState<DrawingTool>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tempDrawing, setTempDrawing] = useState<Drawing | null>(null);
  const [internalColor, setInternalColor] = useState(DEFAULT_COLORS[0]);
  const [internalLineWidth, setInternalLineWidth] = useState(DEFAULT_LINE_WIDTH);

  const activeTool = externalActiveTool !== undefined ? externalActiveTool : internalActiveTool;
  const selectedColor = externalColor !== undefined ? externalColor : internalColor;
  const lineWidth = externalLineWidth !== undefined ? externalLineWidth : internalLineWidth;

  const setActiveTool = externalActiveTool !== undefined ? () => {} : setInternalActiveTool;
  const setSelectedColor = externalColor !== undefined ? () => {} : setInternalColor;
  const setLineWidth = externalLineWidth !== undefined ? () => {} : setInternalLineWidth;

	// Load drawings from localStorage on mount using lazy state initialization
	const [drawings, setDrawings] = useState<Drawing[]>(() => {
		if (!symbol) return [];
		try {
			const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}-${symbol}`);
			if (saved) {
				return JSON.parse(saved) as Drawing[];
			}
		} catch {
			// Ignore parse errors
		}
		return [];
	});

	// Load last-used fib levels from localStorage
	const [lastFibLevels, setLastFibLevels] = useState<number[]>(() => {
		try {
			const saved = localStorage.getItem(FIB_LEVELS_STORAGE_KEY);
			if (saved) {
				return JSON.parse(saved) as number[];
			}
		} catch {
			// Ignore parse errors
		}
		return DEFAULT_FIB_LEVELS;
	});

	// Save drawings to localStorage when they change
	useEffect(() => {
		if (!symbol) return;
		try {
			localStorage.setItem(`${STORAGE_KEY_PREFIX}-${symbol}`, JSON.stringify(drawings));
		} catch {
			// Ignore storage errors
		}
	}, [drawings, symbol]);

	// Save last fib levels to localStorage when they change
	useEffect(() => {
		try {
			localStorage.setItem(FIB_LEVELS_STORAGE_KEY, JSON.stringify(lastFibLevels));
		} catch {
			// Ignore storage errors
		}
	}, [lastFibLevels]);

  const startDrawing = useCallback((point: DrawingPoint) => {
    if (!activeTool) return;

    setIsDrawing(true);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (activeTool === 'horizontal') {
      const drawing: HorizontalLineDrawing = {
        id,
        type: 'horizontal',
        price: point.price,
        time: point.time,
        color: selectedColor,
        lineWidth,
      };
      setTempDrawing(drawing);
    } else if (activeTool === 'trendline' || activeTool === 'rectangle' || activeTool === 'fibonacci') {
      const drawing = {
        id,
        type: activeTool,
        start: point,
        end: point,
        color: selectedColor,
        lineWidth,
      } as TrendLineDrawing | RectangleDrawing | FibonacciDrawing;
      setTempDrawing(drawing);
    }
  }, [activeTool, selectedColor, lineWidth]);

  const updateDrawing = useCallback((point: DrawingPoint) => {
    if (!isDrawing || !tempDrawing) return;

    setTempDrawing((prev) => {
      if (!prev) return null;

      if (prev.type === 'horizontal') {
        return { ...prev, price: point.price };
      }

      // For trendline, rectangle, fibonacci
      return { ...prev, end: point } as Drawing;
    });
  }, [isDrawing, tempDrawing]);

	const finishDrawing = useCallback(() => {
		if (!isDrawing || !tempDrawing) return;

		// Only add if the drawing has meaningful dimensions
		if (tempDrawing.type === 'horizontal') {
			setDrawings((prev) => [...prev, tempDrawing as HorizontalLineDrawing]);
		} else if (tempDrawing.type === 'trendline' || tempDrawing.type === 'rectangle') {
			const { start, end } = tempDrawing as TrendLineDrawing | RectangleDrawing;
			if (start.time !== end.time || start.price !== end.price) {
				setDrawings((prev) => [...prev, tempDrawing as Drawing]);
			}
		} else if (tempDrawing.type === 'fibonacci') {
			const { start, end } = tempDrawing as FibonacciDrawing;
			if (start.time !== end.time || start.price !== end.price) {
				// Use last saved fib levels for new drawings
				const fibDrawing: FibonacciDrawing = {
					...(tempDrawing as FibonacciDrawing),
					levels: lastFibLevels,
				};
				setDrawings((prev) => [...prev, fibDrawing]);
			}
		}

		setIsDrawing(false);
		setTempDrawing(null);
	}, [isDrawing, tempDrawing, lastFibLevels]);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setTempDrawing(null);
  }, []);

  const removeDrawing = useCallback((id: string) => {
    setDrawings((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const clearAllDrawings = useCallback(() => {
    setDrawings([]);
    setTempDrawing(null);
    setIsDrawing(false);
  }, []);

	const updateDrawingLevels = useCallback((id: string, levels: number[]) => {
		setDrawings((prev) =>
			prev.map((d) => {
				if (d.id === id && d.type === 'fibonacci') {
					return { ...d, levels } as FibonacciDrawing;
				}
				return d;
			})
		);
		// Save as last-used levels for future drawings
		setLastFibLevels(levels);
	}, []);

	return {
		// State
		activeTool,
		isDrawing,
		tempDrawing,
		drawings,
		selectedColor,
		lineWidth,
		lastFibLevels,

		// Actions
		setActiveTool,
		setSelectedColor,
		setLineWidth,
		startDrawing,
		updateDrawing,
		finishDrawing,
		cancelDrawing,
		removeDrawing,
		clearAllDrawings,
		updateDrawingLevels,

		// Constants
		availableColors: DEFAULT_COLORS,
	};
}
