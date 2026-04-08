import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDb } from '@/lib/agents/db';
import type { AgentConfig, AgentJob, Blueprint, QueueClaimResult } from '@/lib/agents/types';

const mocks = vi.hoisted(() => ({
  getAgentDb: vi.fn(),
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
  claimNextQueuedJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  scheduleJobRetry: vi.fn(),
  heartbeatJob: vi.fn(),
  calculateBackoffMs: vi.fn((attempt: number) => Math.pow(4, attempt - 1) * 2000),
  runBlueprint: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: mocks.getAgentDb,
}));

vi.mock('@/lib/agents/heartbeat', () => ({
  startHeartbeat: mocks.startHeartbeat,
}));

vi.mock('@/lib/agents/queue', () => ({
  claimNextQueuedJob: mocks.claimNextQueuedJob,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
  scheduleJobRetry: mocks.scheduleJobRetry,
  heartbeatJob: mocks.heartbeatJob,
  calculateBackoffMs: mocks.calculateBackoffMs,
}));

vi.mock('@/lib/agents/blueprint-runner', () => ({
  runBlueprint: mocks.runBlueprint,
}));

vi.mock('node:fs', () => ({
  default: {
    writeFileSync: mocks.writeFileSync,
  },
  writeFileSync: mocks.writeFileSync,
}));

const POLL_INTERVAL_MS = 5_000;
const WORKER_ID = `orchestrator:${process.pid}`;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createAgentJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    agentId: 'orchestrator',
    userId: 'user-1',
    jobType: 'chat',
    status: 'processing',
    priority: 0,
    input: { message: 'hello' },
    result: null,
    errorMessage: null,
    progressNote: null,
    stepLog: [],
    attempt: 1,
    maxAttempts: 3,
    nextRetryAt: null,
    lockedBy: WORKER_ID,
    lockExpiresAt: new Date('2026-04-07T12:05:00.000Z'),
    lastHeartbeatAt: new Date('2026-04-07T12:00:00.000Z'),
    leaseVersion: 7,
    createdAt: new Date('2026-04-07T11:55:00.000Z'),
    startedAt: new Date('2026-04-07T12:00:00.000Z'),
    completedAt: null,
    ...overrides,
  };
}

function createBlueprint(): Blueprint {
  return {
    id: 'orchestrator:chat',
    description: 'test blueprint',
    steps: [],
  };
}

function createAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'orchestrator',
    displayName: 'Orchestrator',
    llmLane: 'interactive',
    temperature: 0.3,
    capabilities: ['chat'],
    rolePromptPath: 'lib/agents/prompts/orchestrator.md',
    blueprints: {},
    blueprintResolver: vi.fn(() => createBlueprint()),
    ...overrides,
  };
}

function createWorkerDb(): AgentDb & {
  _state: {
    updateCalls: Array<Record<string, unknown>>;
  };
} {
  const state = {
    updateCalls: [] as Array<Record<string, unknown>>,
  };

  const where = vi.fn(async () => []);
  const set = vi.fn((value: Record<string, unknown>) => {
    state.updateCalls.push(value);
    return { where };
  });
  const update = vi.fn(() => ({ set }));

  return {
    update,
    _state: state,
  } as unknown as AgentDb & {
    _state: typeof state;
  };
}

function createHeartbeatDb() {
  const state = {
    setCalls: [] as Array<Record<string, unknown>>,
  };

  const where = vi.fn(async () => [{ id: 'orchestrator' }]);
  const set = vi.fn((value: Record<string, unknown>) => {
    state.setCalls.push(value);
    return { where };
  });
  const update = vi.fn(() => ({ set }));

  return {
    update,
    _state: state,
  } as unknown as AgentDb & {
    _state: typeof state;
  };
}

async function settleWorker(iterations = 6) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe('startHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
    vi.clearAllMocks();
    mocks.writeFileSync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the registry and touches /tmp/healthy on each tick, then marks the agent offline on stop', async () => {
    const db = createHeartbeatDb();
    const { startHeartbeat } = await vi.importActual<typeof import('@/lib/agents/heartbeat')>(
      '@/lib/agents/heartbeat',
    );

    const handle = startHeartbeat(db, 'orchestrator', 30_000);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(db._state.setCalls[0]).toEqual({
      lastHeartbeat: expect.any(Object),
      status: 'online',
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/tmp/healthy',
      '2026-04-07T12:00:30.000Z',
    );

    await handle.stop();

    expect(db._state.setCalls[1]).toEqual({
      status: 'offline',
    });
  });
});

describe('agent worker loop', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getAgentDb.mockReset();
    mocks.startHeartbeat.mockReset();
    mocks.stopHeartbeat.mockReset();
    mocks.claimNextQueuedJob.mockReset();
    mocks.completeJob.mockReset();
    mocks.failJob.mockReset();
    mocks.scheduleJobRetry.mockReset();
    mocks.heartbeatJob.mockReset();
    mocks.runBlueprint.mockReset();
    mocks.writeFileSync.mockReset();
    mocks.startHeartbeat.mockReturnValue({ stop: mocks.stopHeartbeat.mockResolvedValue(undefined) });
    mocks.claimNextQueuedJob.mockResolvedValue(null);
    mocks.completeJob.mockResolvedValue(true);
    mocks.failJob.mockResolvedValue(true);
    mocks.scheduleJobRetry.mockResolvedValue(true);
    mocks.heartbeatJob.mockResolvedValue(true);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('claims a queued job, runs the blueprint, and completes it', async () => {
    const db = createWorkerDb();
    const job = createAgentJob();
    const blueprint = createBlueprint();
    const agentConfig = createAgentConfig({
      blueprintResolver: vi.fn(() => blueprint),
    });

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: job.leaseVersion } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockResolvedValue({
      status: 'completed',
      finalOutput: { content: 'done' },
      stepsExecuted: 1,
    });

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.getAgentDb).toHaveBeenCalledTimes(1);
    expect(db._state.updateCalls[0]).toEqual({
      status: 'online',
    });
    expect(mocks.startHeartbeat).toHaveBeenCalledWith(db, 'orchestrator');
    expect(mocks.claimNextQueuedJob).toHaveBeenCalledWith(db, 'orchestrator', WORKER_ID);
    expect(agentConfig.blueprintResolver).toHaveBeenCalledWith(job);
    expect(mocks.runBlueprint).toHaveBeenCalledWith(
      blueprint,
      job,
      agentConfig,
      db,
      { lockedBy: WORKER_ID, leaseVersion: job.leaseVersion },
    );
    expect(mocks.completeJob).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      job.leaseVersion,
      { content: 'done' },
    );

    await handle.stop();
    expect(mocks.stopHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('logs when completeJob loses the lease', async () => {
    const db = createWorkerDb();
    const job = createAgentJob();
    const blueprint = createBlueprint();
    const agentConfig = createAgentConfig({
      blueprintResolver: vi.fn(() => blueprint),
    });

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: job.leaseVersion } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockResolvedValue({
      status: 'completed',
      finalOutput: { content: 'done' },
      stepsExecuted: 1,
    });
    mocks.completeJob.mockResolvedValue(false);

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.completeJob).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      job.leaseVersion,
      { content: 'done' },
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `agent worker completeJob lost lease for job ${job.id}`,
      {
        jobId: job.id,
        workerId: WORKER_ID,
        leaseVersion: job.leaseVersion,
      },
    );

    await handle.stop();
  });

  it('logs when scheduleJobRetry loses the lease', async () => {
    const db = createWorkerDb();
    const job = createAgentJob({ attempt: 1, maxAttempts: 3, leaseVersion: 9 });
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: 9 } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockResolvedValue({
      status: 'failed',
      finalOutput: null,
      failureReason: 'temporary upstream error',
      failureClass: 'transient',
      stepsExecuted: 1,
    });
    mocks.scheduleJobRetry.mockResolvedValue(false);

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.scheduleJobRetry).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      9,
      new Date('2026-04-07T12:00:02.000Z'),
      'temporary upstream error',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `agent worker scheduleJobRetry lost lease for job ${job.id}`,
      {
        jobId: job.id,
        workerId: WORKER_ID,
        leaseVersion: 9,
      },
    );

    await handle.stop();
  });

  it('logs when failJob loses the lease', async () => {
    const db = createWorkerDb();
    const job = createAgentJob({ attempt: 2, maxAttempts: 3, leaseVersion: 4 });
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: 4 } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockResolvedValue({
      status: 'failed',
      finalOutput: null,
      failureReason: 'NotImplementedBlueprintError: blueprint not implemented in Sprint 3: orchestrator:chat',
      failureClass: 'contract',
      stepsExecuted: 1,
    });
    mocks.failJob.mockResolvedValue(false);

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.failJob).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      4,
      'NotImplementedBlueprintError: blueprint not implemented in Sprint 3: orchestrator:chat',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `agent worker failJob lost lease for job ${job.id}`,
      {
        jobId: job.id,
        workerId: WORKER_ID,
        leaseVersion: 4,
      },
    );

    await handle.stop();
  });

  it('sleeps when no queued job is available', async () => {
    const db = createWorkerDb();
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob.mockResolvedValue(null);

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();
    expect(mocks.claimNextQueuedJob).toHaveBeenCalledTimes(1);
    expect(mocks.runBlueprint).not.toHaveBeenCalled();
    expect(mocks.completeJob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await settleWorker();

    expect(mocks.claimNextQueuedJob).toHaveBeenCalledTimes(2);
    expect(mocks.runBlueprint).not.toHaveBeenCalled();
    expect(mocks.completeJob).not.toHaveBeenCalled();

    await handle.stop();
    expect(mocks.stopHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('packages routed orchestrator jobs before completion', async () => {
    const db = createWorkerDb();
    const job = createAgentJob({
      id: 'job-route',
      jobType: 'chat',
      input: { message: 'please route this' },
    });
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: 11 } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockResolvedValue({
      status: 'completed',
      finalOutput: {
        decision: 'route-to-specialist',
        specialistJobId: 'special-job-42',
        warning: null,
      },
      stepsExecuted: 1,
    });

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.completeJob).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      11,
      { routed: true, specialistJobId: 'special-job-42' },
    );

    await handle.stop();
  });

  it('schedules a retry for transient failures using the backoff window', async () => {
    const db = createWorkerDb();
    const job = createAgentJob({ attempt: 1, maxAttempts: 3, leaseVersion: 9 });
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: 9 } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockResolvedValue({
      status: 'failed',
      finalOutput: null,
      failureReason: 'temporary upstream error',
      failureClass: 'transient',
      stepsExecuted: 1,
    });

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.scheduleJobRetry).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      9,
      new Date('2026-04-07T12:00:02.000Z'),
      'temporary upstream error',
    );
    expect(mocks.failJob).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('fails non-transient errors without scheduling a retry', async () => {
    const db = createWorkerDb();
    const job = createAgentJob({ attempt: 2, maxAttempts: 3, leaseVersion: 4 });
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: 4 } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockResolvedValue({
      status: 'failed',
      finalOutput: null,
      failureReason: 'NotImplementedBlueprintError: blueprint not implemented in Sprint 3: orchestrator:chat',
      failureClass: 'contract',
      stepsExecuted: 1,
    });

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.failJob).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      4,
      'NotImplementedBlueprintError: blueprint not implemented in Sprint 3: orchestrator:chat',
    );
    expect(mocks.scheduleJobRetry).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('fails the job when runBlueprint rejects before returning a run result', async () => {
    const db = createWorkerDb();
    const job = createAgentJob({ attempt: 1, maxAttempts: 3, leaseVersion: 15 });
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: 15 } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockRejectedValue(new Error('blueprint exploded'));

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();

    expect(mocks.scheduleJobRetry).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      15,
      new Date('2026-04-07T12:00:02.000Z'),
      'blueprint exploded',
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
    expect(mocks.completeJob).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('waits for an in-flight job to finish before stopping the heartbeat', async () => {
    const db = createWorkerDb();
    const job = createAgentJob({ id: 'job-drain', leaseVersion: 13 });
    const deferred = createDeferred<{
      status: 'completed';
      finalOutput: { content: string };
      stepsExecuted: number;
    }>();
    const agentConfig = createAgentConfig();

    mocks.getAgentDb.mockReturnValue(db);
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce({ job, leaseVersion: 13 } satisfies QueueClaimResult)
      .mockResolvedValueOnce(null);
    mocks.runBlueprint.mockReturnValue(deferred.promise);

    const { startWorker } = await import('@/lib/agents/worker');
    const handle = await startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig,
    });

    await settleWorker();
    expect(mocks.runBlueprint).toHaveBeenCalledTimes(1);

    const stopPromise = handle.stop();
    await settleWorker();
    expect(mocks.stopHeartbeat).not.toHaveBeenCalled();

    deferred.resolve({
      status: 'completed',
      finalOutput: { content: 'drained' },
      stepsExecuted: 1,
    });

    await stopPromise;

    expect(mocks.completeJob).toHaveBeenCalledWith(
      db,
      job.id,
      WORKER_ID,
      13,
      { content: 'drained' },
    );
    expect(mocks.stopHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('throws before starting when the agent database is not configured', async () => {
    mocks.getAgentDb.mockReturnValue(null);

    const { startWorker } = await import('@/lib/agents/worker');

    await expect(startWorker({
      agentId: 'orchestrator',
      pollIntervalMs: POLL_INTERVAL_MS,
      agentConfig: createAgentConfig(),
    })).rejects.toThrow('Database not configured');

    expect(mocks.startHeartbeat).not.toHaveBeenCalled();
    expect(mocks.claimNextQueuedJob).not.toHaveBeenCalled();
  });
});
