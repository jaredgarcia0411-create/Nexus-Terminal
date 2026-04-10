import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@/lib/db/schema';

// Node.js doesn't have a native WebSocket that @neondatabase/serverless
// can use. The `ws` package provides one so Pool connections work in Docker.
neonConfig.webSocketConstructor = ws;

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
