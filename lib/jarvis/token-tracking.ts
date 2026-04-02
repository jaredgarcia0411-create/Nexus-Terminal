import { logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisRequestLog } from '@/lib/db/schema';
import type { JarvisMode } from '@/lib/jarvis/types';

export interface RequestLogEntry {
  userId: string;
  mode: JarvisMode;
  durationMs: number;
  success: boolean;
}

/** Minimal request log — records enough for rate limiting and basic diagnostics. */
export async function logJarvisRequest(entry: RequestLogEntry): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(jarvisRequestLog).values({
      id: crypto.randomUUID(),
      userId: entry.userId,
      mode: entry.mode,
      durationMs: entry.durationMs,
      success: entry.success ? 1 : 0,
    });
  } catch (error) {
    logRouteError('jarvis.request_log', error);
  }
}
