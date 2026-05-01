# Nexus Terminal — HANDOFF.md

> Updated: 2026-05-01
> Purpose: active execution spec plus compact recent context. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

> Generated: 2026-05-01 | Agent: Claude (`nexus-handoff`)
> Status: IN PROGRESS — phases 1-3 implemented and validated locally on 2026-05-01; paused before phase 4 per checkpoint request.

# Build Spec — Backtest Manager Homepage Feature
> Generated: 2026-05-01 | Agent: nexus-architect
> Status: IN PROGRESS — checkpoint 1 complete (phases 1-3)

### Codex Checkpoint — 2026-05-01
- Complete: phase 1 schema + migration (`sample_sets`, `backtests`, `backtest_sessions.backtest_id`)
- Complete: phase 2 API routes (`/api/backtests*`, `/api/sample-sets*`, session route `backtestId` wiring, cross-user read access)
- Complete: phase 3 pure logic libs + tests (`lib/sample-set-csv.ts`, `lib/backtest-stats.ts`, `lib/backtest-filters.ts`)
- Validated locally: `npm run db:generate`, `npm run db:migrate`, `npm run lint`, `npx tsc --noEmit`, `npm test`
- Pending next checkpoint: phases 4-7 only

---

## 1. Objective

Add a "Backtest Manager" landing view to the Backtesting tab. Users land on a two-column dashboard listing all saved backtests and sample sets across all users. From there they can create backtests tied to sample sets, view aggregate stats for any backtest, or launch the existing chart/sim view inside a named backtest context. The chart view gains an active-backtest breadcrumb; saved reviews auto-attach to the active backtest when the current user owns it.

---

## 2. Implementation Phases

---

### Phase 1 — Schema + Migration

**Files to create / modify:**
- MODIFY `/home/jared/Nexus-Terminal/lib/db/schema.ts`

**Steps:**

1. Open `/home/jared/Nexus-Terminal/lib/db/schema.ts`. Confirm the existing top-level import line reads:
   ```ts
   import { pgTable, text, doublePrecision, integer, real, serial, timestamp, primaryKey, index, unique, foreignKey, jsonb, date, boolean } from 'drizzle-orm/pg-core';
   ```
   Add `uniqueIndex` to the destructured import list. The full import becomes:
   ```ts
   import { pgTable, text, doublePrecision, integer, real, serial, timestamp, primaryKey, index, uniqueIndex, unique, foreignKey, jsonb, date, boolean } from 'drizzle-orm/pg-core';
   ```
   Also add `randomUUID` from Node crypto — add this import at the top (after the drizzle import):
   ```ts
   import { randomUUID } from 'crypto';
   ```

2. Append the `sampleSets` table definition **before** `backtestSessions` (so the FK reference resolves in declaration order):
   ```ts
   export const sampleSets = pgTable('sample_sets', {
     id: text('id').primaryKey().$defaultFn(() => randomUUID()),
     userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
     name: text('name').notNull(),
     rows: jsonb('rows').$type<Array<{ ticker: string; date: string }>>().notNull().default([]),
     rowCount: integer('row_count').notNull().default(0),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
   }, (t) => [
     index('sample_sets_user_created_idx').on(t.userId, t.createdAt),
     uniqueIndex('sample_sets_user_name_idx').on(t.userId, t.name),
   ]);
   ```

3. Append the `backtests` table definition right after `sampleSets`:
   ```ts
   export const backtests = pgTable('backtests', {
     id: text('id').primaryKey().$defaultFn(() => randomUUID()),
     userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
     name: text('name').notNull(),
     description: text('description'),
     sampleSetId: text('sample_set_id').references(() => sampleSets.id, { onDelete: 'set null' }),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
   }, (t) => [
     index('backtests_user_created_idx').on(t.userId, t.createdAt),
     uniqueIndex('backtests_user_name_idx').on(t.userId, t.name),
   ]);
   ```

4. In the existing `backtestSessions` table definition, add two new fields after `updatedAt`:
   ```ts
   backtestId: text('backtest_id').references(() => backtests.id, { onDelete: 'set null' }),
   ```
   Then add a new index inside the `(t) => [...]` array for that table:
   ```ts
   index('backtest_sessions_user_backtest_idx').on(t.userId, t.backtestId),
   ```

5. Update `BacktestSession` interface in `/home/jared/Nexus-Terminal/lib/types.ts` — add the new nullable field:
   ```ts
   backtestId: string | null;
   ```

6. Generate and apply the migration. Run from repo root:
   ```
   npm run db:generate
   npm run db:migrate
   ```
   Confirm the migration file was created under `/home/jared/Nexus-Terminal/drizzle/`. Do NOT run `db:push`.

**Done when:** `npm run db:migrate` exits 0, `npx tsc --noEmit` passes on schema.ts, and `BacktestSession` in `lib/types.ts` includes `backtestId`.

---

### Phase 2 — API Routes

**Files to create:**
- `/home/jared/Nexus-Terminal/lib/validations/backtests.ts`
- `/home/jared/Nexus-Terminal/lib/validations/sample-sets.ts`
- `/home/jared/Nexus-Terminal/app/api/backtests/route.ts`
- `/home/jared/Nexus-Terminal/app/api/backtests/[id]/route.ts`
- `/home/jared/Nexus-Terminal/app/api/sample-sets/route.ts`
- `/home/jared/Nexus-Terminal/app/api/sample-sets/[id]/route.ts`
- `/home/jared/Nexus-Terminal/app/api/sample-sets/[id]/duplicate/route.ts`

**Files to modify:**
- `/home/jared/Nexus-Terminal/app/api/backtest/sessions/route.ts`
- `/home/jared/Nexus-Terminal/app/api/backtest/sessions/[id]/route.ts`

---

#### Step 2.1 — Zod validation files

Create `/home/jared/Nexus-Terminal/lib/validations/backtests.ts`:
```ts
import { z } from 'zod';

export const backtestCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or fewer'),
  description: z.string().trim().optional(),
  sampleSetId: z.string().trim().optional(),
});

export const backtestPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().nullable().optional(),
  sampleSetId: z.string().trim().nullable().optional(),
});

export type BacktestCreateBody = z.infer<typeof backtestCreateSchema>;
export type BacktestPatchBody = z.infer<typeof backtestPatchSchema>;
```

Create `/home/jared/Nexus-Terminal/lib/validations/sample-sets.ts`:
```ts
import { z } from 'zod';

const sampleSetRowSchema = z.object({
  ticker: z.string().trim().min(1).toUpperCase(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

export const sampleSetCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or fewer'),
  rows: z.array(sampleSetRowSchema).min(1, 'rows must not be empty'),
});

export const sampleSetPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

export const sampleSetDuplicateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
});

export type SampleSetCreateBody = z.infer<typeof sampleSetCreateSchema>;
export type SampleSetPatchBody = z.infer<typeof sampleSetPatchSchema>;
export type SampleSetDuplicateBody = z.infer<typeof sampleSetDuplicateSchema>;
```

---

#### Step 2.2 — `GET /api/sample-sets` and `POST /api/sample-sets`

Create `/home/jared/Nexus-Terminal/app/api/sample-sets/route.ts`. Follow the auth + db guard pattern from `/home/jared/Nexus-Terminal/app/api/backtest/sessions/route.ts`.

```ts
import { desc, eq, sql } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sampleSets, users } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetCreateSchema } from '@/lib/validations/sample-sets';

export async function GET(_request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    // Join to users to get ownerName. No userId filter — all users see all sets.
    const rows = await db
      .select({
        id: sampleSets.id,
        name: sampleSets.name,
        rowCount: sampleSets.rowCount,
        ownerId: sampleSets.userId,
        ownerName: users.name,
        createdAt: sampleSets.createdAt,
        updatedAt: sampleSets.updatedAt,
      })
      .from(sampleSets)
      .leftJoin(users, eq(sampleSets.userId, users.id))
      .orderBy(desc(sampleSets.updatedAt));

    return Response.json({ sampleSets: rows });
  } catch (error) {
    logRouteError('sample-sets.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, sampleSetCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    // Check for (userId, name) collision
    const [existing] = await db
      .select({ id: sampleSets.id })
      .from(sampleSets)
      .where(sql`${sampleSets.userId} = ${authState.user.id} AND lower(${sampleSets.name}) = lower(${body.name})`)
      .limit(1);

    if (existing) {
      return Response.json({ error: 'A sample set with that name already exists' }, { status: 409 });
    }

    const [created] = await db
      .insert(sampleSets)
      .values({
        userId: authState.user.id,
        name: body.name,
        rows: body.rows,
        rowCount: body.rows.length,
        updatedAt: new Date(),
      })
      .returning();

    return Response.json({ sampleSet: created }, { status: 201 });
  } catch (error) {
    logRouteError('sample-sets.post', error);
    return internalServerError();
  }
}
```

---

#### Step 2.3 — `GET /PATCH /DELETE /api/sample-sets/[id]`

Create `/home/jared/Nexus-Terminal/app/api/sample-sets/[id]/route.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sampleSets, users } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetPatchSchema } from '@/lib/validations/sample-sets';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [row] = await db
      .select()
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });

    return Response.json({ sampleSet: row });
  } catch (error) {
    logRouteError('sample-sets.id.get', error);
    return internalServerError();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const bodyState = await parseAndValidate(request, sampleSetPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [row] = await db
      .select({ id: sampleSets.id, userId: sampleSets.userId })
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const [updated] = await db
      .update(sampleSets)
      .set({ name: body.name, updatedAt: new Date() })
      .where(and(eq(sampleSets.id, id), eq(sampleSets.userId, authState.user.id)))
      .returning();

    return Response.json({ sampleSet: updated });
  } catch (error) {
    logRouteError('sample-sets.id.patch', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [row] = await db
      .select({ id: sampleSets.id, userId: sampleSets.userId })
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    await db.delete(sampleSets).where(and(eq(sampleSets.id, id), eq(sampleSets.userId, authState.user.id)));

    return Response.json({ deleted: true, id });
  } catch (error) {
    logRouteError('sample-sets.id.delete', error);
    return internalServerError();
  }
}
```

---

#### Step 2.4 — `POST /api/sample-sets/[id]/duplicate`

Create `/home/jared/Nexus-Terminal/app/api/sample-sets/[id]/duplicate/route.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sampleSets } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetDuplicateSchema } from '@/lib/validations/sample-sets';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const bodyState = await parseAndValidate(request, sampleSetDuplicateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [source] = await db
      .select()
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!source) return Response.json({ error: 'Sample set not found' }, { status: 404 });

    // Check name collision for target user
    const [collision] = await db
      .select({ id: sampleSets.id })
      .from(sampleSets)
      .where(sql`${sampleSets.userId} = ${authState.user.id} AND lower(${sampleSets.name}) = lower(${body.name})`)
      .limit(1);

    if (collision) return Response.json({ error: 'A sample set with that name already exists' }, { status: 409 });

    const [created] = await db
      .insert(sampleSets)
      .values({
        userId: authState.user.id,
        name: body.name,
        rows: source.rows,
        rowCount: source.rowCount,
        updatedAt: new Date(),
      })
      .returning();

    return Response.json({ sampleSet: created }, { status: 201 });
  } catch (error) {
    logRouteError('sample-sets.id.duplicate.post', error);
    return internalServerError();
  }
}
```

---

#### Step 2.5 — `GET /api/backtests` and `POST /api/backtests`

Create `/home/jared/Nexus-Terminal/app/api/backtests/route.ts`:

```ts
import { count, desc, eq, isNull, sql } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtests, backtestSessions, sampleSets, users } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestCreateSchema } from '@/lib/validations/backtests';

export async function GET(_request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    // Named backtests with review counts
    const rows = await db
      .select({
        id: backtests.id,
        name: backtests.name,
        description: backtests.description,
        sampleSetId: backtests.sampleSetId,
        sampleSetName: sampleSets.name,
        sampleSetExists: sql<boolean>`(${sampleSets.id} IS NOT NULL)`,
        ownerId: backtests.userId,
        ownerName: users.name,
        reviewCount: count(backtestSessions.id),
        createdAt: backtests.createdAt,
        updatedAt: backtests.updatedAt,
      })
      .from(backtests)
      .leftJoin(users, eq(backtests.userId, users.id))
      .leftJoin(sampleSets, eq(backtests.sampleSetId, sampleSets.id))
      .leftJoin(backtestSessions, eq(backtestSessions.backtestId, backtests.id))
      .groupBy(backtests.id, users.name, sampleSets.id)
      .orderBy(desc(backtests.updatedAt));

    // Synthetic "Uncategorized" entries: one per user who has sessions with backtestId IS NULL.
    // Query distinct userIds + count grouped by userId.
    const uncatRows = await db
      .select({
        userId: backtestSessions.userId,
        ownerName: users.name,
        reviewCount: count(backtestSessions.id),
      })
      .from(backtestSessions)
      .leftJoin(users, eq(backtestSessions.userId, users.id))
      .where(isNull(backtestSessions.backtestId))
      .groupBy(backtestSessions.userId, users.name);

    const uncategorized = uncatRows.map((row) => ({
      id: `uncat-${row.userId}`,
      name: 'Uncategorized',
      description: null,
      sampleSetId: null,
      sampleSetName: null,
      sampleSetExists: false,
      ownerId: row.userId,
      ownerName: row.ownerName,
      reviewCount: row.reviewCount,
      createdAt: null,
      updatedAt: null,
    }));

    return Response.json({ backtests: [...rows, ...uncategorized] });
  } catch (error) {
    logRouteError('backtests.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, backtestCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    // 409 on (userId, name) collision — case-insensitive
    const [existing] = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(sql`${backtests.userId} = ${authState.user.id} AND lower(${backtests.name}) = lower(${body.name})`)
      .limit(1);

    if (existing) return Response.json({ error: 'A backtest with that name already exists' }, { status: 409 });

    // If sampleSetId provided, confirm it exists
    if (body.sampleSetId) {
      const [ss] = await db
        .select({ id: sampleSets.id })
        .from(sampleSets)
        .where(eq(sampleSets.id, body.sampleSetId))
        .limit(1);
      if (!ss) return Response.json({ error: 'Sample set not found' }, { status: 404 });
    }

    const [created] = await db
      .insert(backtests)
      .values({
        userId: authState.user.id,
        name: body.name,
        description: body.description ?? null,
        sampleSetId: body.sampleSetId ?? null,
        updatedAt: new Date(),
      })
      .returning();

    return Response.json({ backtest: created }, { status: 201 });
  } catch (error) {
    logRouteError('backtests.post', error);
    return internalServerError();
  }
}
```

---

#### Step 2.6 — `GET /PATCH /DELETE /api/backtests/[id]`

Create `/home/jared/Nexus-Terminal/app/api/backtests/[id]/route.ts`:

`GET` returns full backtest detail plus all associated reviews (REVIEWED sessions) with their actions and joined `systemTickers` row by `(ticker, date)`. `PATCH` and `DELETE` are author-only.

```ts
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestActions, backtests, backtestSessions, sampleSets, systemTickers, users } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestPatchSchema } from '@/lib/validations/backtests';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;

    // Handle synthetic uncategorized id: "uncat-{userId}"
    if (id.startsWith('uncat-')) {
      const ownerId = id.slice(6);
      const [ownerRow] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1);

      const sessions = await db
        .select()
        .from(backtestSessions)
        .where(and(eq(backtestSessions.userId, ownerId), isNull(backtestSessions.backtestId), eq(backtestSessions.status, 'REVIEWED')))
        .orderBy(asc(backtestSessions.reviewedAt));

      const reviews = await Promise.all(sessions.map(async (session) => {
        const actions = await db
          .select()
          .from(backtestActions)
          .where(and(eq(backtestActions.userId, ownerId), eq(backtestActions.sessionId, session.id)))
          .orderBy(asc(backtestActions.sequence));

        const [ticker] = await db
          .select()
          .from(systemTickers)
          .where(and(eq(systemTickers.ticker, session.ticker), eq(systemTickers.date, session.date)))
          .limit(1);

        return { session, actions, systemTicker: ticker ?? null };
      }));

      return Response.json({
        backtest: {
          id,
          name: 'Uncategorized',
          description: null,
          sampleSetId: null,
          userId: ownerId,
          ownerId,
          ownerName: ownerRow?.name ?? null,
        },
        reviews,
      });
    }

    const [backtest] = await db
      .select({
        id: backtests.id,
        name: backtests.name,
        description: backtests.description,
        sampleSetId: backtests.sampleSetId,
        userId: backtests.userId,
        ownerId: backtests.userId,
        ownerName: users.name,
        sampleSetName: sampleSets.name,
        createdAt: backtests.createdAt,
        updatedAt: backtests.updatedAt,
      })
      .from(backtests)
      .leftJoin(users, eq(backtests.userId, users.id))
      .leftJoin(sampleSets, eq(backtests.sampleSetId, sampleSets.id))
      .where(eq(backtests.id, id))
      .limit(1);

    if (!backtest) return Response.json({ error: 'Backtest not found' }, { status: 404 });

    const sessions = await db
      .select()
      .from(backtestSessions)
      .where(and(eq(backtestSessions.backtestId, id), eq(backtestSessions.status, 'REVIEWED')))
      .orderBy(asc(backtestSessions.reviewedAt));

    const reviews = await Promise.all(sessions.map(async (session) => {
      const actions = await db
        .select()
        .from(backtestActions)
        .where(and(eq(backtestActions.userId, session.userId), eq(backtestActions.sessionId, session.id)))
        .orderBy(asc(backtestActions.sequence));

      const [ticker] = await db
        .select()
        .from(systemTickers)
        .where(and(eq(systemTickers.ticker, session.ticker), eq(systemTickers.date, session.date)))
        .limit(1);

      return { session, actions, systemTicker: ticker ?? null };
    }));

    return Response.json({ backtest, reviews });
  } catch (error) {
    logRouteError('backtests.id.get', error);
    return internalServerError();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const bodyState = await parseAndValidate(request, backtestPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [row] = await db
      .select({ id: backtests.id, userId: backtests.userId })
      .from(backtests)
      .where(eq(backtests.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Backtest not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (Object.prototype.hasOwnProperty.call(body, 'description')) updateData.description = body.description ?? null;
    if (Object.prototype.hasOwnProperty.call(body, 'sampleSetId')) updateData.sampleSetId = body.sampleSetId ?? null;

    const [updated] = await db
      .update(backtests)
      .set(updateData)
      .where(and(eq(backtests.id, id), eq(backtests.userId, authState.user.id)))
      .returning();

    return Response.json({ backtest: updated });
  } catch (error) {
    logRouteError('backtests.id.patch', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [row] = await db
      .select({ id: backtests.id, userId: backtests.userId })
      .from(backtests)
      .where(eq(backtests.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Backtest not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    // Deleting the container leaves reviews alive; their backtestId becomes NULL per FK ON DELETE SET NULL.
    await db.delete(backtests).where(and(eq(backtests.id, id), eq(backtests.userId, authState.user.id)));

    return Response.json({ deleted: true, id });
  } catch (error) {
    logRouteError('backtests.id.delete', error);
    return internalServerError();
  }
}
```

---

#### Step 2.7 — Update session routes for `backtestId`

In `/home/jared/Nexus-Terminal/app/api/backtest/sessions/route.ts`:

**POST handler changes:**
1. Add `backtestId` to the Zod import + schema. In the file, the schema is imported from `@/lib/validations/backtest`. Open that file (`/home/jared/Nexus-Terminal/lib/validations/backtest.ts`) and update `backtestSessionUpsertSchema` to include:
   ```ts
   backtestId: z.string().trim().nullable().optional(),
   ```
2. After parsing the body, if `body.backtestId` is provided (non-null), validate that the backtest exists AND `backtest.userId === authState.user.id`. If it does not exist, return 404. If it exists but belongs to another user, return 403 with `{ error: 'You can only auto-tag sessions to your own backtests' }`.
3. When inserting the new session, include `backtestId: body.backtestId ?? null` in the `.values({...})` call.
4. When updating an existing ACTIVE session, also update `backtestId` if it was provided.

**GET handler changes:**
- Remove the `eq(backtestSessions.userId, authState.user.id)` filter from the query to allow cross-user reads. Keep `ticker` + `date` filters. Keep `ensureUser` for auth.

In `/home/jared/Nexus-Terminal/app/api/backtest/sessions/[id]/route.ts`:

**GET handler changes:**
- Remove the `eq(backtestSessions.userId, authState.user.id)` condition from the session `.where()` clause. Change `where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, id)))` to `where(eq(backtestSessions.id, id))`. Similarly remove the userId filter on the actions query — keep only `eq(backtestActions.sessionId, id)`. Write operations (PATCH, DELETE) keep the userId guard unchanged.

**Done when:** All new route files exist, `npx tsc --noEmit` passes, each file follows the `requireUser` / `dbUnavailable` / `parseAndValidate` pattern.

---

### Phase 3 — Pure Logic Libraries + Tests

**Files to create:**
- `/home/jared/Nexus-Terminal/lib/sample-set-csv.ts`
- `/home/jared/Nexus-Terminal/lib/backtest-stats.ts`
- `/home/jared/Nexus-Terminal/lib/backtest-filters.ts`
- `/home/jared/Nexus-Terminal/__tests__/sample-set-csv.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/backtest-stats.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/backtest-filters.test.ts`

---

#### Step 3.1 — `lib/sample-set-csv.ts`

Extract `parseTradesCsv` from `BacktestingSidebar.tsx` into a standalone pure function. The existing implementation in the sidebar is the reference.

```ts
export type SampleSetRow = { ticker: string; date: string };

export type ParseSampleSetCsvResult = {
  rows: SampleSetRow[];
  skippedCount: number;
};

/**
 * Parse a CSV file that must have "ticker" and "date" columns (header names,
 * case-insensitive). Optional unnamed pandas index column is tolerated.
 * Returns valid rows and a count of rows that were skipped due to missing/invalid data.
 * Throws if the file has no "ticker" or "date" column header.
 */
export function parseSampleSetCsv(text: string): ParseSampleSetCsvResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], skippedCount: 0 };

  const header = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const tickerIdx = header.indexOf('ticker');
  const dateIdx = header.indexOf('date');

  if (tickerIdx < 0 || dateIdx < 0) {
    throw new Error('CSV must include "ticker" and "date" columns');
  }

  const rows: SampleSetRow[] = [];
  let skippedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const ticker = (cols[tickerIdx] ?? '').toUpperCase();
    const date = cols[dateIdx] ?? '';
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skippedCount++;
      continue;
    }
    rows.push({ ticker, date });
  }

  return { rows, skippedCount };
}
```

---

#### Step 3.2 — `lib/backtest-stats.ts`

```ts
import type { BacktestAction, BacktestSession } from '@/lib/types';

// Shape of a single systemTickers row as relevant to stats computation.
export type SystemTickerForStats = {
  grade: string | null;
  setupType: string | null;
  day1GapPct: number | null;
};

export type ReviewStats = {
  realizedPnl: number;
  rMultiple: number | null;
  direction: 'LONG' | 'SHORT' | null;
  holdMinutes: number | null;
  gapPct: number | null;
  grade: string | null;
  setupType: string | null;
};

export type ReviewWithStats = {
  session: BacktestSession;
  actions: BacktestAction[];
  stats: ReviewStats;
  systemTicker: SystemTickerForStats | null;
};

export type EquityPoint = { date: string; cumulativePnl: number };

export type AggregateStats = {
  totalReturn: number;
  winRate: number;      // 0–1
  profitFactor: number | null;  // null if no losses
  expectancyR: number | null;   // mean rMultiple; null if no rMultiple computable
  maxDrawdown: number;  // negative number or 0
  totalTrades: number;
  equityCurve: EquityPoint[];
};

/**
 * Compute per-review stats from a single session + its actions.
 * `riskDollars` comes from session.riskDollars.
 * `direction` is inferred from the first action's actionType ('LONG' | 'SHORT' | null).
 * `holdMinutes` is computed from the first action's barTime to the last exit barTime.
 * `realizedPnl` is recomputed from actions (not trusted from session — sessions
 *   store no PnL column directly; use the same logic as BacktestSimPanel).
 */
export function computeReviewStats(
  session: BacktestSession,
  actions: BacktestAction[],
  systemTicker: SystemTickerForStats | null,
): ReviewStats {
  if (actions.length === 0) {
    return {
      realizedPnl: 0,
      rMultiple: null,
      direction: null,
      holdMinutes: null,
      gapPct: systemTicker?.day1GapPct ?? null,
      grade: systemTicker?.grade ?? null,
      setupType: systemTicker?.setupType ?? null,
    };
  }

  // Determine direction from first buy/short action
  const firstAction = actions[0];
  const direction: 'LONG' | 'SHORT' | null =
    firstAction.actionType === 'LONG' || firstAction.actionType === 'LONG_ADD'
      ? 'LONG'
      : firstAction.actionType === 'SHORT' || firstAction.actionType === 'SHORT_ADD'
      ? 'SHORT'
      : null;

  // Compute realized PnL: sum of (exit - entry) * shares for LONG, (entry - exit) * shares for SHORT.
  // Use simple running position approach matching the existing backtest-math logic.
  let totalCost = 0;     // sum of entry shares * price
  let totalShares = 0;   // current open shares
  let realizedPnl = 0;
  let avgEntry = 0;

  for (const action of actions) {
    if (action.actionType === 'LONG' || action.actionType === 'LONG_ADD') {
      totalCost += action.shares * action.price;
      totalShares += action.shares;
      avgEntry = totalCost / totalShares;
    } else if (action.actionType === 'SELL') {
      realizedPnl += (action.price - avgEntry) * action.shares;
      totalShares -= action.shares;
      totalCost = avgEntry * totalShares;
    } else if (action.actionType === 'SHORT' || action.actionType === 'SHORT_ADD') {
      totalCost += action.shares * action.price;
      totalShares += action.shares;
      avgEntry = totalCost / totalShares;
    } else if (action.actionType === 'COVER') {
      realizedPnl += (avgEntry - action.price) * action.shares;
      totalShares -= action.shares;
      totalCost = avgEntry * totalShares;
    }
  }

  const rMultiple = session.riskDollars > 0 ? realizedPnl / session.riskDollars : null;

  // Hold minutes: from first barTime to last exit barTime
  let holdMinutes: number | null = null;
  const exitActions = actions.filter((a) => a.actionType === 'SELL' || a.actionType === 'COVER');
  if (exitActions.length > 0 && actions.length > 0) {
    const t0 = Date.parse(actions[0].barTime);
    const t1 = Date.parse(exitActions[exitActions.length - 1].barTime);
    if (Number.isFinite(t0) && Number.isFinite(t1)) {
      holdMinutes = Math.round((t1 - t0) / 60_000);
    }
  }

  return {
    realizedPnl,
    rMultiple,
    direction,
    holdMinutes,
    gapPct: systemTicker?.day1GapPct ?? null,
    grade: systemTicker?.grade ?? null,
    setupType: systemTicker?.setupType ?? null,
  };
}

/**
 * Aggregate stats across all reviews.
 * Equity curve is sorted by trade date ASC (session.date field, YYYY-MM-DD).
 */
export function computeAggregateStats(reviews: ReviewWithStats[]): AggregateStats {
  if (reviews.length === 0) {
    return {
      totalReturn: 0,
      winRate: 0,
      profitFactor: null,
      expectancyR: null,
      maxDrawdown: 0,
      totalTrades: 0,
      equityCurve: [],
    };
  }

  // Sort by trade date ASC for equity curve
  const sorted = [...reviews].sort((a, b) => a.session.date.localeCompare(b.session.date));

  let cumPnl = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let winners = 0;
  let rMultipleSum = 0;
  let rMultipleCount = 0;

  const equityCurve: EquityPoint[] = [];

  for (const r of sorted) {
    const pnl = r.stats.realizedPnl;
    cumPnl += pnl;
    equityCurve.push({ date: r.session.date, cumulativePnl: cumPnl });

    if (pnl > 0) { grossWins += pnl; winners++; }
    if (pnl < 0) { grossLosses += Math.abs(pnl); }

    if (r.stats.rMultiple !== null) {
      rMultipleSum += r.stats.rMultiple;
      rMultipleCount++;
    }

    if (cumPnl > peak) peak = cumPnl;
    const drawdown = cumPnl - peak;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  return {
    totalReturn: cumPnl,
    winRate: reviews.length > 0 ? winners / reviews.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    expectancyR: rMultipleCount > 0 ? rMultipleSum / rMultipleCount : null,
    maxDrawdown,
    totalTrades: reviews.length,
    equityCurve,
  };
}
```

---

#### Step 3.3 — `lib/backtest-filters.ts`

```ts
import type { ReviewWithStats } from '@/lib/backtest-stats';

export type FilterDef = {
  id: string;
  label: string;
  group: string;
  predicate: (r: ReviewWithStats) => boolean;
};

// Static filters. Dynamic grade/setup filters are generated at runtime in the hook.
// DEFERRED: 'broke_premarket_high' filter — data not captured today (no premarket high
// field in systemTickers or backtestActions). Add when data source is available.
export const FILTER_REGISTRY: FilterDef[] = [
  { id: 'winners',   label: 'Winners',   group: 'outcome',    predicate: (r) => r.stats.realizedPnl > 0 },
  { id: 'losers',    label: 'Losers',    group: 'outcome',    predicate: (r) => r.stats.realizedPnl < 0 },
  { id: 'long',      label: 'Long',      group: 'direction',  predicate: (r) => r.stats.direction === 'LONG' },
  { id: 'short',     label: 'Short',     group: 'direction',  predicate: (r) => r.stats.direction === 'SHORT' },
  { id: 'gap-up',    label: 'Gap Up',    group: 'gap',        predicate: (r) => (r.stats.gapPct ?? 0) > 0 },
  { id: 'gap-down',  label: 'Gap Down',  group: 'gap',        predicate: (r) => (r.stats.gapPct ?? 0) < 0 },
];

/** Apply all active filter IDs with AND logic. Dynamic filters (grade/setup) are passed in separately. */
export function applyFilters(
  reviews: ReviewWithStats[],
  activeFilterIds: Set<string>,
  dynamicFilters: FilterDef[],
): ReviewWithStats[] {
  if (activeFilterIds.size === 0) return reviews;
  const allFilters = [...FILTER_REGISTRY, ...dynamicFilters];
  return reviews.filter((r) =>
    [...activeFilterIds].every((id) => {
      const def = allFilters.find((f) => f.id === id);
      return def ? def.predicate(r) : true;
    }),
  );
}

/** Build dynamic filter defs for grade values present in the loaded reviews. */
export function buildGradeFilters(reviews: ReviewWithStats[]): FilterDef[] {
  const grades = [...new Set(reviews.map((r) => r.stats.grade).filter((g): g is string => g !== null))].sort();
  return grades.map((g) => ({
    id: `grade-${g}`,
    label: `Grade ${g}`,
    group: 'grade',
    predicate: (r) => r.stats.grade === g,
  }));
}

/** Build dynamic filter defs for setup type values present in the loaded reviews. */
export function buildSetupFilters(reviews: ReviewWithStats[]): FilterDef[] {
  const setups = [...new Set(reviews.map((r) => r.stats.setupType).filter((s): s is string => s !== null))].sort();
  return setups.map((s) => ({
    id: `setup-${s}`,
    label: s,
    group: 'setup',
    predicate: (r) => r.stats.setupType === s,
  }));
}
```

---

#### Step 3.4 — Tests for Phase 3 libs

Create `/home/jared/Nexus-Terminal/__tests__/sample-set-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSampleSetCsv } from '@/lib/sample-set-csv';

describe('parseSampleSetCsv', () => {
  it('parses valid rows', () => {
    const csv = 'ticker,date\nAAPL,2024-01-01\nMSFT,2024-01-02';
    const { rows, skippedCount } = parseSampleSetCsv(csv);
    expect(rows).toEqual([
      { ticker: 'AAPL', date: '2024-01-01' },
      { ticker: 'MSFT', date: '2024-01-02' },
    ]);
    expect(skippedCount).toBe(0);
  });

  it('uppercases tickers', () => {
    const { rows } = parseSampleSetCsv('ticker,date\naapl,2024-01-01');
    expect(rows[0].ticker).toBe('AAPL');
  });

  it('skips rows with invalid date format and counts them', () => {
    const csv = 'ticker,date\nAAPL,01-01-2024\nMSFT,2024-01-02';
    const { rows, skippedCount } = parseSampleSetCsv(csv);
    expect(rows).toHaveLength(1);
    expect(skippedCount).toBe(1);
  });

  it('skips rows with empty ticker', () => {
    const csv = 'ticker,date\n,2024-01-01\nMSFT,2024-01-02';
    const { skippedCount } = parseSampleSetCsv(csv);
    expect(skippedCount).toBe(1);
  });

  it('throws if ticker column missing', () => {
    expect(() => parseSampleSetCsv('symbol,date\nAAPL,2024-01-01')).toThrow('ticker');
  });

  it('handles BOM prefix', () => {
    const csv = '\uFEFFticker,date\nAAPL,2024-01-01';
    const { rows } = parseSampleSetCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it('returns zero rows and zero skipped for empty input', () => {
    const { rows, skippedCount } = parseSampleSetCsv('');
    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(0);
  });
});
```

Create `/home/jared/Nexus-Terminal/__tests__/backtest-stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeReviewStats, computeAggregateStats, type ReviewWithStats } from '@/lib/backtest-stats';
import type { BacktestSession, BacktestAction } from '@/lib/types';

function makeSession(overrides: Partial<BacktestSession> = {}): BacktestSession {
  return {
    id: 's1', userId: 'u1', ticker: 'AAPL', date: '2024-01-02',
    status: 'REVIEWED', riskDollars: 100, label: null, notes: null,
    backtestId: null, reviewedAt: null, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), ...overrides,
  };
}

function makeAction(overrides: Partial<BacktestAction>): BacktestAction {
  return {
    id: 'a1', userId: 'u1', sessionId: 's1',
    actionType: 'LONG', price: 100, shares: 10, stopPrice: null,
    barTime: '2024-01-02T09:30:00Z', sequence: 1, createdAt: new Date().toISOString(), ...overrides,
  };
}

describe('computeReviewStats', () => {
  it('returns zero pnl for no actions', () => {
    const stats = computeReviewStats(makeSession(), [], null);
    expect(stats.realizedPnl).toBe(0);
    expect(stats.rMultiple).toBeNull();
  });

  it('computes LONG realized pnl correctly', () => {
    const session = makeSession({ riskDollars: 100 });
    const actions = [
      makeAction({ actionType: 'LONG', price: 100, shares: 10, barTime: '2024-01-02T09:30:00Z', sequence: 1 }),
      makeAction({ id: 'a2', actionType: 'SELL', price: 110, shares: 10, barTime: '2024-01-02T09:45:00Z', sequence: 2 }),
    ];
    const stats = computeReviewStats(session, actions, null);
    expect(stats.realizedPnl).toBeCloseTo(100); // (110-100)*10
    expect(stats.rMultiple).toBeCloseTo(1);     // 100/100
    expect(stats.direction).toBe('LONG');
    expect(stats.holdMinutes).toBe(15);
  });

  it('computes SHORT realized pnl correctly', () => {
    const session = makeSession({ riskDollars: 100 });
    const actions = [
      makeAction({ actionType: 'SHORT', price: 100, shares: 10, barTime: '2024-01-02T09:30:00Z', sequence: 1 }),
      makeAction({ id: 'a2', actionType: 'COVER', price: 90, shares: 10, barTime: '2024-01-02T10:00:00Z', sequence: 2 }),
    ];
    const stats = computeReviewStats(session, actions, null);
    expect(stats.realizedPnl).toBeCloseTo(100);
    expect(stats.direction).toBe('SHORT');
  });

  it('surfaces systemTicker fields', () => {
    const stats = computeReviewStats(makeSession(), [], { grade: 'A', setupType: 'RVOL', day1GapPct: 5.5 });
    expect(stats.grade).toBe('A');
    expect(stats.setupType).toBe('RVOL');
    expect(stats.gapPct).toBe(5.5);
  });
});

describe('computeAggregateStats', () => {
  function makeReview(date: string, pnl: number, rMultiple: number | null = null): ReviewWithStats {
    return {
      session: makeSession({ date }),
      actions: [],
      stats: { realizedPnl: pnl, rMultiple, direction: 'LONG', holdMinutes: 10, gapPct: null, grade: null, setupType: null },
      systemTicker: null,
    };
  }

  it('returns empty stats for no reviews', () => {
    const stats = computeAggregateStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.equityCurve).toHaveLength(0);
  });

  it('sorts equity curve by date ASC', () => {
    const reviews = [
      makeReview('2024-01-03', 50),
      makeReview('2024-01-01', 100),
      makeReview('2024-01-02', -30),
    ];
    const { equityCurve } = computeAggregateStats(reviews);
    expect(equityCurve[0].date).toBe('2024-01-01');
    expect(equityCurve[1].date).toBe('2024-01-02');
    expect(equityCurve[2].date).toBe('2024-01-03');
    expect(equityCurve[2].cumulativePnl).toBeCloseTo(120);
  });

  it('computes profit factor', () => {
    const reviews = [makeReview('2024-01-01', 100), makeReview('2024-01-02', -50)];
    const { profitFactor } = computeAggregateStats(reviews);
    expect(profitFactor).toBeCloseTo(2);
  });

  it('returns null profit factor when no losses', () => {
    const reviews = [makeReview('2024-01-01', 100)];
    const { profitFactor } = computeAggregateStats(reviews);
    expect(profitFactor).toBeNull();
  });

  it('computes expectancyR as mean rMultiple', () => {
    const reviews = [makeReview('2024-01-01', 100, 1), makeReview('2024-01-02', -50, -0.5)];
    const { expectancyR } = computeAggregateStats(reviews);
    expect(expectancyR).toBeCloseTo(0.25);
  });

  it('computes maxDrawdown', () => {
    const reviews = [
      makeReview('2024-01-01', 100),
      makeReview('2024-01-02', -150),
      makeReview('2024-01-03', 200),
    ];
    const { maxDrawdown } = computeAggregateStats(reviews);
    expect(maxDrawdown).toBeCloseTo(-50);
  });

  it('computes winRate', () => {
    const reviews = [makeReview('2024-01-01', 100), makeReview('2024-01-02', -50), makeReview('2024-01-03', 30)];
    const { winRate } = computeAggregateStats(reviews);
    expect(winRate).toBeCloseTo(2 / 3);
  });
});
```

Create `/home/jared/Nexus-Terminal/__tests__/backtest-filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FILTER_REGISTRY, applyFilters, buildGradeFilters, buildSetupFilters } from '@/lib/backtest-filters';
import type { ReviewWithStats } from '@/lib/backtest-stats';

function makeReview(overrides: Partial<ReviewWithStats['stats']> = {}): ReviewWithStats {
  return {
    session: { id: 's1', userId: 'u1', ticker: 'AAPL', date: '2024-01-01',
      status: 'REVIEWED', riskDollars: 100, label: null, notes: null,
      backtestId: null, reviewedAt: null, createdAt: '', updatedAt: '' },
    actions: [],
    stats: {
      realizedPnl: 0, rMultiple: null, direction: 'LONG', holdMinutes: null,
      gapPct: null, grade: null, setupType: null, ...overrides,
    },
    systemTicker: null,
  };
}

describe('FILTER_REGISTRY predicates', () => {
  it('winners filters positive pnl', () => {
    const f = FILTER_REGISTRY.find((f) => f.id === 'winners')!;
    expect(f.predicate(makeReview({ realizedPnl: 100 }))).toBe(true);
    expect(f.predicate(makeReview({ realizedPnl: -50 }))).toBe(false);
  });

  it('losers filters negative pnl', () => {
    const f = FILTER_REGISTRY.find((f) => f.id === 'losers')!;
    expect(f.predicate(makeReview({ realizedPnl: -50 }))).toBe(true);
    expect(f.predicate(makeReview({ realizedPnl: 100 }))).toBe(false);
  });

  it('long filters direction', () => {
    const f = FILTER_REGISTRY.find((f) => f.id === 'long')!;
    expect(f.predicate(makeReview({ direction: 'LONG' }))).toBe(true);
    expect(f.predicate(makeReview({ direction: 'SHORT' }))).toBe(false);
  });

  it('gap-up filters positive gapPct', () => {
    const f = FILTER_REGISTRY.find((f) => f.id === 'gap-up')!;
    expect(f.predicate(makeReview({ gapPct: 3.5 }))).toBe(true);
    expect(f.predicate(makeReview({ gapPct: -2 }))).toBe(false);
  });
});

describe('applyFilters', () => {
  it('returns all reviews when no filters active', () => {
    const reviews = [makeReview({ realizedPnl: 100 }), makeReview({ realizedPnl: -50 })];
    expect(applyFilters(reviews, new Set(), [])).toHaveLength(2);
  });

  it('AND-combines multiple filters', () => {
    const reviews = [
      makeReview({ realizedPnl: 100, direction: 'LONG' }),
      makeReview({ realizedPnl: 100, direction: 'SHORT' }),
      makeReview({ realizedPnl: -50, direction: 'LONG' }),
    ];
    const result = applyFilters(reviews, new Set(['winners', 'long']), []);
    expect(result).toHaveLength(1);
    expect(result[0].stats.direction).toBe('LONG');
    expect(result[0].stats.realizedPnl).toBe(100);
  });
});

describe('buildGradeFilters', () => {
  it('builds filters for unique grades', () => {
    const reviews = [makeReview({ grade: 'A' }), makeReview({ grade: 'B' }), makeReview({ grade: 'A' })];
    const filters = buildGradeFilters(reviews);
    expect(filters.map((f) => f.id)).toEqual(['grade-A', 'grade-B']);
    expect(filters[0].predicate(makeReview({ grade: 'A' }))).toBe(true);
  });
});
```

---

### Phase 4 — Manager View + Dialogs + Hook

**Files to create:**
- `/home/jared/Nexus-Terminal/hooks/use-backtest-manager.ts`
- `/home/jared/Nexus-Terminal/components/trading/BacktestManagerView.tsx`
- `/home/jared/Nexus-Terminal/components/trading/NewBacktestDialog.tsx`
- `/home/jared/Nexus-Terminal/components/trading/AddSampleSetDialog.tsx`
- `/home/jared/Nexus-Terminal/components/trading/EditBacktestDialog.tsx`

---

#### Step 4.1 — `hooks/use-backtest-manager.ts`

```ts
// Shape exposed by the hook
export type BacktestListItem = {
  id: string;
  name: string;
  description: string | null;
  sampleSetId: string | null;
  sampleSetName: string | null;
  sampleSetExists: boolean;
  ownerId: string;
  ownerName: string | null;
  reviewCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SampleSetListItem = {
  id: string;
  name: string;
  rowCount: number;
  ownerId: string;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
};
```

The hook fetches `/api/backtests` and `/api/sample-sets` in parallel on mount. It exposes:
- `backtests: BacktestListItem[]` — all entries including synthetic Uncategorized rows
- `sampleSets: SampleSetListItem[]`
- `isLoading: boolean`
- `error: string | null`
- `refetch: () => void` — re-fetch both lists
- `backtestSearch: string`, `setSampleSetSearch: (v: string) => void`, `sampleSetSearch: string`, `setBacktestSearch: (v: string) => void`
- `mineOnly: boolean`, `setMineOnly: (v: boolean) => void`
- `sortKey: 'updatedAt' | 'createdAt' | 'name' | 'author'`, `setSortKey: (k: ...) => void`
- `filteredBacktests: BacktestListItem[]` — derived (search + mineOnly + sort applied)
- `filteredSampleSets: SampleSetListItem[]` — derived (search applied)
- `currentUserId: string | null` — from session (fetch `/api/auth/session` or use `useSession()` from next-auth/react)
- `createBacktest(body): Promise<BacktestListItem>` — POST `/api/backtests`, then refetch
- `deleteBacktest(id): Promise<void>` — DELETE `/api/backtests/[id]`, then refetch
- `createSampleSet(body): Promise<SampleSetListItem>` — POST `/api/sample-sets`, then refetch
- `deleteSampleSet(id): Promise<void>` — DELETE `/api/sample-sets/[id]`, then refetch
- `duplicateSampleSet(id, name): Promise<SampleSetListItem>` — POST `/api/sample-sets/[id]/duplicate`, then refetch
- `updateBacktest(id, body): Promise<BacktestListItem>` — PATCH `/api/backtests/[id]`, then refetch

Use `useSession` from `next-auth/react` to get the current user ID for `mineOnly` filtering and ownership checks in the UI.

For `mineOnly` filtering: filter `backtests` where `ownerId === currentUserId`. The synthetic Uncategorized entries have `ownerId` set to the original userId, so this works transparently.

Sort logic for `filteredBacktests`:
- `updatedAt DESC`: sort by `updatedAt` descending (null last)
- `createdAt DESC`: sort by `createdAt` descending (null last)
- `name ASC`: alphabetical
- `author ASC`: by `ownerName`

---

#### Step 4.2 — `components/trading/BacktestManagerView.tsx`

This is a client component. Props:
```ts
interface BacktestManagerViewProps {
  onLaunchChart: (backtestId: string | null, ticker: string, date: string) => void;
  onViewStats: (backtestId: string) => void;
}
```

Use `use-backtest-manager` hook internally. Layout:
- Full-height flex column matching the existing tab's `h-[calc(100dvh-6.5rem)] min-h-[620px]` class.
- Header row: "Backtest Manager" `h2` text (font-mono, text-white) + "+ New Backtest" button (top right, `bg-emerald-500 text-black hover:bg-emerald-400`).
- Two-column grid below: left = Saved Backtests, right = Sample Sets.
- Left column header: search input + "Mine only" toggle (`<input type="checkbox">` styled as a small toggle, or use a shadcn `Switch`) + sort `<select>` dropdown (options: Last updated / Created / Name / Author).
- Right column header: "Sample Sets" label + "+ Add Sample" button.
- Each backtest card: name, author badge (`by [ownerName]` in zinc-500), review count, sample set name (or "No sample set" in zinc-500 if null), `updatedAt` relative time. Two buttons: "View Stats" and "Launch Chart". For Uncategorized rows: show "View Stats" only (no "Launch Chart"). Author-only: kebab menu with Edit and Delete.
- Uncategorized cards: render them last in the list regardless of sort (push synthetic rows to the bottom always). Identify them by `id.startsWith('uncat-')`.
- Empty state for Backtests column: if no entries after filter, render "No backtests yet. Create one to get started." in zinc-500.
- Empty state for Sample Sets column: "No sample sets yet. Add one to import a trade list."
- Bottom of left column: Sync Sheet button (trigger file input, same logic as the existing `handleSyncSheetFile` in `BacktestingSidebar.tsx` — copy or import that logic).
- Sync Sheet and file input hidden `<input>` live at the bottom of the left column.
- Sample set card: name, row count, author, buttons: "Duplicate" (anyone), "Delete" (author only via ownership check against `currentUserId`).

NewBacktestDialog, AddSampleSetDialog, EditBacktestDialog are modal overlays rendered inside this component.

---

#### Step 4.3 — `components/trading/NewBacktestDialog.tsx`

Props:
```ts
interface NewBacktestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleSets: SampleSetListItem[];
  onSubmit: (body: { name: string; description?: string; sampleSetId?: string }) => Promise<void>;
}
```

Use shadcn `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`. Fields: Name (required text input), Description (optional textarea), Sample Set (optional `<select>` listing all sample sets with `[ownerName] — [name]` label format so users know whose set it is). Submit calls `onSubmit`, closes on success. Show inline error if the promise rejects with a 409.

---

#### Step 4.4 — `components/trading/AddSampleSetDialog.tsx`

Props:
```ts
interface AddSampleSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: { name: string; rows: Array<{ ticker: string; date: string }> }) => Promise<void>;
}
```

Fields: Name (required), CSV file input (accept `.csv,text/csv`). On file selection, run `parseSampleSetCsv` from `lib/sample-set-csv.ts` client-side. Show a preview message: "Imported X rows, skipped Y (invalid)." If `rows.length === 0`, show error "No valid rows found" and disable submit. Submit calls `onSubmit`.

---

#### Step 4.5 — `components/trading/EditBacktestDialog.tsx`

Props:
```ts
interface EditBacktestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backtest: BacktestListItem;
  sampleSets: SampleSetListItem[];
  onSubmit: (body: { name?: string; description?: string | null; sampleSetId?: string | null }) => Promise<void>;
}
```

Pre-populate fields with current values. Same field set as NewBacktestDialog (name, description, sample set). Submit calls `onSubmit`.

---

#### Step 4.6 — Manager view test

Create `/home/jared/Nexus-Terminal/__tests__/backtest-manager-view.test.tsx`:

Mock `use-backtest-manager` hook. Test:
- Renders backtest cards with name and author.
- "Mine only" toggle hides other users' backtests.
- Sort dropdown changes order.
- "+ New Backtest" button opens `NewBacktestDialog`.
- Empty state renders when `filteredBacktests` is empty.

Use `@testing-library/react` (already present per vitest config — confirm by checking `package.json` before writing the test).

---

### Phase 5 — Stats View + Hook

**Files to create:**
- `/home/jared/Nexus-Terminal/hooks/use-backtest-stats.ts`
- `/home/jared/Nexus-Terminal/components/trading/BacktestStatsView.tsx`

---

#### Step 5.1 — `hooks/use-backtest-stats.ts`

```ts
// Given a backtestId, fetches GET /api/backtests/[id] and derives stats.
// Exposes:
//   backtest: { id, name, ownerName, sampleSetName, ... } | null
//   reviewsWithStats: ReviewWithStats[]
//   filteredReviews: ReviewWithStats[]
//   aggregateStats: AggregateStats | null
//   activeFilterIds: Set<string>
//   toggleFilter: (id: string) => void
//   dynamicFilters: FilterDef[]   // grade + setup filters built from loaded reviews
//   isLoading: boolean
//   error: string | null
//   refetch: () => void
//   currentUserId: string | null
```

Fetch on `backtestId` change. After fetch, call `computeReviewStats` per review and build `reviewsWithStats`. Derive `dynamicFilters` via `buildGradeFilters` + `buildSetupFilters`. Apply `applyFilters` to produce `filteredReviews`. Recompute `aggregateStats` via `computeAggregateStats(filteredReviews)` on every filter change (all in-memory, no server round-trip).

---

#### Step 5.2 — `components/trading/BacktestStatsView.tsx`

Props:
```ts
interface BacktestStatsViewProps {
  backtestId: string;
  onBack: () => void;
  onOpenInChart: (ticker: string, date: string, backtestId: string | null) => void;
  currentUserId: string | null;
}
```

Uses `use-backtest-stats` hook. Layout:
- Header: back button ("← Backtest Manager") + backtest name (font-mono white) + author (zinc-500) + sample set name (zinc-400) + period span (`[earliest date] – [latest date]`, computed from `reviewsWithStats`).
- Metric tile row (6 tiles, grid-cols-6 at lg, grid-cols-3 at sm): Total Return (currency), Avg R (1 decimal), Win Rate (percent), Profit Factor (1 decimal or "—" if null), Max Drawdown (currency), Total Trades (integer).
- Equity curve chart. The project uses recharts — verify by checking `package.json`. Render a `<LineChart>` from recharts with `equityCurve` data. X-axis: trade date. Y-axis: cumulative PnL ($).
- Filter chip bar: render chips grouped by `group`. Static groups first (outcome, direction, gap), then dynamic groups (grade, setup). Each chip: button, highlighted when active (`bg-emerald-500/20 border-emerald-500 text-emerald-300`), default (`border-white/10 bg-white/5 text-zinc-400`). Clicking toggles the filter.
- Reviews table: columns — Ticker, Date, Direction, PnL ($), R-mult, Grade, Setup, Notes excerpt (first 40 chars), "Open" button. Sort by trade date ASC by default.
- Zero-reviews empty state: "No reviewed sessions in this backtest yet. Launch the chart to start reviewing."
- Per-review row: author-only kebab menu (check `review.session.userId === currentUserId`). Menu items: "Edit Notes" (PATCH `/api/backtest/sessions/[id]` with `notes`), "Delete" (DELETE `/api/backtest/sessions/[id]`). After mutation, call `refetch`.

---

### Phase 6 — View-Mode Wiring

**Files to modify:**
- `/home/jared/Nexus-Terminal/components/trading/BacktestingTab.tsx`
- `/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx`
- `/home/jared/Nexus-Terminal/components/trading/BacktestSimPanel.tsx`

---

#### Step 6.1 — `BacktestingTab.tsx` — view state machine

1. Add a `View` union type at the top of the file:
   ```ts
   type View =
     | { kind: 'manager' }
     | { kind: 'chart'; ticker: string; date: string; activeBacktestId: string | null }
     | { kind: 'stats'; backtestId: string };
   ```

2. Replace `const [selected, setSelected] = useState<BacktestSelection | null>(null)` with `const [view, setView] = useState<View>({ kind: 'manager' })`.

3. Derive `selected` for existing chart wiring: `const selected = view.kind === 'chart' ? { ticker: view.ticker, date: view.date } : null`.

4. Replace `handleSelect` with:
   ```ts
   const handleSelect = useCallback((next: BacktestSelection, backtestId: string | null = null) => {
     setArmedAction(null);
     setPendingOrder(null);
     setExtraSessionsForward(0);
     setView({ kind: 'chart', ticker: next.ticker, date: next.date, activeBacktestId: backtestId });
   }, []);
   ```

5. Wrap the existing chart layout in `{view.kind === 'chart' && ...}`. Add `{view.kind === 'manager' && <BacktestManagerView onLaunchChart={...} onViewStats={...} />}`. Add `{view.kind === 'stats' && <BacktestStatsView backtestId={view.backtestId} onBack={...} onOpenInChart={...} currentUserId={currentUserId} />}`.

6. `onLaunchChart`: `(backtestId, ticker, date) => handleSelect({ ticker, date }, backtestId)`.

7. `onViewStats`: `(backtestId) => setView({ kind: 'stats', backtestId })`.

8. Add a breadcrumb bar at the top of the chart layout (inside the chart main `<main>` element, above the existing header `<div>`). Render only when `view.kind === 'chart'`:
   ```tsx
   {view.kind === 'chart' ? (
     <div className="flex h-7 shrink-0 items-center gap-2 px-3 text-xs text-zinc-500">
       <button type="button" onClick={() => setView({ kind: 'manager' })} className="hover:text-white">
         ← Backtest Manager
       </button>
       {view.activeBacktestId ? (
         <>
           <span>•</span>
           <span className="text-zinc-300">{activeBacktestName}</span>
         </>
       ) : null}
     </div>
   ) : null}
   ```
   `activeBacktestName` requires a small state or a prop passed down from the manager. Simplest approach: store `activeBacktestName: string | null` alongside the chart view state. Change the `View` type to include `activeBacktestName: string | null` in the `chart` variant. Pass it from `onLaunchChart` in `BacktestManagerView` where the backtest name is known.

9. Derive `currentUserId` from `useSession()` (import from `next-auth/react`): `const { data: session } = useSession(); const currentUserId = session?.user?.id ?? null`.

---

#### Step 6.2 — `BacktestingSidebar.tsx` — active backtest awareness

1. Add new props to the interface:
   ```ts
   activeBacktest: { id: string; name: string; userId: string } | null;
   sampleSetRows: Array<{ ticker: string; date: string }> | null;
   ```

2. Remove internal `handleSyncSheetFile`, `handleLoadTradesFile`, Sync Sheet button, Load Trades button, and the `loadedTrades` / `syncStatus` / `syncing` state. These move to `BacktestManagerView`. Keep `handleSyncSheetFile` in the manager (already described in Phase 4.2 step).

3. When `activeBacktest` is set, show the sample set rows from `sampleSetRows` (passed by parent) as the ticker list instead of the system tickers. Map each `SampleSetRow` to the existing `SystemTickerRow` shape with `grade: null`, `setupType: null`, `day1GapPct: null`, and `id: ticker-date-index` key.

4. Remove the `sourceLabel` / `X` clear button logic (that was for loaded trades). The source label when `activeBacktest` is set becomes `activeBacktest.name` (truncated).

5. Keep the filter input and sort toggle — they still apply.

6. In `BacktestingTab.tsx`, when building the `BacktestingSidebar` call, pass:
   ```ts
   activeBacktest={view.kind === 'chart' && view.activeBacktestId ? { id: view.activeBacktestId, name: view.activeBacktestName ?? '', userId: /* need ownerId */ } : null}
   sampleSetRows={...} // fetch on demand if activeBacktestId set; store in tab state
   ```
   Simpler: when `activeBacktestId` is set, the sidebar can fetch `GET /api/backtests/[id]` internally to get the sample set rows. Or even simpler: pass `activeBacktestId` as a prop to the sidebar and let the sidebar fetch it. Pick whichever keeps `BacktestingTab.tsx` cleaner. Recommended: give sidebar an `activeBacktestId: string | null` prop and let it do an internal `useEffect` fetch of `GET /api/backtests/[id]` to get the sampleSet rows and backtest name. This avoids lifting that fetch state up into the tab.

---

#### Step 6.3 — `BacktestSimPanel.tsx` — active backtest UX

1. Add props:
   ```ts
   activeBacktest: { id: string; name: string; userId: string } | null;
   currentUserId: string | null;
   onSaveReview: (label?: string, notes?: string, backtestId?: string | null) => Promise<void> | void;
   ```

2. Change the SAVE REVIEW button text: if `activeBacktest && activeBacktest.userId === currentUserId`, render "SAVE TO [BACKTEST NAME]" (uppercase, truncate name if > 15 chars with ellipsis). Otherwise render "SAVE REVIEW".

3. In the `saveReview` async function inside the component, pass `backtestId: activeBacktest?.userId === currentUserId ? activeBacktest?.id : undefined` to `onSaveReview`.

4. In `BacktestingTab.tsx`, update the `onSaveReview` handler passed to `BacktestSimPanel` to forward the `backtestId` to `sessionState.saveReview`. Update `saveReview` in `use-backtest-session.ts` to accept an optional `backtestId?: string | null` parameter and include it in the POST to `/api/backtest/sessions/[id]/review`. (The review endpoint itself doesn't need to store it — `backtestId` lives on the session row, set at session creation time. Instead: update the `ensureActiveSession` call to pass `backtestId` when creating a new session.)

   Actually — the cleaner approach: `backtestId` is set when the session is **created** (POST `/api/backtest/sessions`), not when it is reviewed. So the flow is:
   - When entering chart view with `activeBacktestId`, the `use-backtest-session` hook must pass `backtestId` on session creation.
   - Pass `activeBacktestId` into `useBacktestSession` as a new prop: `backtestId: string | null`.
   - In `ensureActiveSession`, include `backtestId` in the POST body if set.
   - The `onSaveReview` signature in `BacktestSimPanel` does NOT need to change.

5. Update `useBacktestSession` interface to accept `backtestId: string | null` and thread it into `ensureActiveSession`.

6. In `BacktestingTab.tsx`, pass `backtestId={view.kind === 'chart' ? view.activeBacktestId : null}` to `useBacktestSession`.

---

### Phase 7 — Tests + Validation Gates

**Files to create:**
- `/home/jared/Nexus-Terminal/__tests__/backtests-route.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/sample-sets-route.test.ts`

(Other test files already specified in Phases 3 and 4.)

---

#### Step 7.1 — `backtests-route.test.ts`

Follow the exact mocking pattern in `/home/jared/Nexus-Terminal/__tests__/trades-route.test.ts`: use `vi.hoisted` for mock functions, `vi.mock('@/lib/db', ...)` and `vi.mock('@/lib/server-db-utils', ...)`, then import the route handlers.

Cover:
- `GET /api/backtests` returns list (no userId filter — any authed user sees all).
- `POST /api/backtests` creates a backtest for the authed user.
- `POST /api/backtests` returns 409 when `(userId, name)` collides.
- `GET /api/backtests/[id]` returns backtest + reviews (no ownership check).
- `PATCH /api/backtests/[id]` returns 403 when authed user is not the owner.
- `DELETE /api/backtests/[id]` returns 403 when authed user is not the owner.
- `DELETE /api/backtests/[id]` succeeds when authed user is the owner.

#### Step 7.2 — `sample-sets-route.test.ts`

Same pattern. Cover:
- `GET /api/sample-sets` returns list (no userId filter).
- `POST /api/sample-sets` creates with rows.
- `POST /api/sample-sets` returns 409 on name collision.
- `GET /api/sample-sets/[id]` returns full detail including rows array.
- `POST /api/sample-sets/[id]/duplicate` creates a copy for the authed user.
- `PATCH /api/sample-sets/[id]` returns 403 when not owner.
- `DELETE /api/sample-sets/[id]` returns 403 when not owner.
- `DELETE /api/sample-sets/[id]` succeeds for owner.

---

#### Step 7.3 — Validation gates

After ALL phases are complete, run in order:

```
npm run lint
npx tsc --noEmit
npm test
```

Report pass/fail for each. Fix all failures before marking done. `npm run workflow:audit` is NOT required (no workflow assets changed).

---

## 3. Files Reference

### NEW
- `/home/jared/Nexus-Terminal/lib/validations/backtests.ts`
- `/home/jared/Nexus-Terminal/lib/validations/sample-sets.ts`
- `/home/jared/Nexus-Terminal/lib/sample-set-csv.ts`
- `/home/jared/Nexus-Terminal/lib/backtest-stats.ts`
- `/home/jared/Nexus-Terminal/lib/backtest-filters.ts`
- `/home/jared/Nexus-Terminal/app/api/backtests/route.ts`
- `/home/jared/Nexus-Terminal/app/api/backtests/[id]/route.ts`
- `/home/jared/Nexus-Terminal/app/api/sample-sets/route.ts`
- `/home/jared/Nexus-Terminal/app/api/sample-sets/[id]/route.ts`
- `/home/jared/Nexus-Terminal/app/api/sample-sets/[id]/duplicate/route.ts`
- `/home/jared/Nexus-Terminal/hooks/use-backtest-manager.ts`
- `/home/jared/Nexus-Terminal/hooks/use-backtest-stats.ts`
- `/home/jared/Nexus-Terminal/components/trading/BacktestManagerView.tsx`
- `/home/jared/Nexus-Terminal/components/trading/BacktestStatsView.tsx`
- `/home/jared/Nexus-Terminal/components/trading/NewBacktestDialog.tsx`
- `/home/jared/Nexus-Terminal/components/trading/AddSampleSetDialog.tsx`
- `/home/jared/Nexus-Terminal/components/trading/EditBacktestDialog.tsx`
- `/home/jared/Nexus-Terminal/__tests__/sample-set-csv.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/backtest-stats.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/backtest-filters.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/backtests-route.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/sample-sets-route.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/backtest-manager-view.test.tsx`

### MODIFIED
- `/home/jared/Nexus-Terminal/lib/db/schema.ts` — add `sampleSets`, `backtests` tables; add `backtestId` + index to `backtestSessions`; add `uniqueIndex` + `randomUUID` imports
- `/home/jared/Nexus-Terminal/lib/types.ts` — add `backtestId: string | null` to `BacktestSession`
- `/home/jared/Nexus-Terminal/lib/validations/backtest.ts` — add `backtestId` field to `backtestSessionUpsertSchema`
- `/home/jared/Nexus-Terminal/app/api/backtest/sessions/route.ts` — accept + validate `backtestId`; drop userId filter on GET
- `/home/jared/Nexus-Terminal/app/api/backtest/sessions/[id]/route.ts` — drop userId filter on GET
- `/home/jared/Nexus-Terminal/hooks/use-backtest-session.ts` — accept `backtestId: string | null`; thread into `ensureActiveSession`
- `/home/jared/Nexus-Terminal/components/trading/BacktestingTab.tsx` — replace `selected` state with `view` state machine; add breadcrumb; render manager/stats/chart views; wire `activeBacktestId` into `useBacktestSession`
- `/home/jared/Nexus-Terminal/components/trading/BacktestingSidebar.tsx` — remove Sync Sheet / Load Trades buttons; add `activeBacktestId` prop; show sample set rows when active backtest set
- `/home/jared/Nexus-Terminal/components/trading/BacktestSimPanel.tsx` — add `activeBacktest` + `currentUserId` props; change Save Review button text; forward `backtestId` on save

---

## 4. Validation Snapshot

Run from `/home/jared/Nexus-Terminal` after all changes:

```
npm run lint
npx tsc --noEmit
npm test
```

Expected: all three exit 0. Do not run `npm run workflow:audit` (no workflow assets were changed). Do not run `db:push` at any point.

---

## 5. Open Assumptions

Codex must confirm these by reading the referenced files before writing code:

1. **Chart library**: Confirm `recharts` is in `package.json` before writing `<LineChart>` in `BacktestStatsView`. If a different chart library is used, adapt accordingly.

2. **`@testing-library/react` availability**: Confirm it is in `package.json` `devDependencies` before writing the `backtest-manager-view.test.tsx` file. If absent, the component test may need to be integration-style or skipped.

3. **`useSession` availability**: Confirm `next-auth/react` is in `package.json` (it should be, given the project uses NextAuth). The `useSession` hook is used in `BacktestingTab` and `use-backtest-manager`.

4. **`count` and `isNull` from drizzle-orm**: These are standard Drizzle exports — confirm they are available in the installed version by checking an existing route that does aggregation, or just use them and let TypeScript catch any issue at `tsc --noEmit`.

5. **Index syntax**: The existing schema uses both the `(t) => [...]` array form (newer tables like `reportTemplates`) and the `(table) => [...]` form (older tables). Either is fine — use the array form `(t) => [...]` consistently in the new tables to match the newer style.

6. **`parseSampleSetCsv` in `BacktestingSidebar.tsx`**: After extracting `parseTradesCsv` logic into `lib/sample-set-csv.ts`, update the sidebar's internal reference (if any remaining `loadedTrades` logic is kept). Since Phase 6.2 removes the Load Trades button from the sidebar entirely, no import is needed there — just confirm the sidebar no longer calls `parseTradesCsv` internally after the removal.

---

## Recent Completed Context

- 2026-05-01: Backtesting timeframe/day controls + VWAP NY-session reset shipped (`1f1a943`, `43faec3`, `2c0b2d3`).
- 2026-05-01: Dashboard intraday latches + Backtesting chart/review controls shipped — Day 1 + MDR rows now persist for the ET day, drawings shared across intraday charts, per-chart expansion, saved-review delete affordance.
- 2026-04-30: MDR eligibility route and Dashboard Potential MDR filtering shipped.
- 2026-04-28: Backtesting tab shipped with schema/API/UI, simulator action validation, review save/load, and a four-chart grid.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- MDR setup entry-trigger columns remain deferred; `PM Price Needed`, `Opening Gap Needed`, and `Intraday Price Needed` still render placeholders.
- **Backtest Manager — `broke_premarket_high` filter deferred** (decision 5 in 2026-05-01 planning). Data not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
