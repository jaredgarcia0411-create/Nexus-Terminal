'use client';

import React from 'react';
import { ChevronDown, Minus, Square, Trash2, TrendingUp, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DrawingTool } from '@/hooks/use-chart-drawings';

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onToolSelect: (tool: DrawingTool) => void;
  drawingsCount?: number;
  onClearAll?: () => void;
  disabled?: boolean;
}

const tools: Array<{ id: DrawingTool; icon: React.ReactNode; label: string }> = [
  { id: 'trendline', icon: <TrendingUp className="h-4 w-4" />, label: 'Trend Line' },
  { id: 'horizontal', icon: <Minus className="h-4 w-4" />, label: 'Horizontal Line' },
  { id: 'rectangle', icon: <Square className="h-4 w-4" />, label: 'Rectangle' },
  { id: 'fibonacci', icon: <span className="text-[10px] font-bold leading-none">Fib</span>, label: 'Fibonacci Retracement' },
  { id: 'text', icon: <Type className="h-4 w-4" />, label: 'Text' },
];

export default function DrawingToolbar({
  activeTool,
  onToolSelect,
  drawingsCount = 0,
  onClearAll,
  disabled = false,
}: DrawingToolbarProps) {
  const activeLabel = tools.find((tool) => tool.id === activeTool)?.label ?? 'Drawings';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          className={`h-7 px-2 text-[11px] ${
            activeTool
              ? 'bg-zinc-700 text-white hover:bg-zinc-600'
              : 'text-zinc-300 hover:bg-white/10 hover:text-white'
          } disabled:cursor-not-allowed disabled:opacity-40`}
          title="Drawing tools"
          aria-label="Drawing tools"
        >
          <TrendingUp className="h-3.5 w-3.5" />
          <span className="max-w-[72px] truncate">{activeLabel}</span>
          <ChevronDown className="h-3 w-3 text-zinc-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-white/10 bg-[#111319] text-white">
        {tools.map((tool) => (
          <DropdownMenuItem
            key={tool.id}
            onSelect={() => {
              if (disabled) return;
              onToolSelect(activeTool === tool.id ? null : tool.id);
            }}
            className={`cursor-pointer text-xs ${
              activeTool === tool.id
                ? 'bg-white/10 text-white focus:bg-white/10 focus:text-white'
                : 'text-zinc-300 focus:bg-white/10 focus:text-white'
            }`}
          >
            {tool.icon}
            {tool.label}
          </DropdownMenuItem>
        ))}
        {drawingsCount > 0 && onClearAll ? (
          <>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              onSelect={() => {
                if (disabled) return;
                onClearAll();
              }}
              className="cursor-pointer text-xs text-rose-400 focus:bg-rose-500/10 focus:text-rose-300"
            >
              <Trash2 className="h-4 w-4" />
              Clear drawings
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
