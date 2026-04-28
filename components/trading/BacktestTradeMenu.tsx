'use client';

import { TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SimDirection } from '@/lib/backtest-math';
import type { BacktestActionType } from '@/lib/types';

const ACTION_LABELS: Record<BacktestActionType, string> = {
  LONG: 'LONG',
  LONG_ADD: 'LONG ADD',
  SELL: 'SELL',
  SHORT: 'SHORT',
  SHORT_ADD: 'SHORT ADD',
  COVER: 'COVER',
};

const ACTION_ORDER: BacktestActionType[] = ['LONG', 'LONG_ADD', 'SELL', 'SHORT', 'SHORT_ADD', 'COVER'];

function isEnabled(direction: SimDirection, actionType: BacktestActionType) {
  if (direction === 'FLAT') return actionType === 'LONG' || actionType === 'SHORT';
  if (direction === 'LONG') return actionType === 'LONG_ADD' || actionType === 'SELL';
  return actionType === 'SHORT_ADD' || actionType === 'COVER';
}

interface BacktestTradeMenuProps {
  disabled: boolean;
  direction: SimDirection;
  armedAction: BacktestActionType | null;
  onArm: (actionType: BacktestActionType) => void;
}

export default function BacktestTradeMenu({
  disabled,
  direction,
  armedAction,
  onArm,
}: BacktestTradeMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 border border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <TrendingUp className="h-3.5 w-3.5" />
          {armedAction ? ACTION_LABELS[armedAction] : 'Trade'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-white/10 bg-[#111319] text-white">
        {ACTION_ORDER.map((actionType) => {
          const enabled = isEnabled(direction, actionType);
          return (
            <DropdownMenuItem
              key={actionType}
              disabled={!enabled}
              onSelect={() => enabled && onArm(actionType)}
              className="cursor-pointer text-xs"
            >
              <span className={armedAction === actionType ? 'text-emerald-400' : undefined}>
                {ACTION_LABELS[actionType]}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
