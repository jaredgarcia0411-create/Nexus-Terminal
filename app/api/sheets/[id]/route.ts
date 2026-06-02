import { asc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetMembers, sheetRows, sheets, users } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { ensureLockedColumns } from '@/lib/sheets/columns';
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

    return Response.json({ sheet: { ...sheet, columns: ensureLockedColumns(sheet.columns) }, rows, members, role });
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

    const updates: Partial<typeof sheets.$inferInsert> = { updatedAt: new Date() };
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
