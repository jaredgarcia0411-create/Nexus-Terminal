// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SimPosition } from '@/lib/backtest-math';
import type { BacktestAction, BacktestSession } from '@/lib/types';

const { chartGridProps, useBacktestSessionMock, useSessionMock } = vi.hoisted(() => ({
  chartGridProps: [] as Array<{ ticker: string | null; date: string | null; extraSessionsForward: number }>,
  useBacktestSessionMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  },
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: useSessionMock,
}));

vi.mock('@/hooks/use-candle-data', () => ({
  useCandleData: vi.fn(() => ({ candles: [], isLoading: false, error: null })),
}));

vi.mock('@/hooks/use-backtest-session', () => ({
  useBacktestSession: useBacktestSessionMock,
}));

vi.mock('@/components/trading/BacktestManagerView', () => ({
  __esModule: true,
  default: ({
    onLaunchChart,
    onViewStats,
  }: {
    onLaunchChart: (backtest: { id: string; name: string; ownerId: string } | null) => void;
    onViewStats: (backtestId: string) => void;
  }) => (
    <div>
      <div>Manager View</div>
      <button type="button" onClick={() => onLaunchChart({ id: 'bt-1', name: 'Momentum', ownerId: 'u1' })}>
        Open Managed Chart
      </button>
      <button type="button" onClick={() => onViewStats('bt-1')}>
        Open Stats
      </button>
    </div>
  ),
}));

vi.mock('@/components/trading/BacktestStatsView', () => ({
  __esModule: true,
  default: ({
    onBack,
    onOpenInChart,
  }: {
    onBack: () => void;
    onOpenInChart: (ticker: string, date: string, activeBacktest: { id: string | null; name: string | null; userId: string | null }) => void;
  }) => (
    <div>
      <div>Stats View</div>
      <button type="button" onClick={() => onOpenInChart('AAPL', '2026-04-28', { id: 'bt-1', name: 'Momentum', userId: 'u1' })}>
        Open Review In Chart
      </button>
      <button type="button" onClick={onBack}>
        Back
      </button>
    </div>
  ),
}));

vi.mock('@/components/trading/BacktestChartGrid', () => ({
  default: ({
    ticker,
    date,
    extraSessionsForward,
  }: {
    ticker: string | null;
    date: string | null;
    extraSessionsForward: number;
  }) => {
    chartGridProps.push({ ticker, date, extraSessionsForward });
    return <div>{ticker && date ? 'Grid ready' : 'Pick a ticker on the right'}</div>;
  },
}));

vi.mock('@/components/trading/BacktestTradeMenu', () => ({
  default: ({
    disabled,
    direction,
  }: {
    disabled: boolean;
    direction: 'FLAT' | 'LONG' | 'SHORT';
  }) => (
    <div>
      <button type="button" disabled={disabled}>Trade</button>
      <button type="button" disabled={direction !== 'FLAT'}>LONG</button>
      <button type="button" disabled={direction !== 'LONG'}>LONG ADD</button>
      <button type="button" disabled={direction !== 'LONG'}>SELL</button>
      <button type="button" disabled={direction !== 'FLAT'}>SHORT</button>
      <button type="button" disabled={direction !== 'SHORT'}>SHORT ADD</button>
      <button type="button" disabled={direction !== 'SHORT'}>COVER</button>
    </div>
  ),
}));

vi.mock('@/components/trading/BacktestingSidebar', () => ({
  __esModule: true,
  default: ({
    onSelect,
    topPanel,
    activeBacktestId,
  }: {
    onSelect: (selection: { ticker: string; date: string }) => void;
    topPanel?: React.ReactNode;
    activeBacktestId: string | null;
  }) => (
    <div>
      <div>Sidebar Active: {activeBacktestId ?? 'none'}</div>
      <button type="button" onClick={() => onSelect({ ticker: 'AAPL', date: '2026-04-28' })}>
        Select AAPL
      </button>
      {topPanel}
    </div>
  ),
}));

import BacktestingTab from '@/components/trading/BacktestingTab';

type MockSessionState = {
  session: BacktestSession | null;
  actions: BacktestAction[];
  position: SimPosition;
  reviews: BacktestSession[];
  isLoading: boolean;
  isMutating: boolean;
  isReadOnly: boolean;
  error: string | null;
  effectiveRiskDollars: number;
  placeAction: ReturnType<typeof vi.fn>;
  undoLast: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  updateRisk: ReturnType<typeof vi.fn>;
  saveReview: ReturnType<typeof vi.fn>;
  loadReview: ReturnType<typeof vi.fn>;
  deleteReview: ReturnType<typeof vi.fn>;
  startNewSession: ReturnType<typeof vi.fn>;
};

function makeSessionState(
  direction: 'FLAT' | 'LONG' | 'SHORT',
  overrides: Partial<MockSessionState> = {},
) {
  return { ...makeBaseSessionState(direction), ...overrides };
}

function makeBaseSessionState(direction: 'FLAT' | 'LONG' | 'SHORT'): MockSessionState {
  return {
    session: null,
    actions: [],
    position: {
      direction,
      totalShares: direction === 'FLAT' ? 0 : 100,
      avgEntry: direction === 'FLAT' ? null : 10,
      stop: direction === 'LONG' ? 9 : direction === 'SHORT' ? 11 : null,
      realizedPnl: 0,
      lastExitPrice: null,
      initialRiskDollars: 100,
      closedShares: 0,
      totalSharesEverOpened: direction === 'FLAT' ? 0 : 100,
    },
    reviews: [],
    isLoading: false,
    isMutating: false,
    isReadOnly: false,
    error: null,
    effectiveRiskDollars: 100,
    placeAction: vi.fn(),
    undoLast: vi.fn(),
    clear: vi.fn(),
    updateRisk: vi.fn(),
    saveReview: vi.fn(),
    loadReview: vi.fn(),
    deleteReview: vi.fn(),
    startNewSession: vi.fn(),
  };
}

describe('BacktestingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chartGridProps.length = 0;
    useSessionMock.mockReturnValue({ data: { user: { id: 'u1' } } });
    useBacktestSessionMock.mockReturnValue(makeSessionState('FLAT'));
    window.localStorage.clear();
  });

  it('starts on the manager view and enters chart mode when a backtest is launched', () => {
    render(<BacktestingTab />);

    expect(screen.getByText('Manager View')).toBeTruthy();

    fireEvent.click(screen.getByText('Open Managed Chart'));

    expect(screen.getByText('Sidebar Active: bt-1')).toBeTruthy();
    expect(useBacktestSessionMock).toHaveBeenLastCalledWith(expect.objectContaining({ backtestId: 'bt-1' }));
  });

  it('enables long-side actions for an open long position after selecting a ticker', () => {
    useBacktestSessionMock.mockReturnValue(makeSessionState('LONG'));

    render(<BacktestingTab />);
    fireEvent.click(screen.getByText('Open Managed Chart'));
    fireEvent.click(screen.getByText('Select AAPL'));

    expect((screen.getByRole('button', { name: 'Trade' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'LONG ADD' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'SELL' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'SHORT' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables short-side actions for an open short position after selecting a ticker', () => {
    useBacktestSessionMock.mockReturnValue(makeSessionState('SHORT'));

    render(<BacktestingTab />);
    fireEvent.click(screen.getByText('Open Managed Chart'));
    fireEvent.click(screen.getByText('Select AAPL'));

    expect((screen.getByRole('button', { name: 'SHORT ADD' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'COVER' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'SELL' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('passes the global forward-day count to the chart grid', () => {
    render(<BacktestingTab />);
    fireEvent.click(screen.getByText('Open Managed Chart'));
    fireEvent.click(screen.getByText('Select AAPL'));

    fireEvent.click(screen.getByRole('button', { name: 'Add one forward day' }));

    expect(chartGridProps.at(-1)?.extraSessionsForward).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove one forward day' }));
    expect(chartGridProps.at(-1)?.extraSessionsForward).toBe(0);
  });

  it('keeps review mode controls in chart view after entering from the manager', () => {
    useBacktestSessionMock.mockReturnValue(makeSessionState('FLAT', {
      session: {
        id: 'review-1',
        userId: 'u1',
        ticker: 'AAPL',
        date: '2026-04-28',
        status: 'REVIEWED',
        riskDollars: 100,
        label: null,
        notes: null,
        backtestId: 'bt-1',
        reviewedAt: '2026-04-29T12:00:00.000Z',
        createdAt: '2026-04-28T12:00:00.000Z',
        updatedAt: '2026-04-29T12:00:00.000Z',
      },
      isReadOnly: true,
    }));

    render(<BacktestingTab />);
    fireEvent.click(screen.getByText('Open Managed Chart'));

    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete review' })).toBeTruthy();
  });
});
