import { and, asc, desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestActions, backtestSessions } from '@/lib/db/schema';
import { reduceActions } from '@/lib/backtest-math';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestActionCreateSchema } from '@/lib/validations/backtest';
import type { BacktestAction } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, backtestActionCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [session] = await db
      .select({
        id: backtestSessions.id,
        riskDollars: backtestSessions.riskDollars,
      })
      .from(backtestSessions)
      .where(and(
        eq(backtestSessions.userId, authState.user.id),
        eq(backtestSessions.id, body.sessionId),
        eq(backtestSessions.status, 'ACTIVE'),
      ))
      .limit(1);

    if (!session) {
      return Response.json({ error: 'Active session not found' }, { status: 404 });
    }

    const existingActions = await db
      .select()
      .from(backtestActions)
      .where(and(eq(backtestActions.userId, authState.user.id), eq(backtestActions.sessionId, body.sessionId)))
      .orderBy(asc(backtestActions.sequence));

    const currentPosition = reduceActions(existingActions as BacktestAction[], session.riskDollars);

    switch (body.actionType) {
      case 'LONG':
        if (currentPosition.direction !== 'FLAT') {
          return Response.json({ error: 'LONG can only be placed from a flat position' }, { status: 409 });
        }
        if (body.stopPrice == null || body.stopPrice >= body.price) {
          return Response.json({ error: 'LONG requires a stop below entry' }, { status: 400 });
        }
        break;
      case 'SHORT':
        if (currentPosition.direction !== 'FLAT') {
          return Response.json({ error: 'SHORT can only be placed from a flat position' }, { status: 409 });
        }
        if (body.stopPrice == null || body.stopPrice <= body.price) {
          return Response.json({ error: 'SHORT requires a stop above entry' }, { status: 400 });
        }
        break;
      case 'LONG_ADD':
        if (currentPosition.direction !== 'LONG') {
          return Response.json({ error: 'LONG_ADD requires an open long position' }, { status: 409 });
        }
        if (body.stopPrice == null || body.stopPrice >= body.price) {
          return Response.json({ error: 'LONG_ADD requires a stop below entry' }, { status: 400 });
        }
        break;
      case 'SHORT_ADD':
        if (currentPosition.direction !== 'SHORT') {
          return Response.json({ error: 'SHORT_ADD requires an open short position' }, { status: 409 });
        }
        if (body.stopPrice == null || body.stopPrice <= body.price) {
          return Response.json({ error: 'SHORT_ADD requires a stop above entry' }, { status: 400 });
        }
        break;
      case 'SELL':
        if (currentPosition.direction !== 'LONG') {
          return Response.json({ error: 'SELL requires an open long position' }, { status: 409 });
        }
        if (body.shares > currentPosition.totalShares) {
          return Response.json({ error: 'SELL cannot exceed open shares' }, { status: 400 });
        }
        break;
      case 'COVER':
        if (currentPosition.direction !== 'SHORT') {
          return Response.json({ error: 'COVER requires an open short position' }, { status: 409 });
        }
        if (body.shares > currentPosition.totalShares) {
          return Response.json({ error: 'COVER cannot exceed open shares' }, { status: 400 });
        }
        break;
    }

    const lastAction = existingActions.at(-1);

    const [action] = await db
      .insert(backtestActions)
      .values({
        id: crypto.randomUUID(),
        userId: authState.user.id,
        sessionId: body.sessionId,
        actionType: body.actionType,
        price: body.price,
        shares: body.shares,
        stopPrice: body.stopPrice,
        barTime: body.barTime,
        sequence: (lastAction?.sequence ?? 0) + 1,
      })
      .returning();

    await db
      .update(backtestSessions)
      .set({ updatedAt: new Date() })
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, body.sessionId)));

    return Response.json({ action });
  } catch (error) {
    logRouteError('backtest.actions.post', error);
    return internalServerError();
  }
}
