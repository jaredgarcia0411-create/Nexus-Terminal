import { and, desc, eq } from 'drizzle-orm';

import { z } from 'zod';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { importedResearchReports, tickerResearchSummaries } from '@/lib/db/schema';
import { getCachedTickerData } from '@/lib/askedgar';
import { runResearchTldr } from '@/lib/research';
import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const tldrSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-^]{1,10}$/, 'Valid ticker required'),
});

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  const bodyState = await parseAndValidate(request, tldrSchema);
  if (bodyState.error) return bodyState.error;
  const { ticker } = bodyState.data;

  try {
    // Fetch AskEdgar data + optional historical/discord context in parallel
    const [askEdgarData, summaryRows, discordRows] = await Promise.all([
      getCachedTickerData(ticker),
      db
        .select({ historicalSummary: tickerResearchSummaries.historicalSummary })
        .from(tickerResearchSummaries)
        .where(and(eq(tickerResearchSummaries.userId, authState.user.id), eq(tickerResearchSummaries.ticker, ticker)))
        .limit(1),
      db
        .select({ rawText: importedResearchReports.rawText, reportDate: importedResearchReports.reportDate })
        .from(importedResearchReports)
        .where(and(eq(importedResearchReports.userId, authState.user.id), eq(importedResearchReports.ticker, ticker)))
        .orderBy(desc(importedResearchReports.reportDate))
        .limit(1),
    ]);

    const historicalSummary = summaryRows[0]?.historicalSummary ?? undefined;
    const latestDiscord = discordRows[0];
    const discordReport = latestDiscord
      ? { date: latestDiscord.reportDate.toISOString().slice(0, 10), text: latestDiscord.rawText }
      : undefined;

    const result = await runResearchTldr(askEdgarData.rawData, ticker, {
      historicalSummary,
      discordReport,
    });

    return Response.json({
      ticker,
      ...result,
      generatedAt: new Date().toISOString(),
      hasHistoricalData: historicalSummary !== undefined,
    });
  } catch (error) {
    logRouteError('askedgar-tldr', error);
    return internalServerError();
  }
}
