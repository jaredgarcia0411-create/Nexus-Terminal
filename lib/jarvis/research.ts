import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { fetchTickerData } from '@/lib/jarvis/askedgar';
import type { AskEdgarResponse } from '@/lib/jarvis/askedgar';
import { callJarvis } from '@/lib/jarvis/client';
import { buildResearchPrompt, buildResearchTldrPrompt } from '@/lib/jarvis/prompts';
import type { DilutionResearchReport } from '@/lib/jarvis/types';

interface ResearchPipelineOptions {
  forceRefresh?: boolean;
}

export interface ResearchTldr {
  tldr: string;
  findings: string[];
  actionSteps: string[];
  risks: string[];
}

function parseJson(text: string): unknown {
  // Try raw JSON first
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch { /* fall through */ }
  }

  return { message: text };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCacheableReport(report: unknown): report is Record<string, unknown> {
  if (!isObject(report)) return false;

  const candidate = report as Partial<DilutionResearchReport>;
  return (
    typeof candidate.ticker === 'string'
    && typeof candidate.generatedAt === 'string'
    && isObject(candidate.header)
    && Array.isArray(candidate.dataSources)
    && Array.isArray(candidate.news)
    && Array.isArray(candidate.catalysts)
    && isObject(candidate.dilution)
    && isObject(candidate.offeringFrequency)
    && isObject(candidate.offeringAbility)
    && isObject(candidate.cashNeed)
    && typeof candidate.managementCommentary === 'string'
    && isObject(candidate.overallOfferingRisk)
    && isObject(candidate.scamRisk)
    && Array.isArray(candidate.agreements)
    && Array.isArray(candidate.historicalFloat)
    && Array.isArray(candidate.reverseSplits)
    && Array.isArray(candidate.filingTitles)
  );
}

/**
 * Strips wrapper fields and error responses from AskEdgar data to reduce token count.
 * Only keeps the `results` arrays from endpoints that actually returned data.
 * Limits array sizes to keep the payload under LLM context limits.
 */
const MAX_ITEMS_PER_ENDPOINT = 2;

// Fields that waste tokens without helping analysis (long URLs, internal IDs)
const DROP_FIELDS = new Set(['documentUrl', 'accessionNumber', 'cik', 'fileNo']);

function stripVerboseFields(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripVerboseFields);
  if (typeof obj === 'object' && obj !== null) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!DROP_FIELDS.has(k)) cleaned[k] = v;
    }
    return cleaned;
  }
  return obj;
}

function trimRawDataForLlm(rawData: Record<string, AskEdgarResponse<unknown>>): Record<string, unknown[]> {
  const trimmed: Record<string, unknown[]> = {};

  for (const [key, response] of Object.entries(rawData)) {
    // Skip endpoints that returned errors or no data
    if (!response || response.status === 'error' || !Array.isArray(response.results) || response.results.length === 0) {
      continue;
    }
    // Cap results per endpoint and strip verbose fields to save tokens
    const capped = response.results.slice(0, MAX_ITEMS_PER_ENDPOINT);
    trimmed[key] = capped.map(item => stripVerboseFields(item)) as unknown[];
  }

  return trimmed;
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

  // Build a minimal context for research — no user trades or memory needed,
  // and trim the AskEdgar data to only include successful results (saves ~70% tokens)
  const trimmedData = trimRawDataForLlm(askedgarData.rawData as Record<string, AskEdgarResponse<unknown>>);
  const prompt = buildResearchPrompt(trimmedData);

  try {
    // Minimal system prompt for research — saves ~500 tokens vs full JARVIS_SYSTEM_PROMPT
    const llm = await callJarvis(
      'You are a financial analyst. Return structured JSON from SEC filing data. Never fabricate data — use null for missing values.',
      prompt,
    );
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

/**
 * Fetch AskEdgar data for a ticker and cache it — no LLM call.
 * Used by the Research Tab to display raw structured data directly.
 */
export async function fetchAndCacheRawReport(
  userId: string,
  ticker: string,
): Promise<{
  fromCache: boolean;
  ticker: string;
  rawData: Record<string, AskEdgarResponse<unknown>>;
  warnings: string[];
  generatedAt: string;
}> {
  const db = getDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  const normalizedTicker = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.\-^]+$/.test(normalizedTicker)) {
    throw new Error('Invalid ticker');
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [cached] = await db.select({
    rawData: researchReports.rawData,
    generatedAt: researchReports.generatedAt,
  })
    .from(researchReports)
    .where(and(
      eq(researchReports.userId, userId),
      eq(researchReports.ticker, normalizedTicker),
      gte(researchReports.generatedAt, startOfDay),
    ))
    .orderBy(desc(researchReports.generatedAt))
    .limit(1);

  if (isObject(cached?.rawData) && Object.keys(cached.rawData).length > 0) {
    const generatedAt = cached.generatedAt ?? new Date();
    return {
      fromCache: true,
      ticker: normalizedTicker,
      rawData: cached.rawData as Record<string, AskEdgarResponse<unknown>>,
      warnings: collectRawDataWarnings(cached.rawData),
      generatedAt: generatedAt.toISOString(),
    };
  }

  const result = await fetchTickerData(normalizedTicker);
  const generatedAt = new Date();

  await db.insert(researchReports).values({
    id: crypto.randomUUID(),
    userId,
    ticker: normalizedTicker,
    status: 'complete',
    rawData: result.rawData,
    reportJson: null,
    modelUsed: null,
    generatedAt,
  });

  return {
    fromCache: false,
    ticker: normalizedTicker,
    rawData: result.rawData,
    warnings: result.warnings,
    generatedAt: generatedAt.toISOString(),
  };
}

/**
 * Generate a compact TLDR from AskEdgar data for Jarvis chat display.
 * Expects rawData from fetchAndCacheRawReport() or fetchTickerData().
 */
export async function runResearchTldr(
  rawData: Record<string, AskEdgarResponse<unknown>>,
  ticker: string,
): Promise<ResearchTldr> {
  const trimmed = trimRawDataForLlm(rawData);
  const userPrompt = buildResearchTldrPrompt(trimmed);
  const reply = await callJarvis(
    'You are a trading research analyst. Return JSON only.',
    userPrompt,
  );

  const parsed = parseJson(reply.content);
  const parsedObj = isObject(parsed) ? parsed : {};

  const tldr = typeof parsedObj.tldr === 'string'
    ? parsedObj.tldr
    : `Research data fetched for ${ticker} but TLDR generation failed.`;

  const findings = Array.isArray(parsedObj.findings)
    ? parsedObj.findings.filter((item): item is string => typeof item === 'string')
    : [];
  const actionSteps = Array.isArray(parsedObj.actionSteps)
    ? parsedObj.actionSteps.filter((item): item is string => typeof item === 'string')
    : [];
  const risks = Array.isArray(parsedObj.risks)
    ? parsedObj.risks.filter((item): item is string => typeof item === 'string')
    : [];

  return { tldr, findings, actionSteps, risks };
}
