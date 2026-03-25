import { neon, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './db/schema';

export type Db = NeonHttpDatabase<typeof schema>;
export type PoolDb = NeonDatabase<typeof schema>;

let httpDb: Db | null = null;
let poolDb: PoolDb | null = null;

/** HTTP-based client for reads and single-statement writes. */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!httpDb) {
    const sql = neon(process.env.DATABASE_URL);
    httpDb = drizzleHttp(sql, { schema });
  }

  return httpDb;
}

/** Pool-based client for transactional writes (bulk, import). */
export function getPoolDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!poolDb) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    poolDb = drizzleWs(pool, { schema });
  }

  return poolDb;
}
