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

vi.mock('@/components/trading/ResearchGainersList', () => ({
  default: ({ onSelectTicker }: { selectedTicker: string | null; onSelectTicker: (ticker: string) => void }) => (
    <button type="button" onClick={() => onSelectTicker('AAPL')}>
      Pick AAPL gainer
    </button>
  ),
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

describe('ResearchTab', () => {
  it('renders the initial empty state before a ticker is selected', () => {
    render(<ResearchTab />);

    expect(screen.getByText('Select a ticker from the gainers list or search above')).toBeTruthy();
  });

  it('selects an uppercase ticker when pressing Enter in the search input', async () => {
    render(<ResearchTab />);

    const input = screen.getByPlaceholderText('Search ticker...');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Loading MSFT...')).toBeTruthy();
    expect(screen.getByText('Research view for MSFT')).toBeTruthy();
  });

  it('selects AAPL when the mocked gainer is clicked', () => {
    render(<ResearchTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Pick AAPL gainer' }));

    expect(screen.getByText('Research view for AAPL')).toBeTruthy();
  });

  it('updates the header from loading text to the mocked company name', async () => {
    render(<ResearchTab />);

    const input = screen.getByPlaceholderText('Search ticker...');
    fireEvent.change(input, { target: { value: 'msft' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Loading MSFT...')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Acme Biotech')).toBeTruthy();
    });
  });
});
