import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from '@/lib/db/schema';

// Vercel provides its own WebSocket support, but plain Node.js (Docker)
// doesn't. Only load the `ws` package when running outside Vercel.
if (!process.env.VERCEL) {
  try {
    // Dynamic require so Vercel's bundler doesn't try to bundle ws
    const wsModule = require('ws');
    neonConfig.webSocketConstructor = wsModule.default ?? wsModule;
  } catch {
    // ws not available — running on Vercel or in a context that provides WebSocket natively
  }
}

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
