---
name: drizzle-conventions
description: Load this skill when any change touches the database layer, schema, migrations, or queries. Contains Nexus Terminal Drizzle ORM patterns.
---

## Core Drizzle Patterns

### 1. Schema Design Patterns

**All tables in lib/db/schema.ts**:
- Use composite primary keys for user-scoped data: `(userId, id)`
- Define foreign keys with `onDelete: 'cascade'` for data integrity
- Add performance indexes for common query patterns

**Composite primary key example**:
```typescript
export const trades = pgTable('trades', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // ... other fields
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }), // Composite PK
  index('idx_trades_user_sort_key').on(table.userId, table.sortKey),
]);
```

**Foreign key with composite reference**:
```typescript
export const tradeExecutions = pgTable('trade_executions', {
  // ... fields
}, (table) => [
  foreignKey({
    columns: [table.userId, table.tradeId],
    foreignColumns: [trades.userId, trades.id], // Composite FK reference
  }).onDelete('cascade'),
]);
```

**Many-to-many junction table**:
```typescript
export const tradeTags = pgTable('trade_tags', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tradeId: text('trade_id').notNull(),
  tag: text('tag').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.tradeId, table.tag] }), // Triple composite PK
  foreignKey({
    columns: [table.userId, table.tradeId],
    foreignColumns: [trades.userId, trades.id],
  }).onDelete('cascade'),
]);
```

### 2. Database Client Patterns

**Two database clients**:
```typescript
// HTTP client for reads/single writes (most operations)
export function getDb() {
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzleHttp(sql, { schema });
  return db;
}

// Pool client for transactional/bulk writes (imports, bulk updates)
export function getPoolDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzleWs(pool, { schema });
  return db;
}
```

**Usage pattern**:
```typescript
// Regular operations
const db = getDb();
if (!db) return dbUnavailable();

// Bulk/transactional operations
const poolDb = getPoolDb();
if (!poolDb) return dbUnavailable();
await poolDb.transaction(async (tx) => {
  // Use tx for all operations
});
```

### 3. CRUD Operation Patterns

**SELECT with filtering**:
```typescript
// Single row with user scope
const [trade] = await db.select().from(trades)
  .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
  .limit(1);

// Multiple rows with ordering
const tradeRows = await db.select().from(trades)
  .where(eq(trades.userId, authState.user.id))
  .orderBy(desc(trades.date));
```

**SELECT specific columns**:
```typescript
const result = await db.select({ name: tagsTable.name })
  .from(tagsTable)
  .where(eq(tagsTable.userId, authState.user.id))
  .orderBy(asc(tagsTable.name));
```

**INSERT with upsert**:
```typescript
// Basic insert
await db.insert(trades).values({ 
  id: crypto.randomUUID(),
  userId: authState.user.id,
  // ... other values 
});

// Upsert with composite key target
await db.insert(trades).values({ /* values */ }).onConflictDoUpdate({
  target: [trades.userId, trades.id], // Composite key target
  set: { /* update fields */ },
});

// Do nothing on conflict
await db.insert(tagsTable).values({ userId, name: tag }).onConflictDoNothing();
```

**UPDATE with conditions**:
```typescript
await db.update(trades)
  .set({ initialRisk: risk })
  .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
```

**DELETE with conditions**:
```typescript
await db.delete(trades)
  .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
```

### 4. Transaction Patterns

**Basic transaction**:
```typescript
await db.transaction(async (tx) => {
  await tx.insert(trades).values({ /* ... */ });
  await tx.insert(tradeExecutions).values({ /* ... */ });
});
```

**Bulk import transaction**:
```typescript
await db.transaction(async (tx) => {
  for (const trade of normalizedTrades) {
    // Upsert trade
    await tx.insert(trades).values({ /* ... */ }).onConflictDoUpdate({
      target: [trades.userId, trades.id],
      set: { /* ... */ },
    });
    
    // Delete and re-insert child records
    await tx.delete(tradeExecutions).where(and(
      eq(tradeExecutions.userId, userId),
      eq(tradeExecutions.tradeId, trade.id),
    ));
    
    await tx.insert(tradeExecutions).values(executionRows);
    
    // Handle many-to-many relationships
    for (const tag of tags) {
      await tx.insert(tagsTable).values({ userId, name: tag }).onConflictDoNothing();
      await tx.insert(tradeTagsTable).values({ userId, tradeId: trade.id, tag }).onConflictDoNothing();
    }
  }
});
```

### 5. Many-to-Many Relationship Patterns

**Loading tags for multiple trades**:
```typescript
export async function loadTagsForTradeIds(db: QueryDb, userId: string, tradeIds: string[]) {
  if (tradeIds.length === 0) return new Map<string, string[]>();
  
  const rows = await db.select()
    .from(tradeTags)
    .where(and(eq(tradeTags.userId, userId), inArray(tradeTags.tradeId, tradeIds)));
  
  // Build tag map
  const tagMap = new Map<string, string[]>();
  for (const row of rows) {
    const list = tagMap.get(row.tradeId) ?? [];
    list.push(row.tag);
    tagMap.set(row.tradeId, list);
  }
  
  return tagMap;
}
```

**Managing tags with trades**:
```typescript
// Clear existing tags
await db.delete(tradeTagsTable).where(and(
  eq(tradeTagsTable.userId, userId),
  eq(tradeTagsTable.tradeId, tradeId),
));

// Add new tags
for (const tag of tags) {
  await db.insert(tradeTagsTable).values({
    userId,
    tradeId,
    tag,
  }).onConflictDoNothing();
  
  // Ensure tag exists in master tags table
  await db.insert(tagsTable).values({ userId, name: tag }).onConflictDoNothing();
}
```

### 6. Advanced Query Patterns

**Batch operations with `inArray`**:
```typescript
// Check ownership of multiple IDs
const ownedRows = await db.select({ id: trades.id })
  .from(trades)
  .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, uniqueIds)));
```

**SQL expressions for complex calculations**:
```typescript
import { sql } from 'drizzle-orm';

const [todayRow] = await db.select({
  totalRequests: sql<number>`count(*)::int`,
  totalTokens: sql<number>`coalesce(sum(${jarvisRequestLog.totalTokens}), 0)::int`,
  successCount: sql<number>`coalesce(sum(case when ${jarvisRequestLog.success} = 1 then 1 else 0 end), 0)::int`,
})
  .from(jarvisRequestLog)
  .where(sql`${jarvisRequestLog.createdAt} >= ${startOfTodayUtc}`);
```

**GROUP BY with aggregations**:
```typescript
const userBreakdownRows = await db.select({
  userId: jarvisRequestLog.userId,
  requestCount: sql<number>`count(*)::int`,
  totalTokens: sql<number>`coalesce(sum(${jarvisRequestLog.totalTokens}), 0)::int`,
})
  .from(jarvisRequestLog)
  .where(sql`${jarvisRequestLog.createdAt} >= ${startOfTodayUtc}`)
  .groupBy(jarvisRequestLog.userId)
  .orderBy(desc(sql<number>`coalesce(sum(${jarvisRequestLog.totalTokens}), 0)::int`));
```

### 7. Type Inference Patterns

**Using schema inference**:
```typescript
import * as schema from './db/schema';

// Type for insert values
const updateData: Partial<typeof trades.$inferInsert> = {};

// Type for selected rows  
function toTrade(row: typeof trades.$inferSelect, tags: string[] = []) {
  // row is typed based on schema
  return {
    id: row.id,
    userId: row.userId,
    // ... other fields
    tags,
  };
}
```

**Custom API types with conversion**:
```typescript
export type ApiTrade = {
  id: string;
  userId: string;
  // ... fields
  tags: string[];
  rawExecutions: Array<{ /* execution structure */ }>;
};

export function toTrade(
  row: typeof trades.$inferSelect,
  tags: string[] = [],
  rawExecutions: ApiTrade['rawExecutions'] = [],
): ApiTrade {
  return {
    id: row.id,
    userId: row.userId,
    // ... conversion
    tags,
    rawExecutions,
  };
}
```

### 8. Error Handling Patterns

**PostgreSQL error code handling**:
```typescript
function getPostgresErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const typed = error as { code?: unknown };
    if (typeof typed.code === 'string') {
      return typed.code;
    }
  }
  return undefined;
}

// Handle specific error codes
const code = getPostgresErrorCode(error);
const status = code === '23505' || code === '23514' ? 409 : // Conflict
               code === '23502' || code === '23503' || code === '22P02' ? 400 : // Bad request
               500; // Internal error
```

**Batch import conflict prevention**:
```typescript
// Using batch keys to prevent duplicate imports
if (batchKey) {
  const inserted = await tx.insert(tradeImportBatches)
    .values({ userId: authState.user.id, batchKey })
    .onConflictDoNothing()
    .returning({ batchKey: tradeImportBatches.batchKey });
  
  if (inserted.length === 0) {
    importSkipped = true;
    return; // Skip if batch already processed
  }
}
```

### 9. Performance Patterns

**Parallel data loading**:
```typescript
const [tagMap, executionRows] = await Promise.all([
  loadTagsForTradeIds(db, authState.user.id, tradeIds),
  tradeIds.length > 0
    ? db.select().from(tradeExecutions)
      .where(and(eq(tradeExecutions.userId, authState.user.id), inArray(tradeExecutions.tradeId, tradeIds)))
    : Promise.resolve([]),
]);
```

**Efficient batch operations**:
```typescript
// Instead of individual deletes
await db.delete(tradeTags).where(and(
  eq(tradeTags.userId, userId),
  eq(tradeTags.tradeId, tradeId),
));

// Use inArray for multiple IDs
await db.delete(tradeTags).where(and(
  eq(tradeTags.userId, userId),
  inArray(tradeTags.tradeId, tradeIdsToDelete),
));
```

### 10. Security Patterns

**Always scope queries by userId**:
```typescript
// EVERY query must include userId filter
.where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))

// Verify ownership before bulk operations
const ownedRows = await db.select({ id: trades.id })
  .from(trades)
  .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, uniqueIds)));
const ownedIds = ownedRows.map((row) => row.id);
// Only operate on ownedIds
```

## Complete Code Examples

**Trade creation with executions and tags**:
```typescript
const poolDb = getPoolDb();
if (!poolDb) return dbUnavailable();

await poolDb.transaction(async (tx) => {
  // Insert trade
  const [trade] = await tx.insert(trades)
    .values({
      id: crypto.randomUUID(),
      userId: authState.user.id,
      ticker: body.ticker.trim(),
      quantity: body.quantity,
      // ... other fields
    })
    .returning();

  // Insert executions
  if (body.executions?.length) {
    const executionRows = body.executions.map((exec) => ({
      id: crypto.randomUUID(),
      userId: authState.user.id,
      tradeId: trade.id,
      // ... execution fields
    }));
    
    await tx.insert(tradeExecutions).values(executionRows);
  }

  // Handle tags
  if (body.tags?.length) {
    for (const tag of body.tags) {
      await tx.insert(tagsTable).values({ 
        userId: authState.user.id, 
        name: tag 
      }).onConflictDoNothing();
      
      await tx.insert(tradeTagsTable).values({
        userId: authState.user.id,
        tradeId: trade.id,
        tag,
      }).onConflictDoNothing();
    }
  }
});
```

**Trade update with composite key upsert**:
```typescript
await db.insert(trades)
  .values({
    id: tradeId,
    userId: authState.user.id,
    ticker: updatedTicker,
    // ... updated fields
  })
  .onConflictDoUpdate({
    target: [trades.userId, trades.id], // Composite key
    set: {
      ticker: sql`excluded.ticker`,
      // ... other fields to update
    },
  });
```

## Do Not
- Do not use raw SQL unless Drizzle has no equivalent
- Do not omit `userId` filtering in any query
- Do not use Prisma syntax or suggest Prisma
- Do not edit schema without creating a corresponding migration
- Do not bypass transaction patterns for bulk operations
- Do not store sensitive data in JSONB fields without encryption
- Do not create queries without proper error handling
- Do not add new tables without updating lib/types.ts
- Do not break localStorage fallback when DATABASE_URL is not set
- Do not put server-side DB operations directly in route files (use lib/server-db-utils.ts)
