import { eq } from 'drizzle-orm';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { resolveReportIdsByTickerAndDate } from '@/lib/sheets/report-lookup';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

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

    const rows = await db
      .select({ values: sheetRows.values })
      .from(sheetRows)
      .where(eq(sheetRows.sheetId, id));

    const tickers = rows.map((row) => String(row.values.ticker ?? ''));
    const reportIds = await resolveReportIdsByTickerAndDate(db, tickers);

    return Response.json({ reportIds: Object.fromEntries(reportIds) });
  } catch (error) {
    logRouteError('sheets.id.report-ids', error);
    return internalServerError();
  }
}
