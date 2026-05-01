// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hookSeed } = vi.hoisted(() => ({
  hookSeed: {
    backtests: [
      {
        id: 'bt-1',
        name: 'Bravo',
        description: null,
        sampleSetId: 'ss-1',
        sampleSetName: 'Set 1',
        sampleSetExists: true,
        ownerId: 'me',
        ownerName: 'Me',
        reviewCount: 2,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
      {
        id: 'bt-2',
        name: 'Alpha',
        description: null,
        sampleSetId: null,
        sampleSetName: null,
        sampleSetExists: false,
        ownerId: 'other',
        ownerName: 'Other',
        reviewCount: 1,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    sampleSets: [],
    isLoading: false,
    error: null as string | null,
    currentUserId: 'me',
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await import('react');

  type SelectContextValue = {
    value: string;
    onValueChange: (value: string) => void;
    items: Array<{ value: string; label: React.ReactNode }>;
    registerItem: (value: string, label: React.ReactNode) => void;
  };

  const SelectContext = ReactModule.createContext<SelectContextValue | null>(null);

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => {
      const [items, setItems] = ReactModule.useState<Array<{ value: string; label: React.ReactNode }>>([]);

      const registerItem = (nextValue: string, label: React.ReactNode) => {
        setItems((current) => (
          current.some((item) => item.value === nextValue)
            ? current
            : [...current, { value: nextValue, label }]
        ));
      };

      return (
        <SelectContext.Provider value={{ value, onValueChange, items, registerItem }}>
          {children}
        </SelectContext.Provider>
      );
    },
    SelectTrigger: ({
      children: _children,
      ...props
    }: React.ComponentProps<'select'>) => {
      const context = ReactModule.useContext(SelectContext);
      if (!context) return null;

      return (
        <select
          {...props}
          value={context.value}
          onChange={(event) => context.onValueChange(event.target.value)}
        >
          {context.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      );
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const context = ReactModule.useContext(SelectContext);

      ReactModule.useEffect(() => {
        context?.registerItem(value, children);
      }, [children, context, value]);

      return null;
    },
  };
});

vi.mock('@/hooks/use-backtest-manager', async () => {
  const ReactModule = await import('react');

  return {
    useBacktestManager: () => {
      const [sortKey, setSortKey] = ReactModule.useState<'updatedAt' | 'createdAt' | 'name' | 'author'>('updatedAt');
      const [backtestSearch, setBacktestSearch] = ReactModule.useState('');
      const [sampleSetSearch, setSampleSetSearch] = ReactModule.useState('');

      const filteredBacktests = [...hookSeed.backtests]
        .filter((item) => {
          const query = backtestSearch.trim().toLowerCase();
          if (!query) return true;
          return item.name.toLowerCase().includes(query);
        })
        .sort((a, b) => {
          if (sortKey === 'name') return a.name.localeCompare(b.name);
          if (sortKey === 'author') return (a.ownerName ?? '').localeCompare(b.ownerName ?? '');
          if (sortKey === 'createdAt') return Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '');
          return Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '');
        });

      return {
        backtests: hookSeed.backtests,
        sampleSets: hookSeed.sampleSets,
        isLoading: hookSeed.isLoading,
        error: hookSeed.error,
        refetch: vi.fn(),
        backtestSearch,
        setBacktestSearch,
        sampleSetSearch,
        setSampleSetSearch,
        sortKey,
        setSortKey,
        filteredBacktests,
        filteredSampleSets: [],
        currentUserId: hookSeed.currentUserId,
        createBacktest: vi.fn(),
        updateBacktest: vi.fn(),
        deleteBacktest: vi.fn(),
        createSampleSet: vi.fn(),
        deleteSampleSet: vi.fn(),
        duplicateSampleSet: vi.fn(),
      };
    },
  };
});

vi.mock('@/components/trading/NewBacktestDialog', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div>New Backtest Dialog</div> : null),
}));

vi.mock('@/components/trading/AddSampleSetDialog', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div>Add Sample Dialog</div> : null),
}));

vi.mock('@/components/trading/EditBacktestDialog', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div>Edit Backtest Dialog</div> : null),
}));

import BacktestManagerView from '@/components/trading/BacktestManagerView';

describe('BacktestManagerView', () => {
  beforeEach(() => {
    hookSeed.backtests = [
      {
        id: 'bt-1',
        name: 'Bravo',
        description: null,
        sampleSetId: 'ss-1',
        sampleSetName: 'Set 1',
        sampleSetExists: true,
        ownerId: 'me',
        ownerName: 'Me',
        reviewCount: 2,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
      {
        id: 'bt-2',
        name: 'Alpha',
        description: null,
        sampleSetId: null,
        sampleSetName: null,
        sampleSetExists: false,
        ownerId: 'other',
        ownerName: 'Other',
        reviewCount: 1,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ];
    hookSeed.isLoading = false;
    hookSeed.error = null;
  });

  it('renders backtest cards with names and authors', () => {
    render(<BacktestManagerView onLaunchChart={vi.fn()} onViewStats={vi.fn()} />);

    expect(screen.getByText('Bravo')).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('by Me')).toBeTruthy();
    expect(screen.getByText('by Other')).toBeTruthy();
  });

  it('renders section headings for the saved lists', () => {
    render(<BacktestManagerView onLaunchChart={vi.fn()} onViewStats={vi.fn()} />);

    expect(screen.getByText('Saved Tests')).toBeTruthy();
    expect(screen.getByText('Sample Sets')).toBeTruthy();
  });

  it('changes order when the sort dropdown is updated', () => {
    render(<BacktestManagerView onLaunchChart={vi.fn()} onViewStats={vi.fn()} />);

    const getBacktestHeadings = () => screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent)
      .filter((text) => text === 'Bravo' || text === 'Alpha');

    expect(getBacktestHeadings()).toEqual(['Bravo', 'Alpha']);

    fireEvent.change(screen.getByLabelText('Sort backtests'), { target: { value: 'name' } });

    expect(getBacktestHeadings()).toEqual(['Alpha', 'Bravo']);
  });

  it('opens the new backtest dialog from the header button', () => {
    render(<BacktestManagerView onLaunchChart={vi.fn()} onViewStats={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /\+ new backtest/i }));

    expect(screen.getByText('New Backtest Dialog')).toBeTruthy();
  });

  it('launches the default chart list from the header button', () => {
    const onLaunchChart = vi.fn();

    render(<BacktestManagerView onLaunchChart={onLaunchChart} onViewStats={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Launch Chart' })[0]);

    expect(onLaunchChart).toHaveBeenCalledWith(null);
  });

  it('renders the empty state when no backtests are available', () => {
    hookSeed.backtests = [];

    render(<BacktestManagerView onLaunchChart={vi.fn()} onViewStats={vi.fn()} />);

    expect(screen.getByText('No backtests yet. Create one to get started.')).toBeTruthy();
  });
});
