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
