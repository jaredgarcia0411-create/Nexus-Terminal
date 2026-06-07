import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { realizedPnlFromActions } from '@/lib/backtest-stats';
import { getDb } from '@/lib/db';
import { backtestActions, backtestSessions, sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

type SessionRow = typeof backtestSessions.$inferSelect;
type ActionRow = typeof backtestActions.$inferSelect;

function chooseSession(current: SessionRow | undefined, candidate: SessionRow): SessionRow | undefined {
  if (candidate.status === 'ACTIVE') return candidate;
  if (!current && candidate.status === 'REVIEWED') return candidate;
  return current;
}

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
      .select({ id: sheetRows.id })
      .from(sheetRows)
      .where(eq(sheetRows.sheetId, id));
    const rowIds = rows.map((row) => row.id);
    if (rowIds.length === 0) return Response.json({ results: {} });

    const sessions = await db
      .select()
      .from(backtestSessions)
      .where(and(
        eq(backtestSessions.userId, authState.user.id),
        inArray(backtestSessions.sheetRowId, rowIds),
      ))
      .orderBy(desc(backtestSessions.reviewedAt), desc(backtestSessions.createdAt));

    const chosenByRow = new Map<string, SessionRow>();
    for (const session of sessions) {
      if (!session.sheetRowId) continue;
      const chosen = chooseSession(chosenByRow.get(session.sheetRowId), session);
      if (chosen) chosenByRow.set(session.sheetRowId, chosen);
    }

    const chosenIds = [...chosenByRow.values()].map((session) => session.id);
    const actions = chosenIds.length === 0
      ? []
      : await db
        .select()
        .from(backtestActions)
        .where(and(
          eq(backtestActions.userId, authState.user.id),
          inArray(backtestActions.sessionId, chosenIds),
        ))
        .orderBy(asc(backtestActions.sequence));

    const actionsBySession = new Map<string, ActionRow[]>();
    for (const action of actions) {
      actionsBySession.set(action.sessionId, [...(actionsBySession.get(action.sessionId) ?? []), action]);
    }

    const results: Record<string, number | null> = {};
    for (const [rowId, session] of chosenByRow.entries()) {
      const pnl = realizedPnlFromActions(actionsBySession.get(session.id) ?? []);
      results[rowId] = session.riskDollars > 0 ? pnl / session.riskDollars : null;
    }

    return Response.json({ results });
  } catch (error) {
    logRouteError('sheets.r-results.get', error);
    return internalServerError();
  }
}
