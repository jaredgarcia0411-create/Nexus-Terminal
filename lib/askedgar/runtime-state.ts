import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { askedgarRuntimeState } from '@/lib/db/schema';

// Rate limit tracking — when AskEdgar returns 429, we stop making requests
// until the retry window expires. This prevents wasting calls.
let rateLimitedUntil = 0; // Unix timestamp (ms) when we can resume

const MODULE_RATE_LIMIT_REFRESH_MS = 5000;
let rateLimitDbLastSyncedAt = 0;

export async function syncRateLimitFromDb(): Promise<void> {
  if (Date.now() - rateLimitDbLastSyncedAt < MODULE_RATE_LIMIT_REFRESH_MS) return;
  const db = getDb();
  if (!db) return;

  try {
    const [row] = await db
      .select({ rateLimitedUntil: askedgarRuntimeState.rateLimitedUntil })
      .from(askedgarRuntimeState)
      .where(eq(askedgarRuntimeState.id, 'global'))
      .limit(1);

    rateLimitedUntil = row?.rateLimitedUntil ? row.rateLimitedUntil.getTime() : 0;
    rateLimitDbLastSyncedAt = Date.now();
  } catch (err) {
    console.warn('[askedgar-state] rate-limit DB read failed; using module memory:', err);
  }
}

async function persistRateLimit(untilMs: number): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(askedgarRuntimeState)
      .values({
        id: 'global',
        rateLimitedUntil: new Date(untilMs),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: askedgarRuntimeState.id,
        set: { rateLimitedUntil: new Date(untilMs), updatedAt: new Date() },
      });
    rateLimitDbLastSyncedAt = Date.now();
  } catch (err) {
    console.warn('[askedgar-state] rate-limit DB write failed; module memory remains authoritative for this instance:', err);
  }
}

export function setRateLimited(retryAfterSeconds: number) {
  rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
  void persistRateLimit(rateLimitedUntil);
}

export function getRateLimitedUntil() {
  return rateLimitedUntil;
}
