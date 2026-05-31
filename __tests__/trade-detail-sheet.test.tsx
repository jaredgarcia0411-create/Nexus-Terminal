// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';

import TradeDetailSheet from '@/components/trading/TradeDetailSheet';
import type { Trade } from '@/lib/types';

const { toastMock, candleState } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
  candleState: {
    candles: [] as Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
    isLoading: false,
    error: null as string | null,
  },
}));

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/hooks/use-candle-data', () => ({
  useCandleData: () => candleState,
}));

vi.mock('@/components/trading/CandlestickChart', () => ({
  default: ({ candles }: { candles: unknown[] }) => (
    <div data-testid="candlestick-chart">candles: {candles.length}</div>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span>5m</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    date: new Date('2026-05-31T00:00:00'),
    sortKey: '2026-05-31',
    symbol: 'AAPL',
    direction: 'LONG',
    avgEntryPrice: 10,
    avgExitPrice: 12,
    totalQuantity: 100,
    grossPnl: 200,
    netPnl: 190,
    entryTime: '09:30:00',
    exitTime: '10:00:00',
    executionCount: 2,
    rawExecutions: [
      { id: 'entry-1', side: 'ENTRY', price: 10, qty: 100, time: '09:30:00', commission: 1, fees: 0.1 },
      { id: 'exit-1', side: 'EXIT', price: 12, qty: 100, time: '10:00:00', commission: 1, fees: 0.1 },
    ],
    pnl: 190,
    executions: 2,
    initialRisk: 100,
    commission: 2,
    fees: 0.2,
    tags: ['Momentum'],
    notes: 'Original notes',
    isOpen: false,
    ...overrides,
  };
}

describe('TradeDetailSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    candleState.candles = [];
    candleState.isLoading = false;
    candleState.error = null;
  });

  it('renders closed trade overview, net P/L, executions, chart empty state, and notes', () => {
    render(
      <TradeDetailSheet
        trade={makeTrade()}
        open
        onOpenChange={vi.fn()}
        onSaveNotes={vi.fn()}
      />,
    );

    expect(screen.getByText('Trade Details')).toBeTruthy();
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getAllByText('$190.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Closed Net P/L')).toBeTruthy();
    expect(screen.getByText('Execution Count')).toBeTruthy();
    expect(screen.getByText('ENTRY')).toBeTruthy();
    expect(screen.getByText('EXIT')).toBeTruthy();
    expect(screen.getByText('No candle data available for this trade window.')).toBeTruthy();
    expect(screen.getByDisplayValue('Original notes')).toBeTruthy();
  });

  it('saves edited notes with the selected trade id', async () => {
    const onSaveNotes = vi.fn().mockResolvedValue(undefined);
    render(
      <TradeDetailSheet
        trade={makeTrade()}
        open
        onOpenChange={vi.fn()}
        onSaveNotes={onSaveNotes}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Original notes'), { target: { value: 'Updated notes' } });
    fireEvent.click(screen.getByText('Save Notes'));

    await waitFor(() => {
      expect(onSaveNotes).toHaveBeenCalledWith('trade-1', 'Updated notes');
    });
    expect(toastMock.success).toHaveBeenCalledWith('Notes saved');
  });

  it('renders close controls for open trades and rejects invalid close values', () => {
    const onCloseTrade = vi.fn();
    render(
      <TradeDetailSheet
        trade={makeTrade({ isOpen: true, exitTime: '', avgExitPrice: 0, netPnl: 0, grossPnl: 0 })}
        open
        onOpenChange={vi.fn()}
        onSaveNotes={vi.fn()}
        onCloseTrade={onCloseTrade}
      />,
    );

    expect(screen.getByText('Close Position')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '-1' } });
    fireEvent.change(screen.getByPlaceholderText('15:59:00'), { target: { value: '15:59:00' } });
    fireEvent.click(screen.getByText('Close Position (Full)'));

    expect(toastMock.error).toHaveBeenCalledWith('Enter a valid exit price');
    expect(onCloseTrade).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByPlaceholderText('15:59:00'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Close Position (Full)'));

    expect(toastMock.error).toHaveBeenCalledWith('Enter a valid exit time');
    expect(onCloseTrade).not.toHaveBeenCalled();
  });

  it('submits a valid close with trimmed exit time', async () => {
    const onCloseTrade = vi.fn().mockResolvedValue(undefined);
    render(
      <TradeDetailSheet
        trade={makeTrade({ isOpen: true, exitTime: '', avgExitPrice: 0, netPnl: 0, grossPnl: 0 })}
        open
        onOpenChange={vi.fn()}
        onSaveNotes={vi.fn()}
        onCloseTrade={onCloseTrade}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByPlaceholderText('15:59:00'), { target: { value: ' 15:59:00 ' } });
    fireEvent.click(screen.getByText('Close Position (Full)'));

    await waitFor(() => {
      expect(onCloseTrade).toHaveBeenCalledWith('trade-1', 12.5, '15:59:00');
    });
    expect(toastMock.success).toHaveBeenCalledWith('Position closed');
  });
});
