import { and, desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, normalizeTicker, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestSessions } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestSessionUpsertSchema } from '@/lib/validations/backtest';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { searchParams } = new URL(request.url);
    const ticker = normalizeTicker(searchParams.get('ticker') ?? undefined);
    const date = (searchParams.get('date') ?? '').trim();

    if (!ticker) {
      return Response.json({ error: 'ticker is required' }, { status: 400 });
    }
    if (!ISO_DATE_RE.test(date)) {
      return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(backtestSessions)
      .where(and(
        eq(backtestSessions.userId, authState.user.id),
        eq(backtestSessions.ticker, ticker),
        eq(backtestSessions.date, date),
      ))
      .orderBy(desc(backtestSessions.reviewedAt), desc(backtestSessions.createdAt));

    return Response.json({
      session: rows.find((row) => row.status === 'ACTIVE') ?? null,
      reviews: rows.filter((row) => row.status === 'REVIEWED'),
    });
  } catch (error) {
    logRouteError('backtest.sessions.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, backtestSessionUpsertSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [existing] = await db
      .select()
      .from(backtestSessions)
      .where(and(
        eq(backtestSessions.userId, authState.user.id),
        eq(backtestSessions.ticker, body.ticker),
        eq(backtestSessions.date, body.date),
        eq(backtestSessions.status, 'ACTIVE'),
      ))
      .limit(1);

    if (existing) {
      const [session] = await db
        .update(backtestSessions)
        .set({ riskDollars: body.riskDollars, updatedAt: new Date() })
        .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, existing.id)))
        .returning();

      return Response.json({ session });
    }

    const [session] = await db
      .insert(backtestSessions)
      .values({
        id: crypto.randomUUID(),
        userId: authState.user.id,
        ticker: body.ticker,
        date: body.date,
        riskDollars: body.riskDollars,
      })
      .returning();

    return Response.json({ session });
  } catch (error) {
    logRouteError('backtest.sessions.post', error);
    return internalServerError();
  }
}
