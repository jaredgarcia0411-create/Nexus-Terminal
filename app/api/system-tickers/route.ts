import { and, asc, desc, gte, ilike, lte } from 'drizzle-orm';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { systemTickers } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();
    const from = (searchParams.get('from') ?? '').trim();
    const to = (searchParams.get('to') ?? '').trim();

    if (from && !ISO_DATE_RE.test(from)) {
      return Response.json({ error: 'from must be YYYY-MM-DD' }, { status: 400 });
    }
    if (to && !ISO_DATE_RE.test(to)) {
      return Response.json({ error: 'to must be YYYY-MM-DD' }, { status: 400 });
    }

    const conditions = [];
    if (q) conditions.push(ilike(systemTickers.ticker, `%${q}%`));
    if (from) conditions.push(gte(systemTickers.date, from));
    if (to) conditions.push(lte(systemTickers.date, to));

    const query = db
      .select({
        id: systemTickers.id,
        ticker: systemTickers.ticker,
        date: systemTickers.date,
        grade: systemTickers.grade,
        setupType: systemTickers.setupType,
        day1GapPct: systemTickers.day1GapPct,
      })
      .from(systemTickers);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(systemTickers.date), asc(systemTickers.ticker))
      : await query.orderBy(desc(systemTickers.date), asc(systemTickers.ticker));

    return Response.json({ rows });
  } catch (error) {
    logRouteError('system-tickers.get', error);
    return internalServerError();
  }
}
