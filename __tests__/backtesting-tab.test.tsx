// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SimPosition } from '@/lib/backtest-math';
import type { BacktestAction, BacktestSession } from '@/lib/types';

const { useBacktestSessionMock } = vi.hoisted(() => ({
  useBacktestSessionMock: vi.fn(),
}));

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  },
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('@/hooks/use-candle-data', () => ({
  useCandleData: vi.fn(() => ({ candles: [], isLoading: false, error: null })),
}));

vi.mock('@/hooks/use-backtest-session', () => ({
  useBacktestSession: useBacktestSessionMock,
}));

vi.mock('@/components/trading/BacktestChartGrid', () => ({
  default: ({ ticker, date }: { ticker: string | null; date: string | null }) => (
    <div>{ticker && date ? 'Grid ready' : 'Pick a ticker on the right'}</div>
  ),
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
  }: {
    onSelect: (selection: { ticker: string; date: string }) => void;
    topPanel?: React.ReactNode;
  }) => (
    <div>
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
    useBacktestSessionMock.mockReturnValue(makeSessionState('FLAT'));
    window.localStorage.clear();
  });

  it('renders the empty state and disables trade actions until a ticker is chosen', () => {
    render(<BacktestingTab />);

    expect(screen.getByText('Pick a ticker on the right')).toBeTruthy();
    expect(screen.getByRole('button', { name: /trade/i })).toHaveProperty('disabled', true);
  });

  it('enables long-side actions for an open long position', () => {
    useBacktestSessionMock.mockReturnValue(makeSessionState('LONG'));

    render(<BacktestingTab />);
    fireEvent.click(screen.getByText('Select AAPL'));

    expect((screen.getByRole('button', { name: 'Trade' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'LONG ADD' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'SELL' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'SHORT' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables short-side actions for an open short position', () => {
    useBacktestSessionMock.mockReturnValue(makeSessionState('SHORT'));

    render(<BacktestingTab />);
    fireEvent.click(screen.getByText('Select AAPL'));

    expect((screen.getByRole('button', { name: 'SHORT ADD' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'COVER' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'SELL' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Clear and removes the old New button while viewing a review', () => {
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
        reviewedAt: '2026-04-29T12:00:00.000Z',
        createdAt: '2026-04-28T12:00:00.000Z',
        updatedAt: '2026-04-29T12:00:00.000Z',
      },
      isReadOnly: true,
    }));

    render(<BacktestingTab />);

    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete review' })).toBeTruthy();
  });

  it('confirms before deleting a saved review', () => {
    const deleteReview = vi.fn();
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
        reviewedAt: '2026-04-29T12:00:00.000Z',
        createdAt: '2026-04-28T12:00:00.000Z',
        updatedAt: '2026-04-29T12:00:00.000Z',
      },
      isReadOnly: true,
      deleteReview,
    }));

    render(<BacktestingTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteReview).toHaveBeenCalledWith('review-1');
  });
});
