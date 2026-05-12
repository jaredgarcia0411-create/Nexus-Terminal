import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import { generateSmallCapResearchReport } from '@/lib/agents/blueprints/small-cap-research';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const tickerPattern = /^[A-Z0-9.\-^]{1,10}$/;
// Reuse the same row across users for 16 hours - typical small-cap dilution data
// doesn't shift meaningfully within a single trading session, and we want one LLM
// call per ticker per ~day across the whole team.
const CACHE_TTL_HOURS = 16;

const postSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(tickerPattern, 'Valid ticker required'),
});

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();

    const url = new URL(request.url);
    const ticker = url.searchParams.get('ticker')?.trim().toUpperCase() ?? '';
    if (!tickerPattern.test(ticker)) {
      return Response.json({ error: 'Valid ticker required' }, { status: 400 });
    }

    const freshSince = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);
    const [latest] = await db
      .select({
        reportJson: researchReports.reportJson,
        generatedAt: researchReports.generatedAt,
        modelUsed: researchReports.modelUsed,
      })
      .from(researchReports)
      .where(and(
        eq(researchReports.ticker, ticker),
        gte(researchReports.generatedAt, freshSince),
      ))
      .orderBy(desc(researchReports.generatedAt))
      .limit(1);

    // Older rows can have reportJson=null from legacy seeding; treat them as "no fresh report".
    if (latest?.reportJson) {
      return Response.json({
        ticker,
        report: latest.reportJson,
        generatedAt: latest.generatedAt?.toISOString() ?? null,
        modelUsed: latest.modelUsed,
        cached: true,
      });
    }

    return Response.json({ ticker, report: null, generatedAt: null, cached: false });
  } catch (error) {
    logRouteError('research-report:get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();

    const bodyState = await parseAndValidate(request, postSchema);
    if (bodyState.error) return bodyState.error;
    const { ticker } = bodyState.data;

    const user = await ensureUser(db, authState.user);
    const report = await generateSmallCapResearchReport(ticker);
    const generatedAt = new Date();

    // Audit trail: store who triggered the generation. The GET above ignores userId
    // for cache reads so the row still satisfies the team-wide 16h cache window.
    await db.insert(researchReports).values({
      id: crypto.randomUUID(),
      userId: user.id,
      ticker,
      status: 'complete',
      rawData: null,
      reportJson: report,
      modelUsed: 'small-cap-research',
      generatedAt,
    });

    return Response.json({
      ticker,
      report,
      generatedAt: generatedAt.toISOString(),
      cached: false,
    });
  } catch (error) {
    logRouteError('research-report:post', error);
    return internalServerError();
  }
}
