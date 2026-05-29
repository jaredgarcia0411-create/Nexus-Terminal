import { describe, expect, it, vi } from 'vitest';

import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';

function createRateLimitDb(count: number) {
  const returning = vi.fn(async () => [{ count }]);
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return { insert, values, onConflictDoUpdate, returning };
}

const fixedNow = new Date('2026-05-29T14:37:12.000Z');
const fixedWindowStart = new Date('2026-05-29T14:00:00.000Z');
const fixedResetAt = new Date('2026-05-29T15:00:00.000Z');

describe('rate-limit helper', () => {
  it('allows requests under the endpoint limit', async () => {
    const db = createRateLimitDb(5);

    const result = await checkRateLimit(
      db as unknown as Parameters<typeof checkRateLimit>[0],
      'user-1',
      'research-report',
      fixedNow,
    );

    expect(result).toEqual({
      limited: false,
      limit: RATE_LIMITS['research-report'],
      remaining: 15,
      resetAt: fixedResetAt,
      retryAfterSeconds: 0,
    });
    expect(db.values).toHaveBeenCalledWith({
      id: `user-1:research-report:${fixedWindowStart.getTime()}`,
      userId: 'user-1',
      endpoint: 'research-report',
      windowStart: fixedWindowStart,
      count: 1,
    });
    expect(db.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.anything(),
      set: expect.objectContaining({ count: expect.anything() }),
    }));
  });

  it('allows the request that exactly reaches the limit', async () => {
    const db = createRateLimitDb(RATE_LIMITS['research-report']);

    const result = await checkRateLimit(
      db as unknown as Parameters<typeof checkRateLimit>[0],
      'user-1',
      'research-report',
      fixedNow,
    );

    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it('limits requests over the endpoint limit', async () => {
    const db = createRateLimitDb(RATE_LIMITS['askedgar-tldr'] + 1);

    const result = await checkRateLimit(
      db as unknown as Parameters<typeof checkRateLimit>[0],
      'user-1',
      'askedgar-tldr',
      fixedNow,
    );

    expect(result.limited).toBe(true);
    expect(result.limit).toBe(RATE_LIMITS['askedgar-tldr']);
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toEqual(fixedResetAt);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('builds a 429 response with standard rate limit headers', async () => {
    const response = rateLimitResponse({
      limited: true,
      limit: 20,
      remaining: 0,
      resetAt: fixedResetAt,
      retryAfterSeconds: 1368,
    });

    await expect(response.json()).resolves.toEqual({ error: 'Rate limit exceeded. Try again later.' });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1368');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('X-RateLimit-Reset')).toBe(String(Math.floor(fixedResetAt.getTime() / 1000)));
  });
});
