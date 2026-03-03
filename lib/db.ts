import { neon, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './db/schema';

type LegacySqlArgs = { sql: string; args?: unknown[] };
type LegacyExecuteResult = { rows: Array<Record<string, unknown>>; lastInsertRowid?: number };
type SqlClient = { query: (queryWithPlaceholders: string, params?: any[]) => Promise<any> };
type DrizzleExecuteArg = Parameters<NeonHttpDatabase<typeof schema>['execute']>[0];
type DrizzleExecuteResult = ReturnType<NeonHttpDatabase<typeof schema>['execute']>;
type CompatExecute = {
  (query: LegacySqlArgs): Promise<LegacyExecuteResult>;
  (query: DrizzleExecuteArg): DrizzleExecuteResult;
};

export type Db = Omit<NeonHttpDatabase<typeof schema>, 'execute'> & {
  execute: CompatExecute;
};

export type PoolDb = NeonDatabase<typeof schema>;

let httpDb: Db | null = null;
let poolDb: PoolDb | null = null;

function toPgPlaceholders(sqlText: string) {
  let i = 0;
  return sqlText.replace(/\?/g, () => `$${++i}`);
}

function applyLegacyExecute(db: NeonHttpDatabase<typeof schema>, sqlClient: SqlClient): Db {
  const originalExecute = db.execute.bind(db);
  const compatDb = db as Db;

  compatDb.execute = (async (query: LegacySqlArgs | DrizzleExecuteArg) => {
    if (typeof query === 'object' && query !== null && 'sql' in query) {
      let sqlText = String(query.sql).replace(/datetime\('now'\)/g, 'now()');

      // Preserve previous insert-id behavior expected by existing discord alert route.
      if (/^\s*insert\s+into\s+price_alerts\b/i.test(sqlText) && !/\breturning\b/i.test(sqlText)) {
        sqlText = `${sqlText} RETURNING id`;
      }

      const mappedSql = toPgPlaceholders(sqlText);
      const rows = (await sqlClient.query(mappedSql, query.args ?? [])) as Array<Record<string, unknown>>;
      const result: LegacyExecuteResult = { rows };
      const firstId = rows[0]?.id;
      if (firstId != null) {
        result.lastInsertRowid = Number(firstId);
      }
      return result;
    }

    return originalExecute(query as DrizzleExecuteArg);
  }) as CompatExecute;

  return compatDb;
}

/** HTTP-based client for reads and single-statement writes. */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!httpDb) {
    const sql = neon(process.env.DATABASE_URL);
    const db = drizzleHttp(sql, { schema });
    httpDb = applyLegacyExecute(db, sql);
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
