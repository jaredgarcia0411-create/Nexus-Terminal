import { getDb } from '@/lib/db';
import { callJarvis } from '@/lib/jarvis/client';
import { buildContext } from '@/lib/jarvis/context';
import { extractTradeInsights } from '@/lib/jarvis/memory';
import { JARVIS_SYSTEM_PROMPT, buildTradeAnalysisPrompt } from '@/lib/jarvis/prompts';
import type { TradeAnalysisOutput } from '@/lib/jarvis/types';

function normalizeTradeAnalysisPayload(payload: unknown): TradeAnalysisOutput {
  const rec = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const toArray = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item)) : [];
  return {
    strengths: toArray(rec.strengths),
    weaknesses: toArray(rec.weaknesses),
    patterns: toArray(rec.patterns),
    action_items: toArray(rec.action_items),
  };
}

function parseJson(text: string): unknown {
  try {
    let cleaned = text.trim();
    // LLMs often wrap JSON in markdown code fences — strip them
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

export async function runTradeAnalysisPipeline(userId: string) {
  const db = getDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  const context = await buildContext(userId);
  const prompt = buildTradeAnalysisPrompt(context);
  const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
  const normalized = normalizeTradeAnalysisPayload(parseJson(llm.content));

  await extractTradeInsights(userId, normalized);

  return {
    analysis: normalized,
    modelUsed: llm.modelUsed,
  };
}
