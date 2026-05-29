import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { rateLimits } from '@/lib/db/schema';

type RateLimitDb = NonNullable<ReturnType<typeof getDb>>;

// Research report fires 14+ external calls + an LLM call, so it gets the
// tighter cap. Both reset at the top of each clock hour, per user.
export const RATE_LIMITS = {
  'research-report': 20,
  'askedgar-tldr': 30,
} as const;

export type RateLimitEndpoint = keyof typeof RATE_LIMITS;

const WINDOW_MS = 60 * 60 * 1000; // 1 hour fixed window

export interface RateLimitResult {
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

// Top of the current clock hour, in UTC.
function windowStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

// Atomic fixed-window counter: one upsert increments the row for
// (user, endpoint, hour) and returns the new count. count > limit => limited.
export async function checkRateLimit(
  db: RateLimitDb,
  userId: string,
  endpoint: RateLimitEndpoint,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const limit = RATE_LIMITS[endpoint];
  const start = windowStart(now);
  const resetAt = new Date(start.getTime() + WINDOW_MS);
  const id = `${userId}:${endpoint}:${start.getTime()}`;

  const [row] = await db
    .insert(rateLimits)
    .values({ id, userId, endpoint, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.id,
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  // returning() always yields a row for insert-or-update on neon-http, so
  // `?? 1` is a type-narrowing fallback only and is never hit in practice.
  const count = row?.count ?? 1;
  const limited = count > limit;
  const retryAfterSeconds = limited
    ? Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))
    : 0;

  return { limited, limit, remaining: Math.max(0, limit - count), resetAt, retryAfterSeconds };
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    { error: 'Rate limit exceeded. Try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
      },
    },
  );
}
