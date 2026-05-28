import { describe, expect, it } from 'vitest';

import { nyDateTimeToEpoch } from '@/lib/time-utils';
import { buildTradeMarkers } from '@/lib/ui-trade-utils';
import type { Trade } from '@/lib/types';

const baseTrade: Trade = {
  id: 'trade-1',
  date: new Date('2026-05-26T15:59:00-04:00'),
  sortKey: '2026-05-26',
  symbol: 'AAPL',
  direction: 'LONG',
  avgEntryPrice: 100,
  avgExitPrice: 110,
  totalQuantity: 100,
  grossPnl: 1000,
  netPnl: 990,
  entryTime: '15:59:00',
  exitTime: '09:31:00',
  executionCount: 2,
  rawExecutions: [],
  pnl: 990,
  executions: 2,
  commission: 5,
  fees: 5,
  tags: [],
  isOpen: false,
  closedAt: '2026-05-28T09:31:00-04:00',
};

describe('ui-trade-utils', () => {
  it('places fallback exit markers on the close day for cross-day trades', () => {
    const markers = buildTradeMarkers(baseTrade);

    expect(markers).toEqual([
      {
        time: nyDateTimeToEpoch('2026-05-26', '15:59:00'),
        direction: 'LONG',
        price: 100,
        label: 'ENTRY',
      },
      {
        time: nyDateTimeToEpoch('2026-05-28', '09:31:00'),
        direction: 'SHORT',
        price: 110,
        label: 'EXIT',
      },
    ]);
    expect(markers[1].time).toBeGreaterThan(markers[0].time);
  });

  it('places exit executions on the close day when only clock time exists', () => {
    const markers = buildTradeMarkers({
      ...baseTrade,
      rawExecutions: [
        {
          id: 'entry-1',
          side: 'ENTRY',
          price: 100,
          qty: 100,
          time: '15:59:00',
          commission: 0,
          fees: 0,
        },
        {
          id: 'exit-1',
          side: 'EXIT',
          price: 110,
          qty: 100,
          time: '09:31:00',
          commission: 0,
          fees: 0,
        },
      ],
    });

    expect(markers[0].time).toBe(nyDateTimeToEpoch('2026-05-26', '15:59:00'));
    expect(markers[1].time).toBe(nyDateTimeToEpoch('2026-05-28', '09:31:00'));
    expect(markers[1].time).toBeGreaterThan(markers[0].time);
  });

  it('keeps absolute execution timestamps ahead of side-based day resolution', () => {
    const absoluteTimestamp = '2026-05-27T10:15:00-04:00';
    const markers = buildTradeMarkers({
      ...baseTrade,
      rawExecutions: [
        {
          id: 'exit-absolute',
          side: 'EXIT',
          price: 108,
          qty: 50,
          time: '09:31:00',
          timestamp: absoluteTimestamp,
          commission: 0,
          fees: 0,
        },
      ],
    });

    expect(markers[0].time).toBe(new Date(absoluteTimestamp).getTime());
  });
});
