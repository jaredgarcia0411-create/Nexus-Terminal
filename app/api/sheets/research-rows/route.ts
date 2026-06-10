import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { resolveReportIdsByTickerAndDate } from '@/lib/sheets/report-lookup';
import { buildSheetMatchesForDates } from '@/lib/sheets/trade-tags';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { epochToNySortKey, parseSortKey } from '@/lib/time-utils';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateToUtcMs(date: string): number | null {
  const parts = parseSortKey(date);
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function buildDateRange(from: string, to: string): string[] | null {
  const start = dateToUtcMs(from);
  const end = dateToUtcMs(to);
  if (start == null || end == null || start > end) return null;

  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor += MS_PER_DAY) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const today = epochToNySortKey(Date.now());
    const from = url.searchParams.get('from') ?? today;
    const to = url.searchParams.get('to') ?? today;
    const dates = buildDateRange(from, to);
    if (!dates) {
      return Response.json({ error: 'from and to must be YYYY-MM-DD with from before to' }, { status: 400 });
    }

    const matches = await buildSheetMatchesForDates(db, authState.user.id, dates);
    const rows = Array.from(matches.entries()).map(([key, value]) => {
      const [ticker, date] = key.split('|');
      return {
        ticker,
        date,
        reportId: value.reportId,
      };
    });

    // Fallback: when a sheet row has no report pinned, link a report that was
    // generated on the row's own date — the same ticker|date match the sheet's
    // report column uses. Lets Daily Review surface a report for a traded name
    // (e.g. researched and traded the same day) without anyone pinning it.
    const tickersNeedingReport = rows.filter((row) => !row.reportId).map((row) => row.ticker);
    if (tickersNeedingReport.length > 0) {
      const reportIdsByKey = await resolveReportIdsByTickerAndDate(db, tickersNeedingReport);
      for (const row of rows) {
        if (!row.reportId) row.reportId = reportIdsByKey.get(`${row.ticker}|${row.date}`);
      }
    }

    return Response.json({
      rows: rows.map((row) => ({
        ticker: row.ticker,
        date: row.date,
        ...(row.reportId ? { reportId: row.reportId } : {}),
      })),
    });
  } catch (error) {
    logRouteError('sheets.research-rows.get', error);
    return internalServerError();
  }
}
