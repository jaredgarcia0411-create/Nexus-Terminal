import { describe, expect, it } from 'vitest';

import { backtestSessionReviewSchema, backtestSessionUpsertSchema } from '@/lib/validations/backtest';

describe('backtestSessionUpsertSchema', () => {
  it('accepts sheet row session discriminators', () => {
    expect(backtestSessionUpsertSchema.safeParse({
      ticker: 'AAPL',
      date: '2026-04-28',
      riskDollars: 100,
      sheetRowId: 'row-1',
    }).success).toBe(true);

    expect(backtestSessionUpsertSchema.safeParse({
      ticker: 'AAPL',
      date: '2026-04-28',
      riskDollars: 100,
      sheetRowId: null,
    }).success).toBe(true);
  });
});

describe('backtestSessionReviewSchema', () => {
  it('allows review saves without chart state', () => {
    const result = backtestSessionReviewSchema.safeParse({
      sessionId: 'session-1',
      label: 'Setup',
      notes: 'Clean move',
    });

    expect(result.success).toBe(true);
  });

  it('accepts legacy drawings and per-slot indicators', () => {
    const result = backtestSessionReviewSchema.safeParse({
      sessionId: 'session-1',
      chartState: {
        drawings: [{ id: 'drawing-1' }],
        indicators: { primary: ['VWAP'] },
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts bucketed drawings and per-slot indicators', () => {
    const result = backtestSessionReviewSchema.safeParse({
      sessionId: 'session-1',
      chartState: {
        drawings: { intraday: [{ id: 'drawing-1' }], higher: [] },
        indicators: { intraday: { primary: ['VWAP'] }, higher: { daily: ['SMA50'] } },
      },
    });

    expect(result.success).toBe(true);
  });

  it('tolerates extra chart state fields for forward compatibility', () => {
    const result = backtestSessionReviewSchema.safeParse({
      sessionId: 'session-1',
      chartState: {
        extraField: 1,
      },
    });

    expect(result.success).toBe(true);
  });
});
