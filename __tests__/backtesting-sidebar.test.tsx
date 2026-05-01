// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await import('react');

  type SelectContextValue = {
    value: string;
    onValueChange: (value: string) => void;
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
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        {children}
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => {
      const context = ReactModule.useContext(SelectContext);
      if (!context) return null;

      return (
        <button
          type="button"
          {...props}
        >
          {children}
          <span>{context.value}</span>
        </button>
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
      return (
        <button type="button" onClick={() => context?.onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

import BacktestingSidebar from '@/components/trading/BacktestingSidebar';

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('BacktestingSidebar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lets chart-launch mode switch to any sample set and select its rows', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/system-tickers') {
        return jsonResponse({
          rows: [
            { id: 'sys-1', ticker: 'SYS', date: '2026-04-20', grade: null, setupType: null, day1GapPct: null },
          ],
        });
      }

      if (url === '/api/sample-sets') {
        return jsonResponse({
          sampleSets: [{ id: 'ss-1', name: 'Momentum Set', ownerName: 'Me' }],
        });
      }

      if (url === '/api/sample-sets/ss-1') {
        return jsonResponse({
          sampleSet: {
            id: 'ss-1',
            name: 'Momentum Set',
            rows: [{ ticker: 'AUID', date: '2026-04-23' }],
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    const onSelect = vi.fn();

    render(
      <BacktestingSidebar
        selected={null}
        onSelect={onSelect}
        activeBacktestId={null}
      />,
    );

    await waitFor(() => expect(screen.getByText('SYS')).toBeTruthy());

    fireEvent.click(screen.getByText('Me - Momentum Set'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sample-sets/ss-1', expect.any(Object)));
    await waitFor(() => expect(screen.getByText('AUID')).toBeTruthy());
    expect(screen.getByText('Momentum Set')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /AUID/i }));

    expect(onSelect).toHaveBeenCalledWith({ ticker: 'AUID', date: '2026-04-23' });
  });

  it('hides ad hoc sample set selection when a named backtest is active', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/system-tickers') {
        return jsonResponse({ rows: [] });
      }

      if (url === '/api/sample-sets') {
        return jsonResponse({ sampleSets: [] });
      }

      if (url === '/api/backtests/bt-1') {
        return jsonResponse({
          backtest: {
            id: 'bt-1',
            name: 'Saved Test',
            sampleSetRows: [{ ticker: 'AAPL', date: '2026-04-28' }],
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BacktestingSidebar
        selected={null}
        onSelect={vi.fn()}
        activeBacktestId="bt-1"
      />,
    );

    await waitFor(() => expect(screen.getByText('AAPL')).toBeTruthy());
    expect(screen.queryByLabelText('Select Sample Set')).toBeNull();
    expect(screen.getByText('Saved Test')).toBeTruthy();
  });
});
