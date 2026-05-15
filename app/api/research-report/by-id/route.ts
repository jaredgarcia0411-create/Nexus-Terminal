import { eq } from 'drizzle-orm';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// research_reports.id is a uuid (text PK). Loosely-validate the shape here so we
// don't bother the DB with junk inputs. We're not pattern-locking to uuid v4 only —
// any 32-128 char hex-ish string is fine since the row either exists or doesn't.
const idPattern = /^[A-Za-z0-9._-]{8,128}$/;

// Returns one research_reports row by primary key, with NO freshness filter.
// Pairs with the watchlist "+ Add to Watchlist" feature: a row can save a
// reportId today and resolve it back months later, long after the 16h cache
// window the main GET enforces. Reports in this table are never pruned.
export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();

    const url = new URL(request.url);
    const id = url.searchParams.get('id')?.trim() ?? '';
    if (!idPattern.test(id)) {
      return Response.json({ error: 'Valid report id required' }, { status: 400 });
    }

    const [row] = await db
      .select({
        id: researchReports.id,
        ticker: researchReports.ticker,
        reportJson: researchReports.reportJson,
        generatedAt: researchReports.generatedAt,
        modelUsed: researchReports.modelUsed,
        status: researchReports.status,
      })
      .from(researchReports)
      .where(eq(researchReports.id, id))
      .limit(1);

    // Only complete rows with reportJson present are useful — pending/in_progress
    // and legacy reportJson=null rows are surfaced as 404 so the client renders
    // an empty state instead of a half-loaded report.
    if (!row || row.status !== 'complete' || !row.reportJson) {
      return Response.json({ error: 'Report not found' }, { status: 404 });
    }

    return Response.json({
      id: row.id,
      ticker: row.ticker,
      report: row.reportJson,
      generatedAt: row.generatedAt?.toISOString() ?? null,
      modelUsed: row.modelUsed,
    });
  } catch (error) {
    logRouteError('research-report:by-id', error);
    return internalServerError();
  }
}
