import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { sheetMembers, sheetRows, sheets } from '@/lib/db/schema';
import { ensureLockedColumns } from '@/lib/sheets/columns';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sheetImportSchema } from '@/lib/validations/sheets';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, sheetImportSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const created = await db.transaction(async (tx) => {
      const columns = ensureLockedColumns(body.columns);
      const now = new Date();
      const [sheet] = await tx
        .insert(sheets)
        .values({
          ownerUserId: authState.user.id,
          name: body.name,
          sheetDate: null,
          isTemplate: false,
          columns,
          updatedAt: now,
        })
        .returning();

      await tx.insert(sheetMembers).values({
        sheetId: sheet.id,
        userId: authState.user.id,
        role: 'owner',
      });

      const insertedRows = body.rows.length > 0
        ? await tx
            .insert(sheetRows)
            .values(body.rows.map((values, index) => ({
              sheetId: sheet.id,
              position: index,
              values,
              createdByUserId: authState.user.id,
              updatedByUserId: authState.user.id,
              updatedAt: now,
            })))
            .returning()
        : [];

      return { sheet, rows: insertedRows };
    });

    return Response.json(created, { status: 201 });
  } catch (error) {
    logRouteError('sheets.import.post', error);
    return internalServerError();
  }
}
