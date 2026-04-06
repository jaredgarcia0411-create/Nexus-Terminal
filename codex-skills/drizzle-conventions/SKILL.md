---
name: drizzle-conventions
description: >
  Nexus Terminal Drizzle ORM patterns. Use when a change touches `lib/db.ts`,
  `lib/db/schema.ts`, migrations, or user-scoped queries in routes and helpers.
---

# Drizzle Conventions

Use this skill when database shape or query behavior is part of the task.

## Read First

- `lib/db.ts`
- `lib/db/schema.ts`
- `lib/server-db-utils.ts`
- the route, helper, or test you are changing

## Workflow

1. Choose the right client.
   - `getDb()` for reads and single-statement writes.
   - `getPoolDb()` for transactions, imports, and bulk writes.
   - Always guard `null` with `dbUnavailable()`.
2. Follow the protected-route pattern.
   - `const authState = await requireUser()`
   - `const db = getDb()` or `getPoolDb()`
   - `await ensureUser(db, authState.user)`
   - validate request bodies with `parseAndValidate(...)`
3. Keep queries tenant-safe.
   - User-owned tables must filter by `userId`.
   - Ownership checks usually look like `and(eq(table.userId, userId), eq(table.id, id))`.
   - Shared tables are rare and should be intentional. `askedgarCache` is the current example.
4. Match current schema style.
   - Keep schema definitions in `lib/db/schema.ts`.
   - User-scoped tables usually use composite primary keys or user-scoped unique constraints.
   - Foreign keys should cascade on delete.
   - Add indexes for common filters and sort keys.
5. Reuse Drizzle patterns already present here.
   - `onConflictDoUpdate` and `onConflictDoNothing` for idempotent writes.
   - `inArray` for batch ownership checks.
   - `table.$inferSelect` and `table.$inferInsert` for type-safe conversions.
6. Use transactions for multi-table writes.
   - Imports and bulk mutations should use `getPoolDb()` plus `db.transaction(...)`.
   - Keep parent and child deletes, inserts, and tag updates inside the same transaction.
   - Reuse batch-key or idempotency patterns when duplicate imports are possible.
7. Validate after DB work.
   - If schema changes are explicitly required, generate the matching migration.
   - Finish with `npm run lint`, `npx tsc --noEmit`, and `npm test`.

## Current Repo Reference Points

- `trades`, `tradeTags`, and `tradeImportBatches` in `lib/db/schema.ts` show the user-scoped composite-key pattern.
- `tradeExecutions` shows the composite foreign-key pattern back to `trades`.
- `loadTagsForTradeIds` in `lib/server-db-utils.ts` is the reference pattern for many-to-many tag loading.
- `app/api/trades/import/route.ts` and `app/api/trades/bulk/route.ts` are the reference bulk-write routes.

## Do Not

- Do not add schema changes without an explicit spec or request.
- Do not use `getPoolDb()` for simple reads.
- Do not omit `userId` scoping on owned data.
- Do not reach for raw SQL unless Drizzle cannot express the query cleanly.
- Do not create a second schema location or a new DB helper layer.
