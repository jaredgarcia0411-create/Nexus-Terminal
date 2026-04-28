'use client';

import React from 'react';
import { Minus, Square, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DrawingTool } from '@/hooks/use-chart-drawings';

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onToolSelect: (tool: DrawingTool) => void;
  lineWidth: number;
  onLineWidthChange: (width: number) => void;
}

const tools: Array<{ id: DrawingTool; icon: React.ReactNode; label: string }> = [
  { id: 'trendline', icon: <TrendingUp className="h-4 w-4" />, label: 'Trend Line' },
  { id: 'horizontal', icon: <Minus className="h-4 w-4" />, label: 'Horizontal Line' },
  { id: 'rectangle', icon: <Square className="h-4 w-4" />, label: 'Rectangle' },
];

export default function DrawingToolbar({
  activeTool,
  onToolSelect,
  lineWidth,
  onLineWidthChange,
}: DrawingToolbarProps) {
  return (
    <>
      {/* Tool buttons */}
      {tools.map((tool) => (
        <Button
          key={tool.id}
          variant="ghost"
          size="icon-xs"
          onClick={() => onToolSelect(activeTool === tool.id ? null : tool.id)}
          className={`rounded-sm p-1 ${
            activeTool === tool.id
              ? 'bg-zinc-600 text-white'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
          }`}
          title={tool.label}
        >
          {tool.icon}
        </Button>
      ))}

      <div className="h-px w-5 bg-white/10" />

      {/* Line width */}
      {[1, 2, 3].map((w) => (
        <button
          key={w}
          onClick={() => onLineWidthChange(w)}
          className={`flex h-6 w-6 items-center justify-center rounded-sm transition-all ${
            lineWidth === w
              ? 'bg-zinc-600 text-white'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
          }`}
          title={`Line width: ${w}px`}
        >
      <div
        className="rounded-sm bg-current"
        style={{
          width: '16px',
          height: `${w}px`,
        }}
      />
        </button>
      ))}
    </>
  );
}
