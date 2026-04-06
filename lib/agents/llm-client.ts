import type {
  LlmBudgetConfig,
  LlmLane,
  LlmLaneConfig,
  LlmRequest,
  LlmResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_INTERACTIVE_TIMEOUT_MS = 30_000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 60_000;

const DEFAULT_DAILY_BUDGET_CENTS = 500;
const DEFAULT_MONTHLY_BUDGET_CENTS = 10_000;
const DEFAULT_MAX_CONTEXT_TOKENS = 32_000;
const DEFAULT_MAX_SCAN_CANDIDATES = 20;
const DEFAULT_MAX_PATTERN_HISTORY_ITEMS = 50;
const DEFAULT_MAX_RETRIES_PER_STEP = 2;

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }

  return trimmed.replace(/\/+$/, '');
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function readFailureDetailFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const parsed = payload as {
    error?: string | { message?: string };
    message?: string;
  };

  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return `: ${parsed.error.trim().slice(0, 240)}`;
  }

  if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string' && parsed.error.message.trim()) {
    return `: ${parsed.error.message.trim().slice(0, 240)}`;
  }

  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return `: ${parsed.message.trim().slice(0, 240)}`;
  }

  return '';
}

async function readFailureDetail(response: Response): Promise<string> {
  const bodyText = (await response.text()).trim();
  if (!bodyText) {
    return '';
  }

  try {
    return readFailureDetailFromPayload(JSON.parse(bodyText));
  } catch {
    return `: ${bodyText.slice(0, 240)}`;
  }
}

function getLaneConfig(lane: LlmLane): LlmLaneConfig {
  if (lane === 'interactive') {
    return getInteractiveLlmConfig();
  }

  return getBackgroundLlmConfig();
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

export function getInteractiveLlmConfig(): LlmLaneConfig {
  return {
    apiKey: readRequiredEnv('INTERACTIVE_LLM_API_KEY'),
    baseUrl: normalizeBaseUrl(process.env.INTERACTIVE_LLM_API_BASE_URL),
    model: process.env.INTERACTIVE_LLM_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: readPositiveInteger(
      process.env.INTERACTIVE_LLM_TIMEOUT_MS,
      DEFAULT_INTERACTIVE_TIMEOUT_MS,
    ),
  };
}

export function getBackgroundLlmConfig(): LlmLaneConfig {
  return {
    apiKey: readRequiredEnv('BACKGROUND_LLM_API_KEY'),
    baseUrl: normalizeBaseUrl(process.env.BACKGROUND_LLM_API_BASE_URL),
    model: process.env.BACKGROUND_LLM_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: readPositiveInteger(
      process.env.BACKGROUND_LLM_TIMEOUT_MS,
      DEFAULT_BACKGROUND_TIMEOUT_MS,
    ),
  };
}

export function getLlmBudgetConfig(): LlmBudgetConfig {
  return {
    dailyBudgetCents: readPositiveInteger(
      process.env.AGENT_DAILY_BUDGET_CENTS,
      DEFAULT_DAILY_BUDGET_CENTS,
    ),
    monthlyBudgetCents: readPositiveInteger(
      process.env.AGENT_MONTHLY_BUDGET_CENTS,
      DEFAULT_MONTHLY_BUDGET_CENTS,
    ),
    maxContextTokens: readPositiveInteger(
      process.env.AGENT_MAX_CONTEXT_TOKENS,
      DEFAULT_MAX_CONTEXT_TOKENS,
    ),
    maxScanCandidates: readPositiveInteger(
      process.env.AGENT_MAX_SCAN_CANDIDATES,
      DEFAULT_MAX_SCAN_CANDIDATES,
    ),
    maxPatternHistoryItems: readPositiveInteger(
      process.env.AGENT_MAX_PATTERN_HISTORY,
      DEFAULT_MAX_PATTERN_HISTORY_ITEMS,
    ),
    maxRetriesPerStep: readPositiveInteger(
      process.env.AGENT_MAX_RETRIES_PER_STEP,
      DEFAULT_MAX_RETRIES_PER_STEP,
    ),
  };
}

export async function callLlm(
  request: LlmRequest,
  lane: LlmLane,
  overrides?: Partial<LlmLaneConfig>,
): Promise<LlmResponse> {
  const resolvedConfig = {
    ...getLaneConfig(lane),
    ...overrides,
  };
  const model = request.model?.trim() || resolvedConfig.model;
  const temperature = request.temperature ?? 0.2;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolvedConfig.timeoutMs);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(buildChatCompletionsUrl(resolvedConfig.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`LLM request timed out after ${resolvedConfig.timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await readFailureDetail(response);
    throw new Error(`LLM request failed with status ${response.status}${detail}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('LLM returned empty content');
  }

  return {
    content,
    modelUsed: payload.model?.trim() || model,
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
    durationMs: Date.now() - startedAt,
  };
}
