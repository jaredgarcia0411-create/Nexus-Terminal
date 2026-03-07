import { readFileSync } from 'node:fs';
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

function findEntry(entries, tag) {
  return entries.find((entry) => entry.tag === tag) ?? null;
}

async function ensureMigrationBaseline() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  const entries = loadJournalEntries();
  const sql = neon(process.env.DATABASE_URL);

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
  await ensureMigrationBaseline();

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
