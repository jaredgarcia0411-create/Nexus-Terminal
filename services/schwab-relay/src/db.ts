import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from './schema.js';

type RelayDb = NeonHttpDatabase<typeof schema>;

let db: RelayDb | null = null;

export function getDb(): RelayDb {
  if (db) {
    return db;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL environment variable');
  }

  const sql = neon(databaseUrl);
  db = drizzle(sql, { schema });
  return db;
}

export type { RelayDb };
