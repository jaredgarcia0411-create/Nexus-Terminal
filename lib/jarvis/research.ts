import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { fetchTickerData } from '@/lib/jarvis/askedgar';
import { callJarvis } from '@/lib/jarvis/client';
import { buildContext } from '@/lib/jarvis/context';
import { JARVIS_SYSTEM_PROMPT, buildResearchPrompt } from '@/lib/jarvis/prompts';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function runResearchPipeline(userId: string, ticker: string) {
  const db = getDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  const normalizedTicker = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.\-^]+$/.test(normalizedTicker)) {
    throw new Error('Invalid ticker');
  }

  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);

  const [cached] = await db.select()
    .from(researchReports)
    .where(and(
      eq(researchReports.userId, userId),
      eq(researchReports.ticker, normalizedTicker),
      gte(researchReports.generatedAt, startOfTodayUtc),
      eq(researchReports.status, 'complete'),
    ))
    .limit(1);

  if (cached) {
    return {
      fromCache: true,
      ticker: normalizedTicker,
      report: cached.reportJson,
      rawData: cached.rawData,
      modelUsed: cached.modelUsed ?? '',
    };
  }

  const askedgarData = await fetchTickerData(normalizedTicker);
  const context = await buildContext(userId, 'research');
  const prompt = buildResearchPrompt({ ...context, report_data: askedgarData.rawData });

  try {
    const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
    const parsed = parseJson(llm.content);

    await db.insert(researchReports).values({
      id: crypto.randomUUID(),
      userId,
      ticker: normalizedTicker,
      status: 'complete',
      rawData: askedgarData.rawData,
      reportJson: parsed,
      modelUsed: llm.modelUsed,
      generatedAt: new Date(),
    });

    return {
      fromCache: false,
      ticker: normalizedTicker,
      report: parsed,
      rawData: askedgarData.rawData,
      modelUsed: llm.modelUsed,
      warnings: askedgarData.warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research generation failed';
    await db.insert(researchReports).values({
      id: crypto.randomUUID(),
      userId,
      ticker: normalizedTicker,
      status: 'failed',
      rawData: askedgarData.rawData,
      errorMessage: message,
      generatedAt: new Date(),
    });
    throw error;
  }
}
