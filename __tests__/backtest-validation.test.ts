import { describe, expect, it } from 'vitest';

import { backtestSessionReviewSchema } from '@/lib/validations/backtest';

describe('backtestSessionReviewSchema', () => {
  it('allows review saves without chart state', () => {
    const result = backtestSessionReviewSchema.safeParse({
      sessionId: 'session-1',
      label: 'Setup',
      notes: 'Clean move',
    });

    expect(result.success).toBe(true);
  });

  it('accepts drawings and per-slot indicators', () => {
    const result = backtestSessionReviewSchema.safeParse({
      sessionId: 'session-1',
      chartState: {
        drawings: [{ id: 'drawing-1' }],
        indicators: { primary: ['VWAP'] },
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects extra chart state fields', () => {
    const result = backtestSessionReviewSchema.safeParse({
      sessionId: 'session-1',
      chartState: {
        extraField: 1,
      },
    });

    expect(result.success).toBe(false);
  });
});
