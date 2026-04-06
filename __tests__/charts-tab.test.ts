// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useCandleDataMock } = vi.hoisted(() => ({
  useCandleDataMock: vi.fn(),
}));

vi.mock('motion/react', async () => {
  const React = await import('react');

  return {
    motion: {
      div: ({ children, initial: _initial, animate: _animate, exit: _exit, ...props }: React.ComponentProps<'div'> & {
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
      }) => React.createElement('div', props, children),
    },
  };
});

vi.mock('lightweight-charts', () => {
  const createSeries = () => ({
    setData: vi.fn(),
    createPriceLine: vi.fn(),
  });

  return {
    createChart: vi.fn(() => ({
      addSeries: vi.fn(() => createSeries()),
      addPane: vi.fn(() => ({
        addSeries: vi.fn(() => createSeries()),
        applyOptions: vi.fn(),
      })),
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
      applyOptions: vi.fn(),
      remove: vi.fn(),
      takeScreenshot: vi.fn(() => ({ toDataURL: vi.fn(() => 'data:image/png;base64,test') })),
      timeScale: vi.fn(() => ({
        fitContent: vi.fn(),
        getVisibleRange: vi.fn(() => null),
        timeToCoordinate: vi.fn(() => null),
        subscribeVisibleLogicalRangeChange: vi.fn(),
        subscribeVisibleTimeRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleTimeRangeChange: vi.fn(),
      })),
    })),
    AreaSeries: 'AreaSeries',
    BarSeries: 'BarSeries',
    BaselineSeries: 'BaselineSeries',
    CandlestickSeries: 'CandlestickSeries',
    HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries',
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 'normal', Magnet: 'magnet' },
  };
});

vi.mock('@/hooks/use-candle-data', () => ({
  useCandleData: useCandleDataMock,
}));

vi.mock('@/components/trading/ChartDrawings', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'chart-drawings' }),
  };
});

vi.mock('@/components/trading/DrawingToolbar', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'drawing-toolbar' }),
  };
});

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');

  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const content = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);

  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: content,
    DropdownMenuRadioGroup: content,
    DropdownMenuRadioItem: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    DropdownMenuCheckboxItem: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  };
});

import ChartsTab from '@/components/trading/ChartsTab';

const TRADES = [{
  id: 'trade-1',
  date: new Date('2026-03-10T12:00:00.000Z'),
  sortKey: '2026-03-10',
  symbol: 'SPY',
  direction: 'LONG' as const,
  avgEntryPrice: 600,
  avgExitPrice: 605,
  totalQuantity: 10,
  grossPnl: 50,
  netPnl: 48,
  entryTime: '09:35:00',
  exitTime: '10:00:00',
  executionCount: 1,
  rawExecutions: [],
  pnl: 48,
  executions: 1,
  tags: [],
}];

const CANDLES = [
  { datetime: 1700000000000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
  { datetime: 1700000060000, open: 101, high: 103, low: 100, close: 102, volume: 1200 },
];

describe('ChartsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    const candleState = {
      candles: CANDLES,
      isLoading: false,
      error: null,
    };
    const emptyState = {
      candles: [],
      isLoading: false,
      error: null,
    };
    useCandleDataMock.mockImplementation((symbol: string | null) => ({
      ...(symbol ? candleState : emptyState),
    }));

    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the first recent trade symbol as the initial label', () => {
    render(React.createElement(ChartsTab, { trades: TRADES }));

    expect(screen.getByText('SPY')).toBeTruthy();
  });

  it('updates the visible symbol label when typing qqq and pressing Enter', () => {
    render(React.createElement(ChartsTab, { trades: TRADES }));

    const input = screen.getByPlaceholderText('SPY');
    fireEvent.change(input, { target: { value: 'qqq' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('QQQ')).toBeTruthy();
  });

  it('reveals the compare input when the compare toggle is clicked', () => {
    render(React.createElement(ChartsTab, { trades: TRADES }));

    fireEvent.click(screen.getByTitle('Compare Symbol'));

    expect(screen.getByPlaceholderText('Compare')).toBeTruthy();
  });

  it('renders the screenshot button with the expected aria-label', () => {
    render(React.createElement(ChartsTab, { trades: TRADES }));

    expect(screen.getByLabelText('Capture chart screenshot')).toBeTruthy();
  });
});
