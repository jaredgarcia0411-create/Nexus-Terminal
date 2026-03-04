'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format, parseISO } from 'date-fns';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { calculatePnL } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const tradeFormSchema = z.object({
  symbol: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  direction: z.enum(['LONG', 'SHORT']),
  entryPrice: z.coerce.number().positive(),
  exitPrice: z.coerce.number().positive(),
  quantity: z.coerce.number().int().positive(),
  date: z.string().min(1),
  initialRisk: z.string().optional(),
});

type TradeFormInput = z.input<typeof tradeFormSchema>;
type TradeFormValues = z.output<typeof tradeFormSchema>;

interface NewTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTrade: (trade: Trade) => Promise<void> | void;
}

export default function NewTradeDialog({ open, onOpenChange, onCreateTrade }: NewTradeDialogProps) {
  const form = useForm<TradeFormInput>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: {
      symbol: '',
      direction: 'LONG',
      entryPrice: undefined,
      exitPrice: undefined,
      quantity: undefined,
      date: format(new Date(), 'yyyy-MM-dd'),
      initialRisk: '',
    },
  });

  const handleSubmit = form.handleSubmit(async (rawValues) => {
    try {
      const values: TradeFormValues = tradeFormSchema.parse(rawValues);
      const date = parseISO(values.date);
      const sortKey = format(date, 'yyyy-MM-dd');
      const id = `${sortKey}|${values.symbol}|${values.direction}|manual-${values.entryPrice}-${values.exitPrice}-${values.quantity}`;
      const initialRisk = values.initialRisk?.trim() ? Number(values.initialRisk) : undefined;
      if (initialRisk !== undefined && (!Number.isFinite(initialRisk) || initialRisk <= 0)) {
        throw new Error('Invalid initial risk');
      }
      const netPnl = calculatePnL(values.direction, values.entryPrice, values.exitPrice, values.quantity);

      const trade: Trade = {
        id,
        date,
        sortKey,
        symbol: values.symbol,
        direction: values.direction,
        avgEntryPrice: values.entryPrice,
        avgExitPrice: values.exitPrice,
        totalQuantity: values.quantity,
        grossPnl: netPnl,
        netPnl,
        entryTime: '',
        exitTime: '',
        executionCount: 1,
        rawExecutions: [],
        pnl: netPnl,
        executions: 1,
        initialRisk,
        commission: 0,
        fees: 0,
        tags: [],
      };

      await onCreateTrade(trade);
      form.reset({
        symbol: '',
        direction: 'LONG',
        entryPrice: undefined,
        exitPrice: undefined,
        quantity: undefined,
        date: format(new Date(), 'yyyy-MM-dd'),
        initialRisk: '',
      });
      onOpenChange(false);
      toast.success('Trade added');
    } catch (error) {
      console.error(error);
      toast.error('Failed to add trade');
    }
  });
  const direction = useWatch({ control: form.control, name: 'direction' }) ?? 'LONG';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-[#121214] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle>New Manual Trade</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input id="symbol" {...form.register('symbol')} className="bg-white/5 border-white/10" />
            </div>

            <div className="space-y-2">
              <Label>Direction</Label>
              <Select
                value={direction}
                onValueChange={(value: 'LONG' | 'SHORT') => form.setValue('direction', value, { shouldValidate: true })}
              >
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent className="bg-[#18181b] border-white/10 text-white">
                  <SelectItem value="LONG">LONG</SelectItem>
                  <SelectItem value="SHORT">SHORT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="entryPrice">Entry Price</Label>
              <Input id="entryPrice" type="number" step="0.01" {...form.register('entryPrice')} className="bg-white/5 border-white/10" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exitPrice">Exit Price</Label>
              <Input id="exitPrice" type="number" step="0.01" {...form.register('exitPrice')} className="bg-white/5 border-white/10" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" type="number" step="1" {...form.register('quantity')} className="bg-white/5 border-white/10" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" {...form.register('date')} className="bg-white/5 border-white/10" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="initialRisk">Initial Risk (optional)</Label>
              <Input id="initialRisk" type="number" step="0.01" {...form.register('initialRisk')} className="bg-white/5 border-white/10" />
            </div>
          </div>

          {Object.keys(form.formState.errors).length > 0 && (
            <p className="text-sm text-rose-400">Please provide valid values for all required fields.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} className="bg-white/10 hover:bg-white/20">
              Cancel
            </Button>
            <Button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-black">
              Save Trade
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
