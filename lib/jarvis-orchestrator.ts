import {
  type JarvisMacroSummaryOutput,
  type JarvisMode,
  type JarvisSourceContext,
  type JarvisStructuredResponse,
  type ScrapedChunk,
} from '@/lib/jarvis-types';
import {
  assembleKnowledgeContext,
  retrieveKnowledgeChunks,
} from '@/lib/jarvis-knowledge';
import {
  buildStructuredFallbackFromSources,
  formatStructuredMessage,
  parseJarvisLlmResponse,
} from '@/lib/jarvis-response';
import { buildSourceContexts } from '@/lib/jarvis-scrape';

const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v3.2';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const INTER_CALL_DELAY_MS = 1500;

export interface OrchestrationOptions {
  userId: string;
  mode: JarvisMode;
  prompt: string;
  tradeTickers: string[];
  scrapeChunks: ScrapedChunk[];
  sourceContexts: JarvisSourceContext[];
}

export interface OrchestrationResult {
  message: string;
  structured: JarvisStructuredResponse;
  macroSummary?: JarvisMacroSummaryOutput;
  steps: OrchestrationStepLog[];
}

export interface OrchestrationStepLog {
  step: 'plan' | 'retrieve' | 'summarize' | 'critique' | 'answer';
  durationMs: number;
  tokenEstimate: number;
  skipped: boolean;
}

interface RetrievalPlan {
  keywords: string[];
  tickers: string[];
  sourceTypes: string[];
  focusRegions: string[];
}

function estimateTokens(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCritiqueEnabled() {
  return String(process.env.JARVIS_ORCHESTRATION_CRITIQUE ?? 'false').toLowerCase() === 'true';
}

function getApiConfig() {
  const apiKey = process.env.JARVIS_API_KEY ?? process.env.NVIDIA_API_KEY;
  const model = process.env.JARVIS_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const baseUrl = process.env.JARVIS_API_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
  return { apiKey, model, baseUrl };
}

async function callLlm(systemPrompt: string, userMessage: string): Promise<string | null> {
  const { apiKey, model, baseUrl } = getApiConfig();
  if (!apiKey) return null;

  let res: Response;
  try {
    res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const payload = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

function fallbackPlan(prompt: string, tradeTickers: string[]): RetrievalPlan {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const keywords = [...new Set(words)].slice(0, 10);
  return {
    keywords,
    tickers: tradeTickers,
    sourceTypes: ['web_source', 'cached_headline', 'user_document'],
    focusRegions: ['us', 'eu', 'asia', 'global'],
  };
}

const PLAN_SYSTEM_PROMPT = [
  'You are a retrieval planner for a trading assistant.',
  'Given a user prompt and context, produce a JSON retrieval plan.',
  'Return ONLY valid JSON, no markdown, no code fences.',
  'Schema: { "keywords": string[], "tickers": string[], "sourceTypes": string[], "focusRegions": string[] }',
  'sourceTypes options: "web_source", "cached_headline", "trade_journal", "user_document"',
  'focusRegions options: "us", "eu", "asia", "global"',
].join('\n');

async function stepPlan(
  prompt: string,
  tradeTickers: string[],
  sourceContexts: JarvisSourceContext[],
): Promise<{ plan: RetrievalPlan; log: OrchestrationStepLog }> {
  const start = Date.now();

  const sourceHints = sourceContexts
    .slice(0, 5)
    .map((s) => `${s.host}: ${s.title}`)
    .join('; ');

  const userMessage = [
    `User prompt: ${prompt}`,
    `Known tickers: ${tradeTickers.join(', ') || 'none'}`,
    `Available sources: ${sourceHints || 'none'}`,
  ].join('\n');

  const raw = await callLlm(PLAN_SYSTEM_PROMPT, userMessage);
  const durationMs = Date.now() - start;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.keywords)) {
        return {
          plan: {
            keywords: parsed.keywords.filter((k: unknown) => typeof k === 'string').slice(0, 15),
            tickers: Array.isArray(parsed.tickers)
              ? parsed.tickers.filter((t: unknown) => typeof t === 'string')
              : tradeTickers,
            sourceTypes: Array.isArray(parsed.sourceTypes)
              ? parsed.sourceTypes.filter((s: unknown) => typeof s === 'string')
              : ['web_source', 'cached_headline'],
            focusRegions: Array.isArray(parsed.focusRegions)
              ? parsed.focusRegions.filter((r: unknown) => typeof r === 'string')
              : ['us', 'eu', 'asia', 'global'],
          },
          log: { step: 'plan', durationMs, tokenEstimate: estimateTokens(userMessage + (raw ?? '')), skipped: false },
        };
      }
    } catch {
      // Fall through to fallback
    }
  }

  return {
    plan: fallbackPlan(prompt, tradeTickers),
    log: { step: 'plan', durationMs, tokenEstimate: estimateTokens(userMessage), skipped: false },
  };
}

async function stepRetrieve(
  options: OrchestrationOptions,
  plan: RetrievalPlan,
): Promise<{ chunks: ScrapedChunk[]; log: OrchestrationStepLog }> {
  const start = Date.now();

  const query = [...plan.keywords, ...plan.tickers].join(' ');
  const validSourceTypes = plan.sourceTypes.filter(
    (t): t is 'web_source' | 'cached_headline' | 'trade_journal' | 'user_document' =>
      ['web_source', 'cached_headline', 'trade_journal', 'user_document'].includes(t),
  );

  const retrieved = await retrieveKnowledgeChunks({
    userId: options.userId,
    query: query || options.prompt,
    tickers: plan.tickers.length > 0 ? plan.tickers : options.tradeTickers,
    sourceTypes: validSourceTypes.length > 0 ? validSourceTypes : undefined,
    includeGlobal: true,
    limit: 40,
  }).catch(() => []);

  const assembled = assembleKnowledgeContext(retrieved);

  const deduped = new Map<string, ScrapedChunk>();
  for (const chunk of [...options.scrapeChunks, ...assembled.chunks]) {
    deduped.set(`${chunk.sourceUrl}:${chunk.hash}`, chunk);
  }
  const mergedChunks = [...deduped.values()];

  const durationMs = Date.now() - start;
  return {
    chunks: mergedChunks,
    log: { step: 'retrieve', durationMs, tokenEstimate: assembled.totalTokens, skipped: false },
  };
}

const SUMMARIZE_SYSTEM_PROMPT = [
  'You are Jarvis, a focused trading assistant. Be concise, practical, and risk-aware.',
  'Return ONLY valid JSON, with no markdown, no code fences, and no explanatory prose.',
  'Output must be a single JSON object with exactly these keys: tldr, findings, actionSteps, risks.',
  'Use this schema:',
  '{',
  '  "tldr": "<one sentence summary>",',
  '  "findings": ["<bullet style finding>", "..."],',
  '  "actionSteps": ["<concrete action>", "..."],',
  '  "risks": ["<risk-aware caveat>", "..."]',
  '}',
  'Prefer non-empty findings/actionSteps/risks; use "No items identified." only when no valid item is known.',
].join('\n');

const MACRO_SUMMARIZE_SYSTEM_PROMPT = [
  'You are Jarvis, a focused trading assistant producing a macro market summary.',
  'Return ONLY valid JSON, with no markdown, no code fences, and no explanatory prose.',
  'Output must be a single JSON object with these keys: tldr, findings, actionSteps, risks, macroSummary.',
  'Schema:',
  '{',
  '  "tldr": "<one sentence overall macro summary>",',
  '  "findings": ["<bullet style finding>", "..."],',
  '  "actionSteps": ["<concrete action>", "..."],',
  '  "risks": ["<risk-aware caveat>", "..."],',
  '  "macroSummary": {',
  '    "date": "<YYYY-MM-DD>",',
  '    "overallSentiment": "bullish" | "bearish" | "neutral" | "mixed",',
  '    "regions": [',
  '      {',
  '        "region": "us" | "eu" | "asia" | "global",',
  '        "headline": "<one sentence headline for this region>",',
  '        "details": ["<detail bullet>", "..."],',
  '        "sentiment": "bullish" | "bearish" | "neutral" | "mixed"',
  '      }',
  '    ],',
  '    "keyRisks": ["<global risk>", "..."]',
  '  }',
  '}',
  'Cover all 4 regions: us, eu, asia, global. Be specific about macro developments.',
].join('\n');

async function stepSummarize(
  options: OrchestrationOptions,
  chunks: ScrapedChunk[],
): Promise<{ message: string; structured: JarvisStructuredResponse; macroSummary?: JarvisMacroSummaryOutput; log: OrchestrationStepLog }> {
  const start = Date.now();
  const isMacro = options.mode === 'macro-summary';
  const systemPrompt = isMacro ? MACRO_SUMMARIZE_SYSTEM_PROMPT : SUMMARIZE_SYSTEM_PROMPT;

  const previewChunks = chunks.slice(0, 12);
  const chunkContext = previewChunks.length > 0
    ? previewChunks
      .map((chunk, i) => {
        const typeLabel = chunk.sourceType ? `[${chunk.sourceType}] ` : '';
        return `${i + 1}. ${typeLabel}${chunk.sourceHost} - ${chunk.sourceTitle} [relevance ${chunk.relevance?.toFixed(2) ?? '0.00'}]\n${chunk.text.slice(0, 640)}`;
      })
      .join('\n\n')
    : 'No source context available.';

  const userMessage = `${options.prompt}\n\nSource context:\n${chunkContext}`;
  const raw = await callLlm(systemPrompt, userMessage);
  const durationMs = Date.now() - start;

  if (raw) {
    const parsed = parseJarvisLlmResponse(raw);
    let macroSummary: JarvisMacroSummaryOutput | undefined;

    if (isMacro) {
      try {
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonPayload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
          if (jsonPayload.macroSummary && typeof jsonPayload.macroSummary === 'object') {
            macroSummary = validateMacroSummary(jsonPayload.macroSummary);
          }
        }
      } catch {
        // macroSummary extraction failed — proceed without it
      }
    }

    return {
      message: parsed.message,
      structured: parsed.structured,
      macroSummary,
      log: { step: 'summarize', durationMs, tokenEstimate: estimateTokens(userMessage + (raw ?? '')), skipped: false },
    };
  }

  const sourceContexts = buildSourceContexts(
    chunks.map((c) => ({ ...c, relevance: c.relevance ?? 0 })).sort((a, b) => b.relevance - a.relevance),
  );
  const fallback = buildStructuredFallbackFromSources({
    prompt: options.prompt,
    sources: sourceContexts,
  });

  return {
    message: formatStructuredMessage(fallback),
    structured: fallback,
    macroSummary: isMacro ? buildFallbackMacroSummary() : undefined,
    log: { step: 'summarize', durationMs, tokenEstimate: estimateTokens(userMessage), skipped: false },
  };
}

const CRITIQUE_SYSTEM_PROMPT = [
  'You are a quality reviewer for a trading assistant response.',
  'Given a summary, identify gaps, unsupported claims, and confidence issues.',
  'Return ONLY valid JSON:',
  '{ "gaps": ["..."], "unsupportedClaims": ["..."], "confidenceNote": "..." }',
].join('\n');

async function stepCritique(
  summary: string,
): Promise<{ critique: string | null; log: OrchestrationStepLog }> {
  if (!isCritiqueEnabled()) {
    return { critique: null, log: { step: 'critique', durationMs: 0, tokenEstimate: 0, skipped: true } };
  }

  const start = Date.now();
  const raw = await callLlm(CRITIQUE_SYSTEM_PROMPT, `Summary to review:\n${summary}`);
  const durationMs = Date.now() - start;

  return {
    critique: raw,
    log: { step: 'critique', durationMs, tokenEstimate: estimateTokens(summary + (raw ?? '')), skipped: false },
  };
}

function validateSentiment(value: unknown): 'bullish' | 'bearish' | 'neutral' | 'mixed' {
  if (typeof value === 'string' && ['bullish', 'bearish', 'neutral', 'mixed'].includes(value)) {
    return value as 'bullish' | 'bearish' | 'neutral' | 'mixed';
  }
  return 'neutral';
}

function validateRegionCode(value: unknown): 'us' | 'eu' | 'asia' | 'global' | null {
  if (typeof value === 'string' && ['us', 'eu', 'asia', 'global'].includes(value)) {
    return value as 'us' | 'eu' | 'asia' | 'global';
  }
  return null;
}

function validateMacroSummary(raw: unknown): JarvisMacroSummaryOutput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const regions = Array.isArray(obj.regions)
    ? obj.regions
      .map((r: unknown) => {
        if (!r || typeof r !== 'object') return null;
        const region = r as Record<string, unknown>;
        const code = validateRegionCode(region.region);
        if (!code) return null;
        return {
          region: code,
          headline: typeof region.headline === 'string' ? region.headline : 'No data available.',
          details: Array.isArray(region.details)
            ? region.details.filter((d: unknown) => typeof d === 'string') as string[]
            : [],
          sentiment: validateSentiment(region.sentiment),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    : [];

  if (regions.length === 0) return undefined;

  return {
    date: typeof obj.date === 'string' ? obj.date : new Date().toISOString().slice(0, 10),
    overallSentiment: validateSentiment(obj.overallSentiment),
    regions,
    keyRisks: Array.isArray(obj.keyRisks)
      ? obj.keyRisks.filter((r: unknown) => typeof r === 'string') as string[]
      : ['No key risks identified.'],
  };
}

function buildFallbackMacroSummary(): JarvisMacroSummaryOutput {
  return {
    date: new Date().toISOString().slice(0, 10),
    overallSentiment: 'neutral',
    regions: [
      { region: 'us', headline: 'Unable to generate US summary — LLM unavailable.', details: [], sentiment: 'neutral' },
      { region: 'eu', headline: 'Unable to generate EU summary — LLM unavailable.', details: [], sentiment: 'neutral' },
      { region: 'asia', headline: 'Unable to generate Asia summary — LLM unavailable.', details: [], sentiment: 'neutral' },
      { region: 'global', headline: 'Unable to generate Global summary — LLM unavailable.', details: [], sentiment: 'neutral' },
    ],
    keyRisks: ['Macro summary was generated without a live model call. Data may be stale or incomplete.'],
  };
}

export async function runOrchestration(options: OrchestrationOptions): Promise<OrchestrationResult> {
  const steps: OrchestrationStepLog[] = [];

  const { plan, log: planLog } = await stepPlan(options.prompt, options.tradeTickers, options.sourceContexts);
  steps.push(planLog);

  await sleep(INTER_CALL_DELAY_MS);

  const { chunks, log: retrieveLog } = await stepRetrieve(options, plan);
  steps.push(retrieveLog);

  const { message, structured, macroSummary, log: summarizeLog } = await stepSummarize(options, chunks);
  steps.push(summarizeLog);

  await sleep(INTER_CALL_DELAY_MS);

  const { critique, log: critiqueLog } = await stepCritique(message);
  steps.push(critiqueLog);

  if (critique && isCritiqueEnabled()) {
    await sleep(INTER_CALL_DELAY_MS);
  }

  const answerLog: OrchestrationStepLog = {
    step: 'answer',
    durationMs: 0,
    tokenEstimate: 0,
    skipped: !isCritiqueEnabled(),
  };
  steps.push(answerLog);

  return {
    message,
    structured,
    macroSummary,
    steps,
  };
}
