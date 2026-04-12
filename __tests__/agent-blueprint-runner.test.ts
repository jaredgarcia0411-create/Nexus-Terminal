import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { agentJobCheckpoints, agentStepEffects } from '@/lib/db/schema';
import {
  BlueprintValidationError,
  BudgetExceededError,
  NotImplementedBlueprintError,
} from '@/lib/agents/types';

const buildContextMock = vi.hoisted(() => vi.fn());
const persistStepLogMock = vi.hoisted(() => vi.fn());
const checkBudgetMock = vi.hoisted(() => vi.fn());
const checkRateLimitMock = vi.hoisted(() => vi.fn());
const checkCircuitBreakerMock = vi.hoisted(() => vi.fn());
const recordLlmAttemptMock = vi.hoisted(() => vi.fn());
const loadCheckpointMock = vi.hoisted(() => vi.fn());
const saveCheckpointMock = vi.hoisted(() => vi.fn());
const recordStepEffectMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agents/context', () => ({
  buildContext: buildContextMock,
}));

vi.mock('@/lib/agents/queue', () => ({
  persistStepLog: persistStepLogMock,
}));

vi.mock('@/lib/agents/runtime-limits', () => ({
  checkBudget: checkBudgetMock,
  checkRateLimit: checkRateLimitMock,
  checkCircuitBreaker: checkCircuitBreakerMock,
  recordLlmAttempt: recordLlmAttemptMock,
}));

vi.mock('@/lib/agents/checkpoints', () => ({
  loadCheckpoint: loadCheckpointMock,
  saveCheckpoint: saveCheckpointMock,
  recordStepEffect: recordStepEffectMock,
}));

import { runBlueprint } from '@/lib/agents/blueprint-runner';
import type {
  AgentConfig,
  AgentContext,
  AgentJob,
  Blueprint,
  StepResult as AgentStepResult,
} from '@/lib/agents/types';

function createDb(tableRows: Map<unknown, unknown[][]> = new Map()) {
  const select = vi.fn(() => ({
    from(table: unknown) {
      const queue = tableRows.get(table) ?? [];
      tableRows.set(table, queue);

      return {
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: async (count: number) => {
              const rows = queue.shift() ?? [];
              return rows.slice(0, count);
            },
          })),
          limit: async (count: number) => {
            const rows = queue.shift() ?? [];
            return rows.slice(0, count);
          },
        })),
      };
    },
  }));

  return {
    select,
  };
}

function createJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    agentId: 'orchestrator',
    userId: 'user-1',
    jobType: 'chat',
    status: 'processing',
    priority: 10,
    input: { topic: 'watchlist' },
    result: null,
    errorMessage: null,
    progressNote: null,
    stepLog: [],
    attempt: 1,
    maxAttempts: 3,
    nextRetryAt: null,
    lockedBy: 'worker-1',
    lockExpiresAt: new Date('2026-04-07T12:05:00.000Z'),
    lastHeartbeatAt: new Date('2026-04-07T12:00:00.000Z'),
    leaseVersion: 2,
    createdAt: new Date('2026-04-07T11:55:00.000Z'),
    startedAt: new Date('2026-04-07T12:00:00.000Z'),
    completedAt: null,
    ...overrides,
  };
}

function createConfig(blueprint: Blueprint): AgentConfig {
  return {
    id: 'orchestrator',
    displayName: 'Orchestrator',
    llmLane: 'background',
    capabilities: ['chat'],
    rolePromptPath: 'prompts/orchestrator.md',
    blueprints: { main: blueprint },
    blueprintResolver: () => blueprint,
  };
}

function createContext(): AgentContext {
  return {
    recentTrades: [{ id: 'trade-1' }],
    macroSummary: {
      tradingDate: '2026-04-07',
      marketBias: 'neutral',
      summary: 'macro',
      drivers: [],
      crossAssetSnapshot: [],
      scheduledCatalysts: [],
      sectorRotation: [],
      deskImplications: [],
      sourceIndex: [],
      confidence: 'medium',
    },
    memory: [{
      id: 'memory-1',
      userId: 'user-1',
      agentId: 'orchestrator',
      category: 'fact',
      key: 'bias',
      value: 'bullish',
      valueJson: null,
      source: null,
      confidence: null,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
      expiresAt: null,
    }],
    conversationHistory: [{ id: 'message-1' }],
  };
}

function createStepResult(data: unknown, overrides: Partial<AgentStepResult> = {}): AgentStepResult {
  return {
    status: 'completed' as const,
    data,
    metrics: {
      durationMs: 25,
      tokensUsed: 0,
      attempt: 1,
    },
    provenance: {
      sourceIds: [],
      upstreamStepIds: [],
      timestamp: '2026-04-07T12:00:00.000Z',
      model: 'test-model',
    },
    ...overrides,
  };
}

describe('runBlueprint', () => {
  beforeEach(() => {
    buildContextMock.mockReset();
    persistStepLogMock.mockReset().mockResolvedValue(true);
    checkBudgetMock.mockReset().mockResolvedValue(undefined);
    checkRateLimitMock.mockReset().mockResolvedValue(undefined);
    checkCircuitBreakerMock.mockReset().mockResolvedValue(undefined);
    recordLlmAttemptMock.mockReset().mockResolvedValue(undefined);
    loadCheckpointMock.mockReset().mockResolvedValue(null);
    saveCheckpointMock.mockReset().mockResolvedValue(undefined);
    recordStepEffectMock.mockReset().mockResolvedValue(true);
    buildContextMock.mockResolvedValue(createContext());
  });

  it('executes ordered steps with step-1 and later-step validation against the correct payload', async () => {
    const job = createJob();
    const db = createDb() as never;
    let config: AgentConfig;
    const stepOneRun = vi.fn(async (input) => {
      expect(input.jobInput).toEqual({ topic: 'watchlist' });
      expect(input.previousOutput).toBeNull();
      expect(input.memory).toHaveLength(1);
      expect(input.job).toBe(job);
      expect(input.db).toBe(db);
      expect(input.agentConfig).toBe(config);
      return createStepResult({ count: 1 });
    });
    const stepTwoRun = vi.fn(async (input) => {
      expect(input.jobInput).toEqual({ topic: 'watchlist' });
      expect(input.previousOutput).toEqual({ count: 1 });
      expect(input.job).toBe(job);
      expect(input.db).toBe(db);
      expect(input.agentConfig).toBe(config);
      return createStepResult({ summary: 'done' });
    });

    const blueprint: Blueprint = {
      id: 'bp-1',
      description: 'test',
      steps: [
        {
          name: 'first',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          inputSchema: z.object({ topic: z.string() }),
          outputSchema: z.object({ count: z.number() }),
          run: stepOneRun,
        },
        {
          name: 'second',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          inputSchema: z.object({ count: z.number() }),
          outputSchema: z.object({ summary: z.string() }),
          run: stepTwoRun,
        },
      ],
    };

    config = createConfig(blueprint);

    const result = await runBlueprint(
      blueprint,
      job,
      config,
      db,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result).toEqual({
      status: 'completed',
      finalOutput: { summary: 'done' },
      stepsExecuted: 2,
    });
    expect(stepOneRun).toHaveBeenCalledTimes(1);
    expect(stepTwoRun).toHaveBeenCalledTimes(1);
    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(saveCheckpointMock).toHaveBeenCalledTimes(2);
    expect(persistStepLogMock).toHaveBeenCalledTimes(2);
    expect(checkBudgetMock).toHaveBeenCalledTimes(2);
    expect(checkRateLimitMock).toHaveBeenCalledTimes(2);
    expect(checkCircuitBreakerMock).toHaveBeenCalledTimes(2);
    expect(recordLlmAttemptMock).not.toHaveBeenCalled();
    expect(checkBudgetMock.mock.invocationCallOrder[0]).toBeLessThan(checkRateLimitMock.mock.invocationCallOrder[0]);
    expect(checkRateLimitMock.mock.invocationCallOrder[0]).toBeLessThan(checkCircuitBreakerMock.mock.invocationCallOrder[0]);
  });

  it('records both llm attempts when a repair retry is needed after output validation fails', async () => {
    const llmRun = vi.fn()
      .mockResolvedValueOnce(createStepResult(
        { ok: false },
        {
          metrics: { durationMs: 20, tokensUsed: 10, attempt: 1 },
          artifacts: { inputTokens: 4, outputTokens: 6 },
        },
      ))
      .mockResolvedValueOnce(createStepResult(
        { ok: true },
        {
          metrics: { durationMs: 30, tokensUsed: 20, attempt: 1 },
          artifacts: { inputTokens: 8, outputTokens: 12 },
        },
      ));

    const blueprint: Blueprint = {
      id: 'bp-llm',
      description: 'repair',
      steps: [{
        name: 'draft',
        type: 'llm',
        metadata: { canRetry: true, timeoutMs: 1000, maxRepairAttempts: 99, sideEffect: false, lane: 'background' },
        outputSchema: z.object({ ok: z.literal(true) }),
        run: llmRun,
      }],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result).toEqual({
      status: 'completed',
      finalOutput: { ok: true },
      stepsExecuted: 1,
    });
    expect(llmRun).toHaveBeenCalledTimes(2);
    expect(recordLlmAttemptMock).toHaveBeenCalledTimes(2);
    expect(recordLlmAttemptMock.mock.calls[0][1]).toMatchObject({ success: false, totalTokens: 10 });
    expect(recordLlmAttemptMock.mock.calls[1][1]).toMatchObject({ success: true, totalTokens: 20 });
    expect((persistStepLogMock.mock.calls[0][4] as Array<{ tokensUsed?: number }>)[0]).toMatchObject({
      tokensUsed: 30,
      validatorResult: 'pass',
    });
  });

  it('fails before step execution when a runtime policy guard rejects the job', async () => {
    checkBudgetMock.mockRejectedValueOnce(new BudgetExceededError('orchestrator', 'daily'));
    const stepRun = vi.fn();
    const blueprint: Blueprint = {
      id: 'bp-policy',
      description: 'policy',
      steps: [{
        name: 'draft',
        type: 'code',
        metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
        run: stepRun,
      }],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result.status).toBe('failed');
    expect(result.finalOutput).toBeNull();
    expect(result.failureReason).toContain('daily budget exceeded for orchestrator');
    expect(result.failureClass).toBe('policy');
    expect(result.stepsExecuted).toBe(0);
    expect(stepRun).not.toHaveBeenCalled();
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(checkCircuitBreakerMock).not.toHaveBeenCalled();
    expect((persistStepLogMock.mock.calls[0][4] as Array<{ errorClass?: string }>)[0]).toMatchObject({
      status: 'failed',
      errorClass: 'policy',
    });
  });

  it('aborts the run when step_log persistence loses the lease fence', async () => {
    persistStepLogMock.mockResolvedValueOnce(false);
    const blueprint: Blueprint = {
      id: 'bp-lease',
      description: 'lease',
      steps: [{
        name: 'draft',
        type: 'code',
        metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
        run: vi.fn(async () => createStepResult({ ok: true })),
      }],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result).toEqual({
      status: 'failed',
      finalOutput: null,
      failureReason: 'lease lost during step_log persistence',
      failureClass: 'transient',
      stepsExecuted: 1,
    });
  });

  it('resumes from the next step after the latest saved checkpoint', async () => {
    loadCheckpointMock.mockResolvedValueOnce({
      jobId: 'job-1',
      stepIndex: 0,
      stepName: 'first',
      checkpointJson: { count: 2 },
    });

    const firstRun = vi.fn();
    const secondRun = vi.fn(async (input) => {
      expect(input.previousOutput).toEqual({ count: 2 });
      return createStepResult({ summary: 'resumed' });
    });

    const blueprint: Blueprint = {
      id: 'bp-resume',
      description: 'resume',
      steps: [
        {
          name: 'first',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: firstRun,
        },
        {
          name: 'second',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: secondRun,
        },
      ],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result).toEqual({
      status: 'completed',
      finalOutput: { summary: 'resumed' },
      stepsExecuted: 1,
    });
    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('skips a side-effect step when the effect marker already exists and restores that step checkpoint output', async () => {
    loadCheckpointMock.mockResolvedValueOnce({
      jobId: 'job-1',
      stepIndex: 0,
      stepName: 'prep',
      checkpointJson: { prep: true },
    });

    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentStepEffects, [[{ id: 'effect-1' }]]);
    rows.set(agentJobCheckpoints, [[{ checkpointJson: { delivered: true } }]]);
    const db = createDb(rows);

    const skippedRun = vi.fn();
    const downstreamRun = vi.fn(async (input) => {
      expect(input.previousOutput).toEqual({ delivered: true });
      return createStepResult({ done: true });
    });

    const blueprint: Blueprint = {
      id: 'bp-skip',
      description: 'skip',
      steps: [
        {
          name: 'prep',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: vi.fn(async () => createStepResult({ prep: true })),
        },
        {
          name: 'deliver',
          type: 'code',
          metadata: {
            canRetry: false,
            timeoutMs: 1000,
            maxRepairAttempts: 0,
            sideEffect: true,
            idempotencyKey: 'job-1:deliver:memory-write',
          },
          run: skippedRun,
        },
        {
          name: 'finalize',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: downstreamRun,
        },
      ],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      db as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result).toEqual({
      status: 'completed',
      finalOutput: { done: true },
      stepsExecuted: 1,
    });
    expect(skippedRun).not.toHaveBeenCalled();
    expect(downstreamRun).toHaveBeenCalledTimes(1);
    expect((persistStepLogMock.mock.calls[0][4] as Array<{ tokensUsed?: number }>)[0]).toMatchObject({
      step: 'deliver',
      status: 'completed',
      tokensUsed: 0,
      validatorResult: 'pass',
    });
  });

  it('falls back to the prior checkpoint when a side-effect marker exists but the step checkpoint is missing', async () => {
    loadCheckpointMock.mockResolvedValueOnce({
      jobId: 'job-1',
      stepIndex: 0,
      stepName: 'prep',
      checkpointJson: { prep: true },
    });

    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentStepEffects, [[{ id: 'effect-1' }]]);
    rows.set(agentJobCheckpoints, [[]]);
    const db = createDb(rows);

    const downstreamRun = vi.fn(async (input) => {
      expect(input.previousOutput).toEqual({ prep: true });
      return createStepResult({ done: true });
    });

    const blueprint: Blueprint = {
      id: 'bp-crash-gap',
      description: 'crash gap',
      steps: [
        {
          name: 'prep',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: vi.fn(async () => createStepResult({ prep: true })),
        },
        {
          name: 'deliver',
          type: 'code',
          metadata: {
            canRetry: false,
            timeoutMs: 1000,
            maxRepairAttempts: 0,
            sideEffect: true,
            idempotencyKey: 'job-1:deliver:memory-write',
          },
          run: vi.fn(),
        },
        {
          name: 'finalize',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: downstreamRun,
        },
      ],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      db as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result.status).toBe('completed');
    expect((persistStepLogMock.mock.calls[0][4] as Array<{ errorClass?: string }>)[0]).toMatchObject({
      errorClass: 'crash-between-effect-and-checkpoint',
    });
  });

  it('re-runs a side-effect step when there is no effect marker or checkpoint yet', async () => {
    loadCheckpointMock.mockResolvedValueOnce({
      jobId: 'job-1',
      stepIndex: 0,
      stepName: 'prep',
      checkpointJson: { prep: true },
    });

    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentStepEffects, [[]]);
    const db = createDb(rows);
    const sideEffectRun = vi.fn(async (input) => {
      expect(input.previousOutput).toEqual({ prep: true });
      return createStepResult({ delivered: true });
    });

    const blueprint: Blueprint = {
      id: 'bp-rerun',
      description: 'rerun',
      steps: [
        {
          name: 'prep',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: vi.fn(async () => createStepResult({ prep: true })),
        },
        {
          name: 'deliver',
          type: 'code',
          metadata: {
            canRetry: false,
            timeoutMs: 1000,
            maxRepairAttempts: 0,
            sideEffect: true,
            idempotencyKey: 'job-1:deliver:memory-write',
          },
          run: sideEffectRun,
        },
      ],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      db as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result).toEqual({
      status: 'completed',
      finalOutput: { delivered: true },
      stepsExecuted: 1,
    });
    expect(sideEffectRun).toHaveBeenCalledTimes(1);
  });

  it('orders side-effect writes as effect marker, checkpoint, then step_log', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentStepEffects, [[]]);
    const db = createDb(rows);
    const blueprint: Blueprint = {
      id: 'bp-order',
      description: 'order',
      steps: [{
        name: 'deliver',
        type: 'code',
        metadata: {
          canRetry: false,
          timeoutMs: 1000,
          maxRepairAttempts: 0,
          sideEffect: true,
          idempotencyKey: 'job-1:deliver:memory-write',
        },
        run: vi.fn(async () => createStepResult({ delivered: true })),
      }],
    };

    await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      db as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(recordStepEffectMock.mock.invocationCallOrder[0]).toBeLessThan(saveCheckpointMock.mock.invocationCallOrder[0]);
    expect(saveCheckpointMock.mock.invocationCallOrder[0]).toBeLessThan(persistStepLogMock.mock.invocationCallOrder[0]);
  });

  it('fails with a contract error when later-step input validation receives the wrong previousOutput shape', async () => {
    const blueprint: Blueprint = {
      id: 'bp-validation',
      description: 'validation',
      steps: [
        {
          name: 'first',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: vi.fn(async () => createStepResult({ wrong: true })),
        },
        {
          name: 'second',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          inputSchema: z.object({ count: z.number() }),
          run: vi.fn(),
        },
      ],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('Validation failed at second (input)');
    expect(result.failureClass).toBe('contract');
    expect((persistStepLogMock.mock.calls[1][4] as Array<{ validatorResult?: string; errorClass?: string }>)[1]).toMatchObject({
      validatorResult: 'fail',
      errorClass: 'contract',
    });
  });

  it('surfaces output validation failures after the single llm repair retry is exhausted', async () => {
    const llmRun = vi.fn()
      .mockResolvedValueOnce(createStepResult({ ok: false }, { metrics: { durationMs: 10, tokensUsed: 5, attempt: 1 } }))
      .mockResolvedValueOnce(createStepResult({ ok: false }, { metrics: { durationMs: 10, tokensUsed: 5, attempt: 1 } }));

    const blueprint: Blueprint = {
      id: 'bp-llm-contract',
      description: 'llm contract',
      steps: [{
        name: 'draft',
        type: 'llm',
        metadata: { canRetry: true, timeoutMs: 1000, maxRepairAttempts: 99, sideEffect: false },
        outputSchema: z.object({ ok: z.literal(true) }),
        run: llmRun,
      }],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('Validation failed at draft (output)');
    expect(result.failureClass).toBe('contract');
    expect(recordLlmAttemptMock).toHaveBeenCalledTimes(2);
    expect((persistStepLogMock.mock.calls[0][4] as Array<{ tokensUsed?: number; errorClass?: string }>)[0]).toMatchObject({
      tokensUsed: 10,
      errorClass: 'contract',
    });
  });

  it('skips a routed step when metadata.skipWhenRouted is enabled', async () => {
    const routedDecision = {
      decision: 'route-to-specialist',
      targetAgentId: 'small-cap-trader',
      specialistJobType: 'research',
      specialistJobId: 'job-specialist-1',
      warning: null,
      message: 'routed',
    };
    const firstRun = vi.fn(async () => createStepResult(routedDecision));
    const skippedRun = vi.fn();
    const blueprint: Blueprint = {
      id: 'bp-routed',
      description: 'routed',
      steps: [
        {
          name: 'classify',
          type: 'code',
          metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
          run: firstRun,
        },
        {
          name: 'synthesize',
          type: 'llm',
          metadata: {
            canRetry: true,
            timeoutMs: 1000,
            maxRepairAttempts: 0,
            sideEffect: false,
            skipWhenRouted: true,
          },
          run: skippedRun,
        },
      ],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result).toEqual({
      status: 'completed',
      finalOutput: routedDecision,
      stepsExecuted: 1,
    });
    expect(skippedRun).not.toHaveBeenCalled();
    expect((persistStepLogMock.mock.calls[1][4] as Array<{ step?: string; tokensUsed?: number }>)[1]).toMatchObject({
      step: 'synthesize',
      tokensUsed: 0,
    });
  });

  it('classifies not implemented blueprints as contract failures', async () => {
    const blueprint: Blueprint = {
      id: 'bp-not-implemented',
      description: 'contract',
      steps: [{
        name: 'not-implemented',
        type: 'code',
        metadata: { canRetry: false, timeoutMs: 1000, maxRepairAttempts: 0, sideEffect: false },
        run: vi.fn(async () => {
          throw new NotImplementedBlueprintError('small-cap-trader:pre-market-scan');
        }),
      }],
    };

    const result = await runBlueprint(
      blueprint,
      createJob(),
      createConfig(blueprint),
      createDb() as never,
      { lockedBy: 'worker-1', leaseVersion: 2 },
    );

    expect(result.status).toBe('failed');
    expect(result.failureClass).toBe('contract');
    expect(result.failureReason).toContain('blueprint not implemented in Sprint 3');
  });
});
