import { and, desc, eq, gte } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { getCachedTickerData } from '@/lib/askedgar';
import type { AskEdgarResponse } from '@/lib/askedgar';
import { callLlm } from '@/lib/llm-client';

export interface ResearchTldr {
  findings: string[];
  historicalContext: string | null;
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

function buildResearchTldrPrompt(
  reportData: Record<string, unknown[]>,
  options?: { ticker?: string; historicalSummary?: unknown; discordReport?: { date: string; text: string } },
): string {
  const parts = [
    `Analyze this AskEdgar data and return a compact JSON research summary.`,
    options?.ticker ? `\nTicker: ${options.ticker}` : '',
    `
OUTPUT FORMAT (strict JSON, no markdown):
{
  "findings": ["bullet 1", "bullet 2", ...],
  "historicalContext": "1-2 sentences on how the risk profile has evolved, or null if no history"
}

RULES:
- findings: maximum 10 bullets, ranked from highest dilution-trigger risk first to lowest at the bottom.
- For the top bullets that represent imminent dilution risk, prefix with "**High Risk:**" (in bold markdown).
- For the next tier of cautionary items (warrants near strike, recent offering pattern, compliance watch), prefix with "**Watch:**".
- Below those, write plain factual bullets (cash on hand, share count growth, recent offering price, insider ownership, etc.) without prefixes.
- Be specific with numbers (prices, dates, percentages, share counts) when available.
- Never fabricate data. Use null or omit a bullet if the underlying field is missing.
- JSON only, no explanation, no markdown fences.

<report_data>
${JSON.stringify(reportData)}
</report_data>`,
    options?.historicalSummary
      ? `\n<historical_summary>\n${JSON.stringify(options.historicalSummary, null, 1)}\n</historical_summary>`
      : '',
    options?.discordReport
      ? `\n<latest_discord_report date="${options.discordReport.date}">\n${options.discordReport.text.slice(0, 2000)}\n</latest_discord_report>`
      : '',
  ];
  return parts.filter(Boolean).join('\n');
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

  const result = await getCachedTickerData(normalizedTicker);
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
 * Generate a compact TLDR from AskEdgar data for the research tab display.
 * Expects rawData from fetchAndCacheRawReport() or fetchTickerData().
 */
export async function runResearchTldr(
  rawData: Record<string, AskEdgarResponse<unknown>>,
  ticker: string,
  context?: { historicalSummary?: unknown; discordReport?: { date: string; text: string } },
): Promise<ResearchTldr> {
  const trimmed = trimRawDataForLlm(rawData);
  const userPrompt = buildResearchTldrPrompt(trimmed, {
    ticker,
    historicalSummary: context?.historicalSummary,
    discordReport: context?.discordReport,
  });
  const reply = await callLlm(
    'You are a financial analyst specializing in small-cap dilution risk assessment. Return JSON only.',
    userPrompt,
  );

  const parsed = parseJson(reply.content);
  const parsedObj = isObject(parsed) ? parsed : {};

  const toStringArray = (val: unknown) =>
    Array.isArray(val) ? val.filter((item): item is string => typeof item === 'string') : [];

  return {
    findings: toStringArray(parsedObj.findings).slice(0, 10),
    historicalContext: typeof parsedObj.historicalContext === 'string' ? parsedObj.historicalContext : null,
  };
}
