# Sprint 6 — Execution Spec for opencode

**Generated:** 2026-03-08
**Branch:** `main`
**Status:** READY FOR EXECUTION

---

## Overview

Transform Jarvis from a single-pass scrape-and-respond assistant into an orchestrated, multi-step reasoning engine. Add daily macro headline caching via Vercel cron, a new `macro-summary` mode with region-by-region output, and a reusable orchestration pipeline.

**Tickets:** JRV-060 through JRV-064
**Files:** 12 total (4 creates, 8 modifies)

---

## Locked Decisions (do not deviate)

- **Vercel Hobby tier** — daily cron only: `"0 11 * * *"` (6 AM ET)
- **Open-access domains only** — no paywalled sites
- **Final domain list:**
  - US: `cnbc.com`, `reuters.com`, `investing.com`, `federalreserve.gov`
  - EU: `ecb.europa.eu`, `tradingeconomics.com`
  - Asia: `boj.or.jp`, `nikkei.com`
  - Global: `imf.org`, `worldbank.org`
- **System-level headlines** — `userId: 'system'`, globally visible to all users
- **Critique step OFF by default** — `JARVIS_ORCHESTRATION_CRITIQUE=false`
- **Orchestration for `macro-summary` only** — existing modes stay single-pass
- **40 RPM rate limit** on NVIDIA/DeepSeek — add 1.5s delay between sequential LLM calls
- **No database migration required** — `cached_headline` already exists in the schema enum

---

## Execution Order

Execute changes in this exact order. Each change lists the file, what to do, and acceptance criteria.

---

### Change 1: Add env vars to `.env.example`

**File:** `/home/jared/Nexus-Terminal/.env.example`
**Action:** MODIFY — append after line 27 (after `ALLOWED_EMAILS=`)

**Add these lines:**

```
# Jarvis Cron (required for macro headline scraping on Vercel)
CRON_SECRET=

# Jarvis Orchestration (optional — enables multi-step critique)
JARVIS_ORCHESTRATION_CRITIQUE=false
```

**Acceptance criteria:**
- [ ] `CRON_SECRET=` appears in `.env.example`
- [ ] `JARVIS_ORCHESTRATION_CRITIQUE=false` appears in `.env.example`
- [ ] Comments explain purpose
- [ ] No other lines changed

---

### Change 2: Extend allowlist with regions and macro domains

**File:** `/home/jared/Nexus-Terminal/lib/jarvis-allowlist.ts`
**Action:** MODIFY

**Step 2a — Update `AllowlistEntry` interface (line 1-5):**

Replace the current interface with:

```typescript
export type AllowlistRegion = 'us' | 'eu' | 'asia' | 'global';

export interface AllowlistEntry {
  domain: string;
  label: string;
  category: 'earnings' | 'filings' | 'news' | 'general' | 'macro';
  region: AllowlistRegion;
}
```

**Step 2b — Update `ALLOWLIST` array (line 7-28):**

Add `region: 'us'` to each existing entry. Then append 10 new macro entries:

```typescript
const ALLOWLIST: AllowlistEntry[] = [
  // --- Existing entries (Sprint 0) ---
  { domain: 'earningswhispers.com', label: 'Earnings Whispers', category: 'earnings', region: 'us' },
  { domain: 'marketwatch.com', label: 'MarketWatch', category: 'earnings', region: 'us' },
  { domain: 'nasdaq.com', label: 'NASDAQ', category: 'earnings', region: 'us' },
  { domain: 'sec.gov', label: 'SEC EDGAR', category: 'filings', region: 'us' },
  // --- Macro domains (Sprint 6) ---
  { domain: 'cnbc.com', label: 'CNBC', category: 'macro', region: 'us' },
  { domain: 'reuters.com', label: 'Reuters', category: 'macro', region: 'us' },
  { domain: 'investing.com', label: 'Investing.com', category: 'macro', region: 'us' },
  { domain: 'federalreserve.gov', label: 'Federal Reserve', category: 'macro', region: 'us' },
  { domain: 'ecb.europa.eu', label: 'European Central Bank', category: 'macro', region: 'eu' },
  { domain: 'tradingeconomics.com', label: 'Trading Economics', category: 'macro', region: 'eu' },
  { domain: 'boj.or.jp', label: 'Bank of Japan', category: 'macro', region: 'asia' },
  { domain: 'nikkei.com', label: 'Nikkei', category: 'macro', region: 'asia' },
  { domain: 'imf.org', label: 'IMF', category: 'macro', region: 'global' },
  { domain: 'worldbank.org', label: 'World Bank', category: 'macro', region: 'global' },
];
```

**Step 2c — Update `TRUST_SCORES_BY_CATEGORY` (line 37-42):**

Add `macro` category with trust score 0.85:

```typescript
const TRUST_SCORES_BY_CATEGORY: Record<AllowlistEntry['category'], number> = {
  earnings: 0.8,
  filings: 1,
  news: 0.75,
  general: 0.5,
  macro: 0.85,
};
```

**Step 2d — Add two new exported helpers (append after `getAllowedDomains` at line 111-113):**

```typescript
export function getAllowlistByRegion(region: AllowlistRegion) {
  return ALLOWLIST.filter((entry) => entry.region === region);
}

export function getMacroAllowlistDomains() {
  return ALLOWLIST.filter((entry) => entry.category === 'macro');
}
```

**Acceptance criteria:**
- [ ] `AllowlistEntry` has `region: AllowlistRegion` field
- [ ] `AllowlistRegion` type is exported
- [ ] Category union includes `'macro'`
- [ ] All 4 existing entries have `region: 'us'`
- [ ] 10 new macro entries exist with correct regions
- [ ] `TRUST_SCORES_BY_CATEGORY` includes `macro: 0.85`
- [ ] `getAllowlistByRegion('eu')` returns only EU entries
- [ ] `getMacroAllowlistDomains()` returns only macro-category entries
- [ ] `isUrlAllowed()` works for all domains (existing + new)
- [ ] Existing tests in `__tests__/jarvis-allowlist.test.ts` still pass
- [ ] Add new tests for region filtering and macro helpers

---

### Change 3: Extend Jarvis types

**File:** `/home/jared/Nexus-Terminal/lib/jarvis-types.ts`
**Action:** MODIFY

**Step 3a — Update `JarvisMode` (line 1):**

```typescript
export type JarvisMode = 'daily-summary' | 'trade-analysis' | 'assistant' | 'macro-summary';
```

**Step 3b — Add macro summary types (append after `JarvisStructuredResponse` interface, after line 36):**

```typescript
export type MacroSummaryRegion = 'us' | 'eu' | 'asia' | 'global';

export interface JarvisMacroRegionSummary {
  region: MacroSummaryRegion;
  headline: string;
  details: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
}

export interface JarvisMacroSummaryOutput {
  date: string;
  overallSentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  regions: JarvisMacroRegionSummary[];
  keyRisks: string[];
}
```

**Step 3c — Update `JarvisResponse` (line 23-29) to include optional `macroSummary`:**

```typescript
export interface JarvisResponse {
  message: string;
  sourceSummary?: string;
  sources?: JarvisSourceContext[];
  warnings?: string[];
  structured?: JarvisStructuredResponse;
  macroSummary?: JarvisMacroSummaryOutput;
}
```

**Acceptance criteria:**
- [ ] `JarvisMode` includes `'macro-summary'`
- [ ] `MacroSummaryRegion`, `JarvisMacroRegionSummary`, `JarvisMacroSummaryOutput` are exported
- [ ] `JarvisResponse` has optional `macroSummary` field
- [ ] Existing tests in `__tests__/jarvis-types.test.ts` still pass
- [ ] `npx tsc --noEmit` passes

---

### Change 4: Add macro-daily source pack

**File:** `/home/jared/Nexus-Terminal/lib/jarvis-source-packs.ts`
**Action:** MODIFY

**Step 4a — Add the `macro-daily` source pack to the `sourcePacks` array (after the existing `earnings` entry, before `];` on line 27):**

```typescript
  {
    id: 'macro-daily',
    name: 'Macro Daily',
    description: 'Daily macro market overview across US, EU, Asia, and global.',
    icon: 'Globe',
    category: 'macro',
    urls: [
      'https://www.cnbc.com/economy/',
      'https://www.reuters.com/markets/',
      'https://www.investing.com/news/economy',
      'https://tradingeconomics.com/calendar',
    ],
    promptTemplate:
      'Provide a daily macro market summary. Break down by region (US, Europe, Asia-Pacific, Global). For each region: headline development, market sentiment, and key risks. End with overall portfolio implications.',
  },
```

**Acceptance criteria:**
- [ ] `sourcePacks` array has entry with `id: 'macro-daily'`
- [ ] `getSourcePack('macro-daily')` returns the pack
- [ ] Pack has 4 URLs (one per region)
- [ ] Existing tests in `__tests__/jarvis-source-packs.test.ts` still pass

---

### Change 5: Create orchestration engine

**File:** `/home/jared/Nexus-Terminal/lib/jarvis-orchestrator.ts`
**Action:** CREATE

This is the most complex piece. Create the file with the following structure:

```typescript
import {
  type JarvisMode,
  type JarvisMacroSummaryOutput,
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

// --- Constants ---
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v3.2';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const INTER_CALL_DELAY_MS = 1500; // Respect 40 RPM rate limit

// --- Public interfaces ---

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

// --- Internal types ---

interface RetrievalPlan {
  keywords: string[];
  tickers: string[];
  sourceTypes: string[];
  focusRegions: string[];
}

// --- Helpers ---

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

// --- Pipeline steps ---

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
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.keywords)) {
        return {
          plan: {
            keywords: parsed.keywords.filter((k: unknown) => typeof k === 'string').slice(0, 15),
            tickers: parsed.tickers?.filter((t: unknown) => typeof t === 'string') ?? tradeTickers,
            sourceTypes: parsed.sourceTypes?.filter((s: unknown) => typeof s === 'string') ?? ['web_source', 'cached_headline'],
            focusRegions: parsed.focusRegions?.filter((r: unknown) => typeof r === 'string') ?? ['us', 'eu', 'asia', 'global'],
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

  // Merge retrieved chunks with scrape chunks, deduplicating by sourceUrl:hash
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
        // Try to extract macroSummary from the raw JSON
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonPayload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
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

  // Fallback: build deterministic response
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

// --- Validation helpers ---

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

// --- Main orchestration function ---

export async function runOrchestration(options: OrchestrationOptions): Promise<OrchestrationResult> {
  const steps: OrchestrationStepLog[] = [];

  // Step 1: Plan
  const { plan, log: planLog } = await stepPlan(options.prompt, options.tradeTickers, options.sourceContexts);
  steps.push(planLog);

  await sleep(INTER_CALL_DELAY_MS);

  // Step 2: Retrieve
  const { chunks, log: retrieveLog } = await stepRetrieve(options, plan);
  steps.push(retrieveLog);

  // Step 3: Summarize
  const { message, structured, macroSummary, log: summarizeLog } = await stepSummarize(options, chunks);
  steps.push(summarizeLog);

  await sleep(INTER_CALL_DELAY_MS);

  // Step 4: Critique (optional)
  const { critique, log: critiqueLog } = await stepCritique(message);
  steps.push(critiqueLog);

  if (critique && isCritiqueEnabled()) {
    await sleep(INTER_CALL_DELAY_MS);
  }

  // Step 5: Answer — currently pass-through (critique integration is future work)
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
```

**Key design points:**
- `callLlm()` mirrors the existing `askLlm()` pattern — returns `null` on any failure, never leaks API key
- `INTER_CALL_DELAY_MS = 1500` ensures sequential calls respect 40 RPM
- `stepPlan` falls back to keyword extraction from prompt when LLM unavailable
- `stepSummarize` falls back to `buildStructuredFallbackFromSources()` when LLM unavailable
- For `macro-summary` mode, extracts `macroSummary` from the LLM JSON response with strict validation
- `validateMacroSummary()` defensively validates every field of the macro output
- `buildFallbackMacroSummary()` provides deterministic output when LLM is down
- `stepCritique` is a no-op when `JARVIS_ORCHESTRATION_CRITIQUE !== 'true'`
- The `answer` step is a pass-through for now — when critique is enabled in the future, it will reconcile summary + critique

**Acceptance criteria:**
- [ ] `runOrchestration()` exported from `lib/jarvis-orchestrator.ts`
- [ ] Pipeline executes plan -> retrieve -> summarize -> (optional critique) -> answer
- [ ] 1.5s delay between LLM calls
- [ ] LLM-unavailable fallback works at every step
- [ ] `macro-summary` mode produces `macroSummary` field
- [ ] `npx tsc --noEmit` passes
- [ ] Create `__tests__/jarvis-orchestrator.test.ts` with tests for: successful pipeline, LLM fallback, critique-disabled path, macro-summary mode, `validateMacroSummary` edge cases

---

### Change 6: Create cron endpoint for headline scraping

**File:** `/home/jared/Nexus-Terminal/app/api/jarvis/cron/headlines/route.ts`
**Action:** CREATE

```typescript
import { getMacroAllowlistDomains } from '@/lib/jarvis-allowlist';
import { ingestKnowledgeChunks } from '@/lib/jarvis-knowledge';
import {
  buildStructuredSource,
  chunkScrapedSource,
  dedupeSourceChunks,
  rankSourceChunks,
} from '@/lib/jarvis-scrape';
import { getTrustScoreForHost } from '@/lib/jarvis-allowlist';

const SCRAPE_TIMEOUT_MS = 10_000;
const SYSTEM_USER_ID = 'system';

// Representative macro URLs per domain
const DOMAIN_URLS: Record<string, string> = {
  'cnbc.com': 'https://www.cnbc.com/economy/',
  'reuters.com': 'https://www.reuters.com/markets/',
  'investing.com': 'https://www.investing.com/news/economy',
  'federalreserve.gov': 'https://www.federalreserve.gov/newsevents.htm',
  'ecb.europa.eu': 'https://www.ecb.europa.eu/press/pr/html/index.en.html',
  'tradingeconomics.com': 'https://tradingeconomics.com/calendar',
  'boj.or.jp': 'https://www.boj.or.jp/en/mopo/index.htm',
  'nikkei.com': 'https://asia.nikkei.com/Economy',
  'imf.org': 'https://www.imf.org/en/News',
  'worldbank.org': 'https://www.worldbank.org/en/news',
};

function requireCronSecret(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token || token !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

async function scrapeUrlForCron(url: string): Promise<{ url: string; success: boolean; chunks: number; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Nexus-Jarvis/1.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { url, success: false, chunks: 0, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const source = buildStructuredSource(url, html, new Date());
    const chunks = chunkScrapedSource(source);

    return { url, success: true, chunks: chunks.length };
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { url, success: false, chunks: 0, error: message };
  }
}

export async function GET(request: Request) {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  const start = Date.now();
  const macroDomains = getMacroAllowlistDomains();
  const errors: string[] = [];
  let totalScraped = 0;
  let totalIngested = 0;

  for (const entry of macroDomains) {
    const url = DOMAIN_URLS[entry.domain];
    if (!url) {
      errors.push(`No URL mapping for domain: ${entry.domain}`);
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': 'Nexus-Jarvis/1.0' },
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch (fetchError) {
        clearTimeout(timeout);
        const msg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        errors.push(`${entry.domain}: ${msg}`);
        continue;
      }
      clearTimeout(timeout);

      if (!res.ok) {
        errors.push(`${entry.domain}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const source = buildStructuredSource(url, html, new Date());
      const rawChunks = chunkScrapedSource(source);
      const deduped = dedupeSourceChunks(rawChunks);
      const ranked = rankSourceChunks(deduped, {
        tradeTickers: [],
        trustByHost: { [source.host]: getTrustScoreForHost(source.host) },
      });

      totalScraped += 1;

      await ingestKnowledgeChunks({
        userId: SYSTEM_USER_ID,
        sourceType: 'cached_headline',
        chunks: ranked,
      });

      totalIngested += ranked.length;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${entry.domain}: ${msg}`);
    }
  }

  const durationMs = Date.now() - start;

  return Response.json({
    scraped: totalScraped,
    ingested: totalIngested,
    errors,
    durationMs,
  });
}
```

**Key design points:**
- Auth: `requireCronSecret()` checks `Authorization: Bearer <CRON_SECRET>` — does NOT use `requireUser()` since cron has no session
- Scrapes domains sequentially (not in parallel) to avoid overwhelming targets
- Each domain failure is caught independently — one failure doesn't abort the job
- Ingests with `userId: 'system'` and `sourceType: 'cached_headline'`
- Returns a JSON summary with scrape/ingest counts, errors, and duration

**Acceptance criteria:**
- [ ] GET `/api/jarvis/cron/headlines` returns 401 without valid `CRON_SECRET`
- [ ] Returns 503 when `CRON_SECRET` is not configured
- [ ] Returns 200 with scrape summary on success
- [ ] Ingested chunks have `sourceType: 'cached_headline'` and `userId: 'system'`
- [ ] Individual URL failures don't abort the entire job
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] Create `__tests__/jarvis-cron-headlines.test.ts` — test auth validation, basic flow

---

### Change 7: Create `vercel.json`

**File:** `/home/jared/Nexus-Terminal/vercel.json`
**Action:** CREATE

```json
{
  "crons": [
    {
      "path": "/api/jarvis/cron/headlines",
      "schedule": "0 11 * * *"
    }
  ]
}
```

**Acceptance criteria:**
- [ ] `vercel.json` exists at project root
- [ ] Contains valid JSON
- [ ] Schedule is `"0 11 * * *"` (daily at 11:00 UTC / 6:00 AM ET)
- [ ] Path matches the route from Change 6

---

### Change 8: Wire orchestration into Jarvis route handler

**File:** `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts`
**Action:** MODIFY

**Step 8a — Add import (after line 6, alongside existing imports):**

```typescript
import { runOrchestration } from '@/lib/jarvis-orchestrator';
```

**Step 8b — Add `macro-summary` case to `toModePrompt` function (line 124-169):**

Insert a new `if` block before the final `return` statement (before line 163):

```typescript
  if (mode === 'macro-summary') {
    return [
      'Macro Market Summary:',
      prompt || 'Provide a daily macro summary across US, EU, Asia, and global markets.',
      '',
      `Current performance snapshot: ${summary.totalTrades} trades, ${formatMoney(summary.totalPnl)} net.`,
    ].join('\n');
  }
```

**Step 8c — Add orchestration branch in POST handler (after line 529, the `const llmMessage = await askLlm(...)` line):**

Insert before the existing `const warnings = [...]` line. The logic is: if `mode === 'macro-summary'`, use orchestration pipeline instead of the `askLlm` result.

Replace the section from line 529 (`const llmMessage = await askLlm(...)`) through line 559 (the closing of the final `return Response.json(...)`) with:

```typescript
    // --- Macro-summary mode: use orchestration pipeline ---
    if (mode === 'macro-summary') {
      const orchestrationResult = await runOrchestration({
        userId: authState.user.id,
        mode,
        prompt: basePrompt,
        tradeTickers,
        scrapeChunks: llmChunks,
        sourceContexts,
      });

      const warnings = [...scrapeResult.warnings];
      if (assembledMemoryContext.truncated) {
        warnings.push(`Memory context truncated to token budget (${assembledMemoryContext.totalTokens} tokens, dropped ${assembledMemoryContext.droppedCount} chunks).`);
      }

      return Response.json({
        message: orchestrationResult.message,
        sourceSummary,
        sources: sourceContexts,
        structured: orchestrationResult.structured,
        macroSummary: orchestrationResult.macroSummary,
        warnings,
      });
    }

    // --- Standard modes: single-pass LLM ---
    const llmMessage = await askLlm(basePrompt, scrapedSources, llmChunks);

    const warnings = [...scrapeResult.warnings];
    if (assembledMemoryContext.truncated) {
      warnings.push(`Memory context truncated to token budget (${assembledMemoryContext.totalTokens} tokens, dropped ${assembledMemoryContext.droppedCount} chunks).`);
    }

    if (llmMessage) {
      return Response.json({
        message: llmMessage.message,
        sourceSummary,
        sources: sourceContexts,
        structured: llmMessage.structured,
        warnings,
      });
    }

    const structuredFallback = buildStructuredFallbackFromSources({
      prompt,
      sourceSummary,
      sources: sourceContexts,
      warnings,
    });

    return Response.json({
      message: formatStructuredMessage(structuredFallback),
      sourceSummary,
      sources: sourceContexts,
      structured: structuredFallback,
      warnings,
    });
```

**IMPORTANT:** The original lines 529-559 should be fully replaced. The new code has the macro-summary branch first (early return), then the existing single-pass flow unchanged.

**Acceptance criteria:**
- [ ] `macro-summary` mode triggers orchestration pipeline and returns `macroSummary`
- [ ] Other modes (`daily-summary`, `trade-analysis`, `assistant`) still use existing single-pass `askLlm` flow — no changes to their behavior
- [ ] `toModePrompt` handles `'macro-summary'` without fallthrough
- [ ] Response includes `macroSummary` field for macro-summary mode only
- [ ] Existing tests in `__tests__/jarvis-route.test.ts` still pass
- [ ] `npx tsc --noEmit` passes

---

### Change 9: Create `JarvisMacroSummary` component

**File:** `/home/jared/Nexus-Terminal/components/trading/JarvisMacroSummary.tsx`
**Action:** CREATE

```tsx
import React from 'react';
import type { JarvisMacroSummaryOutput, MacroSummaryRegion } from '@/lib/jarvis-types';

interface JarvisMacroSummaryProps {
  macroSummary: JarvisMacroSummaryOutput;
}

const REGION_LABELS: Record<MacroSummaryRegion, string> = {
  us: 'United States',
  eu: 'Europe',
  asia: 'Asia-Pacific',
  global: 'Global',
};

const SENTIMENT_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  bullish: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300' },
  bearish: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-300' },
  neutral: { bg: 'bg-zinc-500/10', border: 'border-zinc-500/30', text: 'text-zinc-300' },
  mixed: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300' },
};

function sentimentStyle(sentiment: string) {
  return SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral;
}

export default function JarvisMacroSummary({ macroSummary }: JarvisMacroSummaryProps) {
  const overallStyle = sentimentStyle(macroSummary.overallSentiment);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">Macro Summary — {macroSummary.date}</p>
        <span className={`rounded-full border px-3 py-0.5 text-xs capitalize ${overallStyle.bg} ${overallStyle.border} ${overallStyle.text}`}>
          {macroSummary.overallSentiment}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {macroSummary.regions.map((region) => {
          const style = sentimentStyle(region.sentiment);
          return (
            <div
              key={region.region}
              className={`rounded-xl border p-4 ${style.border} bg-black/20`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-100">{REGION_LABELS[region.region] ?? region.region}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${style.bg} ${style.border} ${style.text}`}>
                  {region.sentiment}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-200">{region.headline}</p>
              {region.details.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {region.details.map((detail, i) => (
                    <li key={`macro-detail-${region.region}-${i}`} className="flex gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-500">•</span>
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {macroSummary.keyRisks.length > 0 ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200">Key Macro Risks</p>
          <ul className="mt-2 space-y-1.5 text-sm text-amber-100">
            {macroSummary.keyRisks.map((risk, i) => (
              <li key={`macro-risk-${i}`} className="flex gap-2">
                <span className="text-amber-300">!</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

**Design notes:**
- 2x2 grid on desktop (`sm:grid-cols-2`), stacked on mobile
- Sentiment-colored borders and badges per region
- Key risks section in amber, matching existing risks pattern in `JarvisStructuredResponse`
- No new dependencies — uses existing design tokens

**Acceptance criteria:**
- [ ] Component renders a region card for each entry in `macroSummary.regions`
- [ ] Each card shows: region name, headline, sentiment badge, detail bullets
- [ ] Key risks section renders in amber warning style
- [ ] Layout is responsive (2-col grid on desktop, stacked on mobile)
- [ ] Uses existing design tokens (emerald, rose, amber, zinc, dark theme)
- [ ] No new dependencies

---

### Change 10: Wire macro summary into `JarvisStructuredResponse`

**File:** `/home/jared/Nexus-Terminal/components/trading/JarvisStructuredResponse.tsx`
**Action:** MODIFY

**Step 10a — Add imports (line 1-2):**

```typescript
import React from 'react';
import type { JarvisSourceContext, JarvisStructuredResponse, JarvisMacroSummaryOutput } from '@/lib/jarvis-types';
import JarvisMacroSummary from '@/components/trading/JarvisMacroSummary';
```

**Step 10b — Update props interface (line 4-10):**

```typescript
interface JarvisStructuredResponseProps {
  message: string;
  structured?: JarvisStructuredResponse;
  warnings?: string[];
  sourceSummary?: string;
  sources?: JarvisSourceContext[];
  macroSummary?: JarvisMacroSummaryOutput;
}
```

**Step 10c — Update the component signature (line 32) to destructure `macroSummary`:**

```typescript
export default function JarvisStructuredResponse({ message, structured, warnings, sourceSummary, sources, macroSummary }: JarvisStructuredResponseProps) {
```

**Step 10d — Render macro summary between structured response and warnings (after the `structured` section closing `</div>` at line 79, before the warnings section at line 84):**

```tsx
      {macroSummary ? <JarvisMacroSummary macroSummary={macroSummary} /> : null}
```

**Acceptance criteria:**
- [ ] Props include optional `macroSummary`
- [ ] `JarvisMacroSummary` renders when `macroSummary` is truthy
- [ ] Existing rendering is unchanged when `macroSummary` is absent
- [ ] Existing tests in `__tests__/jarvis-structured-response.test.ts` still pass

---

### Change 11: Wire macro summary through `JarvisTab`

**File:** `/home/jared/Nexus-Terminal/components/trading/JarvisTab.tsx`
**Action:** MODIFY

**Step 11a — Add `Globe` to the cards array (line 252-271).**

Add a 4th card to the `cards` array:

```typescript
    {
      mode: 'macro-summary' as JarvisMode,
      label: 'Macro Summary',
      description: 'Get a macro market overview across US, EU, Asia, and global markets.',
      icon: Globe,
    },
```

**Step 11b — Update the grid class (line 309) from `lg:grid-cols-3` to `lg:grid-cols-4`:**

```tsx
      <div className="grid gap-4 lg:grid-cols-4">
```

**Step 11c — Update `setResponse` in `runJarvis` (line 221-227) to capture `macroSummary`:**

```typescript
      setResponse({
        message: payload.message,
        sourceSummary: payload.sourceSummary,
        sources: payload.sources,
        warnings: payload.warnings,
        structured: payload.structured,
        macroSummary: payload.macroSummary,
      });
```

**Step 11d — Pass `macroSummary` to `JarvisStructuredResponse` (line 505-511):**

```tsx
          <JarvisStructuredResponse
            message={response.message}
            structured={response.structured}
            warnings={response.warnings}
            sourceSummary={response.sourceSummary}
            sources={response.sources}
            macroSummary={response.macroSummary}
          />
```

**Acceptance criteria:**
- [ ] "Macro Summary" appears as 4th action card with Globe icon
- [ ] Cards grid is 4-column on desktop
- [ ] Clicking "Macro Summary" calls `runJarvis('macro-summary')`
- [ ] `macroSummary` captured from API response and passed to structured renderer
- [ ] `npx tsc --noEmit` passes

---

### Change 12: Update retrieval to include `cached_headline` by default

**File:** `/home/jared/Nexus-Terminal/lib/jarvis-knowledge.ts`
**Action:** MODIFY

**Update the default `sourceTypes` in `retrieveKnowledgeChunks` (line 324-326):**

Change from:

```typescript
    : ['web_source', 'trade_journal', 'user_document'] as JarvisSourceType[];
```

To:

```typescript
    : ['web_source', 'trade_journal', 'user_document', 'cached_headline'] as JarvisSourceType[];
```

This ensures cached headlines from the cron job are included in retrieval by default for all modes.

**Acceptance criteria:**
- [ ] Default `sourceTypes` includes `'cached_headline'`
- [ ] Existing retrieval behavior unchanged for explicit `sourceTypes` calls
- [ ] `npx tsc --noEmit` passes

---

### Change 13: Update `CLAUDE.md`

**File:** `/home/jared/Nexus-Terminal/.claude/CLAUDE.md`
**Action:** MODIFY

Update these sections:

1. **API Routes section** — Add:
   ```
   ## Jarvis Cron
   - GET /api/jarvis/cron/headlines  (Vercel cron, CRON_SECRET auth)
   ```
   Update count from "12 active endpoints" to "13 active endpoints"

2. **Components section** — Update count from "28 total" to "29 total", add `JarvisMacroSummary` to the Trading Feature Components list (count becomes 19)

3. **Key Service Modules section** — Add:
   ```
   - lib/jarvis-orchestrator.ts — multi-step orchestration pipeline (plan, retrieve, summarize, critique, answer)
   ```

4. **Known Issues section** — Add:
   ```
   4. Vercel Hobby tier limits cron to daily; macro headlines may be stale by market close
   ```

**Acceptance criteria:**
- [ ] API route count updated to 13
- [ ] Cron endpoint listed
- [ ] Component count updated to 29
- [ ] `JarvisMacroSummary` listed
- [ ] `jarvis-orchestrator.ts` listed in service modules

---

## Post-Implementation Checklist

Run these in order after all changes are complete:

```bash
npm run lint
npx tsc --noEmit
npm run test
```

If any fail, fix before proceeding.

### Manual Verification

1. **Cron auth test:**
   ```bash
   # Should return 401
   curl http://localhost:3000/api/jarvis/cron/headlines

   # Should return 200 with scrape summary (set CRON_SECRET in .env.local first)
   curl -H "Authorization: Bearer <your-secret>" http://localhost:3000/api/jarvis/cron/headlines
   ```

2. **UI test:**
   - Open Jarvis tab
   - Verify 4 action cards appear (Daily Summary, Analyze Trades, Ask Jarvis, Macro Summary)
   - Click "Macro Summary" — verify loading state, then region breakdown renders
   - Verify other 3 modes still work identically

3. **Regression check:**
   - Run daily-summary mode — confirm response unchanged
   - Run trade-analysis mode — confirm response unchanged
   - Run assistant mode with URLs — confirm response unchanged

---

## Files Summary

| # | File | Action |
|---|------|--------|
| 1 | `.env.example` | MODIFY |
| 2 | `lib/jarvis-allowlist.ts` | MODIFY |
| 3 | `lib/jarvis-types.ts` | MODIFY |
| 4 | `lib/jarvis-source-packs.ts` | MODIFY |
| 5 | `lib/jarvis-orchestrator.ts` | CREATE |
| 6 | `app/api/jarvis/cron/headlines/route.ts` | CREATE |
| 7 | `vercel.json` | CREATE |
| 8 | `app/api/jarvis/route.ts` | MODIFY |
| 9 | `components/trading/JarvisMacroSummary.tsx` | CREATE |
| 10 | `components/trading/JarvisStructuredResponse.tsx` | MODIFY |
| 11 | `components/trading/JarvisTab.tsx` | MODIFY |
| 12 | `lib/jarvis-knowledge.ts` | MODIFY |
| 13 | `.claude/CLAUDE.md` | MODIFY |

## New Test Files

| File | Covers |
|------|--------|
| `__tests__/jarvis-orchestrator.test.ts` | Orchestration pipeline, fallbacks, macro mode, validation |
| `__tests__/jarvis-cron-headlines.test.ts` | Cron auth, scrape+ingest flow |

Update existing tests:
- `__tests__/jarvis-allowlist.test.ts` — region helpers, macro domain filtering
- `__tests__/jarvis-types.test.ts` — new types compile
- `__tests__/jarvis-source-packs.test.ts` — macro-daily pack lookup
