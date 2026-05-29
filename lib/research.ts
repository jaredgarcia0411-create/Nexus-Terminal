import { and, eq, gt, lt } from 'drizzle-orm';

import { getCachedTickerData } from '@/lib/askedgar';
import type { AskEdgarResponse } from '@/lib/askedgar';
import { estimateCostCents } from '@/lib/agents/model-pricing';
import { recordSiteLlmUsage } from '@/lib/agents/runtime-limits';
import { getDb } from '@/lib/db';
import { askedgarCache, researchTldrClaims } from '@/lib/db/schema';
import { callLlm, type LlmUsage } from '@/lib/llm-client';

export interface ResearchTldr {
  findings: string[];
  historicalContext: string | null;
}

export interface ResearchTldrGeneration {
  tldr: ResearchTldr;
  usage: LlmUsage;
  modelUsed: string;
  durationMs: number;
}

const TLDR_CACHE_TTL_MS = 16 * 60 * 60 * 1000; // 16 hours, matches AskEdgar ticker cache
const CLAIM_STALE_MS = 90_000;
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 1500;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const maybeError = err as { code?: unknown; cause?: { code?: unknown } };
  return maybeError.code === '23505' || maybeError.cause?.code === '23505';
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
  options?: { ticker?: string },
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
- findings: max 10 bullets, ranked highest dilution-trigger risk first.
- Plain factual bullets only — never prefix with "High Risk", "Watch", or any risk label.
- Format share counts and large dollar amounts with thousands separators (e.g., 12,345,678 — not 12345678 or 12.3M).
- When mentioning warrants, include the strike price.
- Cash position: cover in AT MOST 1 bullet that combines cash on hand, monthly burn, and runway in months. Do not split these across multiple bullets.
- Most recent news: include exactly 1 bullet with the most recent headline from the news endpoint (form_type = "news") and its filed date. Format as: "Latest news (YYYY-MM-DD): <headline>". Skip if no news items are present.
- Be specific with numbers (prices, dates, percentages, share counts). Use null or omit a bullet if a field is missing — never fabricate.
- JSON only, no markdown fences.

<report_data>
${JSON.stringify(reportData)}
</report_data>`,
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
 * Generate a compact TLDR from AskEdgar data for the research tab display.
 * Expects rawData from getCachedTickerData().
 */
export async function runResearchTldr(
  rawData: Record<string, AskEdgarResponse<unknown>>,
  ticker: string,
): Promise<ResearchTldrGeneration> {
  const trimmed = trimRawDataForLlm(rawData);
  const userPrompt = buildResearchTldrPrompt(trimmed, {
    ticker,
  });
  const start = Date.now();
  const reply = await callLlm(
    'You are a financial analyst specializing in small-cap dilution risk assessment. Return JSON only.',
    userPrompt,
  );
  const durationMs = Date.now() - start;

  const parsed = parseJson(reply.content);
  const parsedObj = isObject(parsed) ? parsed : {};

  const toStringArray = (val: unknown) =>
    Array.isArray(val) ? val.filter((item): item is string => typeof item === 'string') : [];

  return {
    tldr: {
      findings: toStringArray(parsedObj.findings).slice(0, 10),
      historicalContext: typeof parsedObj.historicalContext === 'string' ? parsedObj.historicalContext : null,
    },
    usage: reply.usage,
    modelUsed: reply.modelUsed,
    durationMs,
  };
}

/**
 * Cached wrapper around runResearchTldr.
 *
 * The TLDR is an LLM-derived summary of AskEdgar data — for a given ticker,
 * regenerating it on every page visit is wasteful (slow + cost). We cache the
 * result in the shared `askedgar_cache` table under cacheType='tldr' for 16
 * hours, which matches the underlying ticker cache TTL.
 *
 * Returns the same shape as runResearchTldr; the route layer adds ticker /
 * generatedAt fields.
 */
async function readFreshTldr(
  db: NonNullable<ReturnType<typeof getDb>>,
  ticker: string,
): Promise<ResearchTldr | null> {
  const rows = await db
    .select()
    .from(askedgarCache)
    .where(
      and(
        eq(askedgarCache.cacheType, 'tldr'),
        eq(askedgarCache.ticker, ticker),
        gt(askedgarCache.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows.length > 0 ? (rows[0].dataJson as ResearchTldr) : null;
}

async function generateAndCacheTldr(
  db: NonNullable<ReturnType<typeof getDb>>,
  ticker: string,
  userId: string,
): Promise<ResearchTldr> {
  const telemetryDb = db as unknown as Parameters<typeof recordSiteLlmUsage>[0];
  const askEdgarData = await getCachedTickerData(ticker);

  let generation: ResearchTldrGeneration;
  try {
    generation = await runResearchTldr(askEdgarData.rawData, ticker);
  } catch (genErr) {
    await recordSiteLlmUsage(telemetryDb, {
      userId,
      agentId: 'small-cap-trader',
      mode: 'site-research-tldr',
      lane: 'background',
      modelUsed: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCents: 0,
      durationMs: 0,
      success: false,
    }).catch(() => undefined);
    throw genErr;
  }

  const { tldr, usage, modelUsed, durationMs } = generation;
  await recordSiteLlmUsage(telemetryDb, {
    userId,
    agentId: 'small-cap-trader',
    mode: 'site-research-tldr',
    lane: 'background',
    modelUsed,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    estimatedCostCents: estimateCostCents(modelUsed, usage.inputTokens, usage.outputTokens),
    durationMs,
    success: true,
  }).catch(() => undefined);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TLDR_CACHE_TTL_MS);
  try {
    await db
      .insert(askedgarCache)
      .values({
        id: `tldr-${ticker}`,
        cacheType: 'tldr',
        ticker,
        dataJson: tldr,
        fetchedAt: now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [askedgarCache.cacheType, askedgarCache.ticker],
        set: { dataJson: tldr, fetchedAt: now, expiresAt },
      });
  } catch (err) {
    console.warn('[research-tldr-cache] Failed to write tldr cache:', err);
  }

  return tldr;
}

export async function getCachedResearchTldr(ticker: string, userId: string): Promise<ResearchTldr> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const db = getDb();

  if (!db) {
    const askEdgarData = await getCachedTickerData(normalizedTicker);
    const { tldr } = await runResearchTldr(askEdgarData.rawData, normalizedTicker);
    return tldr;
  }

  const hit = await readFreshTldr(db, normalizedTicker);
  if (hit) return hit;

  await db
    .delete(researchTldrClaims)
    .where(lt(researchTldrClaims.claimedAt, new Date(Date.now() - CLAIM_STALE_MS)))
    .catch(() => undefined);

  let isOwner = true;
  let shouldReleaseClaim = false;
  try {
    await db.insert(researchTldrClaims).values({ ticker: normalizedTicker, claimedAt: new Date() });
    shouldReleaseClaim = true;
  } catch (err) {
    if (isUniqueViolation(err)) {
      isOwner = false;
    } else {
      console.warn('[research-tldr-claim] Failed to claim tldr generation:', err);
    }
  }

  if (!isOwner) {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await sleep(POLL_INTERVAL_MS);
      const cached = await readFreshTldr(db, normalizedTicker);
      if (cached) return cached;
    }

    return generateAndCacheTldr(db, normalizedTicker, userId);
  }

  try {
    return await generateAndCacheTldr(db, normalizedTicker, userId);
  } finally {
    if (shouldReleaseClaim) {
      await db
        .delete(researchTldrClaims)
        .where(eq(researchTldrClaims.ticker, normalizedTicker))
        .catch(() => undefined);
    }
  }
}
