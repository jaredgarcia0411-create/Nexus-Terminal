import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';

import { generateSmallCapResearchReport } from '@/lib/agents/blueprints/small-cap-research';
import { estimateCostCents } from '@/lib/agents/model-pricing';
import { recordLlmAttempt } from '@/lib/agents/runtime-limits';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
// Vercel kills the function at this boundary. AskEdgar fanout (14 endpoints
// on a cold cache) can take 15-25s and the LLM call up to 60s+ on its own —
// the previous 60s cap meant any cold-cache ticker would 504 mid-LLM.
// Cron routes already use 300s; the research POST belongs in the same bucket.
export const maxDuration = 300;

const tickerPattern = /^[A-Z0-9.\-^]{1,10}$/;
// Reuse the same row across users for 16 hours - typical small-cap dilution data
// doesn't shift meaningfully within a single trading session, and we want one LLM
// call per ticker per ~day across the whole team.
const CACHE_TTL_HOURS = 16;

const postSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(tickerPattern, 'Valid ticker required'),
});

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const maybeError = err as { code?: unknown; cause?: { code?: unknown } };
  return maybeError.code === '23505' || maybeError.cause?.code === '23505';
}

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
        id: researchReports.id,
        reportJson: researchReports.reportJson,
        generatedAt: researchReports.generatedAt,
        modelUsed: researchReports.modelUsed,
      })
      .from(researchReports)
      .where(and(
        eq(researchReports.ticker, ticker),
        eq(researchReports.status, 'complete'),
        gte(researchReports.generatedAt, freshSince),
      ))
      .orderBy(desc(researchReports.generatedAt))
      .limit(1);

    // Older rows can have reportJson=null from legacy seeding; treat them as "no fresh report".
    if (latest?.reportJson) {
      return Response.json({
        ticker,
        id: latest.id,
        report: latest.reportJson,
        generatedAt: latest.generatedAt?.toISOString() ?? null,
        modelUsed: latest.modelUsed,
        cached: true,
      });
    }

    return Response.json({ ticker, id: null, report: null, generatedAt: null, cached: false });
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

    // Must run after ensureUser: rate_limits has an FK to users.id, and
    // ensureUser is what guarantees (and may remap) the canonical user row.
    const rate = await checkRateLimit(db, user.id, 'research-report');
    if (rate.limited) return rateLimitResponse(rate);

    const staleSince = new Date(Date.now() - 90_000);
    await db.delete(researchReports).where(and(
      eq(researchReports.ticker, ticker),
      eq(researchReports.status, 'in_progress'),
      lt(researchReports.generatedAt, staleSince),
    ));

    const claimId = crypto.randomUUID();
    const claimedAt = new Date();
    let isOwner = true;
    try {
      await db.insert(researchReports).values({
        id: claimId,
        userId: user.id,
        ticker,
        status: 'in_progress',
        rawData: null,
        reportJson: null,
        modelUsed: null,
        generatedAt: claimedAt,
      });
    } catch (insertError) {
      if (!isUniqueViolation(insertError)) throw insertError;
      isOwner = false;
    }

    if (!isOwner) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(2000);
        const freshSince = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);
        const [latest] = await db
          .select({
            id: researchReports.id,
            reportJson: researchReports.reportJson,
            generatedAt: researchReports.generatedAt,
            modelUsed: researchReports.modelUsed,
          })
          .from(researchReports)
          .where(and(
            eq(researchReports.ticker, ticker),
            eq(researchReports.status, 'complete'),
            gte(researchReports.generatedAt, freshSince),
          ))
          .orderBy(desc(researchReports.generatedAt))
          .limit(1);

        if (latest?.reportJson) {
          return Response.json({
            ticker,
            id: latest.id,
            report: latest.reportJson,
            generatedAt: latest.generatedAt?.toISOString() ?? null,
            modelUsed: latest.modelUsed,
            cached: true,
          });
        }
      }

      return Response.json(
        { error: 'Report generation in progress; retry shortly.' },
        { status: 503 },
      );
    }

    try {
      const telemetryDb = db as unknown as Parameters<typeof recordLlmAttempt>[0];
      const generationStart = Date.now();
      let generation: Awaited<ReturnType<typeof generateSmallCapResearchReport>>;
      try {
        generation = await generateSmallCapResearchReport(ticker);
      } catch (genErr) {
        await recordLlmAttempt(telemetryDb, {
          userId: user.id,
          agentId: 'small-cap-trader',
          mode: 'site-research-report',
          lane: 'background',
          modelUsed: 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostCents: 0,
          durationMs: Date.now() - generationStart,
          success: false,
        }).catch(() => undefined);
        throw genErr;
      }

      const { report, llmUsage } = generation;
      await recordLlmAttempt(telemetryDb, {
        userId: user.id,
        agentId: 'small-cap-trader',
        mode: 'site-research-report',
        lane: 'background',
        modelUsed: llmUsage.modelUsed,
        inputTokens: llmUsage.inputTokens,
        outputTokens: llmUsage.outputTokens,
        totalTokens: llmUsage.inputTokens + llmUsage.outputTokens,
        estimatedCostCents: estimateCostCents(
          llmUsage.modelUsed,
          llmUsage.inputTokens,
          llmUsage.outputTokens,
        ),
        durationMs: llmUsage.durationMs,
        success: true,
      }).catch(() => undefined);

      const generatedAt = new Date();
      await db.update(researchReports)
        .set({
          status: 'complete',
          reportJson: report,
          modelUsed: 'small-cap-research',
          generatedAt,
        })
        .where(eq(researchReports.id, claimId));

      return Response.json({
        ticker,
        id: claimId,
        report,
        generatedAt: generatedAt.toISOString(),
        cached: false,
      });
    } catch (generationError) {
      await db.delete(researchReports).where(eq(researchReports.id, claimId)).catch(() => undefined);
      throw generationError;
    }
  } catch (error) {
    logRouteError('research-report:post', error);
    return internalServerError();
  }
}
