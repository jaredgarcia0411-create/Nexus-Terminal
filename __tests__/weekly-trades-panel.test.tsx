// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WeeklyTradesPanel from '@/components/trading/WeeklyTradesPanel';
import type { Trade } from '@/lib/types';

vi.mock('@/components/trading/TradeTagEditor', () => ({
  default: ({
    tags,
    onAddTag,
    onRemoveTag,
  }: {
    tags: string[];
    onAddTag?: (tag: string) => void;
    onRemoveTag?: (tag: string) => void;
  }) => (
    <div>
      <span>{tags.join('|')}</span>
      <button type="button" onClick={() => onAddTag?.('Gap')}>add</button>
      <button type="button" onClick={() => onRemoveTag?.(tags[0])}>remove</button>
    </div>
  ),
}));

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 'trade-1',
    date: new Date('2026-05-31T00:00:00'),
    sortKey: '2026-05-31',
    symbol: 'AAPL',
    direction: 'LONG',
    avgEntryPrice: 10,
    avgExitPrice: 12,
    totalQuantity: 100,
    grossPnl: 200,
    netPnl: 190,
    entryTime: '09:30',
    exitTime: '10:00',
    executionCount: 2,
    rawExecutions: [],
    pnl: 190,
    executions: 2,
    initialRisk: 100,
    tags: ['Momentum'],
    ...overrides,
  };
}

describe('WeeklyTradesPanel', () => {
  it('renders shared tag text in read-only mode', () => {
    render(<WeeklyTradesPanel trades={[makeTrade({ tags: ['Momentum', 'Gap'] })]} />);

    expect(screen.getByText('Momentum|Gap')).toBeTruthy();
  });

  it('uses editable tag controls when readOnly is false', () => {
    const onAddTag = vi.fn();
    const onRemoveTag = vi.fn();

    render(
      <WeeklyTradesPanel
        trades={[makeTrade({ id: 'trade-1' })]}
        globalTags={['Gap', 'Momentum']}
        readOnly={false}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />,
    );

    fireEvent.click(screen.getByText('add'));
    fireEvent.click(screen.getByText('remove'));

    expect(onAddTag).toHaveBeenCalledWith('trade-1', 'Gap');
    expect(onRemoveTag).toHaveBeenCalledWith('trade-1', 'Momentum');
  });
});
