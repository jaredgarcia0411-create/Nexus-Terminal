import { eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { sheetMembers, sheetRows, sheets } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sheetSnapshotSchema } from '@/lib/validations/sheets';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, sheetSnapshotSchema);
    if (bodyState.error) return bodyState.error;
    const { date } = bodyState.data;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role !== 'owner') return Response.json({ error: 'Only the owner can snapshot' }, { status: 403 });

    const [source] = await db.select().from(sheets).where(eq(sheets.id, id)).limit(1);
    if (!source) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (source.rootId) {
      return Response.json({ error: 'Only original sheets can be snapshotted' }, { status: 400 });
    }

    const created = await db.transaction(async (tx) => {
      const [sheet] = await tx
        .insert(sheets)
        .values({
          ownerUserId: authState.user.id,
          name: `${source.name} ${date}`,
          sheetDate: date,
          isTemplate: false,
          columns: source.columns,
          rootId: source.id,
          updatedAt: new Date(),
        })
        .returning();

      const sourceRows = await tx.select().from(sheetRows).where(eq(sheetRows.sheetId, source.id));
      if (sourceRows.length > 0) {
        await tx.insert(sheetRows).values(sourceRows.map((row) => ({
          sheetId: sheet.id,
          position: row.position,
          values: row.values,
          createdByUserId: authState.user.id,
        })));
      }
      await tx.delete(sheetRows).where(eq(sheetRows.sheetId, source.id));

      await tx.insert(sheetMembers).values({
        sheetId: sheet.id,
        userId: authState.user.id,
        role: 'owner',
      });

      return sheet;
    });

    return Response.json({ sheet: created }, { status: 201 });
  } catch (error) {
    logRouteError('sheets.id.snapshot', error);
    return internalServerError();
  }
}
