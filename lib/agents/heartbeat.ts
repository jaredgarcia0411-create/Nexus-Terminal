import { writeFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { agentRegistry } from '@/lib/db/schema';
import type { AgentDb } from './db';
import type { AgentId } from './types';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const HEALTH_FILE_PATH = '/tmp/healthy';

export interface HeartbeatHandle {
  stop: () => Promise<void>;
}

async function writeHeartbeat(db: AgentDb, agentId: AgentId) {
  try {
    await db.update(agentRegistry)
      .set({
        lastHeartbeat: sql`now()`,
        status: 'online',
      })
      .where(eq(agentRegistry.id, agentId));
  } catch (error) {
    console.error(`agent heartbeat update failed for ${agentId}`, error);
  }

  try {
    writeFileSync(HEALTH_FILE_PATH, new Date().toISOString());
  } catch (error) {
    console.error(`agent heartbeat healthcheck touch failed for ${agentId}`, error);
  }
}

export function startHeartbeat(
  db: AgentDb,
  agentId: AgentId,
  intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
): HeartbeatHandle {
  const timer = setInterval(() => {
    void writeHeartbeat(db, agentId);
  }, intervalMs);

  return {
    stop: async () => {
      clearInterval(timer);
      await db.update(agentRegistry)
        .set({ status: 'offline' })
        .where(eq(agentRegistry.id, agentId));
    },
  };
}
