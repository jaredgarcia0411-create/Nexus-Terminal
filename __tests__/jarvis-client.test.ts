import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isCircuitOpenMock, recordLlmFailureMock, recordLlmSuccessMock } = vi.hoisted(() => ({
  isCircuitOpenMock: vi.fn(),
  recordLlmFailureMock: vi.fn(),
  recordLlmSuccessMock: vi.fn(),
}));

vi.mock('@/lib/jarvis/circuit-breaker', () => ({
  isCircuitOpen: isCircuitOpenMock,
  recordLlmFailure: recordLlmFailureMock,
  recordLlmSuccess: recordLlmSuccessMock,
}));

import { callJarvis } from '@/lib/jarvis/client';

describe('jarvis client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JARVIS_API_KEY = 'k';
    delete process.env.JARVIS_API_BASE_URL;
    delete process.env.JARVIS_TIMEOUT_MS;
    isCircuitOpenMock.mockReturnValue(false);
  });

  it('returns content from llm response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    const result = await callJarvis('sys', 'user');
    expect(result.content).toBe('ok');
    expect(recordLlmSuccessMock).toHaveBeenCalled();
  });

  it('normalizes nvidia base URL when only /v1 is configured', async () => {
    process.env.JARVIS_API_BASE_URL = 'https://integrate.api.nvidia.com/v1';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));

    await callJarvis('sys', 'user');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('includes provider error detail when request fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 }));

    await expect(callJarvis('sys', 'user')).rejects.toThrow('LLM request failed with status 404: Not Found');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns explicit timeout error when provider hangs', async () => {
    process.env.JARVIS_TIMEOUT_MS = '50';
    const abortError = Object.assign(new Error('request aborted'), { name: 'AbortError' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    await expect(callJarvis('sys', 'user')).rejects.toThrow('LLM request timed out after 50ms');
  });
});
