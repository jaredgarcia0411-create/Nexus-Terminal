import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  callLlmMock,
  getCachedTickerDataMock,
  getDbMock,
  recordSiteLlmUsageMock,
} = vi.hoisted(() => ({
  callLlmMock: vi.fn(),
  getCachedTickerDataMock: vi.fn(),
  getDbMock: vi.fn(),
  recordSiteLlmUsageMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/askedgar', () => ({
  getCachedTickerData: getCachedTickerDataMock,
}));

vi.mock('@/lib/llm-client', () => ({
  callLlm: callLlmMock,
}));

vi.mock('@/lib/agents/runtime-limits', () => ({
  recordSiteLlmUsage: recordSiteLlmUsageMock,
}));

import { askedgarCache, researchTldrClaims } from '@/lib/db/schema';
import { getCachedResearchTldr } from '@/lib/research';

type DbMockOptions = {
  selectResults: unknown[][];
  claimInsertError?: unknown;
};

function createDbMock({ selectResults, claimInsertError }: DbMockOptions) {
  const selectQueue = [...selectResults];
  const selectLimit = vi.fn(async () => selectQueue.shift() ?? []);
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const onConflictDoUpdate = vi.fn(async () => undefined);
  const insertValues = vi.fn((table: unknown, _value: unknown) => {
    if (table === askedgarCache) {
      return { onConflictDoUpdate };
    }
    if (table === researchTldrClaims && claimInsertError) {
      return Promise.reject(claimInsertError);
    }
    return Promise.resolve();
  });
  const insert = vi.fn((table: unknown) => ({
    values: (value: unknown) => insertValues(table, value),
  }));

  const deleteWhere = vi.fn(async () => undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhere }));

  return {
    delete: deleteMock,
    insert,
    select,
    _spies: {
      deleteWhere,
      insertValues,
      onConflictDoUpdate,
      selectLimit,
    },
  };
}

describe('getCachedResearchTldr', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    getCachedTickerDataMock.mockResolvedValue({ rawData: {} });
    callLlmMock.mockResolvedValue({
      content: '{"findings":["f1"],"historicalContext":null}',
      modelUsed: 'llama-3.3-70b-versatile',
      usage: { inputTokens: 5, outputTokens: 7 },
    });
    recordSiteLlmUsageMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a fresh cache hit without claiming or calling the LLM', async () => {
    const cached = { findings: ['cached'], historicalContext: null };
    const db = createDbMock({
      selectResults: [[{ dataJson: cached }]],
    });
    getDbMock.mockReturnValue(db);

    await expect(getCachedResearchTldr('AAPL', 'user-1')).resolves.toEqual(cached);

    expect(callLlmMock).not.toHaveBeenCalled();
    expect(recordSiteLlmUsageMock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('lets the cold-cache owner generate, cache, record telemetry, and release the claim', async () => {
    const db = createDbMock({
      selectResults: [[]],
    });
    getDbMock.mockReturnValue(db);

    await expect(getCachedResearchTldr('AAPL', 'user-1')).resolves.toEqual({
      findings: ['f1'],
      historicalContext: null,
    });

    expect(callLlmMock).toHaveBeenCalledTimes(1);
    expect(recordSiteLlmUsageMock).toHaveBeenCalledTimes(1);
    expect(recordSiteLlmUsageMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mode: 'site-research-tldr',
      success: true,
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
    }));
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledWith(researchTldrClaims);
    expect(db.insert).toHaveBeenCalledWith(askedgarCache);
    expect(db._spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('records failed telemetry and releases the claim when owner generation fails', async () => {
    const db = createDbMock({
      selectResults: [[]],
    });
    getDbMock.mockReturnValue(db);
    callLlmMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    await expect(getCachedResearchTldr('AAPL', 'user-1')).rejects.toThrow('LLM unavailable');

    expect(recordSiteLlmUsageMock).toHaveBeenCalledTimes(1);
    expect(recordSiteLlmUsageMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mode: 'site-research-tldr',
      modelUsed: 'unknown',
      success: false,
      totalTokens: 0,
    }));
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(db.insert).not.toHaveBeenCalledWith(askedgarCache);
  });

  it('waits for a claim winner and reuses the polled cache result', async () => {
    vi.useFakeTimers();
    const polled = { findings: ['polled'], historicalContext: null };
    const db = createDbMock({
      selectResults: [
        [],
        [],
        [{ dataJson: polled }],
      ],
      claimInsertError: { code: '23505' },
    });
    getDbMock.mockReturnValue(db);

    const promise = getCachedResearchTldr('AAPL', 'user-1');
    await vi.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toEqual(polled);
    expect(callLlmMock).not.toHaveBeenCalled();
    expect(recordSiteLlmUsageMock).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
