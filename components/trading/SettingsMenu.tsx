'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { Trade } from '@/lib/types';
import { Settings } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface SettingsMenuProps {
  trades: Trade[];
  onClearAllData: () => void;
}

export default function SettingsMenu({ trades, onClearAllData }: SettingsMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const csvPayload = useMemo(() => {
    const header = [
      'id',
      'date',
      'sortKey',
      'symbol',
      'direction',
      'avgEntryPrice',
      'avgExitPrice',
      'totalQuantity',
      'pnl',
      'executionCount',
      'initialRisk',
      'commission',
      'fees',
      'notes',
      'tags',
    ];

    const rows = trades.map((trade) => [
      trade.id,
      new Date(trade.date).toISOString(),
      trade.sortKey,
      trade.symbol,
      trade.direction,
      trade.avgEntryPrice,
      trade.avgExitPrice,
      trade.totalQuantity,
      trade.pnl,
      trade.executionCount,
      trade.initialRisk ?? '',
      trade.commission ?? 0,
      trade.fees ?? 0,
      (trade.notes ?? '').replaceAll('"', '""'),
      (trade.tags ?? []).join('|'),
    ]);

    return [header, ...rows]
      .map((row) => row.map((value) => `"${String(value)}"`).join(','))
      .join('\n');
  }, [trades]);

  const download = (filename: string, content: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-2 rounded-lg transition-colors hover:text-white text-zinc-500" title="Settings" aria-label="Settings">
            <Settings className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52 bg-[#121214] border-white/10 text-white">
          <DropdownMenuItem
            onClick={() =>
              download(
                `nexus-trades-${format(new Date(), 'yyyy-MM-dd')}.json`,
                JSON.stringify(trades, null, 2),
                'application/json',
              )
            }
            className="cursor-pointer"
          >
            Export Trades (JSON)
          </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            download(
              `nexus-trades-${format(new Date(), 'yyyy-MM-dd')}.csv`,
              csvPayload,
              'text/csv;charset=utf-8',
            )
          }
          className="cursor-pointer"
        >
          Export Trades (CSV)
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem onClick={() => setConfirmOpen(true)} className="cursor-pointer text-rose-400">
          Clear All Data
        </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-[#121214] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Clear all data?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400">This deletes all trades and tags. This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} className="bg-white/10 hover:bg-white/20">
              Cancel
            </Button>
            <Button
              onClick={() => {
                onClearAllData();
                setConfirmOpen(false);
              }}
              className="bg-rose-500 hover:bg-rose-400 text-white"
            >
              Clear Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
