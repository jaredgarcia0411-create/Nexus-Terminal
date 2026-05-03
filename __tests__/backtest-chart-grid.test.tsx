// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chartProps } = vi.hoisted(() => ({
  chartProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/trading/BacktestChart', () => ({
  default: (props: Record<string, unknown>) => {
    chartProps.push(props);
    const timeframe = String(props.timeframe);
    const onToggleExpanded = props.onToggleExpanded as (() => void) | undefined;
    const onTimeframeChange = props.onTimeframeChange as ((next: string) => void) | undefined;
    const extraSessionsForward = Number(props.extraSessionsForward ?? 0);

    return (
      <div data-testid={`chart-${timeframe}`}>
        <span>{timeframe}</span>
        <span data-testid={`extra-${timeframe}`}>{extraSessionsForward}</span>
        <button type="button" onClick={onToggleExpanded}>toggle {timeframe}</button>
        <button type="button" onClick={() => onTimeframeChange?.('15m')}>timeframe {timeframe}</button>
      </div>
    );
  },
}));

import BacktestChartGrid from '@/components/trading/BacktestChartGrid';

function renderGrid() {
  return render(
    <BacktestChartGrid
      ticker="AAPL"
      date="2026-04-28"
      onAnchorChange={vi.fn()}
      armedAction={null}
      onArmedClick={vi.fn()}
      actions={[]}
      currentStop={null}
      extraSessionsForward={0}
    />,
  );
}

describe('BacktestChartGrid', () => {
  beforeEach(() => {
    chartProps.length = 0;
    window.localStorage.clear();
  });

  it('renders the default four chart cells', () => {
    renderGrid();

    expect(screen.getByTestId('chart-5m')).toBeTruthy();
    expect(screen.getByTestId('chart-15m')).toBeTruthy();
    expect(screen.getByTestId('chart-1h')).toBeTruthy();
    expect(screen.getByTestId('chart-1D')).toBeTruthy();
  });

  it('expands a selected chart and hides the other cells', () => {
    renderGrid();

    fireEvent.click(screen.getByRole('button', { name: 'toggle 15m' }));

    expect(screen.queryByTestId('chart-5m')).toBeNull();
    expect(screen.getByTestId('chart-15m')).toBeTruthy();
    expect(screen.queryByTestId('chart-1h')).toBeNull();
    expect(screen.queryByTestId('chart-1D')).toBeNull();
  });

  it('passes shared drawing control to intraday charts only', () => {
    renderGrid();

    const firstRender = chartProps.slice(0, 4);
    expect(firstRender.find((props) => props.timeframe === '5m')?.drawingsController).toBeTruthy();
    expect(firstRender.find((props) => props.timeframe === '15m')?.drawingsController).toBeTruthy();
    expect(firstRender.find((props) => props.timeframe === '1h')?.drawingsController).toBeTruthy();
    expect(firstRender.find((props) => props.timeframe === '1D')?.drawingsController).toBeNull();
  });

  it('passes the global forward-session count to every visible chart', () => {
    render(
      <BacktestChartGrid
        ticker="AAPL"
        date="2026-04-28"
        onAnchorChange={vi.fn()}
        armedAction={null}
        onArmedClick={vi.fn()}
        actions={[]}
        currentStop={null}
        extraSessionsForward={2}
      />,
    );

    expect(screen.getByTestId('extra-5m').textContent).toBe('2');
    expect(screen.getByTestId('extra-15m').textContent).toBe('2');
    expect(screen.getByTestId('extra-1h').textContent).toBe('2');
    expect(screen.getByTestId('extra-1D').textContent).toBe('2');
  });

  it('updates a chart slot timeframe without changing the other slots', () => {
    renderGrid();

    fireEvent.click(screen.getByRole('button', { name: 'timeframe 5m' }));

    expect(screen.queryByTestId('chart-5m')).toBeNull();
    expect(screen.getAllByTestId('chart-15m')).toHaveLength(2);
    expect(screen.getByTestId('chart-1h')).toBeTruthy();
    expect(screen.getByTestId('chart-1D')).toBeTruthy();
  });

  it('persists the expanded slot across remounts', () => {
    const { unmount } = renderGrid();

    fireEvent.click(screen.getByRole('button', { name: 'toggle 1h' }));
    expect(window.localStorage.getItem('nexus-backtest-expand-slot')).toBe('hourly');

    unmount();
    renderGrid();

    expect(screen.queryByTestId('chart-5m')).toBeNull();
    expect(screen.queryByTestId('chart-15m')).toBeNull();
    expect(screen.getByTestId('chart-1h')).toBeTruthy();
    expect(screen.queryByTestId('chart-1D')).toBeNull();
  });

  it('ignores unknown persisted expanded slot values', () => {
    window.localStorage.setItem('nexus-backtest-expand-slot', 'foobar');

    renderGrid();

    expect(screen.getByTestId('chart-5m')).toBeTruthy();
    expect(screen.getByTestId('chart-15m')).toBeTruthy();
    expect(screen.getByTestId('chart-1h')).toBeTruthy();
    expect(screen.getByTestId('chart-1D')).toBeTruthy();
  });
});
