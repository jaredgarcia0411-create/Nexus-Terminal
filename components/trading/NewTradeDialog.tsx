'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format, parseISO } from 'date-fns';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { calculatePnL } from '@/lib/ui-trade-utils';
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
  exitPrice: z.coerce.number().optional(),
  quantity: z.coerce.number().int().positive(),
  date: z.string().min(1),
  entryTime: z.string().optional(),
  exitTime: z.string().optional(),
  initialRisk: z.string().optional(),
  isOpenPosition: z.boolean().optional().default(false),
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
      entryTime: '',
      exitTime: '',
      initialRisk: '',
      isOpenPosition: false,
    },
  });

  const handleSubmit = form.handleSubmit(async (rawValues) => {
    try {
      const values: TradeFormValues = tradeFormSchema.parse(rawValues);
      const date = parseISO(values.date);
      const sortKey = format(date, 'yyyy-MM-dd');
      const timeOfDay = values.entryTime?.trim()
        ? values.entryTime.trim().replace(/:/g, '')
        : format(new Date(), 'HHmmss');
      const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      const id = `${sortKey}|${values.symbol}|${values.direction}|${timeOfDay}-${suffix}`;
      const initialRisk = values.initialRisk?.trim() ? Number(values.initialRisk) : undefined;
      if (initialRisk !== undefined && (!Number.isFinite(initialRisk) || initialRisk <= 0)) {
        throw new Error('Invalid initial risk');
      }

      let trade: Trade;
      if (values.isOpenPosition) {
        trade = {
          id,
          date,
          sortKey,
          symbol: values.symbol,
          direction: values.direction,
          avgEntryPrice: values.entryPrice,
          avgExitPrice: 0,
          totalQuantity: values.quantity,
          grossPnl: 0,
          netPnl: 0,
          entryTime: values.entryTime?.trim() ?? '',
          exitTime: '',
          executionCount: 1,
          rawExecutions: [],
          pnl: 0,
          executions: 1,
          initialRisk,
          commission: 0,
          fees: 0,
          tags: [],
          isOpen: true,
          remainingQty: values.quantity,
        };
      } else {
        const exitPrice = values.exitPrice;
        if (!exitPrice || exitPrice <= 0) {
          throw new Error('Exit price is required for closed trades');
        }
        const netPnl = calculatePnL(values.direction, values.entryPrice, exitPrice, values.quantity);
        trade = {
          id,
          date,
          sortKey,
          symbol: values.symbol,
          direction: values.direction,
          avgEntryPrice: values.entryPrice,
          avgExitPrice: exitPrice,
          totalQuantity: values.quantity,
          grossPnl: netPnl,
          netPnl,
          entryTime: values.entryTime?.trim() ?? '',
          exitTime: values.exitTime?.trim() ?? '',
          executionCount: 1,
          rawExecutions: [],
          pnl: netPnl,
          executions: 1,
          initialRisk,
          commission: 0,
          fees: 0,
          tags: [],
          isOpen: false,
          remainingQty: 0,
        };
      }

      await onCreateTrade(trade);
      form.reset({
        symbol: '',
        direction: 'LONG',
        entryPrice: undefined,
        exitPrice: undefined,
        quantity: undefined,
        date: format(new Date(), 'yyyy-MM-dd'),
        entryTime: '',
        exitTime: '',
        initialRisk: '',
        isOpenPosition: false,
      });
      onOpenChange(false);
      toast.success(values.isOpenPosition ? 'Open position recorded' : 'Trade added');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to add trade');
    }
  });
  const direction = useWatch({ control: form.control, name: 'direction' }) ?? 'LONG';
  const isOpenPosition = useWatch({ control: form.control, name: 'isOpenPosition' }) ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle>New Manual Trade</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input id="symbol" {...form.register('symbol')} className="bg-accent border-border" />
            </div>

            <div className="space-y-2">
              <Label>Direction</Label>
              <Select
                value={direction}
                onValueChange={(value: 'LONG' | 'SHORT') => form.setValue('direction', value, { shouldValidate: true })}
              >
                <SelectTrigger className="bg-accent border-border">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value="LONG">LONG</SelectItem>
                  <SelectItem value="SHORT">SHORT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="entryPrice">Entry Price</Label>
              <Input id="entryPrice" type="number" step="0.01" {...form.register('entryPrice')} className="bg-accent border-border" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" type="number" step="1" {...form.register('quantity')} className="bg-accent border-border" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" {...form.register('date')} className="bg-accent border-border" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="initialRisk">Initial Risk (optional)</Label>
              <Input id="initialRisk" type="number" step="0.01" {...form.register('initialRisk')} className="bg-accent border-border" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="entryTime">Entry Time (optional)</Label>
              <Input id="entryTime" type="text" placeholder="09:30:00" {...form.register('entryTime')} className="bg-accent border-border" />
            </div>

            {!isOpenPosition ? (
              <div className="space-y-2">
                <Label htmlFor="exitTime">Exit Time (optional)</Label>
                <Input id="exitTime" type="text" placeholder="10:15:00" {...form.register('exitTime')} className="bg-accent border-border" />
              </div>
            ) : null}

            <div className="flex items-center gap-2 md:col-span-2 pt-1">
              <input
                id="isOpenPosition"
                type="checkbox"
                checked={isOpenPosition}
                onChange={(event) => form.setValue('isOpenPosition', event.target.checked, { shouldValidate: true })}
                className="h-4 w-4 rounded border-border bg-accent text-primary focus:ring-ring"
              />
              <Label htmlFor="isOpenPosition" className="cursor-pointer text-sm text-muted-foreground">
                Open position (no exit yet)
              </Label>
            </div>

            {!isOpenPosition ? (
              <div className="space-y-2">
                <Label htmlFor="exitPrice">Exit Price</Label>
                <Input id="exitPrice" type="number" step="0.01" {...form.register('exitPrice')} className="bg-accent border-border" />
              </div>
            ) : null}
          </div>

          {Object.keys(form.formState.errors).length > 0 && (
            <p className="text-sm text-rose-400">Please provide valid values for all required fields.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} className="bg-accent hover:bg-accent/80">
              Cancel
            </Button>
            <Button type="submit" className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20">
              Save Trade
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
