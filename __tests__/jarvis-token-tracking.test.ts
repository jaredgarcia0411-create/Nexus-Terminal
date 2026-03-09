import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, logRouteErrorMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  logRouteErrorMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/api-route-utils', () => ({
  logRouteError: logRouteErrorMock,
}));

import { estimateInputTokens, estimateOutputTokens, logJarvisRequest } from '@/lib/jarvis-token-tracking';

describe('jarvis-token-tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logJarvisRequest inserts row with expected fields', async () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    getDbMock.mockReturnValue({ insert: insertMock });

    await expect(logJarvisRequest({
      userId: 'user-1',
      mode: 'assistant',
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 250,
      success: true,
      sourceCount: 2,
      chunkCount: 4,
    })).resolves.toBeUndefined();

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      mode: 'assistant',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      durationMs: 250,
      success: 1,
      sourceCount: 2,
      chunkCount: 4,
    }));
  });

  it('logJarvisRequest does not throw when db is null', async () => {
    getDbMock.mockReturnValue(null);

    await expect(logJarvisRequest({
      userId: 'user-1',
      mode: 'assistant',
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      success: false,
      sourceCount: 0,
      chunkCount: 0,
    })).resolves.toBeUndefined();
  });

  it('logJarvisRequest does not throw when insert fails', async () => {
    const valuesMock = vi.fn().mockRejectedValue(new Error('insert failed'));
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    getDbMock.mockReturnValue({ insert: insertMock });

    await expect(logJarvisRequest({
      userId: 'user-1',
      mode: 'assistant',
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      success: false,
      sourceCount: 0,
      chunkCount: 0,
    })).resolves.toBeUndefined();

    expect(logRouteErrorMock).toHaveBeenCalledWith('jarvis.token_tracking', expect.any(Error));
  });

  it('estimateInputTokens counts whitespace separated words', () => {
    expect(estimateInputTokens('  one   two\nthree\tfour  ')).toBe(4);
  });

  it('estimateOutputTokens counts whitespace separated words', () => {
    expect(estimateOutputTokens('alpha beta   gamma')).toBe(3);
  });
});
