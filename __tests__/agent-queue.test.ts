import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  claimNextQueuedJob,
  completeJob,
  failJob,
  heartbeatJob,
  persistStepLog,
  recoverExpiredJobs,
  renewJobLease,
  scheduleJobRetry,
} from '@/lib/agents/queue';
import type { AgentDb } from '@/lib/agents/db';
import type { AgentJob, StepLogEntry } from '@/lib/agents/types';

function createJobRow(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    agentId: 'orchestrator',
    userId: 'user-1',
    jobType: 'chat',
    status: 'processing',
    priority: 10,
    input: { prompt: 'hello' },
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

function createQueueDb({
  executeRows = [],
  returningRows = [{ id: 'job-1' }],
  returningResults = [],
}: {
  executeRows?: unknown[];
  returningRows?: Array<{ id: string }>;
  returningResults?: Array<Array<{ id: string }>>;
} = {}) {
  const state = {
    lastSet: null as Record<string, unknown> | null,
    lastWhere: null as unknown,
    setCalls: [] as Record<string, unknown>[],
  };

  const execute = vi.fn(async () => executeRows);
  const returning = vi.fn(async () => (
    returningResults.length > 0 ? returningResults.shift() : returningRows
  ));
  const where = vi.fn((condition: unknown) => {
    state.lastWhere = condition;
    return { returning };
  });
  const set = vi.fn((value: Record<string, unknown>) => {
    state.lastSet = value;
    state.setCalls.push(value);
    return { where };
  });
  const update = vi.fn(() => ({ set }));

  return {
    execute,
    update,
    _state: state,
    _mocks: {
      returning,
      where,
      set,
    },
  } as unknown as AgentDb & {
    _state: typeof state;
    _mocks: {
      returning: typeof returning;
      where: typeof where;
      set: typeof set;
    };
  };
}

const queueSource = fs.readFileSync(
  path.join(process.cwd(), 'lib/agents/queue.ts'),
  'utf8',
);

describe('agent queue helpers', () => {
  it('claims the next queued job and returns the fenced lease version', async () => {
    const claimedRow = createJobRow({ leaseVersion: 7, status: 'processing' });
    const db = createQueueDb({ executeRows: [claimedRow] });

    const result = await claimNextQueuedJob(db, 'orchestrator', 'orchestrator:1234');

    expect(result).toEqual({
      job: claimedRow,
      leaseVersion: 7,
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('returns null when no queued job is eligible to claim', async () => {
    const db = createQueueDb({ executeRows: [] });

    await expect(claimNextQueuedJob(db, 'orchestrator', 'orchestrator:1234')).resolves.toBeNull();
  });

  it('keeps the canonical claim SQL ordering and retry eligibility checks', () => {
    expect(queueSource).toContain('WITH candidate AS');
    expect(queueSource).toContain('ORDER BY priority DESC, created_at ASC, id ASC');
    expect(queueSource).toContain("next_retry_at IS NULL OR next_retry_at <= now()");
    expect(queueSource).toContain('started_at = COALESCE(started_at, now())');
  });

  it('renews a lease without touching the heartbeat timestamp', async () => {
    const db = createQueueDb();

    await expect(renewJobLease(db, 'job-1', 'worker-1', 2)).resolves.toBe(true);

    expect(db._state.lastSet).toEqual({
      lockExpiresAt: expect.any(Object),
    });
    expect(db._state.lastSet).not.toHaveProperty('lastHeartbeatAt');
  });

  it('heartbeats a lease and updates the heartbeat timestamp', async () => {
    const db = createQueueDb();

    await expect(heartbeatJob(db, 'job-1', 'worker-1', 2)).resolves.toBe(true);

    expect(db._state.lastSet).toEqual({
      lastHeartbeatAt: expect.any(Object),
      lockExpiresAt: expect.any(Object),
    });
  });

  it('completes a job and clears retry and lease fields', async () => {
    const db = createQueueDb();
    const result = { summary: 'done' };

    await expect(completeJob(db, 'job-1', 'worker-1', 2, result)).resolves.toBe(true);

    expect(db._state.lastSet).toEqual({
      status: 'completed',
      result,
      completedAt: expect.any(Object),
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
      nextRetryAt: null,
      errorMessage: null,
    });
  });

  it('fails a job without overwriting the existing result payload', async () => {
    const db = createQueueDb();

    await expect(failJob(db, 'job-1', 'worker-1', 2, 'boom')).resolves.toBe(true);

    expect(db._state.lastSet).toEqual({
      status: 'failed',
      errorMessage: 'boom',
      completedAt: expect.any(Object),
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
      nextRetryAt: null,
    });
    expect(db._state.lastSet).not.toHaveProperty('result');
  });

  it('schedules a retry while preserving startedAt and prior stepLog', async () => {
    const db = createQueueDb();
    const nextRetryAt = new Date('2026-04-07T12:10:00.000Z');

    await expect(
      scheduleJobRetry(db, 'job-1', 'worker-1', 2, nextRetryAt, 'retry later'),
    ).resolves.toBe(true);

    expect(db._state.lastSet).toEqual({
      status: 'queued',
      nextRetryAt,
      completedAt: null,
      result: null,
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
      errorMessage: 'retry later',
    });
    expect(db._state.lastSet).not.toHaveProperty('startedAt');
    expect(db._state.lastSet).not.toHaveProperty('stepLog');
  });

  it('recovers expired jobs by failing exhausted rows and requeueing rows with attempts left', async () => {
    const db = createQueueDb({
      returningResults: [[{ id: 'a' }], [{ id: 'b' }, { id: 'c' }]],
    });

    await expect(recoverExpiredJobs(db, 'orchestrator')).resolves.toEqual({
      requeued: 2,
      failed: 1,
    });

    expect(db._state.setCalls[0]).toEqual({
      status: 'failed',
      errorMessage: 'Job lease expired; worker did not finish (max attempts reached)',
      completedAt: expect.any(Object),
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
      nextRetryAt: null,
    });
    expect(db._state.setCalls[0]).not.toHaveProperty('result');

    expect(db._state.setCalls[1]).toEqual({
      status: 'queued',
      nextRetryAt: null,
      completedAt: null,
      result: null,
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
    });
    expect(db._state.setCalls[1]).not.toHaveProperty('leaseVersion');
    expect(db._state.setCalls[1]).not.toHaveProperty('startedAt');
    expect(db._state.setCalls[1]).not.toHaveProperty('attempt');
    expect(db._state.setCalls[1]).not.toHaveProperty('errorMessage');
  });

  it('returns empty recovery counts when no expired jobs match either branch', async () => {
    const db = createQueueDb({
      returningResults: [[], []],
    });

    await expect(recoverExpiredJobs(db, 'orchestrator')).resolves.toEqual({
      requeued: 0,
      failed: 0,
    });
  });

  it('persists the step log through the fenced queue helper', async () => {
    const db = createQueueDb();
    const stepLog: StepLogEntry[] = [{
      step: 'draft',
      status: 'completed',
      startedAt: '2026-04-07T12:00:00.000Z',
      completedAt: '2026-04-07T12:01:00.000Z',
      attempt: 1,
      validatorResult: 'pass',
      tokensUsed: 42,
    }];

    await expect(persistStepLog(db, 'job-1', 'worker-1', 2, stepLog)).resolves.toBe(true);

    expect(db._state.lastSet).toEqual({ stepLog });
  });

  it.each([
    ['renewJobLease', () => renewJobLease(createQueueDb({ returningRows: [] }), 'job-1', 'worker-1', 2)],
    ['heartbeatJob', () => heartbeatJob(createQueueDb({ returningRows: [] }), 'job-1', 'worker-1', 2)],
    ['completeJob', () => completeJob(createQueueDb({ returningRows: [] }), 'job-1', 'worker-1', 2, { ok: true })],
    ['failJob', () => failJob(createQueueDb({ returningRows: [] }), 'job-1', 'worker-1', 2, 'boom')],
    ['scheduleJobRetry', () => scheduleJobRetry(createQueueDb({ returningRows: [] }), 'job-1', 'worker-1', 2, new Date('2026-04-07T12:10:00.000Z'))],
    ['persistStepLog', () => persistStepLog(createQueueDb({ returningRows: [] }), 'job-1', 'worker-1', 2, [])],
  ])('%s returns false when the worker lease is stale or expired', async (_name, run) => {
    await expect(run()).resolves.toBe(false);
  });

  it('keeps live-lease fencing in the update helpers', () => {
    expect(queueSource).toContain("eq(agentJobs.status, 'processing')");
    expect(queueSource).toContain('lockExpiresAt} > now()');
  });

  it('keeps expired-job recovery scoped to the owning agent and expired lease branches', () => {
    expect(queueSource).toContain('eq(agentJobs.agentId, agentId)');
    expect(queueSource).toContain("eq(agentJobs.status, 'processing')");
    expect(queueSource).toContain('lockExpiresAt} < now()');
    expect(queueSource).toContain('agentJobs.attempt} >= ${agentJobs.maxAttempts}');
    expect(queueSource).toContain('agentJobs.attempt} < ${agentJobs.maxAttempts}');
  });
});
