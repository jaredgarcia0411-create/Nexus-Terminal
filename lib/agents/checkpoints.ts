import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { agentJobCheckpoints, agentStepEffects } from '@/lib/db/schema';
import type { AgentDb } from './db';

export interface CheckpointRecord {
  jobId: string;
  stepIndex: number;
  stepName: string;
  checkpointJson: unknown;
}

export async function loadCheckpoint(
  db: AgentDb,
  jobId: string,
): Promise<CheckpointRecord | null> {
  const [row] = await db.select({
    jobId: agentJobCheckpoints.jobId,
    stepIndex: agentJobCheckpoints.stepIndex,
    stepName: agentJobCheckpoints.stepName,
    checkpointJson: agentJobCheckpoints.checkpointJson,
  })
    .from(agentJobCheckpoints)
    .where(eq(agentJobCheckpoints.jobId, jobId))
    .orderBy(desc(agentJobCheckpoints.stepIndex))
    .limit(1);

  return row ?? null;
}

export async function saveCheckpoint(
  db: AgentDb,
  record: CheckpointRecord,
): Promise<void> {
  await db.insert(agentJobCheckpoints)
    .values({
      id: randomUUID(),
      jobId: record.jobId,
      stepIndex: record.stepIndex,
      stepName: record.stepName,
      checkpointJson: record.checkpointJson,
    })
    .onConflictDoUpdate({
      target: [
        agentJobCheckpoints.jobId,
        agentJobCheckpoints.stepIndex,
      ],
      set: {
        stepName: record.stepName,
        checkpointJson: record.checkpointJson,
        updatedAt: new Date(),
      },
    });
}

export async function recordStepEffect(
  db: AgentDb,
  effect: {
    jobId: string;
    stepName: string;
    effectType: 'checkpoint-marker' | 'report-write' | 'discord-delivery' | 'memory-write';
    idempotencyKey: string;
  },
): Promise<boolean> {
  const rows = await db.insert(agentStepEffects)
    .values({
      id: randomUUID(),
      jobId: effect.jobId,
      stepName: effect.stepName,
      effectType: effect.effectType,
      idempotencyKey: effect.idempotencyKey,
    })
    .onConflictDoNothing({
      target: agentStepEffects.idempotencyKey,
    })
    .returning({ id: agentStepEffects.id });

  return rows.length > 0;
}
