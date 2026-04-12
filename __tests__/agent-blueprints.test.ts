import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, AgentContext, AgentJob, StepInput } from '@/lib/agents/types';

const randomUUIDMock = vi.hoisted(() => vi.fn(() => 'specialist-job-1'));
const callLlmMock = vi.hoisted(() => vi.fn());
const writeAndDeliverReportMock = vi.hoisted(() => vi.fn());
const upsertMemoryMock = vi.hoisted(() => vi.fn());
const getCachedTickerDataMock = vi.hoisted(() => vi.fn());
const normalizeAskEdgarResponseMock = vi.hoisted(() => vi.fn());
const fetchUnifiedSnapshotMock = vi.hoisted(() => vi.fn());
const fetchDailyAggregatesMock = vi.hoisted(() => vi.fn());
const fetchPageTextMock = vi.hoisted(() => vi.fn());

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

vi.mock('@/lib/agents/llm-client', () => ({
  callLlm: callLlmMock,
}));

vi.mock('@/lib/agents/discord', () => ({
  writeAndDeliverReport: writeAndDeliverReportMock,
}));

vi.mock('@/lib/agents/memory', () => ({
  upsertMemory: upsertMemoryMock,
}));

vi.mock('@/lib/askedgar', () => ({
  getCachedTickerData: getCachedTickerDataMock,
  normalizeAskEdgarResponse: normalizeAskEdgarResponseMock,
}));

vi.mock('@/lib/massive-market', () => ({
  fetchUnifiedSnapshot: fetchUnifiedSnapshotMock,
  fetchDailyAggregates: fetchDailyAggregatesMock,
}));

vi.mock('@/lib/agents/scrape-lite', () => ({
  fetchPageText: fetchPageTextMock,
}));

import { AGENT_CONFIGS, resolveBlueprint } from '@/lib/agents/config';

function createJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    agentId: 'orchestrator',
    userId: 'user-1',
    jobType: 'chat',
    status: 'queued',
    priority: 1,
    input: { message: 'help' },
    result: null,
    errorMessage: null,
    progressNote: null,
    stepLog: [],
    attempt: 0,
    maxAttempts: 3,
    nextRetryAt: null,
    lockedBy: null,
    lockExpiresAt: null,
    lastHeartbeatAt: null,
    leaseVersion: 0,
    createdAt: new Date('2026-04-07T12:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function createContext(): AgentContext {
  return {
    recentTrades: [],
    macroSummary: null,
    memory: [],
    conversationHistory: [],
  };
}

function createStepInput(
  job: AgentJob,
  agentConfig: AgentConfig,
  options: {
    jobInput?: unknown;
    previousOutput?: unknown;
    db?: unknown;
    context?: Partial<AgentContext>;
  } = {},
): StepInput {
  return {
    jobInput: options.jobInput ?? job.input,
    previousOutput: options.previousOutput ?? null,
    memory: [],
    context: {
      ...createContext(),
      ...(options.context ?? {}),
    },
    job,
    db: (options.db ?? {}) as never,
    agentConfig,
  };
}

function createRegistryDb(status: string) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({
    values: insertValues,
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([{ status }]),
      })),
    })),
  }));

  return {
    db: {
      select,
      insert,
    },
    insertValues,
  };
}

describe('agent blueprints', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset().mockReturnValue('specialist-job-1');
    callLlmMock.mockReset();
    writeAndDeliverReportMock.mockReset().mockResolvedValue({
      reportId: 'job-1:research',
      status: 'published',
      deliveryError: null,
    });
    upsertMemoryMock.mockReset().mockResolvedValue(undefined);
    getCachedTickerDataMock.mockReset();
    normalizeAskEdgarResponseMock.mockReset().mockReturnValue({
      news: [{ title: 'Shelf registration' }],
      dilutionDetails: { estimatedCash: 1000000 },
    });
    fetchUnifiedSnapshotMock.mockReset();
    fetchDailyAggregatesMock.mockReset();
    fetchPageTextMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves all four implemented blueprints through the config registry', () => {
    const blueprints = [
      resolveBlueprint(createJob({
        agentId: 'orchestrator',
        jobType: 'chat',
      })),
      resolveBlueprint(createJob({
        agentId: 'orchestrator',
        jobType: 'macro-summary',
        input: {},
      })),
      resolveBlueprint(createJob({
        agentId: 'small-cap-trader',
        jobType: 'research',
        input: { ticker: 'AAPL' },
      })),
      resolveBlueprint(createJob({
        agentId: 'swing-trader',
        jobType: 'research',
        input: { ticker: 'AAPL' },
      })),
    ];

    expect(blueprints.map((blueprint) => blueprint.id)).toEqual([
      'orchestrator:chat',
      'orchestrator:macro-summary',
      'small-cap-trader:research',
      'swing-trader:research',
    ]);
    expect(blueprints.every((blueprint) => blueprint.steps.length > 0)).toBe(true);
  });

  it.each([
    {
      name: 'research slash command wins even when swing keywords are present',
      message: '/research MDR TSLA',
      targetAgentId: 'small-cap-trader',
    },
    {
      name: 'swing slash command wins even when dilution keywords are present',
      message: '/swing ATM NVDA',
      targetAgentId: 'swing-trader',
    },
    {
      name: 'small-cap keyword route',
      message: 'Is there a shelf or dilution setup on ABCD?',
      targetAgentId: 'small-cap-trader',
    },
    {
      name: 'swing keyword route',
      message: 'Is this a parabolic breakout on MDR names?',
      targetAgentId: 'swing-trader',
    },
  ])('$name', async ({ message, targetAgentId }) => {
    const job = createJob({
      agentId: 'orchestrator',
      jobType: 'chat',
      input: { message },
    });
    const agentConfig = AGENT_CONFIGS.orchestrator;
    const { db, insertValues } = createRegistryDb('online');
    const blueprint = resolveBlueprint(job);

    const result = await blueprint.steps[0].run(createStepInput(job, agentConfig, { db }));

    expect(result.data).toMatchObject({
      decision: 'route-to-specialist',
      targetAgentId,
      specialistJobType: 'research',
      specialistJobId: 'specialist-job-1',
      warning: null,
      message: 'routed',
    });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: 'specialist-job-1',
      agentId: targetAgentId,
      userId: job.userId,
      jobType: 'research',
      status: 'queued',
    }));
  });

  it('hands the slash-command ticker into the specialist job input', async () => {
    const job = createJob({
      agentId: 'orchestrator',
      jobType: 'chat',
      input: { message: '/research TSLA and NVDA' },
    });
    const agentConfig = AGENT_CONFIGS.orchestrator;
    const { db, insertValues } = createRegistryDb('online');
    const blueprint = resolveBlueprint(job);

    await blueprint.steps[0].run(createStepInput(job, agentConfig, { db }));

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: 'specialist-job-1',
      agentId: 'small-cap-trader',
      userId: job.userId,
      jobType: 'research',
      status: 'queued',
      input: {
        ticker: 'NVDA',
        originator_job_id: job.id,
        origin_channel_id: 'discord',
      },
    }));
  });

  it('handles direct orchestrator requests without enqueuing a specialist job', async () => {
    const job = createJob({
      agentId: 'orchestrator',
      jobType: 'chat',
      input: { message: 'What time is the CPI release tomorrow?' },
    });
    const agentConfig = AGENT_CONFIGS.orchestrator;
    const { db, insertValues } = createRegistryDb('online');
    const blueprint = resolveBlueprint(job);

    const result = await blueprint.steps[0].run(createStepInput(job, agentConfig, { db }));

    expect(result.data).toEqual({
      decision: 'handle-directly',
      targetAgentId: null,
      specialistJobType: null,
      specialistJobId: null,
      warning: null,
      message: 'What time is the CPI release tomorrow?',
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('falls back to self when the routed specialist is not online', async () => {
    const job = createJob({
      agentId: 'orchestrator',
      jobType: 'chat',
      input: { message: '/research TSLA' },
    });
    const agentConfig = AGENT_CONFIGS.orchestrator;
    const { db, insertValues } = createRegistryDb('degraded');
    const blueprint = resolveBlueprint(job);

    const result = await blueprint.steps[0].run(createStepInput(job, agentConfig, { db }));

    expect(result.data).toEqual({
      decision: 'fallback-to-self',
      targetAgentId: 'small-cap-trader',
      specialistJobType: 'research',
      specialistJobId: null,
      warning: 'small-cap-trader is degraded, handling request directly',
      message: '/research TSLA',
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('uses the background lane for macro-summary synthesis', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        marketBias: 'neutral',
        summary: 'Macro summary',
        drivers: [{
          driver: 'Rates steady into the close',
          impact: 'mixed',
          sourceRefs: ['headline:example.com'],
        }],
        scheduledCatalysts: [{
          event: 'CPI release',
          date: '2026-04-08',
          expectedImpact: 'Could reset rate-cut expectations.',
        }],
        sectorRotation: ['Tech strong'],
        deskImplications: ['Stay selective into the open.'],
        confidence: 'medium',
      }),
      modelUsed: 'background-model',
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 123,
    });
    const job = createJob({
      agentId: 'orchestrator',
      jobType: 'macro-summary',
      input: {},
    });
    const agentConfig = AGENT_CONFIGS.orchestrator;
    const blueprint = resolveBlueprint(job);

    const result = await blueprint.steps[2].run(createStepInput(job, agentConfig, {
      previousOutput: {
        headlines: [{ url: 'https://example.com', text: 'Markets mixed' }],
        snapshot: null,
        note: 'no massive api key',
        crossAssetSnapshot: [],
        sourceIndex: [
          {
            id: 'headline:example.com',
            title: 'example.com headlines',
            url: 'https://example.com',
            fetchedAt: '2026-04-07T12:00:00.000Z',
          },
        ],
      },
    }));

    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.any(String),
      userMessage: expect.stringContaining('Source index:\n'),
    }), 'background');
    expect(result.data).toEqual({
      marketBias: 'neutral',
      summary: 'Macro summary',
      drivers: [{
        driver: 'Rates steady into the close',
        impact: 'mixed',
        sourceRefs: ['headline:example.com'],
      }],
      scheduledCatalysts: [{
        event: 'CPI release',
        date: '2026-04-08',
        expectedImpact: 'Could reset rate-cut expectations.',
      }],
      sectorRotation: ['Tech strong'],
      deskImplications: ['Stay selective into the open.'],
      crossAssetSnapshot: [],
      sourceIndex: [
        {
          id: 'headline:example.com',
          title: 'example.com headlines',
          url: 'https://example.com',
          fetchedAt: '2026-04-07T12:00:00.000Z',
        },
      ],
      confidence: 'medium',
    });
  });

  it('formats recent trades, extracts prose from wrapped orchestrator JSON responses, and persists the assistant turn', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        response: 'Tighten risk and watch follow-through.',
      }),
      modelUsed: 'interactive-model',
      inputTokens: 12,
      outputTokens: 6,
      durationMs: 45,
    });
    randomUUIDMock.mockReturnValueOnce('assistant-turn-1');
    const job = createJob({
      agentId: 'orchestrator',
      jobType: 'chat',
      input: { message: 'What should I do next?', channel: 'discord' },
    });
    const agentConfig = AGENT_CONFIGS.orchestrator;
    const blueprint = resolveBlueprint(job);
    const { db, insertValues } = createRegistryDb('online');

    const result = await blueprint.steps[1].run(createStepInput(job, agentConfig, {
      previousOutput: {
        decision: 'handle-directly',
        targetAgentId: null,
        specialistJobType: null,
        specialistJobId: null,
        warning: null,
        message: 'What should I do next?',
      },
      context: {
        macroSummary: {
          tradingDate: '2026-04-07',
          marketBias: 'neutral',
          summary: 'Breadth improved into the close.',
          drivers: [
            { driver: 'Rates steadied', impact: 'mixed', sourceRefs: ['headline:marketwatch.com'] },
          ],
          crossAssetSnapshot: [],
          scheduledCatalysts: [],
          sectorRotation: [],
          deskImplications: ['Keep size tighter near the open'],
          sourceIndex: [
            {
              id: 'headline:marketwatch.com',
              title: 'marketwatch.com headlines',
              url: 'https://www.marketwatch.com/latest-news',
              fetchedAt: '2026-04-07T13:00:00.000Z',
            },
          ],
          confidence: 'medium',
        },
        recentTrades: [
          { symbol: 'AAPL', grossPnl: 250.6, direction: 'LONG', date: '2026-04-07' },
          { ticker: 'TSLA', pnl: -90.2, direction: 'SHORT' },
        ],
      },
      db,
    }));

    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('Recent trades:\nAAPL: +$251 (long, 2026-04-07)\nTSLA: -$90 (short)'),
    }), 'interactive');
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('Latest macro summary:\nBias: neutral (medium confidence)\nSummary: Breadth improved into the close.\nDrivers: Rates steadied (mixed)\nDesk: Keep size tighter near the open'),
    }), 'interactive');
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('IMPORTANT: Do NOT wrap your response in JSON. Do NOT use code fences. Return plain text only.'),
    }), 'interactive');
    expect(result.data).toEqual({
      content: 'Tighten risk and watch follow-through.',
    });
    expect(insertValues).toHaveBeenCalledWith({
      id: 'assistant-turn-1',
      userId: job.userId,
      agentId: 'orchestrator',
      sessionId: job.id,
      role: 'assistant',
      content: 'Tighten risk and watch follow-through.',
      channel: 'discord',
    });
  });

  it('writes the macro-summary report with the trading date and synthesized payload', async () => {
    const job = createJob({
      agentId: 'orchestrator',
      jobType: 'macro-summary',
      input: { tradingDate: '2026-04-07' },
    });
    const agentConfig = AGENT_CONFIGS.orchestrator;
    const blueprint = resolveBlueprint(job);
    writeAndDeliverReportMock.mockResolvedValueOnce({
      reportId: 'job-1:macro-summary',
      status: 'published',
      deliveryError: null,
    });

    const result = await blueprint.steps[3].run(createStepInput(job, agentConfig, {
      previousOutput: {
        marketBias: 'bullish',
        summary: 'Macro summary',
        drivers: [{
          driver: 'Breadth improved after the open',
          impact: 'positive',
          sourceRefs: ['headline:marketwatch.com'],
        }],
        crossAssetSnapshot: [
          { ticker: 'SPY', price: 520.12, changePercent: 0.8 },
        ],
        scheduledCatalysts: [{
          event: 'FOMC minutes',
          date: '2026-04-08',
          expectedImpact: 'Could shift rate expectations.',
        }],
        sectorRotation: ['Tech strong'],
        deskImplications: ['Stay with relative-strength leaders.'],
        sourceIndex: [
          {
            id: 'headline:marketwatch.com',
            title: 'marketwatch.com headlines',
            url: 'https://www.marketwatch.com/latest-news',
            fetchedAt: '2026-04-07T12:00:00.000Z',
          },
          {
            id: 'snapshot:SPY',
            title: 'SPY Session Snapshot',
            url: null,
            fetchedAt: '2026-04-07T12:00:00.000Z',
          },
        ],
        confidence: 'medium',
      },
      db: {},
    }));

    expect(writeAndDeliverReportMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: job.id,
      userId: 'system-agent-user',
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-07 macro briefing',
      summary: 'Macro summary',
      reportJson: {
        tradingDate: '2026-04-07',
        marketBias: 'bullish',
        summary: 'Macro summary',
        drivers: [{
          driver: 'Breadth improved after the open',
          impact: 'positive',
          sourceRefs: ['headline:marketwatch.com'],
        }],
        crossAssetSnapshot: [
          { ticker: 'SPY', price: 520.12, changePercent: 0.8 },
        ],
        scheduledCatalysts: [{
          event: 'FOMC minutes',
          date: '2026-04-08',
          expectedImpact: 'Could shift rate expectations.',
        }],
        sectorRotation: ['Tech strong'],
        deskImplications: ['Stay with relative-strength leaders.'],
        sourceIndex: [
          {
            id: 'headline:marketwatch.com',
            title: 'marketwatch.com headlines',
            url: 'https://www.marketwatch.com/latest-news',
            fetchedAt: '2026-04-07T12:00:00.000Z',
          },
          {
            id: 'snapshot:SPY',
            title: 'SPY Session Snapshot',
            url: null,
            fetchedAt: '2026-04-07T12:00:00.000Z',
          },
        ],
        confidence: 'medium',
      },
    }));
    expect(result.data).toMatchObject({
      tradingDate: '2026-04-07',
      reportId: 'job-1:macro-summary',
      status: 'published',
      deliveryError: null,
    });
  });

  it('uses the AskEdgar cache helper for small-cap research when data is available', async () => {
    getCachedTickerDataMock.mockResolvedValue({
      fetchedAt: '2026-04-07T12:00:00.000Z',
      registrations: [{ title: 'Shelf registration' }],
      offerings: [],
      dilutionDetails: { estimatedCash: 1000000 },
      rawData: {
        'gap-stats': {
          results: [{ open: 10, close: 9, high: 11 }],
        },
        registrations: {
          results: [{ title: 'Shelf registration' }],
        },
        news: {
          results: [{ title: 'Shelf registration' }],
        },
        screener: {
          results: [{ name: 'Apple Inc.' }],
        },
      },
      warnings: [],
      hasAnyData: true,
    });
    const job = createJob({
      agentId: 'small-cap-trader',
      jobType: 'research',
      input: { ticker: 'AAPL' },
    });
    const agentConfig = AGENT_CONFIGS['small-cap-trader'];
    const blueprint = resolveBlueprint(job);

    const result = await blueprint.steps[0].run(createStepInput(job, agentConfig));

    expect(getCachedTickerDataMock).toHaveBeenCalledWith('AAPL');
    expect(result.data).toMatchObject({
      ticker: 'AAPL',
      gapStats: [{ open: 10, close: 9, high: 11 }],
      registrations: [{ title: 'Shelf registration' }],
      news: [{ title: 'Shelf registration' }],
      cashPosition: { estimatedCash: 1000000 },
    });
  });

  it('uses the AskEdgar cache helper for small-cap research when the upstream payload is sparse', async () => {
    getCachedTickerDataMock.mockResolvedValue({
      fetchedAt: '2026-04-07T12:00:00.000Z',
      registrations: [],
      offerings: [],
      rawData: {
        screener: {
          results: [{ name: 'Apple Inc.' }],
        },
      },
      warnings: ['rate limited'],
      hasAnyData: false,
    });
    const job = createJob({
      agentId: 'small-cap-trader',
      jobType: 'research',
      input: { ticker: 'AAPL' },
    });
    const agentConfig = AGENT_CONFIGS['small-cap-trader'];
    const blueprint = resolveBlueprint(job);

    const result = await blueprint.steps[0].run(createStepInput(job, agentConfig));

    expect(getCachedTickerDataMock).toHaveBeenCalledWith('AAPL');
    expect(result.data).toMatchObject({
      ticker: 'AAPL',
      gapStats: [],
      offerings: [],
      registrations: [],
      cashPosition: { name: 'Apple Inc.' },
    });
  });

  it('adds deterministic analysis and labeled AskEdgar sections to the small-cap synthesis prompt', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        ticker: 'AAPL',
        newsWhyRunning: { rating: 'green', explanation: 'No credible catalyst.' },
        themeMatch: { rating: 'yellow', explanation: 'Loose theme link.' },
        otherCatalysts: [{ catalyst: '424B', rating: 'green' }],
        chartHistory: { rating: 'green', explanation: 'Gap-and-fade history.' },
        dilution: { rating: 'green', explanation: 'Shelf is active.' },
        offeringFrequency: { rating: 'green', explanation: 'Frequent issuer.' },
        offeringAbility: { rating: 'green', explanation: 'ATM is active.' },
        cashNeed: { rating: 'green', explanation: 'Cash runway looks tight.' },
        overallOfferingRisk: { rating: 'green', explanation: 'High near-term offering risk.' },
        jmt415Commentary: null,
        historicalStats: 'Average gap fade 18%.',
        confidence: 'high',
        evidenceIds: ['gap-stats', 'offerings'],
      }),
      modelUsed: 'background-model',
      inputTokens: 22,
      outputTokens: 11,
      durationMs: 55,
    });
    const job = createJob({
      agentId: 'small-cap-trader',
      jobType: 'research',
      input: { ticker: 'AAPL' },
    });
    const agentConfig = AGENT_CONFIGS['small-cap-trader'];
    const blueprint = resolveBlueprint(job);
    const synthesizeStep = blueprint.steps.find((step) => step.name === 'synthesize-report');

    expect(synthesizeStep).toBeDefined();

    const result = await synthesizeStep!.run(createStepInput(job, agentConfig, {
      previousOutput: {
        ticker: 'AAPL',
        gapStats: [{ open: 10, close: 9, high: 11 }],
        offerings: [{ offering_type: 'ATM', status: 'active' }],
        registrations: [{ status: 'effective' }],
        equityLines: [],
        dilutionRating: null,
        dilutionData: [{ cash_burn: 'high' }],
        ownership: [{ percentage: 42 }],
        historicalFloat: [{ date: '2026-01-01', float: 100 }],
        reverseSplits: [],
        splitStatus: [{ status: 'approved pending' }],
        agreements: [],
        nasdaqCompliance: [{ deadline: '2026-04-15' }],
        pumpAndDumpTracker: null,
        news: [{ title: 'Shelf filing' }],
        cashPosition: { estimatedCash: 1000000 },
        priceContext: {
          price: 10,
          change: 2,
          volume: 1000,
          avgVolume90d: 500,
          marketCap: 1000000,
          sector: 'Tech',
          high1w: 11,
          low1w: 8,
          rsi: 72,
          macdSignal: 1.1,
          ema9: 9.5,
          ema21: 8.9,
        },
        deterministicAnalysis: {
          gapCount: 1,
          sameDayFadeRate: 1,
          avgCloseVsOpen: -10,
          avgHighExtension: 10,
          recentOfferingCount: 1,
          hasActiveShelf: true,
          hasActiveAtm: true,
          amountRemainingAtm: 1000000,
          splitApproved: true,
          splitEffectivePending: true,
          daysToComplianceDeadline: 3,
          floatTrend: 'stable',
          knownHolderOverhang: 42,
        },
      },
    }));

    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('AskEdgar sections:'),
    }), 'background');
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('gapStats:\n'),
    }), 'background');
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('Deterministic analysis:\n'),
    }), 'background');
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.not.stringContaining('Filings:\n'),
    }), 'background');
    expect(result.data).toMatchObject({
      ticker: 'AAPL',
      confidence: 'high',
    });
  });

  it.each([
    {
      name: 'small-cap research save step',
      job: createJob({
        agentId: 'small-cap-trader',
        jobType: 'research',
        input: { ticker: 'AAPL' },
      }),
      previousOutput: {
        ticker: 'AAPL',
        newsWhyRunning: { rating: 'green', explanation: 'No real catalyst.' },
        themeMatch: { rating: 'yellow', explanation: 'Loose sympathy only.' },
        otherCatalysts: [{ catalyst: '424B', rating: 'green' }],
        chartHistory: { rating: 'green', explanation: 'Gap-and-fade history.' },
        dilution: { rating: 'green', explanation: 'Shelf is active.' },
        offeringFrequency: { rating: 'green', explanation: 'Frequent issuer.' },
        offeringAbility: { rating: 'green', explanation: 'ATM is active.' },
        cashNeed: { rating: 'green', explanation: 'Cash runway is tight.' },
        overallOfferingRisk: { rating: 'green', explanation: 'High probability of near-term offering.' },
        jmt415Commentary: null,
        historicalStats: 'Average gap fade 18%.',
        confidence: 'high',
        evidenceIds: ['filing-1'],
      },
      expectedAgentId: 'small-cap-trader',
      expectedSummary: /GREEN offering risk/,
      expectedTitle: 'AAPL Small-Cap Research',
    },
    {
      name: 'swing research save step',
      job: createJob({
        agentId: 'swing-trader',
        jobType: 'research',
        input: { ticker: 'NVDA' },
      }),
      previousOutput: {
        ticker: 'NVDA',
        mdrPatternMatch: { rating: 'green', explanation: 'Strong MDR analog.', mdrSimilarity: 87 },
        momentum: { rating: 'green', explanation: 'Momentum still expanding.' },
        catalyst: { rating: 'yellow', explanation: 'Catalyst is valid but aging.' },
        patternClassification: 'CONTINUATION',
        recommendation: { action: 'ADD', reasoning: 'Momentum remains intact.' },
        volumeProfile: { rating: 'green', explanation: 'Volume is 4x average.' },
        confidence: 'medium',
        evidenceIds: ['chart-1'],
      },
      expectedAgentId: 'swing-trader',
      expectedSummary: /ADD.*CONTINUATION/,
      expectedTitle: 'NVDA Swing Research',
    },
  ])('uses writeAndDeliverReport in the $name', async ({ job, previousOutput, expectedAgentId, expectedSummary, expectedTitle }) => {
    const agentConfig = AGENT_CONFIGS[job.agentId];
    const blueprint = resolveBlueprint(job);
    const saveStep = blueprint.steps.find((step) => step.name === 'save-research');
    expect(saveStep).toBeDefined();

    const result = await saveStep!.run(createStepInput(job, agentConfig, {
      previousOutput,
      db: {},
    }));

    expect(writeAndDeliverReportMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: job.id,
      userId: job.userId,
      agentId: expectedAgentId,
      reportType: 'research',
      title: expectedTitle,
      ...(expectedSummary instanceof RegExp
        ? { summary: expect.stringMatching(expectedSummary) }
        : { summary: expectedSummary }),
    }));
    expect(result.data).toMatchObject({
      reportId: 'job-1:research',
      status: 'published',
      deliveryError: null,
    });

    if (job.agentId === 'swing-trader') {
      expect(upsertMemoryMock).toHaveBeenCalledWith(expect.anything(), {
        userId: job.userId,
        agentId: 'swing-trader',
        category: 'thesis',
        key: 'NVDA',
        value: 'ADD — CONTINUATION',
        valueJson: {
          action: 'ADD',
          pattern: 'CONTINUATION',
          mdrSimilarity: 87,
          momentum: 'green',
          confidence: 'medium',
        },
        source: `report:${job.id}`,
        confidence: 'medium',
        expiresAt: expect.any(Date),
      });
    } else {
      expect(upsertMemoryMock).not.toHaveBeenCalled();
    }
  });

  it('continues swing research with empty OHLC history when Massive fails', async () => {
    fetchDailyAggregatesMock.mockRejectedValue(new Error('Massive unavailable'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = createJob({
      agentId: 'swing-trader',
      jobType: 'research',
      input: { ticker: 'AAPL' },
    });
    const agentConfig = AGENT_CONFIGS['swing-trader'];
    const blueprint = resolveBlueprint(job);
    const fetchOhlcStep = blueprint.steps.find((step) => step.name === 'fetch-ohlc-history');

    expect(fetchOhlcStep).toBeDefined();

    const result = await fetchOhlcStep!.run(createStepInput(job, agentConfig, {
      previousOutput: {
        ticker: 'AAPL',
        gapStats: [],
        ownership: [],
        historicalFloat: [],
        dilutionRating: null,
        registrations: [],
        offerings: [],
        priceContext: {
          price: 10,
          change: 2,
          volume: 1000,
          avgVolume90d: 500,
          marketCap: 1000000,
          sector: 'Tech',
          high1w: 11,
          low1w: 8,
          rsi: 72,
          macdSignal: 1.2,
          ema9: 9.5,
          ema21: 8.9,
        },
      },
    }));

    expect(fetchDailyAggregatesMock).toHaveBeenCalledWith('AAPL', 10);
    expect(result.data).toMatchObject({
      ticker: 'AAPL',
      ohlcHistory: [],
    });
    expect(warnSpy).toHaveBeenCalledWith('[swing-trader] OHLC fetch failed for AAPL:', expect.any(Error));
  });

  it('adds deterministic technicals and runner-quality sections to the swing synthesis prompt', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        ticker: 'AAPL',
        mdrPatternMatch: { rating: 'green', explanation: 'Clean MDR analog.', mdrSimilarity: 76 },
        momentum: { rating: 'yellow', explanation: 'Momentum is elevated but mixed.' },
        catalyst: { rating: 'green', explanation: 'Catalyst remains valid.' },
        patternClassification: 'CONTINUATION',
        recommendation: { action: 'HOLD', reasoning: 'Pattern remains intact without forcing size.' },
        volumeProfile: { rating: 'green', explanation: 'Volume remains elevated.' },
        confidence: 'high',
        evidenceIds: ['gap-stats', 'ownership'],
      }),
      modelUsed: 'background-model',
      inputTokens: 24,
      outputTokens: 10,
      durationMs: 60,
    });

    const job = createJob({
      agentId: 'swing-trader',
      jobType: 'research',
      input: { ticker: 'AAPL' },
    });
    const agentConfig = AGENT_CONFIGS['swing-trader'];
    const blueprint = resolveBlueprint(job);
    const synthesizeStep = blueprint.steps.find((step) => step.name === 'synthesize-report');

    expect(synthesizeStep).toBeDefined();

    const result = await synthesizeStep!.run(createStepInput(job, agentConfig, {
      previousOutput: {
        ticker: 'AAPL',
        gapStats: [{ open: 10, close: 11, high: 12 }],
        ownership: [{ percentage: 32 }],
        historicalFloat: [
          { date: '2026-01-01', float: 100 },
          { date: '2026-04-01', float: 112 },
        ],
        dilutionRating: { rating: 'moderate' },
        registrations: [{ status: 'effective' }],
        offerings: [{ offering_type: 'ATM', status: 'active' }],
        priceContext: {
          price: 10,
          change: 2,
          volume: 1000,
          avgVolume90d: 500,
          marketCap: 1000000,
          sector: 'Tech',
          high1w: 11,
          low1w: 8,
          rsi: 72,
          macdSignal: 1.1,
          ema9: 9.5,
          ema21: 8.9,
        },
        ohlcHistory: [
          { date: '2026-04-01', open: 8, high: 9, low: 7.8, close: 8.5, volume: 100, vwap: 8.4 },
          { date: '2026-04-02', open: 8.5, high: 9.2, low: 8.3, close: 8.9, volume: 120, vwap: 8.8 },
          { date: '2026-04-03', open: 8.9, high: 9.5, low: 8.7, close: 9.1, volume: 140, vwap: 9.0 },
          { date: '2026-04-04', open: 9.1, high: 9.8, low: 9.0, close: 9.4, volume: 160, vwap: 9.3 },
          { date: '2026-04-07', open: 9.4, high: 10.2, low: 9.3, close: 10.0, volume: 180, vwap: 9.8 },
          { date: '2026-04-08', open: 10.0, high: 10.5, low: 9.9, close: 10.3, volume: 200, vwap: 10.2 },
          { date: '2026-04-09', open: 10.3, high: 10.8, low: 10.1, close: 10.5, volume: 220, vwap: 10.4 },
          { date: '2026-04-10', open: 10.5, high: 10.9, low: 10.2, close: 10.6, volume: 240, vwap: 10.5 },
          { date: '2026-04-11', open: 10.6, high: 11.0, low: 10.4, close: 10.8, volume: 260, vwap: 10.7 },
          { date: '2026-04-12', open: 10.8, high: 11.2, low: 10.7, close: 11.0, volume: 280, vwap: 10.9 },
        ],
        deterministicTechnicals: {
          relativeVolume: 2,
          extension5d: 23.6,
          extension10d: 29.4,
          rsi: 72,
          ema9: 9.5,
          ema21: 8.9,
        },
        runnerQuality: {
          gapStats: [{ open: 10, close: 11, high: 12 }],
          ownership: [{ percentage: 32 }],
          historicalFloat: [
            { date: '2026-01-01', float: 100 },
            { date: '2026-04-01', float: 112 },
          ],
          dilutionRating: { rating: 'moderate' },
          registrations: [{ status: 'effective' }],
          offerings: [{ offering_type: 'ATM', status: 'active' }],
          floatTrend: 'increasing',
          knownHolderOverhang: 32,
        },
      },
    }));

    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('Deterministic technicals:\n'),
    }), 'background');
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('Runner quality:\n'),
    }), 'background');
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.stringContaining('floatTrend:\n"increasing"'),
    }), 'background');
    expect(result.data).toMatchObject({
      ticker: 'AAPL',
      confidence: 'high',
    });
  });
});
