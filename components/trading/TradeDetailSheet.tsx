'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Trade } from '@/lib/types';
import { formatCurrency, formatR } from '@/lib/trading-utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface TradeDetailSheetProps {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveNotes: (tradeId: string, notes: string) => Promise<void> | void;
}

export default function TradeDetailSheet({ trade, open, onOpenChange, onSaveNotes }: TradeDetailSheetProps) {
  const [notes, setNotes] = useState(trade?.notes ?? '');

  const handleSave = async () => {
    if (!trade) return;
    try {
      await onSaveNotes(trade.id, notes);
      toast.success('Notes saved');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save notes');
    }
  };

  const metrics = trade
    ? [
        ['Symbol', trade.symbol],
        ['Direction', trade.direction],
        ['Date', format(new Date(trade.date), 'MMM dd, yyyy HH:mm')],
        ['Avg Entry', formatCurrency(trade.avgEntryPrice)],
        ['Avg Exit', formatCurrency(trade.avgExitPrice)],
        ['Quantity', trade.totalQuantity.toString()],
        ['PnL', formatCurrency(trade.pnl)],
        ['Initial Risk', trade.initialRisk ? formatCurrency(trade.initialRisk) : '-'],
        ['R-Multiple', trade.initialRisk ? formatR(trade.pnl / trade.initialRisk) : '-'],
        ['Commission', formatCurrency(trade.commission ?? 0)],
        ['Fees', formatCurrency(trade.fees ?? 0)],
      ]
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl bg-[#121214] border-white/10 text-white">
        <SheetHeader>
          <SheetTitle>Trade Details</SheetTitle>
        </SheetHeader>

        {!trade ? null : (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              {metrics.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
                  <p className="mt-1 text-sm font-medium">{value}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="trade-notes">Notes</Label>
              <Textarea
                id="trade-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={8}
                className="bg-white/5 border-white/10"
                placeholder="Add notes about setup quality, execution, emotions, and lessons learned..."
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} className="bg-emerald-500 hover:bg-emerald-400 text-black">
                Save Notes
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
