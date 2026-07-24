'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { Maximize2, Minimize2 } from 'lucide-react';

import CandlestickChart, { type CandleData } from '@/components/trading/CandlestickChart';
import ChartDrawings from '@/components/trading/ChartDrawings';
import DrawingToolbar from '@/components/trading/DrawingToolbar';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DrawingTool } from '@/hooks/use-chart-drawings';
import { TRADE_CHART_TIMEFRAME_CONFIG, type TradeChartTimeframeKey } from '@/lib/chart-timeframes';
import type { TradeMarker } from '@/lib/types';

interface AnnotatableChartProps {
  candles: CandleData[];
  tradeMarkers: TradeMarker[];
  scopeKey: string;
  timeframe: TradeChartTimeframeKey;
  onTimeframeChange: (timeframe: TradeChartTimeframeKey) => void;
  baseHeight: number;
  exactPriceMarkers?: boolean;
  showTimeAxis?: boolean;
  showSessionShading?: boolean;
  showVwap?: boolean;
}

export default function AnnotatableChart({
  candles,
  tradeMarkers,
  scopeKey,
  timeframe,
  onTimeframeChange,
  baseHeight,
  exactPriceMarkers = true,
  showTimeAxis = true,
  showSessionShading = false,
  showVwap = false,
}: AnnotatableChartProps) {
  const [activeTool, setActiveTool] = useState<DrawingTool>(null);
  const [expanded, setExpanded] = useState(false);
  const [drawingsCount, setDrawingsCount] = useState(0);
  const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
  const [seriesInstance, setSeriesInstance] = useState<ISeriesApi<'Candlestick'> | null>(null);
  const [viewportH, setViewportH] = useState(0);
  const clearAllRef = useRef<(() => void) | null>(null);

  const timeMarkers = useMemo(
    () => candles.map((candle) => candle.datetime).sort((a, b) => a - b),
    [candles],
  );

  useEffect(() => {
    if (!expanded) return;
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [expanded]);

  const height = expanded ? Math.max(320, viewportH - 44) : baseHeight;

  const handleInstances = useCallback((chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null) => {
    setChartInstance(chart);
    setSeriesInstance(series);
  }, []);

  const handleInteraction = useCallback((interacting: boolean) => {
    chartInstance?.applyOptions({ handleScroll: !interacting, handleScale: !interacting });
  }, [chartInstance]);

  return (
    <div className={expanded ? 'fixed inset-0 z-50 flex flex-col bg-[#0A0A0B]' : 'relative flex flex-col border border-white/10 bg-[#121214]'}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/10 bg-[#0A0A0B] px-2 print:hidden">
        <Select value={timeframe} onValueChange={(value) => onTimeframeChange(value as TradeChartTimeframeKey)}>
          <SelectTrigger className="h-7 w-24 border-0 bg-transparent text-xs shadow-none dark:bg-transparent dark:hover:bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-foreground">
            {Object.entries(TRADE_CHART_TIMEFRAME_CONFIG).map(([value, cfg]) => (
              <SelectItem key={value} value={value}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-0.5">
          <DrawingToolbar
            activeTool={activeTool}
            onToolSelect={setActiveTool}
            drawingsCount={drawingsCount}
            onClearAll={() => clearAllRef.current?.()}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-zinc-300 hover:bg-white/10 hover:text-white"
            title={expanded ? 'Collapse' : 'Expand'}
            aria-label={expanded ? 'Collapse chart' : 'Expand chart'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className={`relative w-full ${activeTool ? 'cursor-crosshair' : ''}`} style={{ height }}>
        <CandlestickChart
          candles={candles}
          tradeMarkers={tradeMarkers}
          focusLastSession={timeframe !== '1d'}
          height={height}
          exactPriceMarkers={exactPriceMarkers}
          showTimeAxis={showTimeAxis}
          showSessionShading={showSessionShading}
          showVwap={showVwap}
          onInstances={handleInstances}
        />
        {chartInstance && seriesInstance ? (
          <ChartDrawings
            symbol={scopeKey}
            chart={chartInstance}
            series={seriesInstance}
            timeMarkers={timeMarkers}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            selectedColor="#ffffff"
            lineWidth={1}
            persistDrawings
            onInteractionChange={handleInteraction}
            onDrawingsChange={(count, clearFn) => {
              setDrawingsCount(count);
              clearAllRef.current = clearFn;
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
