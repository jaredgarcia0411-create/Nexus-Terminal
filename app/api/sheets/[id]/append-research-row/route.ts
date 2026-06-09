import { eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { applySheetTagsForDates } from '@/lib/sheets/trade-tags';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { appendResearchRowSchema } from '@/lib/validations/sheets';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, appendResearchRowSchema);
    if (bodyState.error) return bodyState.error;
    const { ticker, date, reportId } = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const existing = await db
      .select({ position: sheetRows.position, values: sheetRows.values })
      .from(sheetRows)
      .where(eq(sheetRows.sheetId, id));

    const duplicate = existing.some((row) => {
      const values = row.values as Record<string, unknown>;
      return String(values.ticker ?? '').toUpperCase() === ticker && String(values.date ?? '') === date;
    });
    if (duplicate) return Response.json({ duplicate: true });

    const position = existing.length > 0
      ? Math.max(...existing.map((row) => row.position)) + 1
      : 0;
    const values: Record<string, unknown> = { ticker, date };
    if (reportId) values.research_report = reportId;

    const [row] = await db
      .insert(sheetRows)
      .values({
        sheetId: id,
        position,
        values,
        createdByUserId: authState.user.id,
        updatedByUserId: authState.user.id,
        updatedAt: new Date(),
      })
      .returning();

    await applySheetTagsForDates(db, authState.user.id, [date]);

    return Response.json({ row, duplicate: false }, { status: 201 });
  } catch (error) {
    logRouteError('sheets.id.append-research-row', error);
    return internalServerError();
  }
}
