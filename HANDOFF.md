# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-01
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Sheets - Sprint 1: Data Layer (schema + routes + validation + tests)

> Generated: 2026-06-01 | Agent: Claude (Plan)
> Status: COMPLETE - implementation and validation finished 2026-06-01

### Context

First sprint of the Management > Sheets feature (team research grid). **Data layer only - no UI this sprint.** Full product direction and locked decisions are in `docs/FUTURE-PLANS.md` (lines 94-227) and memory `project_sheets_feature_decisions.md`.

Locked decisions this spec implements:
- 3-table hybrid model: `sheets` (columns folded into a `columns` jsonb + `columnsVersion` guard, `isTemplate` flag), `sheet_rows` (per-row `values` jsonb + `version` for optimistic conflict), `sheet_members` (owner/editor/viewer).
- `sheet_members` + an access helper are built **now** so every route is access-checked from day one. The owner row is auto-inserted on create. **Member add/remove-by-email routes are deferred to a later sprint.**
- Sheet-level edits (rename / columns / archive / delete) are **owner-only**. Rows are editable by owner + editor; viewers are read-only.
- Duplicate copies columns into a new sheet with **blank rows**, and the duplicator becomes the **owner** of the copy.
- Default locked columns: Ticker, Date, Tag, Research Report, Chart, Add to Sample.

Follow the `sample-sets` route + test conventions exactly (`app/api/sample-sets/route.ts`, `app/api/sample-sets/[id]/route.ts`, `__tests__/sample-sets-from-tags-route.test.ts`).

---

### File: `lib/sheets/columns.ts`
**Action:** CREATE

Defines the column type model and the default locked columns. No DB import, so `schema.ts` can import the type without a cycle.

```ts
export type SheetColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'select'
  | 'report'
  | 'chart'
  | 'action';

export type SheetColumn = {
  key: string;
  name: string;
  type: SheetColumnType;
  width?: number;
  options?: string[];
  locked?: boolean;
};

// The six default columns every new sheet starts with. `report`, `chart`, and
// `action` are reference/action types that later sprints render specially; the
// data layer just stores their values as JSON like any other column.
export const DEFAULT_SHEET_COLUMNS: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text', locked: true },
  { key: 'date', name: 'Date', type: 'date', locked: true },
  { key: 'tag', name: 'Tag', type: 'select', options: [], locked: true },
  { key: 'research_report', name: 'Research Report', type: 'report', locked: true },
  { key: 'chart', name: 'Chart', type: 'chart', locked: true },
  { key: 'add_to_sample', name: 'Add to Sample', type: 'action', locked: true },
];
```

**Acceptance criteria**
- [x] File exports `SheetColumnType`, `SheetColumn`, and `DEFAULT_SHEET_COLUMNS`.
- [x] `DEFAULT_SHEET_COLUMNS` has exactly the six columns above in that order, all `locked: true`.

---

### File: `lib/db/schema.ts`
**Action:** MODIFY

1. After the existing import block (the `randomUUID` import on line 3), add a type-only import:
   ```ts
   import type { SheetColumn } from '@/lib/sheets/columns';
   ```
2. Append the three tables at the **end of the file**. All column builders used (`text`, `date`, `boolean`, `jsonb`, `integer`, `timestamp`, `index`, `primaryKey`) and `randomUUID` are already imported at the top.

   ```ts
   export const sheets = pgTable('sheets', {
     id: text('id').primaryKey().$defaultFn(() => randomUUID()),
     ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
     name: text('name').notNull(),
     sheetDate: date('sheet_date'),
     isTemplate: boolean('is_template').notNull().default(false),
     columns: jsonb('columns').$type<SheetColumn[]>().notNull().default([]),
     columnsVersion: integer('columns_version').notNull().default(0),
     archivedAt: timestamp('archived_at', { withTimezone: true }),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
   }, (t) => [
     index('sheets_owner_updated_idx').on(t.ownerUserId, t.updatedAt),
   ]);

   export const sheetRows = pgTable('sheet_rows', {
     id: text('id').primaryKey().$defaultFn(() => randomUUID()),
     sheetId: text('sheet_id').notNull().references(() => sheets.id, { onDelete: 'cascade' }),
     position: integer('position').notNull().default(0),
     values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
     version: integer('version').notNull().default(0),
     createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
     updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
   }, (t) => [
     index('sheet_rows_sheet_position_idx').on(t.sheetId, t.position),
   ]);

   export const sheetMembers = pgTable('sheet_members', {
     sheetId: text('sheet_id').notNull().references(() => sheets.id, { onDelete: 'cascade' }),
     userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
     role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull().default('editor'),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
   }, (t) => [
     primaryKey({ columns: [t.sheetId, t.userId] }),
     index('sheet_members_user_idx').on(t.userId),
   ]);
   ```

**Acceptance criteria**
- [x] Three tables exported: `sheets`, `sheetRows`, `sheetMembers`.
- [x] No unique constraint on `sheets.name` (names repeat across days by design).
- [x] `sheetMembers` has composite PK `(sheetId, userId)` and a secondary index on `userId`.
- [x] `npx tsc --noEmit` passes (the `SheetColumn` type flows into `sheets.columns`).

---

### File: `lib/validations/sheets.ts`
**Action:** CREATE

Zod v4. Mirror `lib/validations/sample-sets.ts` style. Hard bounds on everything (validate aggressively at the boundary).

```ts
import { z } from 'zod';

export const SHEET_COLUMN_TYPES = [
  'text', 'number', 'date', 'url', 'checkbox', 'select', 'report', 'chart', 'action',
] as const;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const columnSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'key must be lowercase letters, numbers, or underscores'),
  name: z.string().trim().min(1).max(60),
  type: z.enum(SHEET_COLUMN_TYPES),
  width: z.number().int().min(40).max(800).optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  locked: z.boolean().optional(),
});

const rowValuesSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => Object.keys(v).length <= 60, 'a row may have at most 60 fields');

export const sheetCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
  isTemplate: z.boolean().optional(),
  sheetDate: z.string().trim().regex(DATE_REGEX, 'sheetDate must be YYYY-MM-DD').optional(),
  columns: z.array(columnSchema).max(40).optional(),
});

export const sheetPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sheetDate: z.string().trim().regex(DATE_REGEX).nullable().optional(),
    isTemplate: z.boolean().optional(),
    archived: z.boolean().optional(),
    columns: z.array(columnSchema).max(40).optional(),
    columnsVersion: z.number().int().min(0).optional(),
  })
  .refine((v) => v.columns === undefined || v.columnsVersion !== undefined, {
    message: 'columnsVersion is required when updating columns',
    path: ['columnsVersion'],
  });

export const sheetDuplicateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sheetDate: z.string().trim().regex(DATE_REGEX).optional(),
});

export const rowCreateSchema = z.object({
  values: rowValuesSchema.optional(),
});

export const rowPatchSchema = z.object({
  values: rowValuesSchema,
  version: z.number().int().min(0),
});

export type SheetCreateBody = z.infer<typeof sheetCreateSchema>;
export type SheetPatchBody = z.infer<typeof sheetPatchSchema>;
export type SheetDuplicateBody = z.infer<typeof sheetDuplicateSchema>;
export type RowCreateBody = z.infer<typeof rowCreateSchema>;
export type RowPatchBody = z.infer<typeof rowPatchSchema>;
```

**Acceptance criteria**
- [x] All five schemas + inferred types exported.
- [x] `sheetPatchSchema` rejects a `columns` update that omits `columnsVersion`.
- [x] Bounds present: name ≤100, column name ≤60, ≤40 columns, ≤50 options, ≤60 row fields.

---

### File: `lib/server-db-utils.ts`
**Action:** MODIFY

Export the existing `QueryDb` type so the access helper can reuse it. Change line 6 only:

```ts
// before
type QueryDb = Db | PoolDb;
// after
export type QueryDb = Db | PoolDb;
```

**Acceptance criteria**
- [x] `QueryDb` is exported; no other change to this file.

---

### File: `lib/sheets/access.ts`
**Action:** CREATE

Single access helper used by every sheet route. Returns the caller's role on a sheet, or `null` if they are not a member (treated as "no access / not found" by callers).

```ts
import { and, eq } from 'drizzle-orm';

import { sheetMembers } from '@/lib/db/schema';
import type { QueryDb } from '@/lib/server-db-utils';

export type SheetRole = 'owner' | 'editor' | 'viewer';

export async function getSheetRole(
  db: QueryDb,
  sheetId: string,
  userId: string,
): Promise<SheetRole | null> {
  const [row] = await db
    .select({ role: sheetMembers.role })
    .from(sheetMembers)
    .where(and(eq(sheetMembers.sheetId, sheetId), eq(sheetMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}
```

**Acceptance criteria**
- [x] Exports `SheetRole` and `getSheetRole`.

---

### File: `app/api/sheets/route.ts`
**Action:** CREATE

`GET` lists sheets the caller can see (joins `sheet_members`). `POST` creates a sheet and auto-inserts the owner membership in one transaction (uses `getPoolDb` for the transaction, like `app/api/sample-sets/[id]/route.ts`).

```ts
import { desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb, getPoolDb } from '@/lib/db';
import { sheetMembers, sheets, users } from '@/lib/db/schema';
import { DEFAULT_SHEET_COLUMNS } from '@/lib/sheets/columns';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sheetCreateSchema } from '@/lib/validations/sheets';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const rows = await db
      .select({
        id: sheets.id,
        name: sheets.name,
        sheetDate: sheets.sheetDate,
        isTemplate: sheets.isTemplate,
        archivedAt: sheets.archivedAt,
        ownerUserId: sheets.ownerUserId,
        ownerName: users.name,
        role: sheetMembers.role,
        updatedAt: sheets.updatedAt,
      })
      .from(sheetMembers)
      .innerJoin(sheets, eq(sheetMembers.sheetId, sheets.id))
      .leftJoin(users, eq(sheets.ownerUserId, users.id))
      .where(eq(sheetMembers.userId, authState.user.id))
      .orderBy(desc(sheets.updatedAt));

    return Response.json({ sheets: rows });
  } catch (error) {
    logRouteError('sheets.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, sheetCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const columns = body.columns ?? DEFAULT_SHEET_COLUMNS;

    const created = await db.transaction(async (tx) => {
      const [sheet] = await tx
        .insert(sheets)
        .values({
          ownerUserId: authState.user.id,
          name: body.name,
          sheetDate: body.sheetDate ?? null,
          isTemplate: body.isTemplate ?? false,
          columns,
          updatedAt: new Date(),
        })
        .returning();

      await tx.insert(sheetMembers).values({
        sheetId: sheet.id,
        userId: authState.user.id,
        role: 'owner',
      });

      return sheet;
    });

    return Response.json({ sheet: created }, { status: 201 });
  } catch (error) {
    logRouteError('sheets.post', error);
    return internalServerError();
  }
}
```

**Acceptance criteria**
- [x] `GET` returns only sheets where the caller has a `sheet_members` row, newest-updated first, including their `role`.
- [x] `POST` applies `DEFAULT_SHEET_COLUMNS` when `columns` is omitted, and inserts sheet + owner member atomically. Returns `201`.

---

### File: `app/api/sheets/[id]/route.ts`
**Action:** CREATE

`GET` (any member), `PATCH` (owner only), `DELETE` (owner only). Non-members get `404` (don't leak existence). PATCH guards column edits with `columnsVersion`.

```ts
import { and, asc, eq, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetMembers, sheetRows, sheets, users } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sheetPatchSchema } from '@/lib/validations/sheets';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });

    const [sheet] = await db.select().from(sheets).where(eq(sheets.id, id)).limit(1);
    const rows = await db
      .select()
      .from(sheetRows)
      .where(eq(sheetRows.sheetId, id))
      .orderBy(asc(sheetRows.position));
    const members = await db
      .select({
        userId: sheetMembers.userId,
        role: sheetMembers.role,
        name: users.name,
        email: users.email,
      })
      .from(sheetMembers)
      .leftJoin(users, eq(sheetMembers.userId, users.id))
      .where(eq(sheetMembers.sheetId, id));

    return Response.json({ sheet, rows, members, role });
  } catch (error) {
    logRouteError('sheets.id.get', error);
    return internalServerError();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, sheetPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role !== 'owner') return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (body.columns !== undefined) {
      const [current] = await db
        .select({ columnsVersion: sheets.columnsVersion })
        .from(sheets)
        .where(eq(sheets.id, id))
        .limit(1);
      if (current && current.columnsVersion !== body.columnsVersion) {
        return Response.json(
          { error: 'Columns were modified by someone else', currentColumnsVersion: current.columnsVersion },
          { status: 409 },
        );
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.sheetDate !== undefined) updates.sheetDate = body.sheetDate;
    if (body.isTemplate !== undefined) updates.isTemplate = body.isTemplate;
    if (body.archived !== undefined) updates.archivedAt = body.archived ? new Date() : null;
    if (body.columns !== undefined) {
      updates.columns = body.columns;
      updates.columnsVersion = (body.columnsVersion ?? 0) + 1;
    }

    const [updated] = await db.update(sheets).set(updates).where(eq(sheets.id, id)).returning();
    return Response.json({ sheet: updated });
  } catch (error) {
    logRouteError('sheets.id.patch', error);
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
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role !== 'owner') return Response.json({ error: 'Forbidden' }, { status: 403 });

    await db.delete(sheets).where(eq(sheets.id, id));
    return Response.json({ deleted: true, id });
  } catch (error) {
    logRouteError('sheets.id.delete', error);
    return internalServerError();
  }
}
```

Note: `and`/`sql` are imported for parity with the sample-sets file even though the simplest form above may not use them — remove any import you do not end up using so lint passes (no-unused-vars). Keep only what the final code references.

**Acceptance criteria**
- [x] `GET` returns `{ sheet, rows, members, role }` for a member; `404` for a non-member.
- [x] `PATCH` returns `403` for editor/viewer; `409` when `columnsVersion` is stale; bumps `columnsVersion` on a successful column update.
- [x] `DELETE` is owner-only; cascade removes rows + members (FK `onDelete: cascade`).
- [x] No unused imports (lint clean).

---

### File: `app/api/sheets/[id]/duplicate/route.ts`
**Action:** CREATE

Copies a source sheet's columns into a brand-new sheet with **no rows**; the caller becomes owner. Uses `getPoolDb` transaction (sheet + owner member).

```ts
import { eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { sheetMembers, sheets } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sheetDuplicateSchema } from '@/lib/validations/sheets';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, sheetDuplicateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });

    const [source] = await db.select().from(sheets).where(eq(sheets.id, id)).limit(1);
    if (!source) return Response.json({ error: 'Sheet not found' }, { status: 404 });

    const created = await db.transaction(async (tx) => {
      const [sheet] = await tx
        .insert(sheets)
        .values({
          ownerUserId: authState.user.id,
          name: body.name ?? source.name,
          sheetDate: body.sheetDate ?? null,
          isTemplate: false,
          columns: source.columns,
          updatedAt: new Date(),
        })
        .returning();

      await tx.insert(sheetMembers).values({
        sheetId: sheet.id,
        userId: authState.user.id,
        role: 'owner',
      });

      return sheet;
    });

    return Response.json({ sheet: created }, { status: 201 });
  } catch (error) {
    logRouteError('sheets.id.duplicate', error);
    return internalServerError();
  }
}
```

**Acceptance criteria**
- [x] Copies `columns` from the source, creates `isTemplate: false`, no rows copied, caller is owner. Returns `201`.
- [x] `404` if caller is not a member of the source sheet.

---

### File: `app/api/sheets/[id]/rows/route.ts`
**Action:** CREATE

`POST` appends a row (owner/editor only). Position = current max + 1.

```ts
import { desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { rowCreateSchema } from '@/lib/validations/sheets';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, rowCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const [last] = await db
      .select({ position: sheetRows.position })
      .from(sheetRows)
      .where(eq(sheetRows.sheetId, id))
      .orderBy(desc(sheetRows.position))
      .limit(1);
    const position = last ? last.position + 1 : 0;

    const [row] = await db
      .insert(sheetRows)
      .values({
        sheetId: id,
        position,
        values: body.values ?? {},
        createdByUserId: authState.user.id,
        updatedByUserId: authState.user.id,
        updatedAt: new Date(),
      })
      .returning();

    return Response.json({ row }, { status: 201 });
  } catch (error) {
    logRouteError('sheets.id.rows.post', error);
    return internalServerError();
  }
}
```

**Acceptance criteria**
- [x] Appends at max position + 1; `403` for viewer; `404` for non-member; returns `201`.

---

### File: `app/api/sheets/[id]/rows/[rowId]/route.ts`
**Action:** CREATE

`PATCH` does the optimistic-version update (the core conflict-safety mechanism): update only when the stored `version` matches the client's; if nothing updated, return `409` with the current row so the client can reconcile. `DELETE` removes a row (owner/editor).

```ts
import { and, eq, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { rowPatchSchema } from '@/lib/validations/sheets';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, rowPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id, rowId } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const [updated] = await db
      .update(sheetRows)
      .set({
        values: body.values,
        version: sql`${sheetRows.version} + 1`,
        updatedByUserId: authState.user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sheetRows.id, rowId),
          eq(sheetRows.sheetId, id),
          eq(sheetRows.version, body.version),
        ),
      )
      .returning();

    if (!updated) {
      const [current] = await db
        .select()
        .from(sheetRows)
        .where(and(eq(sheetRows.id, rowId), eq(sheetRows.sheetId, id)))
        .limit(1);
      if (!current) return Response.json({ error: 'Row not found' }, { status: 404 });
      return Response.json(
        { error: 'Row was modified by someone else', row: current },
        { status: 409 },
      );
    }

    return Response.json({ row: updated });
  } catch (error) {
    logRouteError('sheets.id.rows.patch', error);
    return internalServerError();
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id, rowId } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });

    await db.delete(sheetRows).where(and(eq(sheetRows.id, rowId), eq(sheetRows.sheetId, id)));
    return Response.json({ deleted: true, id: rowId });
  } catch (error) {
    logRouteError('sheets.id.rows.delete', error);
    return internalServerError();
  }
}
```

**Acceptance criteria**
- [x] Successful `PATCH` increments `version` and sets `updatedByUserId`.
- [x] Stale `version` → `409` with the current row in the body.
- [x] Missing row → `404`; viewer → `403`.
- [x] `DELETE` is owner/editor only.

---

### File: `__tests__/sheets-routes.test.ts`
**Action:** CREATE

Vitest, mirroring `__tests__/sample-sets-from-tags-route.test.ts`. **Mock `@/lib/sheets/access` (`getSheetRole`) directly** so tests set the caller's role without having to mock the membership query chain. Mock `@/lib/db` (`getDb`, `getPoolDb`), and `@/lib/server-db-utils` (`requireUser`, `ensureUser`, `dbUnavailable`). Build a small per-test db mock for the chained drizzle calls each route uses (follow the existing `createDbMock` builder approach; for the create/duplicate transaction, mock `getPoolDb().transaction` to invoke its callback with a `tx` mock whose `insert(...).values(...).returning()` resolves the fake sheet).

Example shape for the version-conflict case:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, getPoolDbMock, requireUserMock, ensureUserMock, getSheetRoleMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getPoolDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getSheetRoleMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock, getPoolDb: getPoolDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/sheets/access', () => ({ getSheetRole: getSheetRoleMock }));

// import the handlers under test AFTER the mocks ...
```

Required cases (assert status codes + key payload fields):
- [x] `POST /api/sheets` with no `columns` → `201`, sheet created with `DEFAULT_SHEET_COLUMNS`, owner member inserted (assert the `tx.insert` calls).
- [x] `GET /api/sheets` → returns the mocked member rows.
- [x] `GET /api/sheets/[id]` when `getSheetRole` → `null` → `404`.
- [x] `GET /api/sheets/[id]` when role present → `200` with `{ sheet, rows, members, role }`.
- [x] `PATCH /api/sheets/[id]` when role is `editor` → `403`.
- [x] `PATCH /api/sheets/[id]` columns update with stale `columnsVersion` → `409`.
- [x] `DELETE /api/sheets/[id]` when role is `editor` → `403`; when `owner` → `200`.
- [x] `POST /api/sheets/[id]/rows` when role is `viewer` → `403`.
- [x] `PATCH .../rows/[rowId]` when the version-guarded update returns no row → `409` with `row` in body.
- [x] `POST /api/sheets` validation: name longer than 100 chars → `400` with `Validation failed`.
- [x] `PATCH /api/sheets/[id]` with `columns` but no `columnsVersion` → `400` (schema refine).

> If mocking the transaction or chained query builders gets unwieldy for a given handler, split into a second file (e.g. `__tests__/sheets-rows-route.test.ts`) rather than forcing everything into one. Keep each test's db mock minimal — only the chain methods that handler actually calls.

---

### Migration

After the schema change, generate and apply the migration:

1. Run `npm run db:generate` (creates the next `drizzle/00xx_*.sql` + updates `drizzle/meta`).
2. Inspect the generated SQL: it must `CREATE TABLE sheets`, `sheet_rows`, `sheet_members` with the FKs, composite PK, and indexes above — and must **not** alter or drop any existing table.
3. Run **`npm run db:migrate`** to apply it. (Do not use `db:push`. Skipping `db:migrate` has previously shipped a missing table to prod.)

**Acceptance criteria**
- [x] One new migration file containing only the three new tables.
- [x] `npm run db:migrate` runs cleanly.

---

### Files Changed Summary

| File | Action | ~Lines | Risk |
|---|---|---|---|
| `lib/sheets/columns.ts` | CREATE | ~35 | Low |
| `lib/db/schema.ts` | MODIFY | +~45 / +1 import | Medium (schema) |
| `drizzle/00xx_*.sql` + `drizzle/meta` | GENERATE | — | Medium (migration) |
| `lib/validations/sheets.ts` | CREATE | ~60 | Low |
| `lib/server-db-utils.ts` | MODIFY | 1 (export) | Low |
| `lib/sheets/access.ts` | CREATE | ~20 | Low |
| `app/api/sheets/route.ts` | CREATE | ~85 | Medium |
| `app/api/sheets/[id]/route.ts` | CREATE | ~120 | Medium |
| `app/api/sheets/[id]/duplicate/route.ts` | CREATE | ~55 | Low |
| `app/api/sheets/[id]/rows/route.ts` | CREATE | ~55 | Low |
| `app/api/sheets/[id]/rows/[rowId]/route.ts` | CREATE | ~95 | Medium |
| `__tests__/sheets-routes.test.ts` (+ optional rows test) | CREATE | ~200 | Low |

### Verification Steps

Run from repo root after implementation:

- [x] `npm run db:generate` then `npm run db:migrate` (migration created + applied)
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test` (new sheets tests pass)
- [x] `npm run workflow:audit` (HANDOFF.md / workflow asset changed)

`npm run typecheck:services` not required (no `services/` files touched).

Manual sanity (optional, no UI yet): none this sprint — verification is the test suite.

### Deferred to later sprints (do NOT build now)
- Any UI (`SheetsTab`, grid, `ManagementTab` subtab).
- Member add/remove-by-email routes + the email→user lookup.
- Research "Add to Sheets" import route.
- CSV export, polling/SSE invalidation.
- `AGENTS.md` update — defer until the routes are implemented and the UI lands so we document a real, reachable surface (avoids "not yet built" notes).

---

## Implementation Style

Write the simplest correct code that satisfies the active spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless the spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries: user input, external APIs, and DB reads of untrusted JSON.
- No comments unless the why is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
