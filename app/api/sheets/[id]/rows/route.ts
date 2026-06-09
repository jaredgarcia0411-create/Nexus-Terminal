import { desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { applySheetTagsForDates } from '@/lib/sheets/trade-tags';
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

    await applySheetTagsForDates(db, authState.user.id, [String(body.values?.date ?? '')]);

    return Response.json({ row }, { status: 201 });
  } catch (error) {
    logRouteError('sheets.id.rows.post', error);
    return internalServerError();
  }
}
