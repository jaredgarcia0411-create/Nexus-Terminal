import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agentMemoryV2 } from '@/lib/db/schema';
import type { AgentDb } from './db';
import type { AgentId, AgentMemoryRow, MemoryCategory } from './types';

export async function getMemory(
  db: AgentDb,
  userId: string,
  agentId: AgentId,
  category?: MemoryCategory,
): Promise<AgentMemoryRow[]> {
  const baseCondition = and(eq(agentMemoryV2.userId, userId), eq(agentMemoryV2.agentId, agentId));
  const condition = category ? and(baseCondition, eq(agentMemoryV2.category, category)) : baseCondition;

  const rows = await db.select()
    .from(agentMemoryV2)
    .where(condition);

  return rows as AgentMemoryRow[];
}

export async function upsertMemory(
  db: AgentDb,
  row: Omit<AgentMemoryRow, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
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
      expiresAt: row.expiresAt,
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
        expiresAt: row.expiresAt,
        updatedAt: new Date(),
      },
    });
}
