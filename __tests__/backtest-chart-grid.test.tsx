// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chartProps } = vi.hoisted(() => ({
  chartProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/trading/BacktestChart', () => ({
  default: (props: Record<string, unknown>) => {
    chartProps.push(props);
    const timeframe = String(props.defaultTimeframe);
    const onToggleExpanded = props.onToggleExpanded as (() => void) | undefined;
    const onExtraSessionsForwardChange = props.onExtraSessionsForwardChange as ((next: number) => void) | undefined;
    const extraSessionsForward = Number(props.extraSessionsForward ?? 0);

    return (
      <div data-testid={`chart-${timeframe}`}>
        <span>{timeframe}</span>
        <span data-testid={`extra-${timeframe}`}>{extraSessionsForward}</span>
        <button type="button" onClick={onToggleExpanded}>toggle {timeframe}</button>
        <button type="button" onClick={() => onExtraSessionsForwardChange?.(extraSessionsForward + 1)}>
          right {timeframe}
        </button>
        <button type="button" onClick={() => onExtraSessionsForwardChange?.(Math.max(0, extraSessionsForward - 1))}>
          left {timeframe}
        </button>
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
    />,
  );
}

describe('BacktestChartGrid', () => {
  beforeEach(() => {
    chartProps.length = 0;
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
    expect(firstRender.find((props) => props.defaultTimeframe === '5m')?.drawingsController).toBeTruthy();
    expect(firstRender.find((props) => props.defaultTimeframe === '15m')?.drawingsController).toBeTruthy();
    expect(firstRender.find((props) => props.defaultTimeframe === '1h')?.drawingsController).toBeTruthy();
    expect(firstRender.find((props) => props.defaultTimeframe === '1D')?.drawingsController).toBeNull();
  });

  it('updates the expanded chart forward-session count', () => {
    renderGrid();

    fireEvent.click(screen.getByRole('button', { name: 'toggle 5m' }));
    fireEvent.click(screen.getByRole('button', { name: 'right 5m' }));
    expect(screen.getByTestId('extra-5m').textContent).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'left 5m' }));
    expect(screen.getByTestId('extra-5m').textContent).toBe('0');
  });
});
