// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('motion/react', () => ({
  motion: {
    section: ({ children, initial: _initial, animate: _animate, exit: _exit, ...props }: React.ComponentProps<'section'> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
    }) => <section {...props}>{children}</section>,
  },
}));

vi.mock('@/components/trading/ResearchTickerView', async () => {
  const React = await import('react');

  function MockResearchTickerView({ ticker, onCompanyName }: { ticker: string; onCompanyName?: (name: string | null) => void }) {
    React.useEffect(() => {
      queueMicrotask(() => {
        onCompanyName?.('Acme Biotech');
      });
    }, [onCompanyName]);

    return <div>Research view for {ticker}</div>;
  }

  return { default: MockResearchTickerView };
});

import ResearchTab from '@/components/trading/ResearchTab';

function renderResearchTab(props?: Partial<React.ComponentProps<typeof ResearchTab>>) {
  return render(
    <ResearchTab
      pendingResearchTicker={props?.pendingResearchTicker ?? null}
      onClearPendingTicker={props?.onClearPendingTicker ?? vi.fn()}
    />,
  );
}

describe('ResearchTab', () => {
  it('renders the initial empty state before a ticker is selected', () => {
    renderResearchTab();

    expect(screen.getByText('Search a ticker above or click a row in the Scanner')).toBeTruthy();
  });

  it('selects an uppercase ticker when pressing Enter in the search input', async () => {
    renderResearchTab();

    const input = screen.getByPlaceholderText('Search ticker...');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Loading MSFT...')).toBeTruthy();
    expect(screen.getByText('Research view for MSFT')).toBeTruthy();
  });

  it('selects a pending ticker and clears it', async () => {
    const onClearPendingTicker = vi.fn();

    renderResearchTab({ pendingResearchTicker: 'AAPL', onClearPendingTicker });

    expect(screen.getByText('Research view for AAPL')).toBeTruthy();
    await waitFor(() => {
      expect(onClearPendingTicker).toHaveBeenCalledOnce();
    });
  });

  it('updates the header from loading text to the mocked company name', async () => {
    renderResearchTab();

    const input = screen.getByPlaceholderText('Search ticker...');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Loading MSFT...')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Acme Biotech')).toBeTruthy();
    });
  });
});
