import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { fetchTickerData } from '@/lib/jarvis/askedgar';
import { callJarvis } from '@/lib/jarvis/client';
import { buildContext } from '@/lib/jarvis/context';
import { JARVIS_SYSTEM_PROMPT, buildResearchPrompt } from '@/lib/jarvis/prompts';

interface ResearchPipelineOptions {
  forceRefresh?: boolean;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCacheableReport(report: unknown): report is Record<string, unknown> {
  return isObject(report);
}

function collectRawDataWarnings(rawData: unknown) {
  if (!isObject(rawData)) return ['AskEdgar raw data missing'];

  const entries = Object.entries(rawData);
  if (entries.length === 0) return ['AskEdgar raw data missing'];

  const warnings: string[] = [];
  for (const [endpoint, payload] of entries) {
    if (!isObject(payload)) {
      warnings.push(`${endpoint} unavailable: Invalid endpoint payload`);
      continue;
    }

    if (typeof payload.error === 'string' && payload.error.trim()) {
      warnings.push(`${endpoint} unavailable: ${payload.error}`);
    }
  }

  return warnings;
}

function canReuseCachedReport(input: {
  status: string;
  reportJson: unknown;
  rawData: unknown;
}) {
  if (input.status !== 'complete') return false;
  if (!isCacheableReport(input.reportJson)) return false;
  return collectRawDataWarnings(input.rawData).length === 0;
}

export async function runResearchPipeline(userId: string, ticker: string, options: ResearchPipelineOptions = {}) {
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

  const [cached] = options.forceRefresh
    ? []
    : await db.select()
      .from(researchReports)
      .where(and(
        eq(researchReports.userId, userId),
        eq(researchReports.ticker, normalizedTicker),
        gte(researchReports.generatedAt, startOfTodayUtc),
      ))
      .limit(1);

  if (cached && canReuseCachedReport({ status: cached.status, reportJson: cached.reportJson, rawData: cached.rawData })) {
    return {
      fromCache: true,
      ticker: normalizedTicker,
      report: cached.reportJson,
      rawData: cached.rawData,
      modelUsed: cached.modelUsed ?? '',
      warnings: collectRawDataWarnings(cached.rawData),
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
