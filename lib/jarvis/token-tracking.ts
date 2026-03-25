import { logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisRequestLog } from '@/lib/db/schema';
import type { JarvisMode } from '@/lib/jarvis/types';

export interface TokenTrackingEntry {
  userId: string;
  mode: JarvisMode;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  success: boolean;
  sourceCount: number;
  chunkCount: number;
}

export async function logJarvisRequest(entry: TokenTrackingEntry): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(jarvisRequestLog).values({
      id: crypto.randomUUID(),
      userId: entry.userId,
      mode: entry.mode,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.inputTokens + entry.outputTokens,
      durationMs: entry.durationMs,
      success: entry.success ? 1 : 0,
      sourceCount: entry.sourceCount,
      chunkCount: entry.chunkCount,
    });
  } catch (error) {
    logRouteError('jarvis.token_tracking', error);
  }
}

export function estimateTokens(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
