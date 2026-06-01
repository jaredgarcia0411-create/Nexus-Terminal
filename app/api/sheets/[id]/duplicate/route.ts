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
