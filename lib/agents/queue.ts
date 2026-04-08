import { and, eq, sql } from 'drizzle-orm';
import { agentJobs } from '@/lib/db/schema';
import type { AgentDb } from './db';
import type {
  AgentId,
  AgentJob,
  JobStatus,
  JobType,
  QueueClaimResult,
  StepLogEntry,
} from './types';

type ClaimRow = {
  id: string;
  agentId: string;
  userId: string;
  jobType: string;
  status: string;
  priority: number;
  input: unknown;
  result: unknown | null;
  errorMessage: string | null;
  progressNote: string | null;
  stepLog: unknown;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lockedBy: string | null;
  lockExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  leaseVersion: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

type ClaimRowsResult = ClaimRow[] | { rows: ClaimRow[] };

function normalizeStepLog(stepLog: unknown): StepLogEntry[] {
  return Array.isArray(stepLog) ? (stepLog as StepLogEntry[]) : [];
}

function toAgentJob(row: ClaimRow): AgentJob {
  return {
    ...row,
    agentId: row.agentId as AgentId,
    jobType: row.jobType as JobType,
    status: row.status as JobStatus,
    stepLog: normalizeStepLog(row.stepLog),
  };
}

function processingLeaseFence(jobId: string, lockedBy: string, leaseVersion: number) {
  return and(
    eq(agentJobs.id, jobId),
    eq(agentJobs.lockedBy, lockedBy),
    eq(agentJobs.leaseVersion, leaseVersion),
    eq(agentJobs.status, 'processing'),
    sql`${agentJobs.lockExpiresAt} > now()`,
  );
}

function unwrapClaimRows(result: ClaimRowsResult): ClaimRow[] {
  return Array.isArray(result) ? result : result.rows;
}

// Exponential backoff: 2s, 8s, 32s, ... (4^(attempt-1) * 2000ms).
// job.attempt is post-incremented at claim time, so attempt=1 on first failure.
export function calculateBackoffMs(attempt: number): number {
  return Math.pow(4, attempt - 1) * 2000;
}

export async function claimNextQueuedJob(
  db: AgentDb,
  agentId: AgentId,
  workerId: string,
): Promise<QueueClaimResult | null> {
  const result = await db.execute<ClaimRow>(sql`
    WITH candidate AS (
      SELECT id
      FROM agent_jobs
      WHERE agent_id = ${agentId}
        AND status = 'queued'
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY priority DESC, created_at ASC, id ASC
      LIMIT 1
    )
    UPDATE agent_jobs
    SET status = 'processing',
        started_at = COALESCE(started_at, now()),
        attempt = attempt + 1,
        locked_by = ${workerId},
        lock_expires_at = now() + interval '5 minutes',
        last_heartbeat_at = now(),
        lease_version = lease_version + 1
    WHERE id = (SELECT id FROM candidate)
      AND status = 'queued'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    RETURNING
      id,
      agent_id AS "agentId",
      user_id AS "userId",
      job_type AS "jobType",
      status,
      priority,
      input,
      result,
      error_message AS "errorMessage",
      progress_note AS "progressNote",
      step_log AS "stepLog",
      attempt,
      max_attempts AS "maxAttempts",
      next_retry_at AS "nextRetryAt",
      locked_by AS "lockedBy",
      lock_expires_at AS "lockExpiresAt",
      last_heartbeat_at AS "lastHeartbeatAt",
      lease_version AS "leaseVersion",
      created_at AS "createdAt",
      started_at AS "startedAt",
      completed_at AS "completedAt";
  `);
  const rows = unwrapClaimRows(result);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const job = toAgentJob(row);
  return {
    job,
    leaseVersion: job.leaseVersion,
  };
}

export async function renewJobLease(
  db: AgentDb,
  jobId: string,
  lockedBy: string,
  leaseVersion: number,
): Promise<boolean> {
  const rows = await db.update(agentJobs)
    .set({
      lockExpiresAt: sql`now() + interval '5 minutes'`,
    })
    .where(processingLeaseFence(jobId, lockedBy, leaseVersion))
    .returning({ id: agentJobs.id });

  return rows.length > 0;
}

export async function heartbeatJob(
  db: AgentDb,
  jobId: string,
  lockedBy: string,
  leaseVersion: number,
): Promise<boolean> {
  const rows = await db.update(agentJobs)
    .set({
      lastHeartbeatAt: sql`now()`,
      lockExpiresAt: sql`now() + interval '5 minutes'`,
    })
    .where(processingLeaseFence(jobId, lockedBy, leaseVersion))
    .returning({ id: agentJobs.id });

  return rows.length > 0;
}

export async function completeJob(
  db: AgentDb,
  jobId: string,
  lockedBy: string,
  leaseVersion: number,
  result: unknown,
): Promise<boolean> {
  const rows = await db.update(agentJobs)
    .set({
      status: 'completed',
      result,
      completedAt: sql`now()`,
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
      nextRetryAt: null,
      errorMessage: null,
    })
    .where(processingLeaseFence(jobId, lockedBy, leaseVersion))
    .returning({ id: agentJobs.id });

  return rows.length > 0;
}

export async function failJob(
  db: AgentDb,
  jobId: string,
  lockedBy: string,
  leaseVersion: number,
  errorMessage: string,
): Promise<boolean> {
  const rows = await db.update(agentJobs)
    .set({
      status: 'failed',
      errorMessage,
      completedAt: sql`now()`,
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
      nextRetryAt: null,
    })
    .where(processingLeaseFence(jobId, lockedBy, leaseVersion))
    .returning({ id: agentJobs.id });

  return rows.length > 0;
}

export async function scheduleJobRetry(
  db: AgentDb,
  jobId: string,
  lockedBy: string,
  leaseVersion: number,
  nextRetryAt: Date,
  errorMessage?: string,
): Promise<boolean> {
  const rows = await db.update(agentJobs)
    .set({
      status: 'queued',
      nextRetryAt,
      completedAt: null,
      result: null,
      lockedBy: null,
      lockExpiresAt: null,
      lastHeartbeatAt: null,
      errorMessage: errorMessage === undefined ? sql`${agentJobs.errorMessage}` : errorMessage,
    })
    .where(processingLeaseFence(jobId, lockedBy, leaseVersion))
    .returning({ id: agentJobs.id });

  return rows.length > 0;
}

export async function persistStepLog(
  db: AgentDb,
  jobId: string,
  lockedBy: string,
  leaseVersion: number,
  stepLog: StepLogEntry[],
): Promise<boolean> {
  const rows = await db.update(agentJobs)
    .set({
      stepLog,
    })
    .where(processingLeaseFence(jobId, lockedBy, leaseVersion))
    .returning({ id: agentJobs.id });

  return rows.length > 0;
}
