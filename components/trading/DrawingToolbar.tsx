'use client';

import React from 'react';
import { Minus, Square, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DrawingTool } from '@/hooks/use-chart-drawings';

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onToolSelect: (tool: DrawingTool) => void;
}

const tools: Array<{ id: DrawingTool; icon: React.ReactNode; label: string }> = [
  { id: 'trendline', icon: <TrendingUp className="h-4 w-4" />, label: 'Trend Line' },
  { id: 'horizontal', icon: <Minus className="h-4 w-4" />, label: 'Horizontal Line' },
  { id: 'rectangle', icon: <Square className="h-4 w-4" />, label: 'Rectangle' },
  { id: 'fibonacci', icon: <span className="text-[10px] font-bold leading-none">Fib</span>, label: 'Fibonacci Retracement' },
];

export default function DrawingToolbar({
  activeTool,
  onToolSelect,
}: DrawingToolbarProps) {
  return (
    <>
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
    </>
  );
}
