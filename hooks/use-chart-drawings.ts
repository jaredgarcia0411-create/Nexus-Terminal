'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

export type DrawingTool = 'trendline' | 'horizontal' | 'rectangle' | null;

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

export type Drawing = TrendLineDrawing | HorizontalLineDrawing | RectangleDrawing;

const DEFAULT_COLORS = ['#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#ffffff'];
const DEFAULT_LINE_WIDTH = 2;
const STORAGE_KEY_PREFIX = 'nexus-chart-drawings';

type DrawingState = {
  drawings: Drawing[];
  tempDrawing: Drawing | null;
  isDrawing: boolean;
};

type DrawingAction =
  | { type: 'syncSymbol'; drawings: Drawing[] }
  | { type: 'startDrawing'; drawing: Drawing }
  | { type: 'updateTempDrawing'; point: DrawingPoint }
  | { type: 'finishDrawing' }
  | { type: 'cancelDrawing' }
  | { type: 'removeDrawing'; id: string }
  | { type: 'clearAllDrawings' }
  | { type: 'updateDrawingEndpoint'; id: string; point: DrawingPoint; which: 'start' | 'end' };

function isDrawingPoint(value: unknown): value is DrawingPoint {
  if (!value || typeof value !== 'object') return false;

  const point = value as Record<string, unknown>;
  return typeof point.time === 'number' && Number.isFinite(point.time)
    && typeof point.price === 'number' && Number.isFinite(point.price);
}

function normalizeDrawings(loaded: unknown): Drawing[] {
  if (!Array.isArray(loaded)) return [];

  const normalized: Drawing[] = [];

  for (const item of loaded) {
    if (!item || typeof item !== 'object') continue;

    const drawing = item as Record<string, unknown>;
    const id = typeof drawing.id === 'string' ? drawing.id : null;
    const color = typeof drawing.color === 'string' ? drawing.color : null;
    const lineWidth = typeof drawing.lineWidth === 'number' && Number.isFinite(drawing.lineWidth)
      ? drawing.lineWidth
      : null;

    if (!id || !color || lineWidth === null) {
      continue;
    }

    switch (drawing.type) {
      case 'horizontal': {
        if (
          typeof drawing.price !== 'number'
          || !Number.isFinite(drawing.price)
          || typeof drawing.time !== 'number'
          || !Number.isFinite(drawing.time)
        ) {
          continue;
        }

        normalized.push({
          id,
          type: 'horizontal',
          price: drawing.price,
          time: drawing.time,
          color,
          lineWidth,
        });
        break;
      }
      case 'trendline': {
        if (!isDrawingPoint(drawing.start) || !isDrawingPoint(drawing.end)) {
          continue;
        }

        normalized.push({
          id,
          type: 'trendline',
          start: drawing.start,
          end: drawing.end,
          color,
          lineWidth,
        });
        break;
      }
      case 'rectangle': {
        if (!isDrawingPoint(drawing.start) || !isDrawingPoint(drawing.end)) {
          continue;
        }

        normalized.push({
          id,
          type: 'rectangle',
          start: drawing.start,
          end: drawing.end,
          color,
          lineWidth,
        });
        break;
      }
      default:
        break;
    }
  }

  return normalized;
}

function loadDrawingsForSymbol(symbol: string): Drawing[] {
  if (!symbol) return [];

  try {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}-${symbol}`);
    if (!saved) return [];

    return normalizeDrawings(JSON.parse(saved));
  } catch {
    return [];
  }
}

function createTempDrawing(
  tool: Exclude<DrawingTool, null>,
  point: DrawingPoint,
  color: string,
  lineWidth: number
): Drawing {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  if (tool === 'horizontal') {
    return {
      id,
      type: 'horizontal',
      price: point.price,
      time: point.time,
      color,
      lineWidth,
    };
  }

  return {
    id,
    type: tool,
    start: point,
    end: point,
    color,
    lineWidth,
  };
}

function hasMeaningfulDrawingSize(drawing: Drawing): boolean {
  if (drawing.type === 'horizontal') {
    return true;
  }

  return drawing.start.time !== drawing.end.time || drawing.start.price !== drawing.end.price;
}

function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  switch (action.type) {
    case 'syncSymbol':
      return {
        drawings: action.drawings,
        tempDrawing: null,
        isDrawing: false,
      };
    case 'startDrawing':
      return {
        ...state,
        tempDrawing: action.drawing,
        isDrawing: true,
      };
    case 'updateTempDrawing':
      if (!state.isDrawing || !state.tempDrawing) return state;

      if (state.tempDrawing.type === 'horizontal') {
        return {
          ...state,
          tempDrawing: {
            ...state.tempDrawing,
            price: action.point.price,
          },
        };
      }

      return {
        ...state,
        tempDrawing: {
          ...state.tempDrawing,
          end: action.point,
        },
      };
    case 'finishDrawing': {
      if (!state.isDrawing || !state.tempDrawing) return state;

      return {
        drawings: hasMeaningfulDrawingSize(state.tempDrawing)
          ? [...state.drawings, state.tempDrawing]
          : state.drawings,
        tempDrawing: null,
        isDrawing: false,
      };
    }
    case 'cancelDrawing':
      if (!state.isDrawing && !state.tempDrawing) return state;

      return {
        ...state,
        tempDrawing: null,
        isDrawing: false,
      };
    case 'removeDrawing':
      return {
        ...state,
        drawings: state.drawings.filter((drawing) => drawing.id !== action.id),
      };
    case 'clearAllDrawings':
      return {
        drawings: [],
        tempDrawing: null,
        isDrawing: false,
      };
    case 'updateDrawingEndpoint':
      return {
        ...state,
        drawings: state.drawings.map((drawing) => {
          if (drawing.id !== action.id) return drawing;
          if (drawing.type === 'horizontal') return drawing;

          return {
            ...drawing,
            [action.which]: action.point,
          };
        }),
      };
    default:
      return state;
  }
}

export function useChartDrawings(
  symbol: string,
  externalActiveTool?: DrawingTool,
  externalColor?: string,
  externalLineWidth?: number
) {
  const [internalActiveTool, setInternalActiveTool] = useState<DrawingTool>(null);
  const [internalColor, setInternalColor] = useState(DEFAULT_COLORS[0]);
  const [internalLineWidth, setInternalLineWidth] = useState(DEFAULT_LINE_WIDTH);

  const activeTool = externalActiveTool !== undefined ? externalActiveTool : internalActiveTool;
  const selectedColor = externalColor !== undefined ? externalColor : internalColor;
  const lineWidth = externalLineWidth !== undefined ? externalLineWidth : internalLineWidth;

  const setActiveTool = externalActiveTool !== undefined ? () => {} : setInternalActiveTool;
  const setSelectedColor = externalColor !== undefined ? () => {} : setInternalColor;
  const setLineWidth = externalLineWidth !== undefined ? () => {} : setInternalLineWidth;

  const previousExternalToolRef = useRef<DrawingTool | undefined>(externalActiveTool);
  const skipNextStorageSaveRef = useRef(true);
  const [drawingState, dispatch] = useReducer(drawingReducer, undefined, () => ({
    drawings: loadDrawingsForSymbol(symbol),
    tempDrawing: null,
    isDrawing: false,
  }));

  const { drawings, tempDrawing, isDrawing } = drawingState;

  useEffect(() => {
    skipNextStorageSaveRef.current = true;
    dispatch({
      type: 'syncSymbol',
      drawings: loadDrawingsForSymbol(symbol),
    });
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    if (skipNextStorageSaveRef.current) {
      skipNextStorageSaveRef.current = false;
      return;
    }

    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}-${symbol}`, JSON.stringify(drawings));
    } catch {
      // Ignore storage errors
    }
  }, [drawings, symbol]);

  useEffect(() => {
    if (externalActiveTool === undefined) return;

    const previousExternalTool = previousExternalToolRef.current;
    previousExternalToolRef.current = externalActiveTool;

    if (previousExternalTool === externalActiveTool) return;
    if (!isDrawing && !tempDrawing) return;

    dispatch({ type: 'cancelDrawing' });
  }, [externalActiveTool, isDrawing, tempDrawing]);

  const startDrawing = useCallback((point: DrawingPoint) => {
    if (!activeTool) return;

    dispatch({
      type: 'startDrawing',
      drawing: createTempDrawing(activeTool, point, selectedColor, lineWidth),
    });
  }, [activeTool, selectedColor, lineWidth]);

  const updateDrawing = useCallback((point: DrawingPoint) => {
    dispatch({ type: 'updateTempDrawing', point });
  }, []);

  const finishDrawing = useCallback(() => {
    dispatch({ type: 'finishDrawing' });
  }, []);

  const cancelDrawing = useCallback(() => {
    dispatch({ type: 'cancelDrawing' });
  }, []);

  const removeDrawing = useCallback((id: string) => {
    dispatch({ type: 'removeDrawing', id });
  }, []);

  const clearAllDrawings = useCallback(() => {
    dispatch({ type: 'clearAllDrawings' });
  }, []);

  const updateDrawingEndpoint = useCallback((id: string, point: DrawingPoint, which: 'start' | 'end') => {
    dispatch({ type: 'updateDrawingEndpoint', id, point, which });
  }, []);

  return {
    activeTool,
    isDrawing,
    tempDrawing,
    drawings,
    selectedColor,
    lineWidth,
    setActiveTool,
    setSelectedColor,
    setLineWidth,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    removeDrawing,
    clearAllDrawings,
    updateDrawingEndpoint,
    availableColors: DEFAULT_COLORS,
  };
}
