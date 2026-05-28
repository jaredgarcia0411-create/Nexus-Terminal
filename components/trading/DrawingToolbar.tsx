'use client';

import React from 'react';
import { Minus, Paintbrush, Square, Trash2, TrendingUp, Type } from 'lucide-react';
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
          size="icon-xs"
          disabled={disabled}
          className={`${
            activeTool
              ? 'bg-card text-foreground hover:bg-muted'
              : 'text-foreground hover:bg-accent hover:text-foreground'
          } disabled:cursor-not-allowed disabled:opacity-40`}
          title={activeLabel}
          aria-label="Drawing tools"
        >
          <Paintbrush className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover text-foreground">
        {tools.map((tool) => (
          <DropdownMenuItem
            key={tool.id}
            onSelect={() => {
              if (disabled) return;
              onToolSelect(activeTool === tool.id ? null : tool.id);
            }}
            className={`cursor-pointer text-xs ${
              activeTool === tool.id
                ? 'bg-accent text-foreground focus:bg-accent focus:text-foreground'
                : 'text-muted-foreground focus:bg-accent focus:text-foreground'
            }`}
          >
            {tool.icon}
            {tool.label}
          </DropdownMenuItem>
        ))}
        {drawingsCount > 0 && onClearAll ? (
          <>
            <DropdownMenuSeparator className="bg-accent" />
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
