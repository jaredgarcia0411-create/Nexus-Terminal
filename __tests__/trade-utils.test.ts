import { describe, expect, it } from 'vitest';

import { normalizeTrade } from '@/lib/trade-utils';

describe('normalizeTrade', () => {
  it('builds the trade Date from sortKey without UTC date-only rollback', () => {
    const trade = normalizeTrade({
      id: 'trade-1',
      date: '2026-05-19',
      sortKey: '2026-05-19',
      symbol: 'AAPL',
      direction: 'LONG',
      avgEntryPrice: 100,
      avgExitPrice: 110,
      totalQuantity: 10,
      netPnl: 100,
    });

    expect(trade.date.getFullYear()).toBe(2026);
    expect(trade.date.getMonth()).toBe(4);
    expect(trade.date.getDate()).toBe(19);
  });
});
