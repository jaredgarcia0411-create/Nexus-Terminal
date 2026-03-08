---
name: drizzle-conventions
description: Load this skill when any change touches the database layer, schema, migrations, or queries. Contains Nexus Terminal Drizzle ORM patterns.
---

## Schema Location
lib/db/schema.ts — all table definitions live here

## Tables
- users, trades, trade_tags, tags, schwab_tokens, broker_sync_log

## Patterns
- Use Drizzle ORM query syntax, not raw SQL
- Schema changes require a migration file — do not edit schema without a corresponding migration
- Connection is in lib/db.ts via @neondatabase/serverless
- Config in drizzle.config.ts
- Falls back to localStorage when DATABASE_URL is not set — do not break this fallback
- Server-side DB operations belong in lib/server-db-utils.ts, not in route files directly

## Do Not
- Do not use Prisma syntax or suggest Prisma
- Do not use raw pg or sql template literals unless Drizzle has no equivalent
- Do not add new tables without updating lib/types.ts to match
