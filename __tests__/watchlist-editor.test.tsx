// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';

import type { SampleSetRow } from '@/lib/sample-set-csv';

const { pickerState } = vi.hoisted(() => ({
  pickerState: {
    seedRows: null as SampleSetRow[] | null,
  },
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }: React.ComponentProps<'div'> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/trading/WatchlistSavePicker', () => ({
  default: ({ seedRows }: { seedRows: SampleSetRow[] }) => {
    pickerState.seedRows = seedRows;
    return <div data-testid="watchlist-save-picker">picker open</div>;
  },
}));

vi.mock('@/components/trading/WatchlistReportInline', () => ({
  default: () => <div>report inline</div>,
}));

vi.mock('@/components/trading/WatchlistTickerChart', () => ({
  default: () => <div>ticker chart</div>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import WatchlistEditor, { type WatchlistRow } from '@/components/trading/WatchlistEditor';

const rows: WatchlistRow[] = [
  { id: 'row-1', ticker: 'AAPL', thesis: 'Momentum', grade: 'A', notes: 'Clean setup' },
  { id: 'row-2', ticker: '', thesis: 'Gapper', grade: 'B', notes: 'Needs ticker' },
];

describe('WatchlistEditor sample set save controls', () => {
  beforeEach(() => {
    pickerState.seedRows = null;
  });

  it('hides save and select columns when no daily review date is present', () => {
    render(<WatchlistEditor value={rows} onChange={vi.fn()} />);

    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByLabelText('Select watchlist row')).toBeNull();
    expect(screen.queryByLabelText('Save to sample set')).toBeNull();
  });

  it('opens the picker with a single seeded row from the daily save icon', () => {
    render(<WatchlistEditor value={rows} onChange={vi.fn()} date="2026-05-16" />);

    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getAllByLabelText('Select watchlist row')).toHaveLength(2);

    const saveButtons = screen.getAllByLabelText('Save to sample set');
    expect(saveButtons).toHaveLength(1);
    fireEvent.click(saveButtons[0]);

    expect(screen.getByTestId('watchlist-save-picker')).toBeTruthy();
    expect(pickerState.seedRows).toEqual([{ ticker: 'AAPL', date: '2026-05-16' }]);
  });

  it('bulk save opens the picker with only selected rows that have tickers', () => {
    render(<WatchlistEditor value={rows} onChange={vi.fn()} date="2026-05-16" />);

    const checkboxes = screen.getAllByLabelText('Select watchlist row');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    expect(screen.getByText('2 rows selected')).toBeTruthy();
    fireEvent.click(screen.getByText(/Save selected to sample set/));

    expect(screen.getByTestId('watchlist-save-picker')).toBeTruthy();
    expect(pickerState.seedRows).toEqual([{ ticker: 'AAPL', date: '2026-05-16' }]);
  });

  it('hides the checkbox column in read-only daily review mode', () => {
    render(<WatchlistEditor value={rows} readOnly date="2026-05-16" />);

    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.queryByLabelText('Select watchlist row')).toBeNull();
    expect(screen.getAllByLabelText('Save to sample set')).toHaveLength(1);
  });
});
