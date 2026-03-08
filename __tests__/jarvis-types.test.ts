import { describe, expect, it } from 'vitest';

import type { JarvisMode, JarvisResponse } from '@/lib/jarvis-types';
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

  it('includes macro-summary mode in JarvisMode', () => {
    const mode: JarvisMode = 'macro-summary';

    expect(mode).toBe('macro-summary');
  });

  it('allows optional macroSummary in JarvisResponse', () => {
    const response: JarvisResponse = {
      message: 'ok',
      macroSummary: {
        date: '2026-03-08',
        overallSentiment: 'mixed',
        regions: [{ region: 'us', headline: 'US mixed', details: ['Rates steady'], sentiment: 'mixed' }],
        keyRisks: ['Inflation persistence'],
      },
    };

    expect(response.macroSummary?.overallSentiment).toBe('mixed');
  });
});
