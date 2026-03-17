import { isCircuitOpen, recordLlmFailure, recordLlmSuccess } from '@/lib/jarvis/circuit-breaker';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 25_000;

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed;
}

async function readFailureDetail(response: Response): Promise<string> {
  const bodyText = (await response.text()).trim();
  if (!bodyText) {
    return '';
  }

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const message = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.message === 'string'
        ? parsed.message
        : null;
    if (message) {
      return `: ${message}`;
    }
  } catch {
    // fall through to plain text detail
  }

  return `: ${bodyText.slice(0, 240)}`;
}

function getTimeoutMs() {
  const parsed = Number(process.env.JARVIS_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

export interface JarvisClientResult {
  content: string;
  modelUsed: string;
}

async function requestLlm(systemPrompt: string, userMessage: string, temperature: number): Promise<JarvisClientResult> {
  const apiKey = process.env.JARVIS_API_KEY;
  if (!apiKey) {
    throw new Error('JARVIS_API_KEY is not configured');
  }

  const model = process.env.JARVIS_MODEL || DEFAULT_MODEL;
  const baseUrl = normalizeBaseUrl(process.env.JARVIS_API_BASE_URL || DEFAULT_BASE_URL);
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
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
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('LLM returned empty content');
  }

  return { content, modelUsed: model };
}

export async function callJarvis(systemPrompt: string, userMessage: string, temperature = 0.2): Promise<JarvisClientResult> {
  if (isCircuitOpen()) {
    throw new Error('Jarvis circuit breaker is open');
  }

  try {
    const result = await requestLlm(systemPrompt, userMessage, temperature);
    recordLlmSuccess();
    return result;
  } catch (firstError) {
    recordLlmFailure();
    if (isCircuitOpen()) {
      throw firstError;
    }

    try {
      const retryResult = await requestLlm(systemPrompt, userMessage, temperature);
      recordLlmSuccess();
      return retryResult;
    } catch (retryError) {
      recordLlmFailure();
      throw retryError;
    }
  }
}

export async function callJarvisStreaming(
  systemPrompt: string,
  userMessage: string,
  temperature = 0.2,
): Promise<{ stream: ReadableStream<string>; modelUsed: string }> {
  if (isCircuitOpen()) {
    throw new Error('Jarvis circuit breaker is open');
  }

  const apiKey = process.env.JARVIS_API_KEY;
  if (!apiKey) {
    throw new Error('JARVIS_API_KEY is not configured');
  }

  const model = process.env.JARVIS_MODEL || DEFAULT_MODEL;
  const baseUrl = normalizeBaseUrl(process.env.JARVIS_API_BASE_URL || DEFAULT_BASE_URL);
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    recordLlmFailure();
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    recordLlmFailure();
    const detail = await readFailureDetail(response);
    throw new Error(`LLM request failed with status ${response.status}${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let settled = false;

  const stream = new ReadableStream<string>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            recordLlmSuccess();
          }
          streamController.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);

          if (payload === '[DONE]') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              recordLlmSuccess();
            }
            streamController.close();
            return;
          }

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              streamController.enqueue(content);
            }
          } catch {
            // Ignore malformed chunks.
          }
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          recordLlmFailure();
        }
        streamController.error(error);
      }
    },
    cancel() {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
      }
      reader.cancel().catch(() => {});
    },
  });

  return { stream, modelUsed: model };
}
