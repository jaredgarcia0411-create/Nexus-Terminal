import { describe, expect, it } from 'vitest';

import { toJarvisTradeInput } from '@/lib/jarvis-types';

describe('toJarvisTradeInput', () => {
  it('keeps only the fields Jarvis uses, including notes', () => {
    const source = {
      id: 'trade-1',
      symbol: 'AAPL',
      date: '2026-03-06T00:00:00.000Z',
      netPnl: 120,
      pnl: 120,
      direction: 'LONG' as 'LONG',
      totalQuantity: 10,
      tags: ['swing'],
      notes: 'Important setup',
      extra: 'should be omitted',
    };

    const normalized = toJarvisTradeInput(source);

    expect(normalized).toEqual({
      id: 'trade-1',
      symbol: 'AAPL',
      date: '2026-03-06T00:00:00.000Z',
      netPnl: 120,
      pnl: 120,
      direction: 'LONG',
      totalQuantity: 10,
      tags: ['swing'],
      notes: 'Important setup',
    });
  });
});
