import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ChartsTab from '@/components/trading/ChartsTab';

describe('ChartsTab', () => {
  it('renders key controls for chart workflow', () => {
    const html = renderToStaticMarkup(createElement(ChartsTab, {
      trades: [{
        id: 'trade-1',
        date: new Date('2026-03-10T12:00:00.000Z'),
        sortKey: '2026-03-10',
        symbol: 'SPY',
        direction: 'LONG',
        avgEntryPrice: 600,
        avgExitPrice: 605,
        totalQuantity: 10,
        grossPnl: 50,
        netPnl: 48,
        entryTime: '09:35:00',
        exitTime: '10:00:00',
        executionCount: 1,
        rawExecutions: [],
        pnl: 48,
        executions: 1,
        tags: [],
      }],
    }));

    expect(html).toContain('Capture chart screenshot');
    expect(html).toContain('Timeframe');
    expect(html).not.toContain('Screenshot</');
    expect(html).toContain('SPY');
  });
});
