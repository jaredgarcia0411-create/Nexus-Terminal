import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agentMemoryV2 } from '@/lib/db/schema';
import type { AgentDb } from './db';
import type { AgentId, AgentMemoryRow, MemoryCategory } from './types';

// Default TTL in days per memory category.
// null = permanent (no automatic expiry).
// thesis, scan_param, watchlist have time-bounded relevance.
// All other categories default to null — update here if policy changes.
export const DEFAULT_MEMORY_TTL_DAYS: Record<MemoryCategory, number | null> = {
  thesis: 14,
  scan_param: 30,
  watchlist: 30,
  strategy_note: null,
  fact: null,
  performance: null,
  trade_insight: null,
  user_preference: null,
  macro_fact: null,
  pattern: null,
  sentiment: null,
};

export async function getMemory(
  db: AgentDb,
  userId: string,
  agentId: AgentId,
  category?: MemoryCategory,
): Promise<AgentMemoryRow[]> {
  // TTL filter: expiresAt IS NULL (permanent) OR expiresAt > now() (still active).
  // IMPORTANT: lt(expiresAt, now) alone would silently exclude all NULL rows because
  // SQL NULL comparisons return UNKNOWN (not TRUE). The or(isNull, gt) form is required.
  const ttlCondition = or(isNull(agentMemoryV2.expiresAt), gt(agentMemoryV2.expiresAt, new Date()));
  const baseCondition = and(
    eq(agentMemoryV2.userId, userId),
    eq(agentMemoryV2.agentId, agentId),
    ttlCondition,
  );
  const condition = category ? and(baseCondition, eq(agentMemoryV2.category, category)) : baseCondition;

  const rows = await db.select()
    .from(agentMemoryV2)
    .where(condition);

  return rows as AgentMemoryRow[];
}

export async function upsertMemory(
  db: AgentDb,
  row: Omit<AgentMemoryRow, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'> & { expiresAt?: Date | null },
): Promise<void> {
  // Resolve expiresAt:
  //   undefined -> apply category default from DEFAULT_MEMORY_TTL_DAYS
  //   null      -> permanent (caller explicitly requested no expiry)
  //   Date      -> use as-is (caller explicitly set expiry)
  let resolvedExpiresAt: Date | null;
  if (row.expiresAt !== undefined) {
    resolvedExpiresAt = row.expiresAt;
  } else {
    const ttlDays = DEFAULT_MEMORY_TTL_DAYS[row.category];
    resolvedExpiresAt = ttlDays !== null
      ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      : null;
  }

  await db.insert(agentMemoryV2)
    .values({
      id: randomUUID(),
      userId: row.userId,
      agentId: row.agentId,
      category: row.category,
      key: row.key,
      value: row.value,
      valueJson: row.valueJson,
      source: row.source,
      confidence: row.confidence,
      expiresAt: resolvedExpiresAt,
    })
    .onConflictDoUpdate({
      target: [
        agentMemoryV2.userId,
        agentMemoryV2.agentId,
        agentMemoryV2.category,
        agentMemoryV2.key,
      ],
      set: {
        value: row.value,
        valueJson: row.valueJson,
        source: row.source,
        confidence: row.confidence,
        expiresAt: resolvedExpiresAt,
        updatedAt: new Date(),
      },
    });
}
