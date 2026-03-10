import { isCircuitOpen, recordLlmFailure, recordLlmSuccess } from '@/lib/jarvis/circuit-breaker';

const DEFAULT_MODEL = 'deepseek-v3.2';
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

export interface JarvisClientResult {
  content: string;
  modelUsed: string;
}

async function requestLlm(systemPrompt: string, userMessage: string, temperature: number): Promise<JarvisClientResult> {
  const apiKey = process.env.JARVIS_API_KEY ?? process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error('JARVIS_API_KEY (or NVIDIA_API_KEY) is not configured');
  }

  const model = process.env.JARVIS_MODEL || DEFAULT_MODEL;
  const baseUrl = process.env.JARVIS_API_BASE_URL || DEFAULT_BASE_URL;

  const response = await fetch(baseUrl, {
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
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}`);
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
