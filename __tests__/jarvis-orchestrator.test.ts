import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { retrieveKnowledgeChunksMock, assembleKnowledgeContextMock } = vi.hoisted(() => ({
  retrieveKnowledgeChunksMock: vi.fn(),
  assembleKnowledgeContextMock: vi.fn(),
}));

vi.mock('@/lib/jarvis-knowledge', () => ({
  retrieveKnowledgeChunks: retrieveKnowledgeChunksMock,
  assembleKnowledgeContext: assembleKnowledgeContextMock,
}));

import { runOrchestration } from '@/lib/jarvis-orchestrator';

describe('runOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    retrieveKnowledgeChunksMock.mockResolvedValue([]);
    assembleKnowledgeContextMock.mockReturnValue({
      chunks: [],
      totalTokens: 0,
      truncated: false,
      droppedCount: 0,
    });
    process.env.JARVIS_ORCHESTRATION_CRITIQUE = 'false';
    process.env.JARVIS_API_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
    process.env.JARVIS_MODEL = 'deepseek-v3.2';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.JARVIS_API_KEY;
    delete process.env.NVIDIA_API_KEY;
  });

  it('executes plan -> retrieve -> summarize -> critique -> answer', async () => {
    process.env.JARVIS_API_KEY = 'test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"keywords":["macro","rates"],"tickers":["SPY"],"sourceTypes":["web_source","cached_headline"],"focusRegions":["us","eu"]}' } }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"tldr":"Macro mixed","findings":["US rates steady"],"actionSteps":["Keep position sizes normal"],"risks":["CPI surprise"]}' } }],
      })));

    const promise = runOrchestration({
      userId: 'user-1',
      mode: 'assistant',
      prompt: 'Summarize rates outlook',
      tradeTickers: ['SPY'],
      scrapeChunks: [],
      sourceContexts: [],
    });

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.steps.map((step) => step.step)).toEqual(['plan', 'retrieve', 'summarize', 'critique', 'answer']);
    expect(result.steps.find((step) => step.step === 'critique')?.skipped).toBe(true);
    expect(result.structured.tldr).toBe('Macro mixed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back deterministically when LLM is unavailable', async () => {
    process.env.JARVIS_API_KEY = '';

    const promise = runOrchestration({
      userId: 'user-1',
      mode: 'assistant',
      prompt: 'Fallback behavior',
      tradeTickers: ['AAPL'],
      scrapeChunks: [
        {
          sourceUrl: 'https://www.marketwatch.com/story/1',
          sourceHost: 'www.marketwatch.com',
          sourceTitle: 'MarketWatch',
          index: 0,
          startToken: 0,
          endToken: 10,
          tokenCount: 10,
          text: 'AAPL sees mixed momentum into earnings.',
          hash: 'h1',
          relevance: 0.8,
          tickers: ['AAPL'],
        },
      ],
      sourceContexts: [],
    });

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.message).toContain('TL;DR:');
    expect(result.structured.findings.length).toBeGreaterThan(0);
    expect(result.macroSummary).toBeUndefined();
  });

  it('keeps critique and answer marked as skipped when critique is disabled', async () => {
    process.env.JARVIS_API_KEY = '';
    process.env.JARVIS_ORCHESTRATION_CRITIQUE = 'false';

    const promise = runOrchestration({
      userId: 'user-1',
      mode: 'assistant',
      prompt: 'Check critique behavior',
      tradeTickers: [],
      scrapeChunks: [],
      sourceContexts: [],
    });

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.steps.find((step) => step.step === 'critique')?.skipped).toBe(true);
    expect(result.steps.find((step) => step.step === 'answer')?.skipped).toBe(true);
  });

  it('produces macroSummary in macro-summary mode and validates fields', async () => {
    process.env.JARVIS_API_KEY = 'test-key';

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"keywords":["macro"],"tickers":[],"sourceTypes":["cached_headline"],"focusRegions":["us","eu","asia","global"]}' } }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"tldr":"Daily macro mixed","findings":["Rates diverge"],"actionSteps":["Maintain hedges"],"risks":["Policy surprises"],"macroSummary":{"date":"2026-03-08","overallSentiment":"upside","regions":[{"region":"invalid","headline":"bad","details":["x"],"sentiment":"bullish"},{"region":"us","headline":42,"details":["valid",9],"sentiment":"bullish"}],"keyRisks":["Inflation",100]}}' } }],
      })));

    const promise = runOrchestration({
      userId: 'user-1',
      mode: 'macro-summary',
      prompt: 'Provide macro summary',
      tradeTickers: [],
      scrapeChunks: [],
      sourceContexts: [],
    });

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.macroSummary).toBeDefined();
    expect(result.macroSummary?.overallSentiment).toBe('neutral');
    expect(result.macroSummary?.regions).toHaveLength(1);
    expect(result.macroSummary?.regions[0]).toMatchObject({
      region: 'us',
      headline: 'No data available.',
      sentiment: 'bullish',
      details: ['valid'],
    });
    expect(result.macroSummary?.keyRisks).toEqual(['Inflation']);
  });

  it('short-circuits plan step for dilution-research mode', async () => {
    process.env.JARVIS_API_KEY = 'test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"tldr":"Dilution mixed","findings":["High warrant stack"],"actionSteps":["Monitor ATM"],"risks":["Cash runway short"]}' } }],
      })));

    const promise = runOrchestration({
      userId: 'user-1',
      mode: 'dilution-research',
      prompt: 'Analyze dilution',
      tradeTickers: ['AAPL'],
      scrapeChunks: [],
      sourceContexts: [],
    });

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.structured.tldr).toBe('Dilution mixed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
