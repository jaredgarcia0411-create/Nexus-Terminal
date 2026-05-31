// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type React from 'react';

import TradesTab from '@/components/trading/TradesTab';
import type { Trade } from '@/lib/types';

vi.mock('motion/react', () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      ...props
    }: React.ComponentProps<'div'> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/trading/TagFilterDropdown', () => ({
  default: ({
    globalTags,
    selectedTags,
    onToggleTag,
    onClearTags,
  }: {
    globalTags: string[];
    selectedTags: Set<string>;
    onToggleTag: (tag: string) => void;
    onClearTags: () => void;
  }) => (
    <div data-testid="tag-filter-dropdown">
      <span>global: {globalTags.join(',')}</span>
      <span>selected: {[...selectedTags].join(',')}</span>
      <button type="button" onClick={() => onToggleTag(globalTags[0])}>toggle-filter-tag</button>
      <button type="button" onClick={onClearTags}>clear-filter-tags</button>
    </div>
  ),
}));

vi.mock('@/components/trading/TradeTable', () => ({
  default: ({
    trades,
    readOnly,
    globalTags,
    positionFilter,
    onPositionFilterChange,
    onToggleSelect,
    onSelectAll,
    onAddTag,
    onRemoveTag,
    onDeleteGlobalTag,
    onTradeClick,
    onMergeTrades,
  }: {
    trades: Trade[];
    readOnly: boolean;
    globalTags: string[];
    positionFilter?: 'all' | 'open' | 'closed';
    onPositionFilterChange?: (filter: 'all' | 'open' | 'closed') => void;
    onToggleSelect: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onAddTag: (tradeId: string, tagName: string) => void;
    onRemoveTag: (tradeId: string, tagName: string) => void;
    onDeleteGlobalTag: (tagName: string) => void;
    onTradeClick: (trade: Trade) => void;
    onMergeTrades?: (ids: string[]) => void;
  }) => (
    <div data-testid="trade-table">
      <span>readOnly: {String(readOnly)}</span>
      <span>globalTags: {globalTags.join(',')}</span>
      <span>position: {positionFilter}</span>
      <button type="button" onClick={() => onPositionFilterChange?.('open')}>change-position</button>
      <button type="button" onClick={() => onToggleSelect(trades[0].id)}>toggle-select</button>
      <button type="button" onClick={() => onSelectAll(trades.map((trade) => trade.id))}>select-all</button>
      <button type="button" onClick={() => onAddTag(trades[0].id, 'Gap')}>add-row-tag</button>
      <button type="button" onClick={() => onRemoveTag(trades[0].id, 'Momentum')}>remove-row-tag</button>
      <button type="button" onClick={() => onDeleteGlobalTag('Momentum')}>delete-global-tag</button>
      <button type="button" onClick={() => onTradeClick(trades[0])}>trade-click</button>
      <button type="button" onClick={() => onMergeTrades?.(trades.map((trade) => trade.id))}>merge-trades</button>
    </div>
  ),
}));

vi.mock('@/components/trading/ManageTagsDialog', () => ({
  default: ({
    open,
    globalTags,
    onRenameTag,
    onDeleteTag,
  }: {
    open: boolean;
    globalTags: string[];
    onRenameTag: (from: string, to: string) => Promise<void>;
    onDeleteTag: (tagName: string) => void;
  }) => (
    open ? (
      <div data-testid="manage-tags-dialog">
        <span>managed: {globalTags.join(',')}</span>
        <button type="button" onClick={() => void onRenameTag('Momentum', 'Breakout')}>rename-tag</button>
        <button type="button" onClick={() => onDeleteTag('Gap')}>delete-dialog-tag</button>
      </div>
    ) : null
  ),
}));

function makeTrade(overrides: Partial<Trade> = {}): Trade {
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

function renderTradesTab(overrides: Partial<React.ComponentProps<typeof TradesTab>> = {}) {
  const props: React.ComponentProps<typeof TradesTab> = {
    filteredTrades: [makeTrade()],
    selectedIds: new Set(['trade-1']),
    globalTags: ['Momentum', 'Gap'],
    selectedFilterTags: new Set(['Momentum']),
    searchQuery: '',
    riskInput: '',
    defaultRiskInput: '',
    bulkTagInput: '',
    onSearchQueryChange: vi.fn(),
    onToggleFilterTag: vi.fn(),
    onClearFilterTags: vi.fn(),
    onDeleteGlobalTag: vi.fn(),
    onRenameGlobalTag: vi.fn().mockResolvedValue(undefined),
    onToggleSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onMergeTrades: vi.fn(),
    onTradeClick: vi.fn(),
    positionFilter: 'all',
    onPositionFilterChange: vi.fn(),
    onRiskInputChange: vi.fn(),
    onDefaultRiskInputChange: vi.fn(),
    onBulkTagInputChange: vi.fn(),
    onApplyRisk: vi.fn(),
    onSetDefaultRisk: vi.fn(),
    onBulkAddTag: vi.fn(),
    ...overrides,
  };

  render(<TradesTab {...props} />);
  return props;
}

describe('TradesTab', () => {
  it('wires search, bulk controls, and tag filters to parent handlers', () => {
    const props = renderTradesTab();

    fireEvent.change(screen.getByPlaceholderText('Search symbol...'), { target: { value: 'TSLA' } });
    fireEvent.change(screen.getByPlaceholderText('Add risk ($) to selected'), { target: { value: '125' } });
    fireEvent.change(screen.getByPlaceholderText('Set automatic risk ($)'), { target: { value: '80' } });
    fireEvent.change(screen.getByPlaceholderText('Add tag to selected'), { target: { value: 'Breakout' } });
    fireEvent.click(screen.getByText('Apply Risk'));
    fireEvent.click(screen.getByText('Set Auto Risk'));
    fireEvent.click(screen.getByText('Add Tag'));
    fireEvent.click(screen.getByText('toggle-filter-tag'));
    fireEvent.click(screen.getByText('clear-filter-tags'));

    expect(props.onSearchQueryChange).toHaveBeenCalledWith('TSLA');
    expect(props.onRiskInputChange).toHaveBeenCalledWith('125');
    expect(props.onDefaultRiskInputChange).toHaveBeenCalledWith('80');
    expect(props.onBulkTagInputChange).toHaveBeenCalledWith('Breakout');
    expect(props.onApplyRisk).toHaveBeenCalledTimes(1);
    expect(props.onSetDefaultRisk).toHaveBeenCalledTimes(1);
    expect(props.onBulkAddTag).toHaveBeenCalledTimes(1);
    expect(props.onToggleFilterTag).toHaveBeenCalledWith('Momentum');
    expect(props.onClearFilterTags).toHaveBeenCalledTimes(1);
  });

  it('forwards table props and row actions without re-testing the table', () => {
    const props = renderTradesTab({ filteredTrades: [makeTrade(), makeTrade({ id: 'trade-2', symbol: 'MSFT' })] });

    expect(screen.getByTestId('trade-table').textContent).toContain('readOnly: false');
    expect(screen.getByTestId('trade-table').textContent).toContain('globalTags: Momentum,Gap');
    expect(screen.getByTestId('trade-table').textContent).toContain('position: all');

    fireEvent.click(screen.getByText('change-position'));
    fireEvent.click(screen.getByText('toggle-select'));
    fireEvent.click(screen.getByText('select-all'));
    fireEvent.click(screen.getByText('add-row-tag'));
    fireEvent.click(screen.getByText('remove-row-tag'));
    fireEvent.click(screen.getByText('delete-global-tag'));
    fireEvent.click(screen.getByText('trade-click'));
    fireEvent.click(screen.getByText('merge-trades'));

    expect(props.onPositionFilterChange).toHaveBeenCalledWith('open');
    expect(props.onToggleSelect).toHaveBeenCalledWith('trade-1');
    expect(props.onSelectAll).toHaveBeenCalledWith(['trade-1', 'trade-2']);
    expect(props.onAddTag).toHaveBeenCalledWith('trade-1', 'Gap');
    expect(props.onRemoveTag).toHaveBeenCalledWith('trade-1', 'Momentum');
    expect(props.onDeleteGlobalTag).toHaveBeenCalledWith('Momentum');
    expect(props.onTradeClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'trade-1' }));
    expect(props.onMergeTrades).toHaveBeenCalledWith(['trade-1', 'trade-2']);
  });

  it('opens tag management and passes rename/delete handlers', () => {
    const props = renderTradesTab();

    fireEvent.click(screen.getByText('Manage Tags'));

    expect(screen.getByTestId('manage-tags-dialog').textContent).toContain('managed: Momentum,Gap');

    fireEvent.click(screen.getByText('rename-tag'));
    fireEvent.click(screen.getByText('delete-dialog-tag'));

    expect(props.onRenameGlobalTag).toHaveBeenCalledWith('Momentum', 'Breakout');
    expect(props.onDeleteGlobalTag).toHaveBeenCalledWith('Gap');
  });
});
