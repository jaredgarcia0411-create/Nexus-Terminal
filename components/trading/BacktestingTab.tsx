'use client';

import { useCallback, useState } from 'react';
import { Eraser, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';

import BacktestChartGrid from '@/components/trading/BacktestChartGrid';
import BacktestingSidebar, { type BacktestSelection } from '@/components/trading/BacktestingSidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function getInitialRiskDollars() {
  if (typeof window === 'undefined') return 100;

  try {
    const stored = Number(localStorage.getItem('nexus-default-risk'));
    return Number.isFinite(stored) && stored > 0 ? stored : 100;
  } catch {
    return 100;
  }
}

export default function BacktestingTab() {
  const [selected, setSelected] = useState<BacktestSelection | null>(null);
  const [riskDollars] = useState(getInitialRiskDollars);

  const handleAnchorChange = useCallback((newDate: string) => {
    setSelected((current) => (current ? { ...current, date: newDate } : current));
  }, []);

  return (
    <motion.div
      key="backtesting"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-[calc(100dvh-6.5rem)] min-h-[620px] overflow-hidden bg-[#0A0A0B]"
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex min-w-0 flex-col gap-2 overflow-hidden pr-2">
          <div className="flex h-10 shrink-0 items-center gap-2 border border-white/10 bg-[#121214] px-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-white">{selected?.ticker ?? 'No ticker'}</span>
                {selected ? <span className="font-mono text-xs tabular-nums text-zinc-500">{selected.date}</span> : null}
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="font-mono text-xs tabular-nums text-zinc-400">R$ {riskDollars.toFixed(0)}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!selected}
                    className="h-8 border border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    Trade
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-white/10 bg-[#111319] text-white">
                  <DropdownMenuItem disabled className="text-xs text-zinc-500">LONG</DropdownMenuItem>
                  <DropdownMenuItem disabled className="text-xs text-zinc-500">SHORT</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled
                className="h-8 border border-white/10 bg-white/5 text-xs text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <Eraser className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>

          <BacktestChartGrid
            ticker={selected?.ticker ?? null}
            date={selected?.date ?? null}
            onAnchorChange={handleAnchorChange}
          />
        </main>

        <BacktestingSidebar selected={selected} onSelect={setSelected} />
      </div>
    </motion.div>
  );
}
