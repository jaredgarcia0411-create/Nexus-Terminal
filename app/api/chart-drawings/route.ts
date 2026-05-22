import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { chartDrawings } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { chartDrawingsPutSchema, chartDrawingsQuerySchema } from '@/lib/validations/chart-drawings';

function parseQuery(request: Request) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const bucket = url.searchParams.get('bucket');
  return chartDrawingsQuerySchema.safeParse({ ticker, bucket });
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const tickerRaw = url.searchParams.get('ticker');
    if (!tickerRaw) {
      return Response.json({ error: 'ticker query param required' }, { status: 400 });
    }

    const ticker = tickerRaw.trim().toUpperCase();
    if (!ticker) {
      return Response.json({ error: 'ticker query param required' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(chartDrawings)
      .where(and(
        eq(chartDrawings.userId, authState.user.id),
        eq(chartDrawings.ticker, ticker),
      ));

    const intraday = rows.find((row) => row.bucket === 'intraday') ?? null;
    const higher = rows.find((row) => row.bucket === 'higher') ?? null;

    return Response.json({
      intraday: {
        drawings: intraday?.drawings ?? [],
        indicators: intraday?.indicators ?? {},
      },
      higher: {
        drawings: higher?.drawings ?? [],
        indicators: higher?.indicators ?? {},
      },
    });
  } catch (error) {
    logRouteError('chart-drawings.get', error);
    return internalServerError();
  }
}

export async function PUT(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const queryState = parseQuery(request);
    if (!queryState.success) {
      return Response.json(
        { error: 'Invalid query', issues: z.flattenError(queryState.error) },
        { status: 400 },
      );
    }
    const { ticker, bucket } = queryState.data;

    const bodyState = await parseAndValidate(request, chartDrawingsPutSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const now = new Date();
    await db
      .insert(chartDrawings)
      .values({
        userId: authState.user.id,
        ticker,
        bucket,
        drawings: body.drawings,
        indicators: body.indicators,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [chartDrawings.userId, chartDrawings.ticker, chartDrawings.bucket],
        set: {
          drawings: body.drawings,
          indicators: body.indicators,
          updatedAt: now,
        },
      });

    return Response.json({ ok: true });
  } catch (error) {
    logRouteError('chart-drawings.put', error);
    return internalServerError();
  }
}
