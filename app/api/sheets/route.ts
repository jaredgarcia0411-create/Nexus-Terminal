import { desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb, getPoolDb } from '@/lib/db';
import { sheetMembers, sheets, users } from '@/lib/db/schema';
import { DEFAULT_SHEET_COLUMNS } from '@/lib/sheets/columns';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sheetCreateSchema } from '@/lib/validations/sheets';

export async function GET(_request: Request) {
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
        rootId: sheets.rootId,
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

    const created = await db.transaction(async (tx) => {
      const [sheet] = await tx
        .insert(sheets)
        .values({
          ownerUserId: authState.user.id,
          name: body.name,
          sheetDate: body.sheetDate ?? null,
          isTemplate: body.isTemplate ?? false,
          columns: body.columns ?? DEFAULT_SHEET_COLUMNS,
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
