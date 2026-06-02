import { and, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { reorderRowsSchema } from '@/lib/validations/sheets';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, reorderRowsSchema);
    if (bodyState.error) return bodyState.error;
    const { rowIds } = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });

    await Promise.all(rowIds.map((rowId, index) => (
      db.update(sheetRows)
        .set({ position: index })
        .where(and(eq(sheetRows.id, rowId), eq(sheetRows.sheetId, id)))
    )));

    return Response.json({ ok: true });
  } catch (error) {
    logRouteError('sheets.id.rows.reorder', error);
    return internalServerError();
  }
}
