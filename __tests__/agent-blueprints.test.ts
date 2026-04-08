import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, AgentContext, AgentJob, StepInput } from '@/lib/agents/types';

const randomUUIDMock = vi.hoisted(() => vi.fn(() => 'specialist-job-1'));
const callLlmMock = vi.hoisted(() => vi.fn());
const writeAndDeliverReportMock = vi.hoisted(() => vi.fn());
const getCachedTickerDataMock = vi.hoisted(() => vi.fn());
const normalizeAskEdgarResponseMock = vi.hoisted(() => vi.fn());
const fetchUnifiedSnapshotMock = vi.hoisted(() => vi.fn());
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

vi.mock('@/lib/askedgar', () => ({
  getCachedTickerData: getCachedTickerDataMock,
  normalizeAskEdgarResponse: normalizeAskEdgarResponseMock,
}));

vi.mock('@/lib/massive-market', () => ({
  fetchUnifiedSnapshot: fetchUnifiedSnapshotMock,
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
  } = {},
): StepInput {
  return {
    jobInput: options.jobInput ?? job.input,
    previousOutput: options.previousOutput ?? null,
    memory: [],
    context: createContext(),
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
    getCachedTickerDataMock.mockReset();
    normalizeAskEdgarResponseMock.mockReset().mockReturnValue({
      news: [{ title: 'Shelf registration' }],
      dilutionDetails: { estimatedCash: 1000000 },
    });
    fetchUnifiedSnapshotMock.mockReset();
    fetchPageTextMock.mockReset();
    vi.unstubAllGlobals();
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
        summary: 'Macro summary',
        keyEvents: ['Event'],
        sectorNotes: ['Tech strong'],
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
      },
    }));

    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.any(String),
    }), 'background');
    expect(result.data).toEqual({
      summary: 'Macro summary',
      keyEvents: ['Event'],
      sectorNotes: ['Tech strong'],
      confidence: 'medium',
    });
  });

  it('uses the AskEdgar cache helper for small-cap research when data is available', async () => {
    getCachedTickerDataMock.mockResolvedValue({
      fetchedAt: '2026-04-07T12:00:00.000Z',
      registrations: [{ title: 'Shelf registration' }],
      offerings: [],
      dilutionDetails: { estimatedCash: 1000000 },
      rawData: {
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
      filings: [{ title: 'Shelf registration' }],
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
      filings: [],
      cashPosition: { name: 'Apple Inc.' },
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
        dilutionRisk: 'high',
        offeringAbility: 'immediate',
        filingSummary: 'Shelf is active',
        catalysts: ['424B'],
        confidence: 'high',
        evidenceIds: ['filing-1'],
      },
      expectedAgentId: 'small-cap-trader',
      expectedSummary: 'Shelf is active',
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
        mdrSimilarity: 87,
        volumeSurgeRatio: 4.2,
        levels: { entry: 110, stop: 103, targets: [120, 128] },
        recommendation: 'ADD',
        patternClassification: 'CONTINUATION',
        confidence: 'medium',
        evidenceIds: ['chart-1'],
      },
      expectedAgentId: 'swing-trader',
      expectedSummary: /ADD CONTINUATION/,
    },
  ])('uses writeAndDeliverReport in the $name', async ({ job, previousOutput, expectedAgentId, expectedSummary }) => {
    const agentConfig = AGENT_CONFIGS[job.agentId];
    const blueprint = resolveBlueprint(job);
    const saveStep = blueprint.steps[3];

    const result = await saveStep.run(createStepInput(job, agentConfig, {
      previousOutput,
      db: {},
    }));

    expect(writeAndDeliverReportMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: job.id,
      userId: job.userId,
      agentId: expectedAgentId,
      reportType: 'research',
      ...(expectedSummary instanceof RegExp
        ? { summary: expect.stringMatching(expectedSummary) }
        : { summary: expectedSummary }),
    }));
    expect(result.data).toMatchObject({
      reportId: 'job-1:research',
      status: 'published',
      deliveryError: null,
    });
  });
});
