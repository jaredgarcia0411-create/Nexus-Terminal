import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { dailyTickerSummaries } from '@/lib/db/schema';
import { fetchDailyTickerSummary } from '@/lib/massive-market';
import { ensureUser, requireUser } from '@/lib/server-db-utils';

interface DailySummaryBody {
  ticker?: string;
  date?: string;
}

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
    const ticker = normalizeTicker(searchParams.get('ticker') ?? undefined);
    const date = normalizeDate(searchParams.get('date') ?? undefined);

    const whereClause = ticker
      ? and(
        eq(dailyTickerSummaries.userId, authState.user.id),
        eq(dailyTickerSummaries.ticker, ticker),
        eq(dailyTickerSummaries.date, date),
      )
      : eq(dailyTickerSummaries.userId, authState.user.id);

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
      .where(whereClause)
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

    await ensureUser(db, authState.user);

    const bodyState = await parseJsonBody<DailySummaryBody>(request);
    if (bodyState.error) return bodyState.error;

    const ticker = normalizeTicker(bodyState.data.ticker);
    if (!ticker) {
      return Response.json({ error: 'ticker is required' }, { status: 400 });
    }

    const date = normalizeDate(bodyState.data.date);
    const payload = await fetchDailyTickerSummary(ticker, date);

    const rowId = crypto.randomUUID();
    const fetchedAt = new Date();

    await db.insert(dailyTickerSummaries).values({
      id: rowId,
      userId: authState.user.id,
      ticker,
      date,
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

    return Response.json({
      ticker,
      date,
      open: payload.open ?? null,
      high: payload.high ?? null,
      low: payload.low ?? null,
      close: payload.close ?? null,
      volume: payload.volume ?? null,
      preMarket: payload.preMarket ?? null,
      afterHours: payload.afterHours ?? null,
      fetchedAt: fetchedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('MASSIVE_API_KEY')) {
      return Response.json({ error: 'Market data provider not configured' }, { status: 503 });
    }
    logRouteError('market-data.daily-summary.post', error);
    return internalServerError();
  }
}
