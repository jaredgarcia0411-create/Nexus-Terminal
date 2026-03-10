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
    isCircuitOpenMock.mockReturnValue(false);
  });

  it('returns content from llm response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    const result = await callJarvis('sys', 'user');
    expect(result.content).toBe('ok');
    expect(recordLlmSuccessMock).toHaveBeenCalled();
  });
});
