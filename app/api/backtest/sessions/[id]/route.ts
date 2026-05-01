import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestActions, backtestSessions } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

const backtestSessionPatchSchema = z.object({
  riskDollars: z.number().positive('riskDollars must be positive').optional(),
  notes: z.string().trim().nullable().optional(),
  label: z.string().trim().nullable().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [session] = await db
      .select()
      .from(backtestSessions)
      .where(eq(backtestSessions.id, id))
      .limit(1);

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const actions = await db
      .select()
      .from(backtestActions)
      .where(eq(backtestActions.sessionId, id))
      .orderBy(asc(backtestActions.sequence));

    return Response.json({ session, actions });
  } catch (error) {
    logRouteError('backtest.sessions.id.get', error);
    return internalServerError();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const bodyState = await parseAndValidate(request, backtestSessionPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [existing] = await db
      .select()
      .from(backtestSessions)
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, id)))
      .limit(1);

    if (!existing) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const updateData: Partial<typeof backtestSessions.$inferInsert> = {};
    if (Object.prototype.hasOwnProperty.call(body, 'riskDollars')) {
      updateData.riskDollars = body.riskDollars;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      updateData.notes = body.notes?.trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'label')) {
      updateData.label = body.label?.trim() || null;
    }

    if (Object.keys(updateData).length === 0) {
      return Response.json({ session: existing });
    }

    const [session] = await db
      .update(backtestSessions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, id)))
      .returning();

    return Response.json({ session });
  } catch (error) {
    logRouteError('backtest.sessions.id.patch', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    await db
      .delete(backtestSessions)
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, id)));

    return Response.json({ deleted: true, id });
  } catch (error) {
    logRouteError('backtest.sessions.id.delete', error);
    return internalServerError();
  }
}
