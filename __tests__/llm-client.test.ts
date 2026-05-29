import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callLlm } from '@/lib/llm-client';

const originalFetch = global.fetch;
const originalApiKey = process.env.LLM_API_KEY;
const originalModel = process.env.LLM_MODEL;

function mockLlmResponse(body: Record<string, unknown>) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

describe('callLlm', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test';
    process.env.LLM_MODEL = 'llama-3.3-70b-versatile';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalApiKey;
    }
    if (originalModel === undefined) {
      delete process.env.LLM_MODEL;
    } else {
      process.env.LLM_MODEL = originalModel;
    }
    vi.restoreAllMocks();
  });

  it('returns token usage from the provider response', async () => {
    mockLlmResponse({
      choices: [{ message: { content: '{"findings":[]}' } }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    });

    await expect(callLlm('sys', 'user')).resolves.toEqual({
      content: '{"findings":[]}',
      modelUsed: 'llama-3.3-70b-versatile',
      usage: { inputTokens: 11, outputTokens: 22 },
    });
  });

  it('defaults missing token usage to zero', async () => {
    mockLlmResponse({
      choices: [{ message: { content: '{"findings":[]}' } }],
    });

    await expect(callLlm('sys', 'user')).resolves.toEqual({
      content: '{"findings":[]}',
      modelUsed: 'llama-3.3-70b-versatile',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });
});
