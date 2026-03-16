import { describe, expect, it } from 'vitest';
import { normalizeMassiveTicker } from '@/lib/massive-market';

function normalizeRealtimeSymbol(raw: string) {
  return normalizeMassiveTicker(raw).replace(/\//g, '');
}

describe('normalizeRealtimeSymbol', () => {
  it('equities pass through unchanged', () => {
    expect(normalizeRealtimeSymbol('SPY')).toBe('SPY');
    expect(normalizeRealtimeSymbol('AAPL')).toBe('AAPL');
  });

  it('futures strip leading slash', () => {
    expect(normalizeRealtimeSymbol('/GC')).toBe('GC');
    expect(normalizeRealtimeSymbol('/ES')).toBe('ES');
  });

  it('forex strips C: prefix and slash', () => {
    expect(normalizeRealtimeSymbol('C:EURUSD')).toBe('EURUSD');
  });

  it('Schwab forex format strips slash', () => {
    expect(normalizeRealtimeSymbol('EUR/USD')).toBe('EURUSD');
  });

  it('both forex formats normalize to same key', () => {
    const massive = normalizeRealtimeSymbol('C:EURUSD');
    const schwab = normalizeRealtimeSymbol('EUR/USD');
    expect(massive).toBe(schwab);
  });
});
