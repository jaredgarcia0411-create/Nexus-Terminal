import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

function loadJournalEntries() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const journalPath = path.resolve(__dirname, '..', 'drizzle', 'meta', '_journal.json');
  const raw = readFileSync(journalPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error('Invalid drizzle/meta/_journal.json');
  }

  return parsed.entries;
}

function loadMigrationTags() {
  const migrationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
  return readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.replace(/\.sql$/, ''))
    .sort();
}

function parseMigrationPrefix(tag) {
  const match = /^([0-9]{4})_/.exec(tag);
  return match ? Number(match[1]) : null;
}

function validateJournal(entries, migrationTags) {
  const seenIdx = new Set();
  for (const entry of entries) {
    if (seenIdx.has(entry.idx)) {
      throw new Error(`Duplicate journal idx detected: ${entry.idx}`);
    }
    seenIdx.add(entry.idx);
  }

  const migrationTagSet = new Set(migrationTags);
  const journalSet = new Set(entries.map((entry) => entry.tag));
  const missingFiles = entries
    .map((entry) => entry.tag)
    .filter((tag) => !migrationTagSet.has(tag));

  if (missingFiles.length > 0) {
    throw new Error(`Missing migration SQL files for journal entries: ${missingFiles.join(', ')}`);
  }

  const extraFiles = migrationTags.filter((tag) => !journalSet.has(tag));
  if (extraFiles.length > 0) {
    console.warn(`[db-migrate-safe] SQL files not tracked in journal: ${extraFiles.join(', ')}`);
  }

  const seenPrefixes = new Map();
  for (const entry of entries) {
    const prefix = parseMigrationPrefix(entry.tag);
    if (prefix === null) {
      console.warn(`[db-migrate-safe] Journal tag '${entry.tag}' does not start with four-digit prefix`);
      continue;
  }
    seenPrefixes.set(prefix, (seenPrefixes.get(prefix) ?? 0) + 1);
  }

  const duplicatePrefixes = [...seenPrefixes.entries()].filter(([, count]) => count > 1);
  if (duplicatePrefixes.length > 0) {
    console.warn(
      `[db-migrate-safe] Duplicate migration numeric prefixes detected: ${duplicatePrefixes
        .map(([prefix, count]) => `${prefix} (${count})`)
        .join(', ')}`,
    );
  }

  const uniquePrefixes = [...seenPrefixes.keys()].filter((value) => value !== null).sort((a, b) => a - b);
  const gapWarnings = [];
  for (let i = 1; i < uniquePrefixes.length; i += 1) {
    if (uniquePrefixes[i] !== uniquePrefixes[i - 1] + 1) {
      gapWarnings.push(`${uniquePrefixes[i - 1]} -> ${uniquePrefixes[i]}`);
    }
  }
  if (gapWarnings.length > 0) {
    console.warn(`[db-migrate-safe] Migration prefix sequence has gaps: ${gapWarnings.join(', ')}`);
  }
}

async function validateSchemaState(sql) {
  const columnRows = await sql.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'users',
        'trades',
        'trade_executions',
        'trade_tags',
        'tags',
        'trade_import_batches',
        'broker_sync_log',
        'jarvis_source_urls'
      )
      and column_name in ('id', 'user_id', 'email')
  `);

  const usersIdType = columnRows.find((row) => row.table_name === 'users' && row.column_name === 'id')?.data_type;
  if (!usersIdType) {
    return;
  }

  const expected = usersIdType;
  const userIdRows = columnRows.filter((row) => row.column_name === 'user_id');
  const mismatchedUserIds = userIdRows.filter((row) => row.data_type !== expected);
  if (mismatchedUserIds.length > 0) {
    const detail = mismatchedUserIds
      .map((row) => `${row.table_name}.user_id=${row.data_type}`)
      .join(', ');
    throw new Error(`Schema type mismatch for user_id columns: ${detail}`);
  }

  const usersEmailColumn = columnRows.find((row) => row.table_name === 'users' && row.column_name === 'email');
  if (!usersEmailColumn) {
    throw new Error('users.email column is missing');
  }

  const uniqueIndexRows = await sql.query(`
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_schema = kcu.constraint_schema
      and tc.table_name = kcu.table_name
      and tc.constraint_name = kcu.constraint_name
    where tc.table_schema = 'public'
      and tc.table_name = 'users'
      and tc.constraint_type = 'UNIQUE'
      and kcu.column_name = 'email'
  `);

  if (!Array.isArray(uniqueIndexRows) || uniqueIndexRows.length === 0) {
    throw new Error('users.email does not have a UNIQUE constraint');
  }
}

function findEntry(entries, tag) {
  return entries.find((entry) => entry.tag === tag) ?? null;
}

async function ensureMigrationBaseline(sql) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  const entries = loadJournalEntries();
  validateJournal(entries, loadMigrationTags());
  await validateSchemaState(sql);

  await sql.query('create schema if not exists drizzle');
  await sql.query(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);

  const existingMigration = await sql.query(
    'select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
  );
  if (existingMigration.length > 0) {
    return;
  }

  const stateRows = await sql.query(`
    select
      to_regclass('public.users') is not null as has_users,
      to_regclass('public.trades') is not null as has_trades,
      to_regclass('public.tags') is not null as has_tags,
      to_regclass('public.trade_import_batches') is not null as has_trade_import_batches,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'users'
          and column_name = 'name'
      ) as has_users_name
  `);

  const state = stateRows[0] ?? {};
  const hasLegacyCoreSchema = state.has_users && state.has_trades && state.has_tags;
  if (!hasLegacyCoreSchema) {
    return;
  }

  const latestEntry = entries[entries.length - 1] ?? null;
  const migration0001 = findEntry(entries, '0001_nosy_nebula');
  const migration0000 = findEntry(entries, '0000_motionless_catseye');

  const baseline = state.has_trade_import_batches
    ? latestEntry
    : state.has_users_name
      ? migration0001
      : migration0000;

  if (!baseline) {
    throw new Error('Could not determine baseline migration entry');
  }

  await sql.query(
    'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
    [`baseline:${baseline.tag}`, baseline.when],
  );

  process.stdout.write(`Seeded drizzle baseline at ${baseline.tag}\n`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  const sql = neon(process.env.DATABASE_URL);
  await ensureMigrationBaseline(sql);

  const result = spawnSync('npx', ['drizzle-kit', 'migrate'], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
