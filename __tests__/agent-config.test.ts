import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_CONFIGS, resolveBlueprint } from '@/lib/agents/config';
import {
  NotImplementedBlueprintError,
  V1_AGENT_IDS,
} from '@/lib/agents/types';
import type {
  AgentConfig,
  AgentContext,
  AgentJob,
  StepInput,
} from '@/lib/agents/types';

function createJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    agentId: 'orchestrator',
    userId: 'user-1',
    jobType: 'chat',
    status: 'queued',
    priority: 10,
    input: { message: 'Hello' },
    result: null,
    errorMessage: null,
    progressNote: null,
    stepLog: [],
    attempt: 1,
    maxAttempts: 3,
    nextRetryAt: null,
    lockedBy: null,
    lockExpiresAt: null,
    lastHeartbeatAt: null,
    leaseVersion: 1,
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
): StepInput {
  return {
    jobInput: job.input,
    previousOutput: null,
    memory: [],
    context: createContext(),
    job,
    db: {} as never,
    agentConfig,
  };
}

describe('agent config registry', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('node:fs');
    vi.doUnmock('@/lib/agents/blueprints/orchestrator-chat');
    vi.doUnmock('@/lib/agents/blueprints/orchestrator-macro-summary');
    vi.doUnmock('@/lib/agents/blueprints/orchestrator-macro-intraday');
    vi.doUnmock('@/lib/agents/blueprints/orchestrator-market-pulse');
    vi.doUnmock('@/lib/agents/blueprints/small-cap-research');
    vi.doUnmock('@/lib/agents/blueprints/swing-trader-research');
  });

  it('defines a config for every v1 agent id and resolves known blueprints', () => {
    expect(Object.keys(AGENT_CONFIGS).sort()).toEqual([...V1_AGENT_IDS].sort());

    for (const agentId of V1_AGENT_IDS) {
      expect(AGENT_CONFIGS[agentId]).toBeDefined();
      expect(AGENT_CONFIGS[agentId].id).toBe(agentId);
    }

    expect(resolveBlueprint(createJob({
      agentId: 'orchestrator',
      jobType: 'chat',
    })).id).toBe('orchestrator:chat');
    expect(resolveBlueprint(createJob({
      agentId: 'orchestrator',
      jobType: 'macro-summary',
    })).id).toBe('orchestrator:macro-summary');
    expect(resolveBlueprint(createJob({
      agentId: 'orchestrator',
      jobType: 'macro-summary',
      input: { tradingDate: '2026-04-07', intradayUpdate: true },
    })).id).toBe('orchestrator:macro-intraday');
    expect(resolveBlueprint(createJob({
      agentId: 'orchestrator',
      jobType: 'market-pulse',
    })).id).toBe('orchestrator:market-pulse');
    expect(resolveBlueprint(createJob({
      agentId: 'small-cap-trader',
      jobType: 'research',
    })).id).toBe('small-cap-trader:research');
    expect(resolveBlueprint(createJob({
      agentId: 'swing-trader',
      jobType: 'research',
    })).id).toBe('swing-trader:research');
  });

  it('throws when resolveBlueprint receives an unknown agent id', () => {
    expect(() => resolveBlueprint(createJob({
      agentId: 'unknown-agent' as never,
      jobType: 'chat',
    }))).toThrow('unknown agent: unknown-agent');
  });

  it('surfaces the not-implemented blueprint error at step execution time', async () => {
    const job = createJob({
      agentId: 'small-cap-trader',
      jobType: 'pre-market-scan',
      input: { ticker: 'ABCD' },
    });
    const blueprint = resolveBlueprint(job);

    expect(blueprint.id).toBe('small-cap-trader:pre-market-scan');
    expect(blueprint.steps).toHaveLength(1);

    await expect(blueprint.steps[0].run(
      createStepInput(job, AGENT_CONFIGS['small-cap-trader']),
    )).rejects.toBeInstanceOf(NotImplementedBlueprintError);
    await expect(blueprint.steps[0].run(
      createStepInput(job, AGENT_CONFIGS['small-cap-trader']),
    )).rejects.toThrow('blueprint not implemented in Sprint 3');
  });

  it('does not perform import-time file reads when the config module is loaded with mocked blueprints', async () => {
    const readFileSyncMock = vi.fn(() => {
      throw new Error('unexpected file read');
    });
    const mockBlueprint = {
      id: 'mock-blueprint',
      description: 'mock',
      steps: [],
    };

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      readFileSync: readFileSyncMock,
    }));
    vi.doMock('@/lib/agents/blueprints/orchestrator-chat', () => ({
      orchestratorChatBlueprint: mockBlueprint,
    }));
    vi.doMock('@/lib/agents/blueprints/orchestrator-macro-summary', () => ({
      orchestratorMacroSummaryBlueprint: mockBlueprint,
    }));
    vi.doMock('@/lib/agents/blueprints/orchestrator-macro-intraday', () => ({
      orchestratorMacroIntradayBlueprint: mockBlueprint,
    }));
    vi.doMock('@/lib/agents/blueprints/orchestrator-market-pulse', () => ({
      orchestratorMarketPulseBlueprint: mockBlueprint,
    }));
    vi.doMock('@/lib/agents/blueprints/small-cap-research', () => ({
      smallCapResearchBlueprint: mockBlueprint,
    }));
    vi.doMock('@/lib/agents/blueprints/swing-trader-research', () => ({
      swingTraderResearchBlueprint: mockBlueprint,
    }));

    const { AGENT_CONFIGS: freshConfigs } = await import('@/lib/agents/config');

    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(Object.keys(freshConfigs).sort()).toEqual([...V1_AGENT_IDS].sort());
  });
});

describe('prompts loader', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('node:fs');
  });

  it('reads the prompt files once at module load and builds the llm system prompt from cached content', async () => {
    const readFileSyncMock = vi.fn((filePath: string) => {
      const normalizedPath = String(filePath);
      if (normalizedPath.endsWith('global-policy.md')) {
        return 'GLOBAL';
      }
      if (normalizedPath.endsWith('jmt-report-format.md')) {
        return 'JMT';
      }
      if (normalizedPath.endsWith('orchestrator.md')) {
        return 'ORCHESTRATOR';
      }
      if (normalizedPath.endsWith('small-cap.md')) {
        return 'SMALL';
      }
      if (normalizedPath.endsWith('swing-trader.md')) {
        return 'SWING';
      }

      throw new Error(`unexpected file: ${normalizedPath}`);
    });

    vi.doMock('node:fs', () => ({
      readFileSync: readFileSyncMock,
    }));

    const promptsLoader = await import('@/lib/agents/prompts-loader');

    expect(readFileSyncMock).toHaveBeenCalledTimes(5);
    expect(promptsLoader.loadGlobalPolicyPrompt()).toBe('GLOBAL');
    expect(promptsLoader.loadJmtFormatPrompt()).toBe('JMT');
    expect(promptsLoader.loadRolePrompt('orchestrator')).toBe('ORCHESTRATOR');
    expect(promptsLoader.loadRolePrompt('small-cap-trader')).toBe('SMALL');
    expect(promptsLoader.loadRolePrompt('swing-trader')).toBe('SWING');
    expect(promptsLoader.buildLlmSystemPrompt('orchestrator')).toBe('GLOBAL\n\n---\n\nORCHESTRATOR');
    expect(promptsLoader.buildLlmSystemPrompt('small-cap-trader')).toBe('GLOBAL\n\n---\n\nJMT\n\n---\n\nSMALL');
    expect(promptsLoader.buildLlmSystemPrompt('swing-trader')).toBe('GLOBAL\n\n---\n\nJMT\n\n---\n\nSWING');
    expect(readFileSyncMock).toHaveBeenCalledTimes(5);
  });

  it('fails fast when a required prompt file is missing at module load', async () => {
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');

      return {
        ...actual,
        readFileSync: vi.fn((filePath: Parameters<typeof actual.readFileSync>[0], encoding: Parameters<typeof actual.readFileSync>[1]) => {
          if (String(filePath).endsWith('orchestrator.md')) {
            const error = new Error(`ENOENT: missing prompt ${String(filePath)}`);
            (error as NodeJS.ErrnoException).code = 'ENOENT';
            throw error;
          }

          return actual.readFileSync(filePath, encoding);
        }),
      };
    });

    await expect(import('@/lib/agents/prompts-loader')).rejects.toThrow(/orchestrator\.md/);
  });
});
