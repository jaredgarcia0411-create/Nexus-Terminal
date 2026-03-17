import { and, count, eq, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisRequestLog } from '@/lib/db/schema';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const DEFAULT_LIMIT_PER_HOUR = 30;

function getLimitPerHour() {
  const parsed = Number(process.env.JARVIS_RATE_LIMIT_PER_HOUR);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT_PER_HOUR;
  return Math.floor(parsed);
}

export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  const limit = getLimitPerHour();
  const db = getDb();

  if (!db) {
    return { allowed: true, remaining: limit, resetAt: Date.now() + 3_600_000 };
  }

  const oneHourAgo = new Date(Date.now() - 3_600_000);

  const [row] = await db
    .select({ total: count() })
    .from(jarvisRequestLog)
    .where(
      and(
        eq(jarvisRequestLog.userId, userId),
        gt(jarvisRequestLog.createdAt, oneHourAgo),
      ),
    );

  const used = row?.total ?? 0;

  if (used >= limit) {
    return { allowed: false, remaining: 0, resetAt: Date.now() + 3_600_000 };
  }

  return {
    allowed: true,
    remaining: limit - used,
    resetAt: Date.now() + 3_600_000,
  };
}
