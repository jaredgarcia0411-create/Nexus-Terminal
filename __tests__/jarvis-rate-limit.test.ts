import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, resetRateLimits } from '@/lib/jarvis-rate-limit';

describe('jarvis-rate-limit', () => {
  beforeEach(() => {
    resetRateLimits();
    delete process.env.JARVIS_RATE_LIMIT_PER_HOUR;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRateLimits();
  });

  it('first request is allowed with 29 remaining by default', () => {
    const result = checkRateLimit('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29);
  });

  it('allows first 30 requests and blocks the 31st', () => {
    const outcomes = Array.from({ length: 31 }, () => checkRateLimit('user-1'));
    const firstThirty = outcomes.slice(0, 30);
    const thirtyFirst = outcomes[30];

    expect(firstThirty.every((result) => result.allowed)).toBe(true);
    expect(thirtyFirst).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('allows requests again after the 1-hour window', () => {
    vi.useFakeTimers();

    for (let i = 0; i < 30; i += 1) {
      checkRateLimit('user-1');
    }
    expect(checkRateLimit('user-1').allowed).toBe(false);

    vi.advanceTimersByTime(3_600_001);

    const result = checkRateLimit('user-1');
    expect(result.allowed).toBe(true);
  });

  it('resetRateLimits clears state', () => {
    for (let i = 0; i < 30; i += 1) {
      checkRateLimit('user-1');
    }
    expect(checkRateLimit('user-1').allowed).toBe(false);

    resetRateLimits();

    const result = checkRateLimit('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29);
  });

  it('respects custom JARVIS_RATE_LIMIT_PER_HOUR', () => {
    process.env.JARVIS_RATE_LIMIT_PER_HOUR = '5';

    const outcomes = Array.from({ length: 6 }, () => checkRateLimit('user-1'));
    expect(outcomes.slice(0, 5).every((result) => result.allowed)).toBe(true);
    expect(outcomes[5]).toMatchObject({ allowed: false, remaining: 0 });
  });
});
