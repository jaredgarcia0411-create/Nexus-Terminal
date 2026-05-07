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
  function MockResearchTickerView({ ticker }: { ticker: string }) {
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

    expect(screen.getByText('Search a Ticker or Select One From The Scanner in Dashboard')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search Symbol')).toBeTruthy();
  });

  it('selects an uppercase ticker when pressing Enter in the search input', async () => {
    renderResearchTab();

    const input = screen.getByPlaceholderText('Search Symbol');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.queryByText('Loading MSFT...')).toBeNull();
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

  it('does not render company name text beside the search input', async () => {
    renderResearchTab();

    const input = screen.getByPlaceholderText('Search Symbol');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Research view for MSFT')).toBeTruthy();
    expect(screen.queryByText('Acme Biotech')).toBeNull();
  });
});
