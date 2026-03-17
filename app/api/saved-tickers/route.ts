import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { savedTickers } from '@/lib/db/schema';
import { ensureUser, requireUser } from '@/lib/server-db-utils';
import { savedTickerBodySchema } from '@/lib/validations/system';

function normalizeTicker(value: string | undefined) {
  return (value ?? '').trim().toUpperCase();
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    await ensureUser(db, authState.user);

    const { searchParams } = new URL(request.url);
    const category = (searchParams.get('category') ?? '').trim();

    const rows = await db
      .select({
        id: savedTickers.id,
        ticker: savedTickers.ticker,
        category: savedTickers.category,
        notes: savedTickers.notes,
        createdAt: savedTickers.createdAt,
      })
      .from(savedTickers)
      .where(category
        ? and(eq(savedTickers.userId, authState.user.id), eq(savedTickers.category, category))
        : eq(savedTickers.userId, authState.user.id))
      .orderBy(desc(savedTickers.createdAt));

    return Response.json({ rows });
  } catch (error) {
    logRouteError('saved-tickers.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, savedTickerBodySchema);
    if (bodyState.error) return bodyState.error;

    const ticker = normalizeTicker(bodyState.data.ticker);
    if (!ticker) {
      return Response.json({ error: 'ticker is required' }, { status: 400 });
    }

    const category = (bodyState.data.category ?? 'watchlist').trim() || 'watchlist';
    const notes = (bodyState.data.notes ?? '').trim() || null;
    const createdAt = new Date();

    await db.insert(savedTickers).values({
      id: crypto.randomUUID(),
      userId: authState.user.id,
      ticker,
      category,
      notes,
      createdAt,
    }).onConflictDoUpdate({
      target: [savedTickers.userId, savedTickers.ticker],
      set: {
        category,
        notes,
      },
    });

    return Response.json({ ticker, category, notes });
  } catch (error) {
    logRouteError('saved-tickers.post', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    await ensureUser(db, authState.user);

    const { searchParams } = new URL(request.url);
    const id = (searchParams.get('id') ?? '').trim();
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    await db.delete(savedTickers).where(and(eq(savedTickers.userId, authState.user.id), eq(savedTickers.id, id)));
    return Response.json({ success: true });
  } catch (error) {
    logRouteError('saved-tickers.delete', error);
    return internalServerError();
  }
}
