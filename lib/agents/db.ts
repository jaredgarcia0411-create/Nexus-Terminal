import { Pool } from '@neondatabase/serverless';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from '@/lib/db/schema';

export type AgentDb = NeonDatabase<typeof schema>;

let agentDb: AgentDb | null = null;

export function getAgentDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!agentDb) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    agentDb = drizzleWs(pool, { schema });
  }

  return agentDb;
}
