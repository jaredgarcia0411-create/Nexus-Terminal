import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { importedResearchReports, tickerResearchSummaries } from '@/lib/db/schema';
import { fetchTickerData } from '@/lib/jarvis/askedgar';
import { callJarvis } from '@/lib/jarvis/client';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TICKER_REGEX = /^[A-Z0-9.\-^]{1,10}$/;

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return Response.json({ error: 'Database not configured' }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ticker = String(body.ticker ?? '').trim().toUpperCase();

  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return Response.json({ error: 'Valid ticker required' }, { status: 400 });
  }

  try {
    const [askEdgarData, summaryRows, discordRows] = await Promise.all([
      fetchTickerData(ticker),
      db
        .select()
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

    const historicalSummary = summaryRows[0]?.historicalSummary ?? null;
    const latestDiscordReport = discordRows[0] ?? null;

    const trimmedData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(askEdgarData.rawData)) {
      const endpoint = value as { results?: unknown[] };
      if (Array.isArray(endpoint.results) && endpoint.results.length > 0) {
        trimmedData[key] = endpoint.results.slice(0, 2);
      }
    }

    const systemPrompt = `You are a financial analyst specializing in small-cap dilution risk assessment. Given SEC filing data and historical context, produce a concise research TLDR. Return ONLY valid JSON with this structure:
{
  "tldr": "2-3 sentence summary of current dilution/offering risk state",
  "findings": ["key data point 1", "key data point 2", ...],
  "actionSteps": ["what to watch for 1", "what to watch for 2", ...],
  "risks": ["main risk 1", "main risk 2", ...],
  "historicalContext": "1-2 sentences on how the risk profile has evolved, or null if no history"
}
Never fabricate data. Use null for missing values. Be direct and actionable.`;

    const userPrompt = [
      `Ticker: ${ticker}`,
      `\nAsk Edgar Data:\n${JSON.stringify(trimmedData, null, 1)}`,
      historicalSummary ? `\nHistorical Summary:\n${JSON.stringify(historicalSummary, null, 1)}` : '',
      latestDiscordReport
        ? `\nLatest Discord Report (${latestDiscordReport.reportDate.toISOString().slice(0, 10)}):\n${latestDiscordReport.rawText.slice(0, 2000)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const llmResponse = await callJarvis(systemPrompt, userPrompt);
    const parsed = JSON.parse(llmResponse.content) as Record<string, unknown>;

    return Response.json({
      ticker,
      ...parsed,
      generatedAt: new Date().toISOString(),
      hasHistoricalData: historicalSummary !== null,
    });
  } catch (error) {
    console.error('[askedgar-tldr]', error);
    return Response.json({ error: 'TLDR generation failed' }, { status: 500 });
  }
}
