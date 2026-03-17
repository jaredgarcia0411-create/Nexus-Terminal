import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { dailyTickerSummaries } from '@/lib/db/schema';
import { fetchDailyTickerSummary } from '@/lib/massive-market';
import { ensureUser, requireUser } from '@/lib/server-db-utils';
import { dailySummaryBodySchema } from '@/lib/validations/system';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeTicker(input: string | undefined) {
  return (input ?? '').trim().toUpperCase();
}

function normalizeDate(input: string | undefined) {
  const value = (input ?? '').trim();
  return value.length > 0 ? value : todayDate();
}

function parseDateOnly(input: string | undefined): Date | null {
  const value = (input ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

async function fetchAndUpsertDailySummary(input: {
  db: NonNullable<ReturnType<typeof getDb>>;
  userId: string;
  ticker: string;
  date: string;
}) {
  const payload = await fetchDailyTickerSummary(input.ticker, input.date);
  const fetchedAt = new Date();

  await input.db.insert(dailyTickerSummaries).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    ticker: input.ticker,
    date: input.date,
    open: payload.open ?? null,
    high: payload.high ?? null,
    low: payload.low ?? null,
    close: payload.close ?? null,
    volume: payload.volume ?? null,
    preMarket: payload.preMarket ?? null,
    afterHours: payload.afterHours ?? null,
    rawData: payload,
    fetchedAt,
  }).onConflictDoUpdate({
    target: [dailyTickerSummaries.userId, dailyTickerSummaries.ticker, dailyTickerSummaries.date],
    set: {
      open: payload.open ?? null,
      high: payload.high ?? null,
      low: payload.low ?? null,
      close: payload.close ?? null,
      volume: payload.volume ?? null,
      preMarket: payload.preMarket ?? null,
      afterHours: payload.afterHours ?? null,
      rawData: payload,
      fetchedAt,
    },
  });

  return {
    ticker: input.ticker,
    date: input.date,
    open: payload.open ?? null,
    high: payload.high ?? null,
    low: payload.low ?? null,
    close: payload.close ?? null,
    volume: payload.volume ?? null,
    preMarket: payload.preMarket ?? null,
    afterHours: payload.afterHours ?? null,
    fetchedAt: fetchedAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const canonicalUser = await ensureUser(db, authState.user);
    const userId = canonicalUser?.id ?? authState.user.id;

    const { searchParams } = new URL(request.url);
    const ticker = normalizeTicker(searchParams.get('ticker') ?? undefined);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const date = normalizeDate(searchParams.get('date') ?? undefined);

    const conditions = [eq(dailyTickerSummaries.userId, userId)];

    if (ticker) {
      conditions.push(eq(dailyTickerSummaries.ticker, ticker));
    }

    if (startDate && endDate) {
      conditions.push(gte(dailyTickerSummaries.date, startDate));
      conditions.push(lte(dailyTickerSummaries.date, endDate));
    } else if (ticker) {
      conditions.push(eq(dailyTickerSummaries.date, date));
    }

    const rows = await db
      .select({
        id: dailyTickerSummaries.id,
        ticker: dailyTickerSummaries.ticker,
        date: dailyTickerSummaries.date,
        open: dailyTickerSummaries.open,
        high: dailyTickerSummaries.high,
        low: dailyTickerSummaries.low,
        close: dailyTickerSummaries.close,
        volume: dailyTickerSummaries.volume,
        preMarket: dailyTickerSummaries.preMarket,
        afterHours: dailyTickerSummaries.afterHours,
        fetchedAt: dailyTickerSummaries.fetchedAt,
      })
      .from(dailyTickerSummaries)
      .where(and(...conditions))
      .orderBy(desc(dailyTickerSummaries.fetchedAt))
      .limit(50);

    return Response.json({ rows });
  } catch (error) {
    logRouteError('market-data.daily-summary.get', error);
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

    const canonicalUser = await ensureUser(db, authState.user);
    const userId = canonicalUser?.id ?? authState.user.id;

    const bodyState = await parseAndValidate(request, dailySummaryBodySchema);
    if (bodyState.error) return bodyState.error;

    const ticker = normalizeTicker(bodyState.data.ticker);
    if (!ticker) {
      return Response.json({ error: 'ticker is required' }, { status: 400 });
    }

    const startDate = (bodyState.data.startDate ?? '').trim();
    const endDate = (bodyState.data.endDate ?? '').trim();

    if (startDate && endDate) {
      const start = parseDateOnly(startDate);
      const end = parseDateOnly(endDate);
      if (!start || !end) {
        return Response.json({ error: 'startDate and endDate must be YYYY-MM-DD' }, { status: 400 });
      }
      if (end < start) {
        return Response.json({ error: 'endDate must be on or after startDate' }, { status: 400 });
      }

      const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) {
        return Response.json({ error: 'Date range cannot exceed 30 days' }, { status: 400 });
      }

      const rows = [];
      const current = new Date(start);
      while (current <= end) {
        const currentDate = current.toISOString().split('T')[0];
        const row = await fetchAndUpsertDailySummary({
          db,
          userId,
          ticker,
          date: currentDate,
        });
        rows.push(row);
        current.setUTCDate(current.getUTCDate() + 1);
      }

      return Response.json({ rows });
    }

    const date = normalizeDate(bodyState.data.date);
    const row = await fetchAndUpsertDailySummary({
      db,
      userId,
      ticker,
      date,
    });

    return Response.json(row);
  } catch (error) {
    if (error instanceof Error && error.message.includes('MASSIVE_API_KEY')) {
      return Response.json({ error: 'Market data provider not configured' }, { status: 503 });
    }
    logRouteError('market-data.daily-summary.post', error);
    return internalServerError();
  }
}
